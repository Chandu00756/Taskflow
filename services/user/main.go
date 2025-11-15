package main

import (
	"fmt"
	"log"
	"net"

	"github.com/chanduchitikam/task-management-system/pkg/auth"
	"github.com/chanduchitikam/task-management-system/pkg/config"
	"github.com/chanduchitikam/task-management-system/pkg/database"
	"github.com/chanduchitikam/task-management-system/services/user/models"
	"github.com/chanduchitikam/task-management-system/services/user/service"
	userpb "github.com/chanduchitikam/task-management-system/proto/user"
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
	if err := database.AutoMigrate(db, &models.User{}); err != nil {
		log.Fatalf("Failed to migrate database: %v", err)
	}

	// Create JWT manager
	jwtManager := auth.NewJWTManager(
		cfg.JWT.SecretKey,
		cfg.JWT.AccessTokenDuration,
		cfg.JWT.RefreshTokenDuration,
	)

	// Create gRPC server
	grpcServer := grpc.NewServer()

	// Register UserService
	userService := service.NewUserService(db, jwtManager)
	userpb.RegisterUserServiceServer(grpcServer, userService)

	// Register reflection for grpcurl
	reflection.Register(grpcServer)

	// Start listening
	addr := fmt.Sprintf(":%d", cfg.Server.GRPCPort)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("Failed to listen: %v", err)
	}

	log.Printf("UserService listening on %s", addr)
	if err := grpcServer.Serve(listener); err != nil {
		log.Fatalf("Failed to serve: %v", err)
	}
}
