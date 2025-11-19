package main

import (
	"fmt"
	"log"
	"net"
	"os"

	"github.com/chanduchitikam/task-management-system/pkg/database"
	"github.com/chanduchitikam/task-management-system/proto/organization"
	"github.com/chanduchitikam/task-management-system/services/org/service"
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

	log.Printf("✓ Organization Service listening on port %s", port)
	log.Println("✓ Ready to handle requests")

	if err := grpcServer.Serve(lis); err != nil {
		log.Fatalf("Failed to serve: %v", err)
	}
}
