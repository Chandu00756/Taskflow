package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/smtp"
	"os"
	"strings"
	"time"

	"github.com/chanduchitikam/task-management-system/pkg/auth"
	"github.com/chanduchitikam/task-management-system/pkg/config"
	"github.com/chanduchitikam/task-management-system/pkg/database"
	userpb "github.com/chanduchitikam/task-management-system/proto/user"
	"github.com/chanduchitikam/task-management-system/services/user/models"
	"github.com/chanduchitikam/task-management-system/services/user/service"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"
	"gorm.io/gorm"
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
	if err := database.AutoMigrate(db, &models.User{}, &models.Organization{}, &models.Invite{}); err != nil {
		log.Fatalf("Failed to migrate database: %v", err)
	}

	// Ensure global admin account exists (admin@taskflow.com)
	adminEmail := "admin@taskflow.com"
	adminPassword := "Tskadmin00756$"
	var admin models.User
	if err := db.Where("LOWER(email) = ?", adminEmail).First(&admin).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			hashed, err := auth.HashPassword(adminPassword)
			if err != nil {
				log.Fatalf("failed to hash admin password: %v", err)
			}
			admin = models.User{
				Email:    adminEmail,
				Username: "admin",
				Password: hashed,
				FullName: "TaskFlow Admin",
				Role:     "admin",
			}
			if err := db.Create(&admin).Error; err != nil {
				log.Fatalf("failed to create admin user: %v", err)
			}
			log.Printf("Created default admin account: %s", adminEmail)
		} else {
			log.Fatalf("failed to query admin user: %v", err)
		}
	} else {
		log.Printf("Admin account already exists: %s", adminEmail)
	}

	// 	// 	// Create JWT manager
	jwtManager := auth.NewJWTManager(
		cfg.JWT.SecretKey,
		cfg.JWT.AccessTokenDuration,
		cfg.JWT.RefreshTokenDuration,
	)

	// 	// 	// Create gRPC server
	grpcServer := grpc.NewServer()

	// Start a simple HTTP API for organization admin operations (invite/create/list users)
	go func() {
		httpMux := http.NewServeMux()

		// Create org user (org admin only) -> create invite (secure)
		httpMux.HandleFunc("/api/v1/orgs/users", func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodPost {
				// require Authorization header
				authHeader := r.Header.Get("Authorization")
				if authHeader == "" {
					http.Error(w, "missing authorization", http.StatusUnauthorized)
					return
				}
				token := strings.TrimPrefix(authHeader, "Bearer ")
				claims, err := jwtManager.ValidateToken(token)
				if err != nil {
					http.Error(w, "invalid token", http.StatusUnauthorized)
					return
				}

				// parse org_id from query
				orgID := r.URL.Query().Get("org_id")
				if orgID == "" {
					http.Error(w, "org_id is required", http.StatusBadRequest)
					return
				}

				// Only org admins for this org can create users
				if claims.Role != "admin" || claims.OrgID != orgID {
					// allow global admin to view but not create
					http.Error(w, "forbidden: only organization admins can create users", http.StatusForbidden)
					return
				}

				// decode body
				var req struct {
					Email        string `json:"email"`
					Username     string `json:"username"`
					FullName     string `json:"full_name"`
					Role         string `json:"role"`
					ExpiresHours int    `json:"expires_hours"`
				}
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
					http.Error(w, "invalid body", http.StatusBadRequest)
					return
				}

				if req.Email == "" || req.Username == "" {
					http.Error(w, "email and username required", http.StatusBadRequest)
					return
				}

				role := req.Role
				if role == "" {
					role = "member"
				}

				// generate secure token (plaintext returned once) and store only hash
				inviteToken, err := generateSecureToken(32)
				if err != nil {
					http.Error(w, "failed to generate invite token", http.StatusInternalServerError)
					return
				}
				tokenHash := hashString(inviteToken)

				expires := time.Now().Add(72 * time.Hour)
				if req.ExpiresHours > 0 {
					expires = time.Now().Add(time.Duration(req.ExpiresHours) * time.Hour)
				}

				invite := models.Invite{
					Email:     strings.ToLower(req.Email),
					OrgID:     orgID,
					Role:      role,
					TokenHash: tokenHash,
					ExpiresAt: expires,
					CreatedBy: claims.UserID,
				}

				if err := db.Create(&invite).Error; err != nil {
					http.Error(w, "failed to create invite", http.StatusInternalServerError)
					return
				}

				// In production, attempt to email the invite token; in development, return token in response.
				var emailed bool
				// Check SMTP configuration via environment variables
				smtpHost := os.Getenv("SMTP_HOST")
				smtpPort := os.Getenv("SMTP_PORT")
				smtpUser := os.Getenv("SMTP_USER")
				smtpPass := os.Getenv("SMTP_PASS")
				smtpFrom := os.Getenv("SMTP_FROM")

				if strings.ToLower(cfg.Server.Environment) != "development" && smtpHost != "" && smtpPort != "" {
					// attempt to send email
					body := fmt.Sprintf("You have been invited to join organization %s. Use this token to accept the invite: %s", orgID, inviteToken)
					if err := sendMail(smtpHost+":"+smtpPort, smtpUser, smtpPass, smtpFrom, invite.Email, "TaskFlow Invite", body); err != nil {
						log.Printf("warning: failed to send invite email: %v", err)
					} else {
						emailed = true
					}
				}

				resp := map[string]string{
					"invite_id": invite.ID,
					"email":     invite.Email,
				}
				if strings.ToLower(cfg.Server.Environment) == "development" {
					resp["token"] = inviteToken
				} else if emailed {
					resp["message"] = "invite emailed to recipient"
				} else {
					resp["message"] = "invite created; token delivery not configured"
				}

				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(resp)
				return
			}
			// For other methods, respond 405
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		})

		// Accept invite and set password -> create user
		httpMux.HandleFunc("/api/v1/invite/accept", func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			var req struct {
				Token    string `json:"token"`
				Password string `json:"password"`
				Username string `json:"username"`
				FullName string `json:"full_name"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "invalid body", http.StatusBadRequest)
				return
			}
			if req.Token == "" || req.Password == "" || req.Username == "" {
				http.Error(w, "token, password and username required", http.StatusBadRequest)
				return
			}

			// lookup invite by hashed token
			tokenHash := hashString(req.Token)
			var invite models.Invite
			if err := db.Where("token_hash = ?", tokenHash).First(&invite).Error; err != nil {
				http.Error(w, "invalid or expired invite", http.StatusBadRequest)
				return
			}
			if invite.UsedAt != nil || invite.ExpiresAt.Before(time.Now()) {
				http.Error(w, "invite already used or expired", http.StatusBadRequest)
				return
			}

			// ensure no existing user with this email
			var existing models.User
			if err := db.Where("LOWER(email) = ?", strings.ToLower(invite.Email)).First(&existing).Error; err == nil {
				http.Error(w, "user with this email already exists", http.StatusConflict)
				return
			}

			// create user
			hashedPass, err := auth.HashPassword(req.Password)
			if err != nil {
				http.Error(w, "failed to hash password", http.StatusInternalServerError)
				return
			}
			newUser := models.User{
				Email:    strings.ToLower(invite.Email),
				Username: req.Username,
				Password: hashedPass,
				FullName: req.FullName,
				Role:     invite.Role,
			}
			if invite.OrgID != "" {
				newUser.OrgID = &invite.OrgID
			}
			if err := db.Create(&newUser).Error; err != nil {
				http.Error(w, "failed to create user", http.StatusInternalServerError)
				return
			}

			now := time.Now()
			invite.UsedAt = &now
			if err := db.Save(&invite).Error; err != nil {
				// Log but don't fail creation
				log.Printf("warning: failed to mark invite used: %v", err)
			}

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"message": "user created successfully"})
		})

		// List org users (org admin or global admin)
		httpMux.HandleFunc("/api/v1/orgs/users/list", func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				http.Error(w, "missing authorization", http.StatusUnauthorized)
				return
			}
			token := strings.TrimPrefix(authHeader, "Bearer ")
			claims, err := jwtManager.ValidateToken(token)
			if err != nil {
				http.Error(w, "invalid token", http.StatusUnauthorized)
				return
			}

			orgID := r.URL.Query().Get("org_id")
			if orgID == "" {
				http.Error(w, "org_id is required", http.StatusBadRequest)
				return
			}

			// Allow if requester is org admin for this org OR global admin (seeded admin)
			isOrgAdmin := claims.Role == "admin" && claims.OrgID == orgID
			isGlobalAdmin := claims.Role == "admin" && claims.OrgID == "" && strings.ToLower(claims.Email) == "admin@taskflow.com"
			if !isOrgAdmin && !isGlobalAdmin {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}

			var users []models.User
			if err := db.Where("org_id = ?", orgID).Find(&users).Error; err != nil {
				http.Error(w, "failed to list users", http.StatusInternalServerError)
				return
			}

			out := make([]map[string]interface{}, 0, len(users))
			for _, u := range users {
				out = append(out, map[string]interface{}{
					"user_id":   u.ID,
					"email":     u.Email,
					"username":  u.Username,
					"full_name": u.FullName,
					"role":      u.Role,
				})
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{"users": out})
		})

		addr := fmt.Sprintf(":%d", cfg.Server.HTTPPort)
		log.Printf("UserService HTTP admin API listening on %s", addr)
		if err := http.ListenAndServe(addr, httpMux); err != nil {
			log.Fatalf("failed to start http admin api: %v", err)
		}
	}()

	// 	// 	// Register UserService
	userService := service.NewUserService(db, jwtManager)
	userpb.RegisterUserServiceServer(grpcServer, userService)

	// 	// 	// Register reflection for grpcurl
	reflection.Register(grpcServer)

	// 	// 	// Start listening
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

// sendMail sends a simple plaintext email using basic SMTP auth.
func sendMail(addr, user, pass, from, to, subject, body string) error {
	// If no SMTP user/pass provided, try unauthenticated send
	msg := "From: " + from + "\r\n" +
		"To: " + to + "\r\n" +
		"Subject: " + subject + "\r\n\r\n" +
		body + "\r\n"

	if user != "" && pass != "" {
		auth := smtp.PlainAuth("", user, pass, strings.Split(addr, ":")[0])
		return smtp.SendMail(addr, auth, from, []string{to}, []byte(msg))
	}
	return smtp.SendMail(addr, nil, from, []string{to}, []byte(msg))
}

// generateSecureToken returns a cryptographically secure random token of n bytes encoded as hex
func generateSecureToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// hashString returns a SHA-256 hex digest of the input string
func hashString(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}
