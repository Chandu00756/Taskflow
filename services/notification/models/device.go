package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Device represents a user device for push notifications
type Device struct {
	ID        string         `gorm:"primaryKey;type:uuid;default:gen_random_uuid()" json:"id"`
	UserID    string         `gorm:"type:uuid;not null;index" json:"user_id"`
	Token     string         `gorm:"not null;index" json:"token"`
	Platform  string         `gorm:"type:varchar(32)" json:"platform"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (d *Device) BeforeCreate(tx *gorm.DB) error {
	if d.ID == "" {
		d.ID = uuid.New().String()
	}
	return nil
}

func (Device) TableName() string {
	return "devices"
}
