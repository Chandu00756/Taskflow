package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// // // Task represents a task in the system
type Task struct {
	ID          string     `gorm:"primaryKey;type:uuid" json:"id"`
	Title       string     `gorm:"not null" json:"title"`
	Description string     `json:"description"`
	Status      string     `gorm:"not null;default:'todo'" json:"status"`
	Priority    string     `gorm:"not null;default:'medium'" json:"priority"`
	AssignedTo  *string    `gorm:"type:uuid;default:null" json:"assigned_to,omitempty"`
	OrgID       *string    `gorm:"type:uuid;index;default:null" json:"org_id,omitempty"`
	CreatedBy   string     `gorm:"type:uuid;not null" json:"created_by"`
	TeamID      *string    `gorm:"type:uuid;default:null" json:"team_id,omitempty"`
	GroupID     *string    `gorm:"type:uuid;default:null" json:"group_id,omitempty"`
	DueDate     *time.Time `json:"due_date,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	Tags        string     `gorm:"type:text" json:"tags"` // Stored as comma-separated values
}

// // // BeforeCreate hook to generate UUID
func (t *Task) BeforeCreate(tx *gorm.DB) error {
	if t.ID == "" {
		t.ID = uuid.New().String()
	}
	return nil
}

// // // TableName specifies the table name
func (Task) TableName() string {
	return "tasks"
}
