package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/chanduchitikam/task-management-system/gateway/middleware"
	"github.com/chanduchitikam/task-management-system/pkg/auth"
	"github.com/chanduchitikam/task-management-system/pkg/config"
	notificationpb "github.com/chanduchitikam/task-management-system/proto/notification"
	organizationpb "github.com/chanduchitikam/task-management-system/proto/organization"
	taskpb "github.com/chanduchitikam/task-management-system/proto/task"
	userpb "github.com/chanduchitikam/task-management-system/proto/user"
	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/encoding/protojson"
)

// hasScheme reports whether the provided address already contains a URI scheme
func hasScheme(addr string) bool {
	// simple check for scheme like "dns:///host:port" or "http://"
	return strings.Contains(addr, "://")
}

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func main() {
	// 	// 	// Load configuration
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// 	// 	// Create logger
	logger, err := zap.NewProduction()
	if err != nil {
		log.Fatalf("Failed to create logger: %v", err)
	}
	defer logger.Sync()

	// 	// 	// Create JWT manager
	jwtManager := auth.NewJWTManager(
		cfg.JWT.SecretKey,
		cfg.JWT.AccessTokenDuration,
		cfg.JWT.RefreshTokenDuration,
	)

	// 	// 	// Create middleware (for future HTTP-level implementation)
	_ = middleware.NewAuthInterceptor(jwtManager)
	rateLimiter := middleware.NewRateLimiter(100, 10) // 100 req/sec, burst of 10
	_ = middleware.NewLoggingInterceptor(logger)

	// 	// 	// Start cleanup for rate limiter
	rateLimiter.CleanupLimiters(5 * time.Minute)

	// 	// 	// Create gRPC-Gateway mux with metadata forwarder
	mux := runtime.NewServeMux(
		runtime.WithMarshalerOption(runtime.MIMEWildcard, &runtime.JSONPb{
			MarshalOptions: protojson.MarshalOptions{
				EmitDefaultValues: true, // Include false boolean values in JSON
				UseProtoNames:     true, // Use snake_case names from proto
			},
		}),
		runtime.WithIncomingHeaderMatcher(func(key string) (string, bool) {
			// Forward all X- headers and Grpc-Metadata- headers
			if strings.HasPrefix(key, "X-") || strings.HasPrefix(key, "Grpc-Metadata-") {
				return key, true
			}
			return runtime.DefaultHeaderMatcher(key)
		}),
		runtime.WithMetadata(func(ctx context.Context, req *http.Request) metadata.MD {
			md := metadata.MD{}
			// Forward authorization-related headers as metadata
			if val := req.Header.Get("X-User-Id"); val != "" {
				md.Set("user_id", val)
				md.Set("user-id", val)
			}
			if val := req.Header.Get("X-Role"); val != "" {
				md.Set("role", val)
			}
			if val := req.Header.Get("X-Org-Id"); val != "" {
				md.Set("org_id", val)
				md.Set("org-id", val)
			}
			return md
		}),
	)
	opts := []grpc.DialOption{
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	}

	ctx := context.Background()

	// 	// 	// Register UserService with DNS-scheme fallback
	userServiceAddr := getEnvOrDefault("USER_SERVICE_ADDR", fmt.Sprintf("localhost:%d", cfg.Server.GRPCPort))
	if err := userpb.RegisterUserServiceHandlerFromEndpoint(ctx, mux, userServiceAddr, opts); err != nil {
		// Retry using explicit DNS resolver scheme for Docker service names
		dnsAddr := userServiceAddr
		if !hasScheme(userServiceAddr) {
			dnsAddr = "dns:///" + userServiceAddr
		}
		if err2 := userpb.RegisterUserServiceHandlerFromEndpoint(ctx, mux, dnsAddr, opts); err2 != nil {
			log.Fatalf("Failed to register UserService (attempts: %v, %v): %v", err, err2, err2)
		}
	}

	// 	// 	// Register TaskService with DNS-scheme fallback
	taskServiceAddr := getEnvOrDefault("TASK_SERVICE_ADDR", fmt.Sprintf("localhost:%d", cfg.Server.GRPCPort+1))
	if err := taskpb.RegisterTaskServiceHandlerFromEndpoint(ctx, mux, taskServiceAddr, opts); err != nil {
		dnsAddr := taskServiceAddr
		if !hasScheme(taskServiceAddr) {
			dnsAddr = "dns:///" + taskServiceAddr
		}
		if err2 := taskpb.RegisterTaskServiceHandlerFromEndpoint(ctx, mux, dnsAddr, opts); err2 != nil {
			log.Fatalf("Failed to register TaskService (attempts: %v, %v): %v", err, err2, err2)
		}
	}

	// 	// 	// Register NotificationService with DNS-scheme fallback
	notificationServiceAddr := getEnvOrDefault("NOTIFICATION_SERVICE_ADDR", fmt.Sprintf("localhost:%d", cfg.Server.GRPCPort+2))
	if err := notificationpb.RegisterNotificationServiceHandlerFromEndpoint(ctx, mux, notificationServiceAddr, opts); err != nil {
		dnsAddr := notificationServiceAddr
		if !hasScheme(notificationServiceAddr) {
			dnsAddr = "dns:///" + notificationServiceAddr
		}
		if err2 := notificationpb.RegisterNotificationServiceHandlerFromEndpoint(ctx, mux, dnsAddr, opts); err2 != nil {
			log.Fatalf("Failed to register NotificationService (attempts: %v, %v): %v", err, err2, err2)
		}
	}

	// 	// 	// Register OrganizationService with DNS-scheme fallback
	orgServiceAddr := getEnvOrDefault("ORG_SERVICE_ADDR", fmt.Sprintf("localhost:%d", cfg.Server.GRPCPort+3))
	if err := organizationpb.RegisterOrganizationServiceHandlerFromEndpoint(ctx, mux, orgServiceAddr, opts); err != nil {
		dnsAddr := orgServiceAddr
		if !hasScheme(orgServiceAddr) {
			dnsAddr = "dns:///" + orgServiceAddr
		}
		if err2 := organizationpb.RegisterOrganizationServiceHandlerFromEndpoint(ctx, mux, dnsAddr, opts); err2 != nil {
			log.Fatalf("Failed to register OrganizationService (attempts: %v, %v): %v", err, err2, err2)
		}
	}

	// 	// 	// Add CORS middleware
	handler := corsMiddleware(mux, jwtManager)

	// 	// 	// Start HTTP server
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

// corsMiddleware validates JWT (when present), injects claims into the
// request context and also adds CORS headers expected by the frontend.
func corsMiddleware(next http.Handler, jwtManager *auth.JWTManager) http.Handler {
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

		// If an Authorization header is present, try to validate and inject claims
		authHeader := r.Header.Get("Authorization")
		if authHeader != "" {
			token := strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer"))
			token = strings.TrimSpace(token)
			if token != "" && jwtManager != nil {
				if claims, err := jwtManager.ValidateToken(token); err == nil {
					ctx := r.Context()
					ctx = context.WithValue(ctx, "user_id", claims.UserID)
					ctx = context.WithValue(ctx, "email", claims.Email)
					ctx = context.WithValue(ctx, "role", claims.Role)
					ctx = context.WithValue(ctx, "org_id", claims.OrgID)
					r = r.WithContext(ctx)

					// Also expose as HTTP headers so gRPC-gateway forwards them as metadata
					// (headers become metadata keys like "x-user-id")
					if claims.UserID != "" {
						r.Header.Set("X-User-Id", claims.UserID)
						r.Header.Set("Grpc-Metadata-user_id", claims.UserID)
						r.Header.Set("Grpc-Metadata-user-id", claims.UserID)
					}
					if claims.OrgID != "" {
						r.Header.Set("X-Org-Id", claims.OrgID)
						r.Header.Set("Grpc-Metadata-org_id", claims.OrgID)
						r.Header.Set("Grpc-Metadata-org-id", claims.OrgID)
					}
					if claims.Role != "" {
						r.Header.Set("X-Role", claims.Role)
						r.Header.Set("Grpc-Metadata-role", claims.Role)
					}
				}
			}
		}

		next.ServeHTTP(w, r)
	})
}
