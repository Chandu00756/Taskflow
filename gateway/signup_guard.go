package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/chanduchitikam/task-management-system/pkg/mailer"
)

// The sign-up guard sits in front of the self-service sign-up endpoints and
// keeps bots out before an account or organization is ever created:
//
//   - a Cloudflare Turnstile challenge (X-Captcha-Token) when a secret is set,
//   - a hidden form field real people never fill in (X-Signup-Trap),
//   - throwaway-inbox domains and links in names are refused,
//   - sign-ups are limited per client IP and across the whole site.

// signupPaths are the endpoints that create accounts without an invitation.
var signupPaths = map[string]bool{
	"/api/v1/auth/register":          true,
	"/api/v1/organizations/register": true,
}

const maxSignupBody = 64 << 10

// captchaVerifier checks a Turnstile token for the client at remoteIP.
type captchaVerifier func(ctx context.Context, token, remoteIP string) bool

type signupGuard struct {
	verify    captchaVerifier // nil: no CAPTCHA configured
	perHour   int             // per client IP
	perDay    int             // per client IP
	siteHour  int             // across all clients; 0 = unlimited
	mu        sync.Mutex
	byIP      map[string][]time.Time
	site      []time.Time
	now       func() time.Time
	trustXFF  bool
	lastSweep time.Time
}

func newSignupGuard(verify captchaVerifier, perHour, perDay, siteHour int, trustXFF bool) *signupGuard {
	return &signupGuard{verify: verify, perHour: perHour, perDay: perDay, siteHour: siteHour,
		byIP: map[string][]time.Time{}, now: time.Now, trustXFF: trustXFF}
}

// turnstileVerifier returns a verifier backed by Cloudflare's siteverify API.
func turnstileVerifier(secret string) captchaVerifier {
	client := &http.Client{Timeout: 8 * time.Second}
	return func(ctx context.Context, token, remoteIP string) bool {
		form := url.Values{"secret": {secret}, "response": {token}}
		if remoteIP != "" {
			form.Set("remoteip", remoteIP)
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://challenges.cloudflare.com/turnstile/v0/siteverify", strings.NewReader(form.Encode()))
		if err != nil {
			return false
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		resp, err := client.Do(req)
		if err != nil {
			log.Printf("signup guard: turnstile unreachable: %v", err)
			return false
		}
		defer resp.Body.Close()
		var out struct {
			Success bool `json:"success"`
		}
		if json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&out) != nil {
			return false
		}
		return out.Success
	}
}

// allow records a sign-up attempt from ip and reports whether it is within
// the per-IP and site-wide limits.
func (g *signupGuard) allow(ip string) (ok bool, reason string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	t := g.now()
	if t.Sub(g.lastSweep) > 10*time.Minute {
		for k, v := range g.byIP {
			if len(v) == 0 || t.Sub(v[len(v)-1]) > 24*time.Hour {
				delete(g.byIP, k)
			}
		}
		g.lastSweep = t
	}
	var day []time.Time
	hour := 0
	for _, at := range g.byIP[ip] {
		if t.Sub(at) < 24*time.Hour {
			day = append(day, at)
			if t.Sub(at) < time.Hour {
				hour++
			}
		}
	}
	g.byIP[ip] = day
	var site []time.Time
	for _, at := range g.site {
		if t.Sub(at) < time.Hour {
			site = append(site, at)
		}
	}
	g.site = site
	switch {
	case g.perHour > 0 && hour >= g.perHour, g.perDay > 0 && len(day) >= g.perDay:
		return false, "Too many sign-ups from your network. Please try again later."
	case g.siteHour > 0 && len(site) >= g.siteHour:
		return false, "Sign-ups are temporarily paused. Please try again in a little while."
	}
	g.byIP[ip] = append(day, t)
	g.site = append(site, t)
	return true, ""
}

// signupFields are the parts of a sign-up body the guard inspects.
type signupFields struct {
	Email         string `json:"email"`
	AdminEmail    string `json:"admin_email"`
	Username      string `json:"username"`
	FullName      string `json:"full_name"`
	AdminFullName string `json:"admin_full_name"`
	OrgName       string `json:"org_name"`
	Description   string `json:"description"`
}

func containsLink(s string) bool {
	l := strings.ToLower(s)
	return strings.Contains(l, "://") || strings.Contains(l, "www.") || strings.Contains(l, "<a ") || strings.Contains(l, "href=")
}

// check validates a sign-up request; it returns a status and message to
// reject it with, or 0 to let it through. The body is restored for the
// next handler.
func (g *signupGuard) check(r *http.Request, ip string) (int, string) {
	if strings.TrimSpace(r.Header.Get("X-Signup-Trap")) != "" {
		return http.StatusBadRequest, "We could not complete your sign-up."
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxSignupBody+1))
	_ = r.Body.Close()
	if err != nil || len(body) > maxSignupBody {
		return http.StatusRequestEntityTooLarge, "request too large"
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	r.ContentLength = int64(len(body))

	var f signupFields
	if json.Unmarshal(body, &f) != nil {
		return http.StatusBadRequest, "invalid request body"
	}
	email := strings.TrimSpace(f.Email)
	if email == "" {
		email = strings.TrimSpace(f.AdminEmail)
	}
	if addr, err := mail.ParseAddress(email); err != nil || addr.Address != email || !strings.Contains(mailer.Domain(email), ".") {
		return http.StatusBadRequest, "Enter a valid email address."
	}
	if mailer.IsDisposableDomain(mailer.Domain(email)) {
		return http.StatusBadRequest, "Disposable email addresses can't be used. Sign up with your work or personal email."
	}
	for _, s := range []string{f.Username, f.FullName, f.AdminFullName, f.OrgName, f.Description} {
		if containsLink(s) {
			return http.StatusBadRequest, "Names and descriptions can't contain links."
		}
	}
	if g.verify != nil {
		token := strings.TrimSpace(r.Header.Get("X-Captcha-Token"))
		if token == "" || len(token) > 4096 || !g.verify(r.Context(), token, ip) {
			return http.StatusBadRequest, "Please complete the human verification check and try again."
		}
	}
	if ok, reason := g.allow(ip); !ok {
		return http.StatusTooManyRequests, reason
	}
	return 0, ""
}

// middleware applies the guard to sign-up requests only.
func (g *signupGuard) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && signupPaths[strings.TrimRight(r.URL.Path, "/")] {
			ip := clientIP(r, g.trustXFF)
			if code, msg := g.check(r, ip); code != 0 {
				log.Printf("signup guard: refused sign-up from %s: %s", ip, msg)
				if code == http.StatusTooManyRequests {
					w.Header().Set("Retry-After", "3600")
				}
				writeJSONError(w, code, msg)
				return
			}
		}
		// The CAPTCHA and trap headers are for the guard only.
		r.Header.Del("X-Captcha-Token")
		r.Header.Del("X-Signup-Trap")
		next.ServeHTTP(w, r)
	})
}
