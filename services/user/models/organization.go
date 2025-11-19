package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// Organization represents an organisation/tenant in the system
type Organization struct {
	ID          string         `gorm:"primaryKey;type:uuid" json:"id"`
	Name        string         `gorm:"not null;uniqueIndex" json:"name"`
	Domain      string         `gorm:"not null;uniqueIndex" json:"domain"`
	Description *string        `json:"description"`
	Settings    datatypes.JSON `gorm:"type:jsonb;default:'{}'::jsonb" json:"settings"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
}

func (o *Organization) BeforeCreate(tx *gorm.DB) error {
	if o.ID == "" {
		o.ID = uuid.New().String()
	}
	return nil
}

func (Organization) TableName() string {
	return "organizations"
}
