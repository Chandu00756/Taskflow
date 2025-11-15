package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Notification represents a notification in the system
type Notification struct {
	ID            string    `gorm:"primaryKey;type:uuid;default:gen_random_uuid()" json:"id"`
	UserID        string    `gorm:"type:uuid;not null;index" json:"user_id"`
	Type          string    `gorm:"not null" json:"type"`
	Title         string    `gorm:"not null" json:"title"`
	Message       string    `gorm:"not null" json:"message"`
	TaskID        string    `gorm:"type:uuid" json:"task_id"`
	RelatedUserID string    `gorm:"type:uuid" json:"related_user_id"`
	Read          bool      `gorm:"default:false" json:"read"`
	Metadata      string    `gorm:"type:jsonb" json:"metadata"`
	CreatedAt     time.Time `json:"created_at"`
}

// BeforeCreate hook to generate UUID
func (n *Notification) BeforeCreate(tx *gorm.DB) error {
	if n.ID == "" {
		n.ID = uuid.New().String()
	}
	return nil
}

// TableName specifies the table name
func (Notification) TableName() string {
	return "notifications"
}
