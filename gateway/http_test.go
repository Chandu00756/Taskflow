package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/chanduchitikam/task-management-system/pkg/auth"
)

func echoIdentity() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Seen-Role", r.Header.Get("X-Role"))
		w.Header().Set("Seen-User", r.Header.Get("X-User-Id"))
		w.Header().Set("Seen-Grpc", r.Header.Get("Grpc-Metadata-Role"))
		w.WriteHeader(http.StatusOK)
	})
}

func TestForgedIdentityHeadersAreStripped(t *testing.T) {
	h := edgeMiddleware(echoIdentity(), gatewayOptions{cors: newCORSPolicy("http://app.test")})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/users", nil)
	req.Header.Set("X-Role", "super_admin")
	req.Header.Set("X-User-Id", "attacker")
	req.Header.Set("Grpc-Metadata-Role", "super_admin")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Header().Get("Seen-Role") != "" || rec.Header().Get("Seen-User") != "" || rec.Header().Get("Seen-Grpc") != "" {
		t.Fatalf("forged headers reached the backend: %v", rec.Header())
	}
}

func TestVerifiedTokenSetsIdentity(t *testing.T) {
	jwt := auth.NewJWTManager("test-secret", time.Hour, time.Hour)
	token, err := jwt.GenerateAccessToken("user-1", "u@x.test", "org_admin", "org-1")
	if err != nil {
		t.Fatal(err)
	}
	h := edgeMiddleware(echoIdentity(), gatewayOptions{cors: newCORSPolicy(""), jwt: jwt})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/users", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-Role", "super_admin") // must be overwritten by the verified claim
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Header().Get("Seen-Role") != "org_admin" || rec.Header().Get("Seen-User") != "user-1" {
		t.Fatalf("identity = %v", rec.Header())
	}
}

func TestCORSAllowList(t *testing.T) {
	h := edgeMiddleware(echoIdentity(), gatewayOptions{cors: newCORSPolicy("http://app.test")})
	allowed := httptest.NewRequest(http.MethodOptions, "/api/v2/me", nil)
	allowed.Header.Set("Origin", "http://app.test")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, allowed)
	if rec.Code != http.StatusNoContent || rec.Header().Get("Access-Control-Allow-Origin") != "http://app.test" {
		t.Fatalf("allowed origin rejected: %d %v", rec.Code, rec.Header())
	}
	evil := httptest.NewRequest(http.MethodOptions, "/api/v2/me", nil)
	evil.Header.Set("Origin", "http://evil.test")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, evil)
	if rec.Code != http.StatusForbidden || rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("disallowed origin accepted: %d %v", rec.Code, rec.Header())
	}
}

func TestRateLimit(t *testing.T) {
	h := edgeMiddleware(echoIdentity(), gatewayOptions{cors: newCORSPolicy(""), limiter: newIPLimiter(1, 2)})
	codes := []int{}
	for i := 0; i < 4; i++ {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v2/tickets", nil))
		codes = append(codes, rec.Code)
	}
	if codes[0] != 200 || codes[1] != 200 || codes[3] != http.StatusTooManyRequests {
		t.Fatalf("codes = %v", codes)
	}
	// Health checks are never rate limited.
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))
	if rec.Code != 200 {
		t.Fatalf("health limited: %d", rec.Code)
	}
}
