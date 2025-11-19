package models

import (
	"time"

	"github.com/google/uuid"
)

type Team struct {
	ID           uuid.UUID  `db:"id" json:"id"`
	OrgID        uuid.UUID  `db:"org_id" json:"org_id"`
	Name         string     `db:"name" json:"name"`
	Description  *string    `db:"description" json:"description,omitempty"`
	TeamLeadID   *uuid.UUID `db:"team_lead_id" json:"team_lead_id,omitempty"`
	ParentTeamID *uuid.UUID `db:"parent_team_id" json:"parent_team_id,omitempty"`
	Status       string     `db:"status" json:"status"`
	Metadata     string     `db:"metadata" json:"metadata"`
	CreatedAt    time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt    time.Time  `db:"updated_at" json:"updated_at"`
	CreatedBy    *uuid.UUID `db:"created_by" json:"created_by,omitempty"`
}

type TeamMember struct {
	ID       uuid.UUID  `db:"id" json:"id"`
	TeamID   uuid.UUID  `db:"team_id" json:"team_id"`
	UserID   uuid.UUID  `db:"user_id" json:"user_id"`
	Role     string     `db:"role" json:"role"`
	JoinedAt time.Time  `db:"joined_at" json:"joined_at"`
	LeftAt   *time.Time `db:"left_at" json:"left_at,omitempty"`
	IsActive bool       `db:"is_active" json:"is_active"`

	// Joined user data
	FullName string `db:"full_name" json:"full_name,omitempty"`
	Email    string `db:"email" json:"email,omitempty"`
	Username string `db:"username" json:"username,omitempty"`
}

type Project struct {
	ID               uuid.UUID  `db:"id" json:"id"`
	OrgID            uuid.UUID  `db:"org_id" json:"org_id"`
	Name             string     `db:"name" json:"name"`
	Description      *string    `db:"description" json:"description,omitempty"`
	ProjectManagerID *uuid.UUID `db:"project_manager_id" json:"project_manager_id,omitempty"`
	Status           string     `db:"status" json:"status"`
	Priority         string     `db:"priority" json:"priority"`
	StartDate        *time.Time `db:"start_date" json:"start_date,omitempty"`
	EndDate          *time.Time `db:"end_date" json:"end_date,omitempty"`
	Budget           *float64   `db:"budget" json:"budget,omitempty"`
	Progress         int32      `db:"progress" json:"progress"`
	Metadata         string     `db:"metadata" json:"metadata"`
	CreatedAt        time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt        time.Time  `db:"updated_at" json:"updated_at"`
	CreatedBy        *uuid.UUID `db:"created_by" json:"created_by,omitempty"`
}

type ProjectTeam struct {
	ID         uuid.UUID  `db:"id" json:"id"`
	ProjectID  uuid.UUID  `db:"project_id" json:"project_id"`
	TeamID     uuid.UUID  `db:"team_id" json:"team_id"`
	AssignedAt time.Time  `db:"assigned_at" json:"assigned_at"`
	AssignedBy *uuid.UUID `db:"assigned_by" json:"assigned_by,omitempty"`

	// Joined team data
	TeamName        string `db:"team_name" json:"team_name,omitempty"`
	TeamMemberCount int32  `db:"team_member_count" json:"team_member_count,omitempty"`
}

type ProjectMember struct {
	ID                   uuid.UUID  `db:"id" json:"id"`
	ProjectID            uuid.UUID  `db:"project_id" json:"project_id"`
	UserID               uuid.UUID  `db:"user_id" json:"user_id"`
	Role                 string     `db:"role" json:"role"`
	AllocationPercentage int32      `db:"allocation_percentage" json:"allocation_percentage"`
	JoinedAt             time.Time  `db:"joined_at" json:"joined_at"`
	LeftAt               *time.Time `db:"left_at" json:"left_at,omitempty"`
	IsActive             bool       `db:"is_active" json:"is_active"`

	// Joined user data
	FullName string `db:"full_name" json:"full_name,omitempty"`
	Email    string `db:"email" json:"email,omitempty"`
	Username string `db:"username" json:"username,omitempty"`
}

type Group struct {
	ID          uuid.UUID  `db:"id" json:"id"`
	OrgID       uuid.UUID  `db:"org_id" json:"org_id"`
	Name        string     `db:"name" json:"name"`
	Description *string    `db:"description" json:"description,omitempty"`
	GroupType   string     `db:"group_type" json:"group_type"`
	OwnerID     *uuid.UUID `db:"owner_id" json:"owner_id,omitempty"`
	Status      string     `db:"status" json:"status"`
	Metadata    string     `db:"metadata" json:"metadata"`
	CreatedAt   time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt   time.Time  `db:"updated_at" json:"updated_at"`
	CreatedBy   *uuid.UUID `db:"created_by" json:"created_by,omitempty"`
}

type GroupMember struct {
	ID       uuid.UUID `db:"id" json:"id"`
	GroupID  uuid.UUID `db:"group_id" json:"group_id"`
	UserID   uuid.UUID `db:"user_id" json:"user_id"`
	Role     string    `db:"role" json:"role"`
	JoinedAt time.Time `db:"joined_at" json:"joined_at"`
	IsActive bool      `db:"is_active" json:"is_active"`

	// Joined user data
	FullName string `db:"full_name" json:"full_name,omitempty"`
	Email    string `db:"email" json:"email,omitempty"`
	Username string `db:"username" json:"username,omitempty"`
	TeamName string `db:"team_name" json:"team_name,omitempty"`
}

type Workspace struct {
	ID            uuid.UUID  `db:"id" json:"id"`
	OrgID         uuid.UUID  `db:"org_id" json:"org_id"`
	Name          string     `db:"name" json:"name"`
	Description   *string    `db:"description" json:"description,omitempty"`
	WorkspaceType string     `db:"workspace_type" json:"workspace_type"`
	TeamID        *uuid.UUID `db:"team_id" json:"team_id,omitempty"`
	ProjectID     *uuid.UUID `db:"project_id" json:"project_id,omitempty"`
	OwnerID       *uuid.UUID `db:"owner_id" json:"owner_id,omitempty"`
	Settings      string     `db:"settings" json:"settings"`
	IsPrivate     bool       `db:"is_private" json:"is_private"`
	CreatedAt     time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt     time.Time  `db:"updated_at" json:"updated_at"`
}
