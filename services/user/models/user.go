package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// // // User represents a user in the system
type User struct {
	ID        string    `gorm:"primaryKey;type:uuid" json:"id"`
	Email     string    `gorm:"uniqueIndex;not null" json:"email"`
	Username  string    `gorm:"uniqueIndex;not null" json:"username"`
	Password  string    `gorm:"not null" json:"-"`
	FullName  string    `json:"full_name"`
	Role      string    `gorm:"not null;default:'member'" json:"role"`
	OrgID     *string   `gorm:"type:uuid;index" json:"org_id"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// // // BeforeCreate hook to generate UUID
func (u *User) BeforeCreate(tx *gorm.DB) error {
	if u.ID == "" {
		u.ID = uuid.New().String()
	}
	return nil
}

// // // TableName specifies the table name
func (User) TableName() string {
	return "users"
}
