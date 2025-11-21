package main

import (
	"fmt"
	"log"
	"net"
	"net/http"

	"github.com/chanduchitikam/task-management-system/pkg/cache"
	"github.com/chanduchitikam/task-management-system/pkg/config"
	"github.com/chanduchitikam/task-management-system/pkg/database"
	taskpb "github.com/chanduchitikam/task-management-system/proto/task"
	"github.com/chanduchitikam/task-management-system/services/task/models"
	"github.com/chanduchitikam/task-management-system/services/task/service"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"
)

func main() {
	// 	// 	// Load configuration
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// 	// 	// Connect to database
	db, err := database.NewPostgresConnection(cfg.Database.GetDSN())
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	// 	// 	// Auto-migrate models
	if err := database.AutoMigrate(db, &models.Task{}); err != nil {
		log.Fatalf("Failed to migrate database: %v", err)
	}

	// 	// 	// Connect to Redis
	redisClient, err := cache.NewRedisClient(
		cfg.Redis.GetRedisAddr(),
		cfg.Redis.Password,
		cfg.Redis.DB,
	)
	if err != nil {
		log.Fatalf("Failed to connect to Redis: %v", err)
	}

	// 	// 	// Create gRPC server
	grpcServer := grpc.NewServer()

	// 	// 	// Register TaskService
	taskService := service.NewTaskService(db, redisClient)
	taskpb.RegisterTaskServiceServer(grpcServer, taskService)

	// 	// 	// Register reflection
	reflection.Register(grpcServer)

	// Start HTTP server for metrics
	go func() {
		mux := http.NewServeMux()
		mux.Handle("/metrics", promhttp.Handler())
		metricsAddr := ":9093"
		log.Printf("TaskService metrics server listening on %s", metricsAddr)
		if err := http.ListenAndServe(metricsAddr, mux); err != nil {
			log.Fatalf("Failed to start metrics server: %v", err)
		}
	}()

	// 	// 	// Start listening (use different port from UserService)
	port := cfg.Server.GRPCPort + 1 // 50052
	addr := fmt.Sprintf(":%d", port)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("Failed to listen: %v", err)
	}

	log.Printf("TaskService listening on %s", addr)
	if err := grpcServer.Serve(listener); err != nil {
		log.Fatalf("Failed to serve: %v", err)
	}
}
