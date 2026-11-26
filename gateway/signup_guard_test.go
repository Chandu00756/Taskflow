package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func signupReq(path, body string, headers map[string]string) *http.Request {
	r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.RemoteAddr = "203.0.113.7:5555"
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	return r
}

func TestSignupGuard(t *testing.T) {
	passCaptcha := func(_ context.Context, token, _ string) bool { return token == "good" }
	var reached string
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Captcha-Token") != "" {
			t.Error("captcha header must not reach the backend")
		}
		b, _ := io.ReadAll(r.Body)
		reached = string(b)
		w.WriteHeader(http.StatusOK)
	})
	ok := `{"email":"ann@example.com","username":"ann","password":"x","full_name":"Ann"}`
	cases := []struct {
		name    string
		path    string
		body    string
		headers map[string]string
		want    int
	}{
		{"valid", "/api/v1/auth/register", ok, map[string]string{"X-Captcha-Token": "good"}, 200},
		{"missing captcha", "/api/v1/auth/register", ok, nil, 400},
		{"bad captcha", "/api/v1/auth/register", ok, map[string]string{"X-Captcha-Token": "forged"}, 400},
		{"honeypot", "/api/v1/auth/register", ok, map[string]string{"X-Captcha-Token": "good", "X-Signup-Trap": "http://spam"}, 400},
		{"disposable", "/api/v1/auth/register", `{"email":"bot@mailinator.com","username":"b"}`, map[string]string{"X-Captcha-Token": "good"}, 400},
		{"disposable subdomain", "/api/v1/auth/register", `{"email":"bot@x.yopmail.com","username":"b"}`, map[string]string{"X-Captcha-Token": "good"}, 400},
		{"invalid email", "/api/v1/auth/register", `{"email":"not-an-email","username":"b"}`, map[string]string{"X-Captcha-Token": "good"}, 400},
		{"link in name", "/api/v1/organizations/register", `{"admin_email":"a@corp.example","org_name":"Buy now https://spam.example"}`, map[string]string{"X-Captcha-Token": "good"}, 400},
		{"org valid", "/api/v1/organizations/register", `{"admin_email":"a@corp.example","org_name":"Corp","admin_full_name":"A"}`, map[string]string{"X-Captcha-Token": "good"}, 200},
		{"not json", "/api/v1/auth/register", `nope`, map[string]string{"X-Captcha-Token": "good"}, 400},
		{"login untouched", "/api/v1/auth/login", `{"email":"a@b.c"}`, nil, 200},
	}
	for _, c := range cases {
		g := newSignupGuard(passCaptcha, 3, 10, 0, false)
		h := g.middleware(next)
		reached = ""
		w := httptest.NewRecorder()
		h.ServeHTTP(w, signupReq(c.path, c.body, c.headers))
		if w.Code != c.want {
			t.Errorf("%s: status %d, want %d (%s)", c.name, w.Code, c.want, w.Body.String())
		}
		if c.want == 200 && reached != c.body {
			t.Errorf("%s: backend got body %q", c.name, reached)
		}
	}
}

func TestSignupGuardRateLimits(t *testing.T) {
	g := newSignupGuard(nil, 2, 3, 0, false)
	clock := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	g.now = func() time.Time { return clock }
	for i := 0; i < 2; i++ {
		if ok, _ := g.allow("1.1.1.1"); !ok {
			t.Fatalf("attempt %d refused", i)
		}
	}
	if ok, _ := g.allow("1.1.1.1"); ok {
		t.Fatal("third attempt in an hour must be refused")
	}
	if ok, _ := g.allow("2.2.2.2"); !ok {
		t.Fatal("another IP must not be affected")
	}
	clock = clock.Add(61 * time.Minute)
	if ok, _ := g.allow("1.1.1.1"); !ok {
		t.Fatal("hourly limit must reset")
	}
	if ok, _ := g.allow("1.1.1.1"); ok {
		t.Fatal("daily limit of 3 must apply")
	}

	site := newSignupGuard(nil, 0, 0, 2, false)
	site.allow("a")
	site.allow("b")
	if ok, reason := site.allow("c"); ok || !strings.Contains(reason, "paused") {
		t.Fatalf("site-wide cap not applied: %v %q", ok, reason)
	}
}

func TestSignupGuardWithoutCaptcha(t *testing.T) {
	g := newSignupGuard(nil, 3, 10, 0, false)
	w := httptest.NewRecorder()
	g.middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) })).
		ServeHTTP(w, signupReq("/api/v1/auth/register", `{"email":"ann@example.com","username":"ann"}`, nil))
	if w.Code != 200 {
		t.Fatalf("without a configured secret the CAPTCHA is skipped; got %d", w.Code)
	}
}
