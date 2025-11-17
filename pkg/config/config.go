package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// // // Config holds all application configuration
type Config struct {
	Server   ServerConfig
	Database DatabaseConfig
	Redis    RedisConfig
	JWT      JWTConfig
	Sentry   SentryConfig
}

// // // ServerConfig holds server-specific configuration
type ServerConfig struct {
	GRPCPort    int
	HTTPPort    int
	Environment string
}

// // // DatabaseConfig holds database connection configuration
type DatabaseConfig struct {
	Host     string
	Port     int
	User     string
	Password string
	DBName   string
	SSLMode  string
}

// // // RedisConfig holds Redis connection configuration
type RedisConfig struct {
	Host     string
	Port     int
	Password string
	DB       int
}

// // // JWTConfig holds JWT configuration
type JWTConfig struct {
	SecretKey            string
	AccessTokenDuration  time.Duration
	RefreshTokenDuration time.Duration
}

// // // SentryConfig holds Sentry configuration
type SentryConfig struct {
	DSN                string
	Release            string
	TracesSampleRate   float64
	ProfilesSampleRate float64
	GoVersion          string
}

// // // LoadConfig loads configuration from environment variables
func LoadConfig() (*Config, error) {
	config := &Config{
		Server: ServerConfig{
			GRPCPort:    getEnvAsInt("GRPC_PORT", 50051),
			HTTPPort:    getEnvAsInt("HTTP_PORT", 8080),
			Environment: getEnv("ENVIRONMENT", "development"),
		},
		Database: DatabaseConfig{
			Host:     getEnv("DB_HOST", "localhost"),
			Port:     getEnvAsInt("DB_PORT", 5432),
			User:     getEnv("DB_USER", "postgres"),
			Password: getEnv("DB_PASSWORD", "postgres"),
			DBName:   getEnv("DB_NAME", "taskmanagement"),
			SSLMode:  getEnv("DB_SSLMODE", "disable"),
		},
		Redis: RedisConfig{
			Host:     getEnv("REDIS_HOST", "localhost"),
			Port:     getEnvAsInt("REDIS_PORT", 6379),
			Password: getEnv("REDIS_PASSWORD", ""),
			DB:       getEnvAsInt("REDIS_DB", 0),
		},
		JWT: JWTConfig{
			SecretKey:            getEnv("JWT_SECRET", "your-secret-key-change-in-production"),
			AccessTokenDuration:  time.Hour * 24,
			RefreshTokenDuration: time.Hour * 24 * 7,
		},
		Sentry: SentryConfig{
			DSN:                getEnv("SENTRY_DSN", ""),
			Release:            getEnv("SENTRY_RELEASE", "1.0.0"),
			TracesSampleRate:   getEnvAsFloat("SENTRY_TRACES_SAMPLE_RATE", 0.1),
			ProfilesSampleRate: getEnvAsFloat("SENTRY_PROFILES_SAMPLE_RATE", 0.1),
			GoVersion:          getEnv("GO_VERSION", "1.24"),
		},
	}

	return config, nil
}

// // // GetDSN returns the database connection string
func (c *DatabaseConfig) GetDSN() string {
	return fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		c.Host, c.Port, c.User, c.Password, c.DBName, c.SSLMode,
	)
}

// // // GetRedisAddr returns the Redis connection address
func (c *RedisConfig) GetRedisAddr() string {
	return fmt.Sprintf("%s:%d", c.Host, c.Port)
}

// // // Helper functions
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvAsInt(key string, defaultValue int) int {
	valueStr := getEnv(key, "")
	if value, err := strconv.Atoi(valueStr); err == nil {
		return value
	}
	return defaultValue
}

func getEnvAsFloat(key string, defaultValue float64) float64 {
	valueStr := getEnv(key, "")
	if value, err := strconv.ParseFloat(valueStr, 64); err == nil {
		return value
	}
	return defaultValue
}
