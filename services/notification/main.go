package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/chanduchitikam/task-management-system/pkg/cache"
	"github.com/chanduchitikam/task-management-system/pkg/config"
	"github.com/chanduchitikam/task-management-system/pkg/database"
	notificationpb "github.com/chanduchitikam/task-management-system/proto/notification"
	"github.com/chanduchitikam/task-management-system/services/notification/models"
	"github.com/chanduchitikam/task-management-system/services/notification/service"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"
	"google.golang.org/protobuf/encoding/protojson"
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
	if err := database.AutoMigrate(db, &models.Notification{}, &models.NotificationPreference{}); err != nil {
		log.Fatalf("Failed to migrate database: %v", err)
	}
	if err := database.AutoMigrate(db, &models.Device{}); err != nil {
		log.Fatalf("Failed to migrate database: %v", err)
	}

	//  	//  	// Create gRPC server
	grpcServer := grpc.NewServer()

	//  	//  	// Create Redis client and NotificationService with distributed delivery
	redisClient, err := cache.NewRedisClient(cfg.Redis.GetRedisAddr(), cfg.Redis.Password, cfg.Redis.DB)
	if err != nil {
		log.Printf("warning: failed to connect to redis, proceeding without distributed delivery: %v", err)
	}

	//  	//  	// Register NotificationService (with a console provider for local delivery)
	// build provider list from env
	var providers []service.Provider
	// console provider always present for local visibility
	providers = append(providers, &service.ConsoleProvider{})

	// FCM provider (legacy server key)
	if fcmKey := os.Getenv("FCM_SERVER_KEY"); fcmKey != "" {
		if f := service.NewFCMProvider(fcmKey); f != nil {
			providers = append(providers, f)
			log.Println("FCM provider enabled")
		}
	}

	// APNs provider (token-based)
	apnsKeyPath := os.Getenv("APNS_KEY_PATH")
	apnsKeyID := os.Getenv("APNS_KEY_ID")
	apnsTeamID := os.Getenv("APNS_TEAM_ID")
	apnsTopic := os.Getenv("APNS_TOPIC")
	apnsSandbox := os.Getenv("APNS_USE_SANDBOX") == "1"
	if apnsKeyPath != "" && apnsKeyID != "" && apnsTeamID != "" && apnsTopic != "" {
		if ap, err := service.NewAPNSProvider(apnsKeyPath, apnsKeyID, apnsTeamID, apnsTopic, apnsSandbox); err == nil {
			providers = append(providers, ap)
			log.Println("APNs provider enabled")
		} else {
			log.Printf("failed to enable APNs provider: %v", err)
		}
	}

	notificationService := service.NewNotificationService(db, redisClient, providers...)
	notificationpb.RegisterNotificationServiceServer(grpcServer, notificationService)

	// Start a durable worker to consume Redis Stream and process deliveries
	if redisClient != nil {
		go func() {
			stream := "notifications:stream"
			group := "notification_workers"
			hostname := "local"
			if hn, err := os.Hostname(); err == nil {
				hostname = hn
			}
			consumer := fmt.Sprintf("%s-%d", hostname, os.Getpid())

			// create consumer group if not exists
			if err := redisClient.XGroupCreateMkStream(context.Background(), stream, group, "0"); err != nil {
				// ignore BUSYGROUP error
				if !strings.Contains(err.Error(), "BUSYGROUP") {
					log.Printf("warning: failed to create consumer group: %v", err)
				}
			}

			log.Printf("notification stream worker %s started", consumer)
			for {
				msgs, err := redisClient.XReadGroup(context.Background(), group, consumer, stream, 10, 5000*time.Millisecond)
				if err != nil {
					log.Printf("error reading from stream: %v", err)
					time.Sleep(time.Second)
					continue
				}
				if len(msgs) == 0 {
					continue
				}

				for _, m := range msgs {
					// payload stored under 'payload'
					raw, ok := m.Values["payload"]
					if !ok {
						// ack and skip malformed
						if _, err := redisClient.XAck(context.Background(), stream, group, m.ID); err != nil {
							log.Printf("failed to ack malformed message %s: %v", m.ID, err)
						}
						continue
					}

					var payloadStr string
					switch v := raw.(type) {
					case string:
						payloadStr = v
					case []byte:
						payloadStr = string(v)
					default:
						payloadStr = fmt.Sprintf("%v", v)
					}

					var event notificationpb.NotificationEvent
					if err := protojson.Unmarshal([]byte(payloadStr), &event); err != nil {
						log.Printf("failed to unmarshal stream payload for id %s: %v", m.ID, err)
						// move malformed payload to DLQ for inspection and ack the original
						dlqValues := map[string]interface{}{
							"original_message_id": m.ID,
							"user_id":             m.Values["user_id"],
							"payload":             payloadStr,
							"error":               err.Error(),
						}
						if _, addErr := redisClient.XAdd(context.Background(), "notifications:dlq", dlqValues); addErr != nil {
							log.Printf("failed to add to DLQ for message %s: %v", m.ID, addErr)
						}
						if _, ackErr := redisClient.XAck(context.Background(), stream, group, m.ID); ackErr != nil {
							log.Printf("failed to ack bad message %s: %v", m.ID, ackErr)
						}
						continue
					}

					// process delivery
					if err := notificationService.ProcessStreamEvent(context.Background(), &event); err != nil {
						log.Printf("error processing stream event %s: %v", event.NotificationId, err)
						// do not ack, let it be retried
						continue
					}

					// acknowledge
					if _, err := redisClient.XAck(context.Background(), stream, group, m.ID); err != nil {
						log.Printf("failed to ack message %s: %v", m.ID, err)
					}
				}
			}
		}()
	}

	// start internal HTTP server for device registration and metrics
	go func() {
		httpPort := cfg.Server.HTTPPort + 2
		mux := http.NewServeMux()

		// device registration
		mux.HandleFunc("/internal/notifications/devices", func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case "POST":
				var req struct {
					UserID   string `json:"user_id"`
					Token    string `json:"token"`
					Platform string `json:"platform"`
				}
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
					http.Error(w, "invalid body", http.StatusBadRequest)
					return
				}
				if req.UserID == "" || req.Token == "" {
					http.Error(w, "user_id and token required", http.StatusBadRequest)
					return
				}
				// upsert device by token
				// upsert device by token (create or update existing)
				var existing models.Device
				if err := db.Where("token = ?", req.Token).First(&existing).Error; err == nil {
					existing.UserID = req.UserID
					existing.Platform = req.Platform
					if err := db.Save(&existing).Error; err != nil {
						http.Error(w, "failed to update device", http.StatusInternalServerError)
						return
					}
				} else {
					dev := &models.Device{UserID: req.UserID, Token: req.Token, Platform: req.Platform}
					if err := db.Create(dev).Error; err != nil {
						http.Error(w, "failed to save device", http.StatusInternalServerError)
						return
					}
				}
				w.WriteHeader(http.StatusCreated)
				return
			case "GET":
				// list devices
				q := r.URL.Query().Get("user_id")
				var devices []models.Device
				if q != "" {
					db.Where("user_id = ?", q).Find(&devices)
				} else {
					db.Find(&devices)
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(devices)
				return
			default:
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
		})

		// metrics endpoint exposed via promhttp
		mux.Handle("/metrics", promhttp.Handler())

		addr := fmt.Sprintf(":%d", httpPort)
		log.Printf("internal HTTP server listening on %s", addr)
		if err := http.ListenAndServe(addr, mux); err != nil {
			log.Printf("internal HTTP server exited: %v", err)
		}
	}()

	// 	// 	// Register reflection
	reflection.Register(grpcServer)

	// 	// 	// Start listening (use different port)
	port := cfg.Server.GRPCPort + 2 // 50053
	addr := fmt.Sprintf(":%d", port)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("Failed to listen: %v", err)
	}

	log.Printf("NotificationService listening on %s", addr)
	// handle graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-quit
		log.Println("shutting down notification service...")
		// stop accepting new connections
		grpcServer.GracefulStop()
		// shutdown notification service resources
		if notificationService != nil {
			_ = notificationService.Shutdown(context.Background())
		}
		if redisClient != nil {
			_ = redisClient.Close()
		}
		log.Println("shutdown complete")
		os.Exit(0)
	}()

	if err := grpcServer.Serve(listener); err != nil {
		log.Fatalf("Failed to serve: %v", err)
	}
}
