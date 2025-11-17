package database

import (
	"fmt"
	"log"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// // // NewPostgresConnection creates a new PostgreSQL database connection
func NewPostgresConnection(dsn string) (*gorm.DB, error) {
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("failed to get database instance: %w", err)
	}

	// 	// 	// Set connection pool settings
	sqlDB.SetMaxIdleConns(10)
	sqlDB.SetMaxOpenConns(100)

	log.Println("Database connection established successfully")
	return db, nil
}

// // // AutoMigrate runs database migrations for the given models
func AutoMigrate(db *gorm.DB, models ...interface{}) error {
	return db.AutoMigrate(models...)
}
