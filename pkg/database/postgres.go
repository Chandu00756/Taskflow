package database

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"strconv"

	_ "github.com/lib/pq"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// // // NewPostgresConnection creates a new PostgreSQL database connection
func NewPostgresConnection(dsn string) (*gorm.DB, error) {
	// SQL statements can contain credentials and personal data; only log them
	// when explicitly requested.
	level := logger.Warn
	if os.Getenv("DB_LOG_QUERIES") == "true" {
		level = logger.Info
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(level),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("failed to get database instance: %w", err)
	}

	// Pool sizes are configurable so several services can share one
	// Postgres without exhausting max_connections.
	sqlDB.SetMaxIdleConns(EnvInt("DB_MAX_IDLE_CONNS", 10))
	sqlDB.SetMaxOpenConns(EnvInt("DB_MAX_OPEN_CONNS", 100))

	log.Println("Database connection established successfully")
	return db, nil
}

// // // AutoMigrate runs database migrations for the given models
func AutoMigrate(db *gorm.DB, models ...interface{}) error {
	return db.AutoMigrate(models...)
}

// Connect creates a raw sql.DB connection for services that don't use GORM
func Connect() (*sql.DB, error) {
	host := getEnv("DB_HOST", "localhost")
	port := getEnv("DB_PORT", "5432")
	user := getEnv("DB_USER", "postgres")
	password := getEnv("DB_PASSWORD", "postgres")
	dbname := getEnv("DB_NAME", "taskmanagement")

	sslmode := getEnv("DB_SSLMODE", "disable")

	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		host, port, user, password, dbname, sslmode)

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	db.SetMaxIdleConns(EnvInt("DB_MAX_IDLE_CONNS", 10))
	db.SetMaxOpenConns(EnvInt("DB_MAX_OPEN_CONNS", 100))

	log.Println("Database connection established successfully")
	return db, nil
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// EnvInt reads a positive integer setting, falling back when unset or invalid.
func EnvInt(key string, fallback int) int {
	if n, err := strconv.Atoi(os.Getenv(key)); err == nil && n > 0 {
		return n
	}
	return fallback
}
