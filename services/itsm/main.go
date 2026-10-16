// Command itsm runs the service desk (ITSM) REST API: tickets, problems,
// changes, releases, assets, service catalog, knowledge base and admin.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/chanduchitikam/task-management-system/pkg/auth"
	"github.com/chanduchitikam/task-management-system/pkg/config"
	"github.com/chanduchitikam/task-management-system/pkg/database"
	"github.com/chanduchitikam/task-management-system/services/itsm/app"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"gorm.io/gorm/schema"
)

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	if cfg.Server.Environment != "development" && cfg.JWT.SecretKey == "your-secret-key-change-in-production" {
		log.Fatal("JWT_SECRET must be set to a strong secret outside development")
	}

	logLevel := logger.Warn
	if os.Getenv("DB_LOG_QUERIES") == "true" {
		logLevel = logger.Info
	}
	var db *gorm.DB
	for attempt := 1; attempt <= 30; attempt++ {
		db, err = gorm.Open(postgres.Open(cfg.Database.GetDSN()), &gorm.Config{
			NamingStrategy: schema.NamingStrategy{TablePrefix: "itsm_"},
			Logger:         logger.Default.LogMode(logLevel),
			NowFunc:        func() time.Time { return time.Now().UTC() },
		})
		if err == nil {
			break
		}
		log.Printf("database not ready (attempt %d): %v", attempt, err)
		time.Sleep(2 * time.Second)
	}
	if err != nil {
		log.Fatalf("connect database: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatalf("database handle: %v", err)
	}
	sqlDB.SetMaxOpenConns(database.EnvInt("DB_MAX_OPEN_CONNS", 50))
	sqlDB.SetMaxIdleConns(database.EnvInt("DB_MAX_IDLE_CONNS", 10))
	sqlDB.SetConnMaxLifetime(30 * time.Minute)

	// The users table is owned by the user service; wait for it on fresh databases.
	for attempt := 1; attempt <= 60; attempt++ {
		if err = app.EnsureSchema(db); err == nil {
			break
		}
		log.Printf("schema not ready (attempt %d): %v", attempt, err)
		time.Sleep(2 * time.Second)
	}
	if err != nil {
		log.Fatalf("migrate: %v", err)
	}

	maxUpload, _ := strconv.ParseInt(env("MAX_UPLOAD_MB", "15"), 10, 64)
	mailPerMinute, perr := strconv.Atoi(env("SMTP_MAX_PER_MINUTE", "30"))
	if perr != nil || mailPerMinute < 0 {
		mailPerMinute = 30
	}
	jwt := auth.NewJWTManager(cfg.JWT.SecretKey, cfg.JWT.AccessTokenDuration, cfg.JWT.RefreshTokenDuration)
	application := app.New(db, jwt, app.Config{
		Environment:      cfg.Server.Environment,
		PublicURL:        env("PUBLIC_URL", "http://localhost:3000"),
		SMTPHost:         os.Getenv("SMTP_HOST"),
		SMTPPort:         env("SMTP_PORT", "587"),
		SMTPUser:         os.Getenv("SMTP_USER"),
		SMTPPass:         os.Getenv("SMTP_PASS"),
		SMTPFrom:         os.Getenv("SMTP_FROM"),
		SMTPMaxPerMinute: mailPerMinute,
		MaxUploadBytes:   maxUpload << 20,
		RefreshTokenTTL:  cfg.JWT.RefreshTokenDuration,
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if os.Getenv("DISABLE_WORKERS") != "true" {
		interval, _ := time.ParseDuration(env("WORKER_INTERVAL", "60s"))
		go application.RunWorkers(ctx, interval)
	}

	addr := ":" + env("ITSM_HTTP_PORT", "8090")
	srv := &http.Server{
		Addr:              addr,
		Handler:           application.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      120 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		log.Printf("ITSM service listening on %s", addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("serve: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	log.Println("shutting down ITSM service")
	cancel()
	shutdownCtx, done := context.WithTimeout(context.Background(), 20*time.Second)
	defer done()
	_ = srv.Shutdown(shutdownCtx)
}
