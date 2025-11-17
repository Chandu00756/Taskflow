package models

import (
	"time"

	"gorm.io/gorm"
)

// NotificationPreference stores per-user notification preferences
type NotificationPreference struct {
	ID     string `gorm:"primaryKey;type:uuid;default:gen_random_uuid()" json:"id"`
	UserID string `gorm:"type:uuid;not null;index" json:"user_id"`
	// Channels stores a JSON object mapping channel names to enabled/disabled, e.g. {"push":true,"email":false}
	Channels  string         `gorm:"type:jsonb;default:'{}'" json:"channels"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (NotificationPreference) TableName() string {
	return "notification_preferences"
}
