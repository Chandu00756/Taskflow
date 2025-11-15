package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/chanduchitikam/task-management-system/gateway/middleware"
	"github.com/chanduchitikam/task-management-system/pkg/auth"
	"github.com/chanduchitikam/task-management-system/pkg/config"
	notificationpb "github.com/chanduchitikam/task-management-system/proto/notification"
	taskpb "github.com/chanduchitikam/task-management-system/proto/task"
	userpb "github.com/chanduchitikam/task-management-system/proto/user"
	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func main() {
	// Load configuration
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Create logger
	logger, err := zap.NewProduction()
	if err != nil {
		log.Fatalf("Failed to create logger: %v", err)
	}
	defer logger.Sync()

	// Create JWT manager
	jwtManager := auth.NewJWTManager(
		cfg.JWT.SecretKey,
		cfg.JWT.AccessTokenDuration,
		cfg.JWT.RefreshTokenDuration,
	)

	// Create middleware (for future HTTP-level implementation)
	_ = middleware.NewAuthInterceptor(jwtManager)
	rateLimiter := middleware.NewRateLimiter(100, 10) // 100 req/sec, burst of 10
	_ = middleware.NewLoggingInterceptor(logger)

	// Start cleanup for rate limiter
	rateLimiter.CleanupLimiters(5 * time.Minute)

	// Create gRPC-Gateway mux
	mux := runtime.NewServeMux()
	opts := []grpc.DialOption{
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	}

	ctx := context.Background()

	// Register UserService
	userServiceAddr := getEnvOrDefault("USER_SERVICE_ADDR", fmt.Sprintf("localhost:%d", cfg.Server.GRPCPort))
	if err := userpb.RegisterUserServiceHandlerFromEndpoint(ctx, mux, userServiceAddr, opts); err != nil {
		log.Fatalf("Failed to register UserService: %v", err)
	}

	// Register TaskService
	taskServiceAddr := getEnvOrDefault("TASK_SERVICE_ADDR", fmt.Sprintf("localhost:%d", cfg.Server.GRPCPort+1))
	if err := taskpb.RegisterTaskServiceHandlerFromEndpoint(ctx, mux, taskServiceAddr, opts); err != nil {
		log.Fatalf("Failed to register TaskService: %v", err)
	}

	// Register NotificationService
	notificationServiceAddr := getEnvOrDefault("NOTIFICATION_SERVICE_ADDR", fmt.Sprintf("localhost:%d", cfg.Server.GRPCPort+2))
	if err := notificationpb.RegisterNotificationServiceHandlerFromEndpoint(ctx, mux, notificationServiceAddr, opts); err != nil {
		log.Fatalf("Failed to register NotificationService: %v", err)
	}

	// Add CORS middleware
	handler := corsMiddleware(mux)

	// Start HTTP server
	addr := fmt.Sprintf(":%d", cfg.Server.HTTPPort)
	logger.Info("API Gateway listening", zap.String("addr", addr))

	server := &http.Server{
		Addr:         addr,
		Handler:      handler,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("Failed to serve: %v", err)
	}
}

// corsMiddleware adds CORS headers
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			origin = "*"
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Max-Age", "86400")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}
