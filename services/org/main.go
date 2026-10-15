package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/chanduchitikam/task-management-system/pkg/auth"
	"github.com/chanduchitikam/task-management-system/pkg/config"
	"github.com/chanduchitikam/task-management-system/pkg/database"
	"github.com/chanduchitikam/task-management-system/proto/organization"
	"github.com/chanduchitikam/task-management-system/services/org/service"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"
)

func main() {
	log.Println("Starting Organization Service...")

	// Connect to database
	db, err := database.Connect()
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	log.Println("✓ Connected to database")

	// users/organizations are created by the user service; wait for them on a fresh database.
	var schemaErr error
	for attempt := 1; attempt <= 30; attempt++ {
		if schemaErr = service.EnsureSchema(context.Background(), db); schemaErr == nil {
			break
		}
		log.Printf("schema not ready (attempt %d): %v", attempt, schemaErr)
		time.Sleep(2 * time.Second)
	}
	if schemaErr != nil {
		log.Fatalf("Failed to ensure schema: %v", schemaErr)
	}
	log.Println("✓ Schema ready")

	// Create organization service
	orgService := service.NewOrganizationService(db)

	// Setup gRPC server
	port := os.Getenv("GRPC_PORT")
	if port == "" {
		port = "50054"
	}

	lis, err := net.Listen("tcp", fmt.Sprintf(":%s", port))
	if err != nil {
		log.Fatalf("Failed to listen on port %s: %v", port, err)
	}

	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}
	jwtManager := auth.NewJWTManager(cfg.JWT.SecretKey, cfg.JWT.AccessTokenDuration, cfg.JWT.RefreshTokenDuration)
	grpcServer := grpc.NewServer(
		grpc.ChainUnaryInterceptor(auth.UnaryIdentityInterceptor(jwtManager), service.AuthzUnaryInterceptor(db)),
		grpc.StreamInterceptor(auth.StreamIdentityInterceptor(jwtManager)),
	)
	organization.RegisterOrganizationServiceServer(grpcServer, orgService)

	// Enable reflection for grpcurl
	reflection.Register(grpcServer)

	// Start HTTP server for metrics
	go func() {
		mux := http.NewServeMux()
		mux.Handle("/metrics", promhttp.Handler())
		metricsAddr := ":9094"
		if v := os.Getenv("METRICS_ADDR"); v != "" {
			metricsAddr = v
		}
		log.Printf("OrganizationService metrics server listening on %s", metricsAddr)
		if err := http.ListenAndServe(metricsAddr, mux); err != nil {
			log.Fatalf("Failed to start metrics server: %v", err)
		}
	}()

	log.Printf("✓ Organization Service listening on port %s", port)
	log.Println("✓ Ready to handle requests")

	if err := grpcServer.Serve(lis); err != nil {
		log.Fatalf("Failed to serve: %v", err)
	}
}
