package main

import (
	"fmt"
	"log"
	"net"

	"github.com/chanduchitikam/task-management-system/pkg/config"
	"github.com/chanduchitikam/task-management-system/pkg/database"
	notificationpb "github.com/chanduchitikam/task-management-system/proto/notification"
	"github.com/chanduchitikam/task-management-system/services/notification/models"
	"github.com/chanduchitikam/task-management-system/services/notification/service"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"
)

func main() {
	// Load configuration
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Connect to database
	db, err := database.NewPostgresConnection(cfg.Database.GetDSN())
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	// Auto-migrate models
	if err := database.AutoMigrate(db, &models.Notification{}); err != nil {
		log.Fatalf("Failed to migrate database: %v", err)
	}

	// Create gRPC server
	grpcServer := grpc.NewServer()

	// Register NotificationService
	notificationService := service.NewNotificationService(db)
	notificationpb.RegisterNotificationServiceServer(grpcServer, notificationService)

	// Register reflection
	reflection.Register(grpcServer)

	// Start listening (use different port)
	port := cfg.Server.GRPCPort + 2 // 50053
	addr := fmt.Sprintf(":%d", port)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("Failed to listen: %v", err)
	}

	log.Printf("NotificationService listening on %s", addr)
	if err := grpcServer.Serve(listener); err != nil {
		log.Fatalf("Failed to serve: %v", err)
	}
}
