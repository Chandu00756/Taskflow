package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Invite represents an organization invite for a new user
type Invite struct {
	ID        string     `gorm:"primaryKey;type:uuid" json:"id"`
	Email     string     `gorm:"not null;index" json:"email"`
	OrgID     string     `gorm:"type:uuid;index" json:"org_id"`
	Role      string     `gorm:"not null;default:'member'" json:"role"`
	TokenHash string     `gorm:"not null" json:"token_hash"`
	ExpiresAt time.Time  `json:"expires_at"`
	UsedAt    *time.Time `json:"used_at,omitempty"`
	CreatedBy string     `gorm:"type:uuid" json:"created_by"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

func (i *Invite) BeforeCreate(tx *gorm.DB) error {
	if i.ID == "" {
		i.ID = uuid.New().String()
	}
	return nil
}

func (Invite) TableName() string {
	return "invites"
}
