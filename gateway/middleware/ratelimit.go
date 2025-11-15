package middleware

import (
	"context"
	"sync"
	"time"

	"golang.org/x/time/rate"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// RateLimiter implements rate limiting per IP or user
type RateLimiter struct {
	limiters map[string]*rate.Limiter
	mu       sync.RWMutex
	rate     rate.Limit
	burst    int
}

// NewRateLimiter creates a new rate limiter
func NewRateLimiter(requestsPerSecond int, burst int) *RateLimiter {
	return &RateLimiter{
		limiters: make(map[string]*rate.Limiter),
		rate:     rate.Limit(requestsPerSecond),
		burst:    burst,
	}
}

// getLimiter gets or creates a limiter for a key
func (rl *RateLimiter) getLimiter(key string) *rate.Limiter {
	rl.mu.RLock()
	limiter, exists := rl.limiters[key]
	rl.mu.RUnlock()

	if !exists {
		rl.mu.Lock()
		limiter = rate.NewLimiter(rl.rate, rl.burst)
		rl.limiters[key] = limiter
		rl.mu.Unlock()
	}

	return limiter
}

// Unary returns a rate limiting interceptor for unary RPCs
func (rl *RateLimiter) Unary() grpc.UnaryServerInterceptor {
	return func(
		ctx context.Context,
		req interface{},
		info *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler,
	) (interface{}, error) {
		// Use user_id from context if available, otherwise use method name
		key := info.FullMethod
		if userID, ok := ctx.Value("user_id").(string); ok {
			key = userID
		}

		limiter := rl.getLimiter(key)
		if !limiter.Allow() {
			return nil, status.Error(codes.ResourceExhausted, "rate limit exceeded")
		}

		return handler(ctx, req)
	}
}

// CleanupLimiters periodically removes inactive limiters
func (rl *RateLimiter) CleanupLimiters(interval time.Duration) {
	ticker := time.NewTicker(interval)
	go func() {
		for range ticker.C {
			rl.mu.Lock()
			for key, limiter := range rl.limiters {
				if limiter.Tokens() == float64(rl.burst) {
					delete(rl.limiters, key)
				}
			}
			rl.mu.Unlock()
		}
	}()
}
