package main

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"os"

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

	grpcServer := grpc.NewServer()
	organization.RegisterOrganizationServiceServer(grpcServer, orgService)

	// Enable reflection for grpcurl
	reflection.Register(grpcServer)

	// Start HTTP server for metrics
	go func() {
		mux := http.NewServeMux()
		mux.Handle("/metrics", promhttp.Handler())
		metricsAddr := ":9094"
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
