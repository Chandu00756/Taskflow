package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// // // User represents a user in the system
type User struct {
	ID       string  `gorm:"primaryKey;type:uuid" json:"id"`
	Email    string  `gorm:"uniqueIndex;not null" json:"email"`
	Username string  `gorm:"uniqueIndex;not null" json:"username"`
	Password string  `gorm:"not null" json:"-"`
	FullName string  `json:"full_name"`
	Role     string  `gorm:"not null;default:'member'" json:"role"`
	OrgID    *string `gorm:"type:uuid;index" json:"org_id"`

	// Password management
	MustChangePassword  bool       `gorm:"default:false" json:"must_change_password"`
	HasLoggedIn         bool       `gorm:"default:false" json:"has_logged_in"`
	LastLogin           *time.Time `json:"last_login"`
	FailedLoginAttempts int        `gorm:"default:0" json:"failed_login_attempts"`

	// Security questions (JSON: [{question: "Q1", answer_hash: "hash1"}, ...])
	SecurityQuestions string `gorm:"type:text" json:"security_questions,omitempty"`

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
