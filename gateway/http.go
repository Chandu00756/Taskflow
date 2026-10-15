package main

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/chanduchitikam/task-management-system/pkg/auth"
	"golang.org/x/time/rate"
)

// spoofableHeaders carry identity between the gateway and backend services.
// They must never be accepted from clients.
var spoofableHeaders = []string{"X-User-Id", "X-Org-Id", "X-Role", "X-Email"}

// stripIdentityHeaders removes identity headers and any Grpc-Metadata-*
// header supplied by the client so only verified identity reaches services.
func stripIdentityHeaders(h http.Header) {
	for _, k := range spoofableHeaders {
		h.Del(k)
	}
	for k := range h {
		if strings.HasPrefix(strings.ToLower(k), "grpc-metadata-") {
			delete(h, k)
		}
	}
}

// corsPolicy decides which browser origins may call the API with credentials.
type corsPolicy struct {
	allowAll bool
	origins  map[string]bool
}

func newCORSPolicy(raw string) corsPolicy {
	p := corsPolicy{origins: map[string]bool{}}
	for _, o := range strings.Split(raw, ",") {
		o = strings.TrimRight(strings.TrimSpace(o), "/")
		if o == "*" {
			p.allowAll = true
		} else if o != "" {
			p.origins[o] = true
		}
	}
	return p
}

func (p corsPolicy) allowed(origin string) bool {
	return origin != "" && (p.allowAll || p.origins[origin])
}

// ipLimiter is a per-client token bucket used to protect the API from abuse.
type ipLimiter struct {
	mu       sync.Mutex
	limiters map[string]*limiterEntry
	rate     rate.Limit
	burst    int
}

type limiterEntry struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

func newIPLimiter(perSecond float64, burst int) *ipLimiter {
	l := &ipLimiter{limiters: map[string]*limiterEntry{}, rate: rate.Limit(perSecond), burst: burst}
	go func() {
		for range time.Tick(time.Minute) {
			l.mu.Lock()
			for k, e := range l.limiters {
				if time.Since(e.lastSeen) > 5*time.Minute {
					delete(l.limiters, k)
				}
			}
			l.mu.Unlock()
		}
	}()
	return l
}

func (l *ipLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	e, ok := l.limiters[key]
	if !ok {
		e = &limiterEntry{limiter: rate.NewLimiter(l.rate, l.burst)}
		l.limiters[key] = e
	}
	e.lastSeen = time.Now()
	return e.limiter.Allow()
}

func clientIP(r *http.Request, trustProxy bool) string {
	if trustProxy {
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			return strings.TrimSpace(strings.Split(fwd, ",")[0])
		}
		if real := r.Header.Get("X-Real-Ip"); real != "" {
			return real
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func writeJSONError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"code": code, "message": msg})
}

type gatewayOptions struct {
	cors       corsPolicy
	limiter    *ipLimiter
	trustProxy bool
	jwt        *auth.JWTManager
}

// edgeMiddleware applies security headers, CORS, rate limiting and identity
// injection before handing the request to the API router.
func edgeMiddleware(next http.Handler, opts gatewayOptions) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")

		origin := r.Header.Get("Origin")
		if opts.cors.allowed(origin) {
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Access-Control-Allow-Credentials", "true")
			h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
			h.Set("Access-Control-Expose-Headers", "Content-Disposition, X-Total-Count")
			h.Set("Access-Control-Max-Age", "86400")
			h.Add("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			if origin != "" && !opts.cors.allowed(origin) {
				w.WriteHeader(http.StatusForbidden)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}

		if opts.limiter != nil && !strings.HasPrefix(r.URL.Path, "/health") && r.URL.Path != "/metrics" {
			if !opts.limiter.allow(clientIP(r, opts.trustProxy)) {
				h.Set("Retry-After", "1")
				writeJSONError(w, http.StatusTooManyRequests, "rate limit exceeded")
				return
			}
		}

		stripIdentityHeaders(r.Header)
		if token := bearerToken(r); token != "" && opts.jwt != nil {
			if claims, err := opts.jwt.ValidateToken(token); err == nil {
				ctx := r.Context()
				ctx = context.WithValue(ctx, ctxKeyClaims{}, claims)
				r = r.WithContext(ctx)
				r.Header.Set("X-User-Id", claims.UserID)
				r.Header.Set("X-Org-Id", claims.OrgID)
				r.Header.Set("X-Role", claims.Role)
				r.Header.Set("X-Email", claims.Email)
			}
		}
		next.ServeHTTP(w, r)
	})
}

type ctxKeyClaims struct{}

func bearerToken(r *http.Request) string {
	h := strings.TrimSpace(r.Header.Get("Authorization"))
	if len(h) > 7 && strings.EqualFold(h[:7], "bearer ") {
		return strings.TrimSpace(h[7:])
	}
	return ""
}

// newServiceProxy forwards matching requests to an HTTP backend service.
func newServiceProxy(target string) (http.Handler, error) {
	u, err := url.Parse(target)
	if err != nil {
		return nil, err
	}
	proxy := httputil.NewSingleHostReverseProxy(u)
	base := proxy.Director
	proxy.Director = func(r *http.Request) {
		base(r)
		r.Host = u.Host
		// CORS is owned by the gateway; drop the browser origin so the
		// backend does not emit a second set of CORS headers.
		r.Header.Del("Origin")
	}
	proxy.ModifyResponse = func(resp *http.Response) error {
		for _, k := range []string{"Access-Control-Allow-Origin", "Access-Control-Allow-Credentials", "Access-Control-Allow-Methods", "Access-Control-Allow-Headers"} {
			resp.Header.Del(k)
		}
		return nil
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, _ error) {
		writeJSONError(w, http.StatusBadGateway, "service temporarily unavailable")
	}
	return proxy, nil
}
