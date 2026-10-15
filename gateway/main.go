package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/chanduchitikam/task-management-system/pkg/auth"
	"github.com/chanduchitikam/task-management-system/pkg/config"
	notificationpb "github.com/chanduchitikam/task-management-system/proto/notification"
	organizationpb "github.com/chanduchitikam/task-management-system/proto/organization"
	taskpb "github.com/chanduchitikam/task-management-system/proto/task"
	userpb "github.com/chanduchitikam/task-management-system/proto/user"
	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"github.com/prometheus/client_golang/prometheus/promhttp"
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
			if val := req.Header.Get("X-Email"); val != "" {
				md.Set("email", val)
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

	// Register metrics endpoint
	if err := mux.HandlePath("GET", "/metrics", func(w http.ResponseWriter, r *http.Request, pathParams map[string]string) {
		promhttp.Handler().ServeHTTP(w, r)
	}); err != nil {
		log.Fatalf("Failed to register /metrics endpoint: %v", err)
	}

	// Service desk (ITSM) REST API is served by a plain HTTP service.
	itsmProxy, err := newServiceProxy(getEnvOrDefault("ITSM_SERVICE_URL", "http://localhost:8090"))
	if err != nil {
		log.Fatalf("invalid ITSM_SERVICE_URL: %v", err)
	}

	root := http.NewServeMux()
	root.Handle("/api/v2/", itsmProxy)
	health := func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}
	root.HandleFunc("/health", health)
	root.HandleFunc("/healthz", health)
	root.HandleFunc("/ready", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ready"}`))
	})
	root.Handle("/", mux)

	handler := edgeMiddleware(root, gatewayOptions{
		cors:       newCORSPolicy(getEnvOrDefault("CORS_ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")),
		limiter:    newIPLimiter(float64(getEnvAsInt("RATE_LIMIT_RPS", 50)), getEnvAsInt("RATE_LIMIT_BURST", 100)),
		trustProxy: os.Getenv("TRUST_PROXY_HEADERS") == "true",
		jwt:        jwtManager,
	})

	// 	// 	// Start HTTP server
	addr := fmt.Sprintf(":%d", cfg.Server.HTTPPort)
	logger.Info("API Gateway listening", zap.String("addr", addr))

	server := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to serve: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	logger.Info("shutting down gateway")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdownCtx)
}

func getEnvAsInt(key string, fallback int) int {
	if v, err := strconv.Atoi(os.Getenv(key)); err == nil {
		return v
	}
	return fallback
}
