package app

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// Base is embedded by every tenant-owned record.
type Base struct {
	ID        string    `gorm:"primaryKey;type:uuid" json:"id"`
	OrgID     string    `gorm:"type:uuid;index;not null" json:"-"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// BeforeCreate assigns a UUID when none was set.
func (b *Base) BeforeCreate(*gorm.DB) error {
	if b.ID == "" {
		b.ID = uuid.NewString()
	}
	return nil
}

// ---------------------------------------------------------------------------
// Account & configuration
// ---------------------------------------------------------------------------

// Settings holds helpdesk-wide configuration for one organization.
type Settings struct {
	OrgID                    string         `gorm:"primaryKey;type:uuid" json:"-"`
	HelpdeskName             string         `json:"helpdesk_name"`
	PortalName               string         `json:"portal_name"`
	PortalWelcome            string         `gorm:"type:text" json:"portal_welcome"`
	SupportEmail             string         `json:"support_email"`
	TimeZone                 string         `json:"time_zone"`
	DateFormat               string         `json:"date_format"`
	Language                 string         `json:"language"`
	PrimaryColor             string         `json:"primary_color"`
	LogoURL                  string         `gorm:"type:text" json:"logo_url"`
	AutoCloseResolvedHours   int            `json:"auto_close_resolved_hours"`
	AllowRequesterSignup     bool           `json:"allow_requester_signup"`
	RequesterCanClose        bool           `json:"requester_can_close"`
	RequesterCanReopen       bool           `json:"requester_can_reopen"`
	DeptHeadSeesDeptTickets  bool           `json:"dept_head_sees_dept_tickets"`
	CSATEnabled              bool           `json:"csat_enabled"`
	RequireCategoryOnResolve bool           `json:"require_category_on_resolve"`
	RequireTimeOnClose       bool           `json:"require_time_on_close"`
	CreateRequesterFromEmail bool           `json:"create_requester_from_email"`
	InboundEmailKey          string         `json:"inbound_email_key,omitempty"`
	PasswordMinLength        int            `json:"password_min_length"`
	PasswordRequireUpper     bool           `json:"password_require_upper"`
	PasswordRequireNumber    bool           `json:"password_require_number"`
	PasswordRequireSpecial   bool           `json:"password_require_special"`
	SessionTimeoutMinutes    int            `json:"session_timeout_minutes"`
	PrefixIncident           string         `json:"prefix_incident"`
	PrefixServiceRequest     string         `json:"prefix_service_request"`
	PrefixProblem            string         `json:"prefix_problem"`
	PrefixChange             string         `json:"prefix_change"`
	PrefixRelease            string         `json:"prefix_release"`
	CustomStatuses           datatypes.JSON `json:"custom_statuses"`
	Seeded                   bool           `json:"-"`
	// DefaultsVersion records which built-in defaults were added, so a
	// default an admin later deletes is not added again.
	DefaultsVersion int       `json:"-"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// TableName pins the singular settings table name.
func (Settings) TableName() string { return "itsm_settings" }

// Counter issues human-friendly sequential numbers per org and entity.
type Counter struct {
	OrgID  string `gorm:"primaryKey;type:uuid"`
	Entity string `gorm:"primaryKey"`
	Value  int64
}

// Person extends a platform user with helpdesk profile data. Agents are
// people with IsAgent set; everyone else is a requester.
type Person struct {
	UserID             string         `gorm:"primaryKey;type:uuid" json:"user_id"`
	OrgID              string         `gorm:"type:uuid;index;not null" json:"-"`
	IsAgent            bool           `json:"is_agent"`
	AgentType          string         `json:"agent_type"`
	RoleIDs            datatypes.JSON `json:"role_ids"`
	TicketScope        string         `json:"ticket_scope"`
	JobTitle           string         `json:"job_title"`
	JobRoleID          *string        `gorm:"type:uuid;index" json:"job_role_id"`
	Phone              string         `json:"phone"`
	Mobile             string         `json:"mobile"`
	DepartmentID       *string        `gorm:"type:uuid" json:"department_id"`
	LocationID         *string        `gorm:"type:uuid" json:"location_id"`
	ReportingManagerID *string        `gorm:"type:uuid" json:"reporting_manager_id"`
	TimeZone           string         `json:"time_zone"`
	Language           string         `json:"language"`
	Signature          string         `gorm:"type:text" json:"signature"`
	// Out of office: auto-assignment skips the agent and approvals go to the delegate.
	OOOStart      *time.Time `json:"ooo_start"`
	OOOEnd        *time.Time `json:"ooo_end"`
	OOODelegateID *string    `gorm:"type:uuid" json:"ooo_delegate_id"`
	OOOMessage    string     `json:"ooo_message"`
	// NotificationPrefs maps an event to channel switches, e.g. {"mention":{"in_app":false}}.
	NotificationPrefs datatypes.JSON `json:"-"`
	Address           string         `gorm:"type:text" json:"address"`
	Background        string         `gorm:"type:text" json:"background"`
	VIP               bool           `json:"vip"`
	ExternalID        string         `json:"external_id"`
	Available         bool           `json:"available"`
	LastActiveAt      *time.Time     `json:"last_active_at"`
	CreatedAt         time.Time      `json:"created_at"`
	UpdatedAt         time.Time      `json:"updated_at"`
}

// Role is an agent role with a set of privileges.
type Role struct {
	Base
	Name        string         `gorm:"not null" json:"name"`
	Description string         `json:"description"`
	Privileges  datatypes.JSON `json:"privileges"`
	IsDefault   bool           `json:"is_default"`
}

// AgentGroup routes work to a set of agents.
type AgentGroup struct {
	Base
	Name                 string  `gorm:"not null" json:"name"`
	Description          string  `json:"description"`
	EscalateToID         *string `gorm:"type:uuid" json:"escalate_to_id"`
	UnassignedForMinutes int     `json:"unassigned_for_minutes"`
	BusinessHoursID      *string `gorm:"type:uuid" json:"business_hours_id"`
	AutoAssign           bool    `json:"auto_assign"`
	RoundRobinCursor     int     `json:"-"`
	Restricted           bool    `json:"restricted"`
	LeaderID             *string `gorm:"type:uuid" json:"leader_id"`
	Email                string  `json:"email"`
}

// GroupMember links agents to agent groups.
type GroupMember struct {
	GroupID string `gorm:"primaryKey;type:uuid" json:"group_id"`
	UserID  string `gorm:"primaryKey;type:uuid" json:"user_id"`
	OrgID   string `gorm:"type:uuid;index;not null" json:"-"`
	// Role is "member" (assignable) or "observer" (sees group tickets, never auto-assigned).
	Role      string    `gorm:"not null;default:'member'" json:"role"`
	CreatedAt time.Time `json:"created_at"`
}

// Department is an organizational unit (OU). Units form a tree: company,
// division, business unit, department and smaller units. People belong to
// one primary unit; requesters are placed by email domain when it matches.
type Department struct {
	Base
	Name        string         `gorm:"not null" json:"name"`
	Description string         `json:"description"`
	HeadUserID  *string        `gorm:"type:uuid" json:"head_user_id"`
	PrimeUserID *string        `gorm:"type:uuid" json:"prime_user_id"`
	Domains     datatypes.JSON `json:"domains"`
	ParentID    *string        `gorm:"type:uuid;index" json:"parent_id"`
	Kind        string         `json:"kind"`
	Code        string         `json:"code"`
	CostCenter  string         `json:"cost_center"`
	LocationID  *string        `gorm:"type:uuid" json:"location_id"`
	Email       string         `json:"email"`
}

// Team is a set of people that work together across units. Static teams
// list their members; dynamic teams compute membership from rules.
type Team struct {
	Base
	Name        string         `gorm:"not null" json:"name"`
	Description string         `gorm:"type:text" json:"description"`
	Kind        string         `json:"kind"`
	LeadUserID  *string        `gorm:"type:uuid" json:"lead_user_id"`
	UnitID      *string        `gorm:"type:uuid" json:"unit_id"`
	Email       string         `json:"email"`
	Color       string         `json:"color"`
	Rules       datatypes.JSON `json:"rules"`
}

// TeamMember lists the members of a static team.
type TeamMember struct {
	TeamID    string    `gorm:"primaryKey;type:uuid" json:"team_id"`
	UserID    string    `gorm:"primaryKey;type:uuid;index" json:"user_id"`
	OrgID     string    `gorm:"type:uuid;index;not null" json:"-"`
	CreatedAt time.Time `json:"created_at"`
}

// Avatar stores a profile picture, served publicly by unguessable user id.
type Avatar struct {
	UserID      string    `gorm:"primaryKey;type:uuid" json:"user_id"`
	OrgID       string    `gorm:"type:uuid;index;not null" json:"-"`
	ContentType string    `json:"content_type"`
	Data        []byte    `json:"-"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// Location is a physical site that people and assets belong to.
type Location struct {
	Base
	Name        string  `gorm:"not null" json:"name"`
	ParentID    *string `gorm:"type:uuid" json:"parent_id"`
	Address     string  `json:"address"`
	City        string  `json:"city"`
	State       string  `json:"state"`
	Country     string  `json:"country"`
	Zip         string  `json:"zip"`
	ContactName string  `json:"contact_name"`
	Email       string  `json:"email"`
	Phone       string  `json:"phone"`
}

// BusinessHours defines a support calendar.
type BusinessHours struct {
	Base
	Name         string         `gorm:"not null" json:"name"`
	Description  string         `json:"description"`
	IsDefault    bool           `json:"is_default"`
	TimeZone     string         `json:"time_zone"`
	AlwaysOpen   bool           `json:"always_open"`
	WorkingHours datatypes.JSON `json:"working_hours"`
	Holidays     datatypes.JSON `json:"holidays"`
}

// TableName keeps the plural name readable.
func (BusinessHours) TableName() string { return "itsm_business_hours" }

// SLAPolicy defines response/resolution targets for matching tickets.
type SLAPolicy struct {
	Base
	Name        string         `gorm:"not null" json:"name"`
	Description string         `json:"description"`
	IsDefault   bool           `json:"is_default"`
	Active      bool           `json:"active"`
	Position    int            `json:"position"`
	Conditions  datatypes.JSON `json:"conditions"`
	Targets     datatypes.JSON `json:"targets"`
	Escalations datatypes.JSON `json:"escalations"`
}

// ---------------------------------------------------------------------------
// Service desk records
// ---------------------------------------------------------------------------

// Ticket is an incident or service request.
type Ticket struct {
	Base
	Number           int64          `gorm:"index" json:"number"`
	Type             string         `gorm:"index;not null" json:"type"`
	Subject          string         `gorm:"not null" json:"subject"`
	Description      string         `gorm:"type:text" json:"description"`
	Status           string         `gorm:"index;not null" json:"status"`
	Priority         int            `gorm:"index" json:"priority"`
	Urgency          int            `json:"urgency"`
	Impact           int            `json:"impact"`
	Source           string         `json:"source"`
	RequesterID      string         `gorm:"type:uuid;index;not null" json:"requester_id"`
	ResponderID      *string        `gorm:"type:uuid;index" json:"responder_id"`
	GroupID          *string        `gorm:"type:uuid;index" json:"group_id"`
	DepartmentID     *string        `gorm:"type:uuid;index" json:"department_id"`
	Category         string         `json:"category"`
	SubCategory      string         `json:"sub_category"`
	ItemCategory     string         `json:"item_category"`
	Tags             datatypes.JSON `json:"tags"`
	CCEmails         datatypes.JSON `json:"cc_emails"`
	CustomFields     datatypes.JSON `json:"custom_fields"`
	DueBy            *time.Time     `gorm:"index" json:"due_by"`
	FrDueBy          *time.Time     `json:"fr_due_by"`
	IsEscalated      bool           `json:"is_escalated"`
	FrEscalated      bool           `json:"fr_escalated"`
	SLAPolicyID      *string        `gorm:"type:uuid" json:"sla_policy_id"`
	FirstRespondedAt *time.Time     `json:"first_responded_at"`
	ResolvedAt       *time.Time     `json:"resolved_at"`
	ClosedAt         *time.Time     `json:"closed_at"`
	PendingSince     *time.Time     `json:"pending_since"`
	SLAPausedSeconds int64          `json:"-"`
	UnassignedEsc    bool           `json:"-"`
	ParentID         *string        `gorm:"type:uuid;index" json:"parent_id"`
	MergedIntoID     *string        `gorm:"type:uuid" json:"merged_into_id"`
	ResolutionNotes  string         `gorm:"type:text" json:"resolution_notes"`
	IsSpam           bool           `gorm:"index" json:"is_spam"`
	IsDeleted        bool           `gorm:"index" json:"is_deleted"`
	CreatedByID      string         `gorm:"type:uuid" json:"created_by_id"`
}

// Problem tracks the root cause of one or more incidents.
type Problem struct {
	Base
	Number         int64          `gorm:"index" json:"number"`
	Subject        string         `gorm:"not null" json:"subject"`
	Description    string         `gorm:"type:text" json:"description"`
	Status         string         `gorm:"index" json:"status"`
	Priority       int            `json:"priority"`
	Impact         int            `json:"impact"`
	RequesterID    *string        `gorm:"type:uuid" json:"requester_id"`
	AgentID        *string        `gorm:"type:uuid;index" json:"agent_id"`
	GroupID        *string        `gorm:"type:uuid" json:"group_id"`
	DepartmentID   *string        `gorm:"type:uuid" json:"department_id"`
	Category       string         `json:"category"`
	SubCategory    string         `json:"sub_category"`
	ItemCategory   string         `json:"item_category"`
	BusinessImpact string         `json:"business_impact"`
	DueBy          *time.Time     `json:"due_by"`
	KnownError     bool           `json:"known_error"`
	RootCause      string         `gorm:"type:text" json:"root_cause"`
	ImpactAnalysis string         `gorm:"type:text" json:"impact_analysis"`
	Symptoms       string         `gorm:"type:text" json:"symptoms"`
	Workaround     string         `gorm:"type:text" json:"workaround"`
	Tags           datatypes.JSON `json:"tags"`
	CustomFields   datatypes.JSON `json:"custom_fields"`
	ClosedAt       *time.Time     `json:"closed_at"`
	IsDeleted      bool           `gorm:"index" json:"is_deleted"`
	CreatedByID    string         `gorm:"type:uuid" json:"created_by_id"`
}

// Change is a planned modification to IT services.
type Change struct {
	Base
	Number         int64          `gorm:"index" json:"number"`
	Subject        string         `gorm:"not null" json:"subject"`
	Description    string         `gorm:"type:text" json:"description"`
	Status         string         `gorm:"index" json:"status"`
	ChangeType     string         `json:"change_type"`
	Priority       int            `json:"priority"`
	Impact         int            `json:"impact"`
	Risk           int            `json:"risk"`
	ApprovalStatus string         `json:"approval_status"`
	RequesterID    *string        `gorm:"type:uuid" json:"requester_id"`
	AgentID        *string        `gorm:"type:uuid;index" json:"agent_id"`
	GroupID        *string        `gorm:"type:uuid" json:"group_id"`
	DepartmentID   *string        `gorm:"type:uuid" json:"department_id"`
	Category       string         `json:"category"`
	SubCategory    string         `json:"sub_category"`
	ItemCategory   string         `json:"item_category"`
	BusinessImpact string         `json:"business_impact"`
	PlannedStart   *time.Time     `gorm:"index" json:"planned_start"`
	PlannedEnd     *time.Time     `json:"planned_end"`
	Reason         string         `gorm:"type:text" json:"reason"`
	ImpactPlan     string         `gorm:"type:text" json:"impact_plan"`
	RolloutPlan    string         `gorm:"type:text" json:"rollout_plan"`
	BackoutPlan    string         `gorm:"type:text" json:"backout_plan"`
	ReleaseID      *string        `gorm:"type:uuid" json:"release_id"`
	Tags           datatypes.JSON `json:"tags"`
	CustomFields   datatypes.JSON `json:"custom_fields"`
	ClosedAt       *time.Time     `json:"closed_at"`
	IsDeleted      bool           `gorm:"index" json:"is_deleted"`
	CreatedByID    string         `gorm:"type:uuid" json:"created_by_id"`
}

// Release bundles changes that ship together.
type Release struct {
	Base
	Number       int64          `gorm:"index" json:"number"`
	Subject      string         `gorm:"not null" json:"subject"`
	Description  string         `gorm:"type:text" json:"description"`
	ReleaseType  string         `json:"release_type"`
	Status       string         `gorm:"index" json:"status"`
	Priority     int            `json:"priority"`
	AgentID      *string        `gorm:"type:uuid" json:"agent_id"`
	GroupID      *string        `gorm:"type:uuid" json:"group_id"`
	DepartmentID *string        `gorm:"type:uuid" json:"department_id"`
	Category     string         `json:"category"`
	PlannedStart *time.Time     `json:"planned_start"`
	PlannedEnd   *time.Time     `json:"planned_end"`
	WorkStart    *time.Time     `json:"work_start"`
	WorkEnd      *time.Time     `json:"work_end"`
	BuildPlan    string         `gorm:"type:text" json:"build_plan"`
	TestPlan     string         `gorm:"type:text" json:"test_plan"`
	Tags         datatypes.JSON `json:"tags"`
	IsDeleted    bool           `gorm:"index" json:"is_deleted"`
	CreatedByID  string         `gorm:"type:uuid" json:"created_by_id"`
}

// Conversation is a reply, note or forward on a record.
type Conversation struct {
	Base
	EntityType    string         `gorm:"index:idx_conv_entity;not null" json:"entity_type"`
	EntityID      string         `gorm:"type:uuid;index:idx_conv_entity;not null" json:"entity_id"`
	UserID        string         `gorm:"type:uuid" json:"user_id"`
	Body          string         `gorm:"type:text" json:"body"`
	Private       bool           `json:"private"`
	Incoming      bool           `json:"incoming"`
	Kind          string         `json:"kind"`
	ToEmails      datatypes.JSON `json:"to_emails"`
	CCEmails      datatypes.JSON `json:"cc_emails"`
	AttachmentIDs datatypes.JSON `json:"attachment_ids"`
}

// WorkTask is a to-do attached to a ticket, problem, change or release.
type WorkTask struct {
	Base
	EntityType  string     `gorm:"index:idx_task_entity;not null" json:"entity_type"`
	EntityID    string     `gorm:"type:uuid;index:idx_task_entity;not null" json:"entity_id"`
	Title       string     `gorm:"not null" json:"title"`
	Description string     `gorm:"type:text" json:"description"`
	Status      string     `json:"status"`
	DueDate     *time.Time `json:"due_date"`
	AgentID     *string    `gorm:"type:uuid" json:"agent_id"`
	GroupID     *string    `gorm:"type:uuid" json:"group_id"`
	CompletedAt *time.Time `json:"completed_at"`
	CreatedByID string     `gorm:"type:uuid" json:"created_by_id"`
}

// TimeEntry records agent effort.
type TimeEntry struct {
	Base
	EntityType   string     `gorm:"index:idx_time_entity;not null" json:"entity_type"`
	EntityID     string     `gorm:"type:uuid;index:idx_time_entity;not null" json:"entity_id"`
	AgentID      string     `gorm:"type:uuid;index" json:"agent_id"`
	Note         string     `gorm:"type:text" json:"note"`
	Billable     bool       `json:"billable"`
	Minutes      int        `json:"minutes"`
	ExecutedAt   time.Time  `json:"executed_at"`
	TimerRunning bool       `json:"timer_running"`
	StartedAt    *time.Time `json:"started_at"`
}

// Activity is an immutable audit trail entry for a record.
type Activity struct {
	Base
	EntityType string         `gorm:"index:idx_act_entity;not null" json:"entity_type"`
	EntityID   string         `gorm:"type:uuid;index:idx_act_entity;not null" json:"entity_id"`
	ActorID    *string        `gorm:"type:uuid" json:"actor_id"`
	Action     string         `json:"action"`
	Summary    string         `gorm:"type:text" json:"summary"`
	Changes    datatypes.JSON `json:"changes"`
}

// Attachment stores an uploaded file.
type Attachment struct {
	Base
	EntityType  string `gorm:"index" json:"entity_type"`
	EntityID    string `gorm:"index" json:"entity_id"`
	Name        string `json:"name"`
	ContentType string `json:"content_type"`
	Size        int64  `json:"size"`
	Data        []byte `json:"-"`
	UploadedBy  string `gorm:"type:uuid" json:"uploaded_by"`
}

// Watcher subscribes a user to updates on a record.
type Watcher struct {
	EntityType string    `gorm:"primaryKey" json:"entity_type"`
	EntityID   string    `gorm:"primaryKey;type:uuid" json:"entity_id"`
	UserID     string    `gorm:"primaryKey;type:uuid" json:"user_id"`
	OrgID      string    `gorm:"type:uuid;index;not null" json:"-"`
	CreatedAt  time.Time `json:"created_at"`
}

// Link associates two records (incident↔problem, change↔asset, …).
type Link struct {
	Base
	SourceType string `gorm:"index:idx_link_src;not null" json:"source_type"`
	SourceID   string `gorm:"type:uuid;index:idx_link_src;not null" json:"source_id"`
	TargetType string `gorm:"index:idx_link_tgt;not null" json:"target_type"`
	TargetID   string `gorm:"type:uuid;index:idx_link_tgt;not null" json:"target_id"`
	LinkType   string `json:"link_type"`
}

// Approval is a request for a decision on a change or service request.
type Approval struct {
	Base
	EntityType    string     `gorm:"index:idx_appr_entity;not null" json:"entity_type"`
	EntityID      string     `gorm:"type:uuid;index:idx_appr_entity;not null" json:"entity_id"`
	ApproverID    string     `gorm:"type:uuid;index;not null" json:"approver_id"`
	RequestedByID string     `gorm:"type:uuid" json:"requested_by_id"`
	Status        string     `gorm:"index" json:"status"`
	Remark        string     `gorm:"type:text" json:"remark"`
	RespondedAt   *time.Time `json:"responded_at"`
}

// ---------------------------------------------------------------------------
// Assets / CMDB
// ---------------------------------------------------------------------------

// AssetType is a node in the CI type hierarchy.
type AssetType struct {
	Base
	Name        string         `gorm:"not null" json:"name"`
	Description string         `json:"description"`
	ParentID    *string        `gorm:"type:uuid" json:"parent_id"`
	Fields      datatypes.JSON `json:"fields"`
	Icon        string         `json:"icon"`
	Visible     bool           `json:"visible"`
}

// Asset is a configuration item.
type Asset struct {
	Base
	Number          int64          `gorm:"index" json:"number"`
	Name            string         `gorm:"not null" json:"name"`
	AssetTag        string         `gorm:"index" json:"asset_tag"`
	AssetTypeID     string         `gorm:"type:uuid;index;not null" json:"asset_type_id"`
	Description     string         `gorm:"type:text" json:"description"`
	Impact          string         `json:"impact"`
	UsageType       string         `json:"usage_type"`
	State           string         `gorm:"index" json:"state"`
	UserID          *string        `gorm:"type:uuid;index" json:"user_id"`
	DepartmentID    *string        `gorm:"type:uuid" json:"department_id"`
	LocationID      *string        `gorm:"type:uuid" json:"location_id"`
	AgentID         *string        `gorm:"type:uuid" json:"agent_id"`
	GroupID         *string        `gorm:"type:uuid" json:"group_id"`
	AssignedOn      *time.Time     `json:"assigned_on"`
	ProductID       *string        `gorm:"type:uuid" json:"product_id"`
	VendorID        *string        `gorm:"type:uuid" json:"vendor_id"`
	Cost            float64        `json:"cost"`
	SerialNumber    string         `json:"serial_number"`
	AcquisitionDate *time.Time     `json:"acquisition_date"`
	WarrantyExpiry  *time.Time     `json:"warranty_expiry"`
	EndOfLife       *time.Time     `json:"end_of_life"`
	TypeFields      datatypes.JSON `json:"type_fields"`
	Tags            datatypes.JSON `json:"tags"`
	IsDeleted       bool           `gorm:"index" json:"is_deleted"`
}

// AssetRelationship is a directed CMDB relationship between two assets.
type AssetRelationship struct {
	Base
	SourceID string `gorm:"type:uuid;index;not null" json:"source_id"`
	TargetID string `gorm:"type:uuid;index;not null" json:"target_id"`
	Type     string `gorm:"not null" json:"type"`
}

// Product is a make/model in the product catalog.
type Product struct {
	Base
	Name            string  `gorm:"not null" json:"name"`
	AssetTypeID     *string `gorm:"type:uuid" json:"asset_type_id"`
	Manufacturer    string  `json:"manufacturer"`
	Status          string  `json:"status"`
	ProcurementMode string  `json:"procurement_mode"`
	Description     string  `gorm:"type:text" json:"description"`
}

// Vendor supplies products and services.
type Vendor struct {
	Base
	Name        string `gorm:"not null" json:"name"`
	Description string `gorm:"type:text" json:"description"`
	ContactName string `json:"contact_name"`
	Email       string `json:"email"`
	Phone       string `json:"phone"`
	Mobile      string `json:"mobile"`
	Website     string `json:"website"`
	Address     string `gorm:"type:text" json:"address"`
}

// Contract tracks leases, maintenance, warranties and licenses.
type Contract struct {
	Base
	Number            int64          `gorm:"index" json:"number"`
	Name              string         `gorm:"not null" json:"name"`
	ContractType      string         `json:"contract_type"`
	Status            string         `gorm:"index" json:"status"`
	VendorID          *string        `gorm:"type:uuid" json:"vendor_id"`
	ApproverID        *string        `gorm:"type:uuid" json:"approver_id"`
	Cost              float64        `json:"cost"`
	StartDate         *time.Time     `json:"start_date"`
	EndDate           *time.Time     `gorm:"index" json:"end_date"`
	AutoRenew         bool           `json:"auto_renew"`
	RenewalNoticeDays int            `json:"renewal_notice_days"`
	NotifyToIDs       datatypes.JSON `json:"notify_to_ids"`
	Description       string         `gorm:"type:text" json:"description"`
	LicenseType       string         `json:"license_type"`
	LicenseCount      int            `json:"license_count"`
	BillingCycle      string         `json:"billing_cycle"`
	SoftwareID        *string        `gorm:"type:uuid" json:"software_id"`
	AssetIDs          datatypes.JSON `json:"asset_ids"`
	ExpiryNotifiedAt  *time.Time     `json:"expiry_notified_at"`
}

// PurchaseOrder tracks procurement from a vendor.
type PurchaseOrder struct {
	Base
	Number           int64          `gorm:"index" json:"number"`
	Name             string         `gorm:"not null" json:"name"`
	PONumber         string         `json:"po_number"`
	VendorID         *string        `gorm:"type:uuid" json:"vendor_id"`
	Status           string         `gorm:"index" json:"status"`
	ExpectedDelivery *time.Time     `json:"expected_delivery"`
	ShippingAddress  string         `gorm:"type:text" json:"shipping_address"`
	BillingAddress   string         `gorm:"type:text" json:"billing_address"`
	Currency         string         `json:"currency"`
	TaxPercent       float64        `json:"tax_percent"`
	ShippingCost     float64        `json:"shipping_cost"`
	DiscountPercent  float64        `json:"discount_percent"`
	Items            datatypes.JSON `json:"items"`
	Total            float64        `json:"total"`
	DepartmentID     *string        `gorm:"type:uuid" json:"department_id"`
	Terms            string         `gorm:"type:text" json:"terms"`
	CreatedByID      string         `gorm:"type:uuid" json:"created_by_id"`
}

// Software is an application tracked for license compliance.
type Software struct {
	Base
	Name        string  `gorm:"not null" json:"name"`
	Publisher   string  `json:"publisher"`
	Category    string  `json:"category"`
	Status      string  `json:"status"`
	LicenseType string  `json:"license_type"`
	Description string  `gorm:"type:text" json:"description"`
	ManagedByID *string `gorm:"type:uuid" json:"managed_by_id"`
}

// TableName keeps software uncountable.
func (Software) TableName() string { return "itsm_software" }

// SoftwareInstallation records software found on an asset.
type SoftwareInstallation struct {
	Base
	SoftwareID  string     `gorm:"type:uuid;index;not null" json:"software_id"`
	AssetID     string     `gorm:"type:uuid;index;not null" json:"asset_id"`
	Version     string     `json:"version"`
	UserID      *string    `gorm:"type:uuid" json:"user_id"`
	InstalledAt *time.Time `json:"installed_at"`
}

// ---------------------------------------------------------------------------
// Service catalog & knowledge base
// ---------------------------------------------------------------------------

// CatalogCategory groups service catalog items.
type CatalogCategory struct {
	Base
	Name        string `gorm:"not null" json:"name"`
	Description string `json:"description"`
	Icon        string `json:"icon"`
	Position    int    `json:"position"`
}

// CatalogItem is a requestable service.
type CatalogItem struct {
	Base
	CategoryID       *string        `gorm:"type:uuid;index" json:"category_id"`
	Name             string         `gorm:"not null" json:"name"`
	ShortDescription string         `json:"short_description"`
	Description      string         `gorm:"type:text" json:"description"`
	Cost             float64        `json:"cost"`
	DeliveryHours    int            `json:"delivery_hours"`
	Status           string         `gorm:"index" json:"status"`
	Icon             string         `json:"icon"`
	QuantityEnabled  bool           `json:"quantity_enabled"`
	Fields           datatypes.JSON `json:"fields"`
	ApprovalRequired bool           `json:"approval_required"`
	ApproverType     string         `json:"approver_type"`
	ApproverIDs      datatypes.JSON `json:"approver_ids"`
	DeliveryGroupID  *string        `gorm:"type:uuid" json:"delivery_group_id"`
	DeliveryAgentID  *string        `gorm:"type:uuid" json:"delivery_agent_id"`
	ProductID        *string        `gorm:"type:uuid" json:"product_id"`
	AllowAttachments bool           `json:"allow_attachments"`
	Visibility       string         `json:"visibility"`
	DepartmentIDs    datatypes.JSON `json:"department_ids"`
	Position         int            `json:"position"`
}

// RequestedItem links a service request ticket to the catalog item ordered.
type RequestedItem struct {
	Base
	TicketID       string         `gorm:"type:uuid;index;not null" json:"ticket_id"`
	ItemID         string         `gorm:"type:uuid;index;not null" json:"item_id"`
	Quantity       int            `json:"quantity"`
	Stage          string         `json:"stage"`
	Cost           float64        `json:"cost"`
	FieldValues    datatypes.JSON `json:"field_values"`
	RequestedForID string         `gorm:"type:uuid" json:"requested_for_id"`
}

// KBCategory is the top level of the knowledge base.
type KBCategory struct {
	Base
	Name        string `gorm:"not null" json:"name"`
	Description string `json:"description"`
	Position    int    `json:"position"`
}

// KBFolder groups articles and controls their visibility.
type KBFolder struct {
	Base
	CategoryID    string         `gorm:"type:uuid;index;not null" json:"category_id"`
	Name          string         `gorm:"not null" json:"name"`
	Description   string         `json:"description"`
	Visibility    string         `json:"visibility"`
	DepartmentIDs datatypes.JSON `json:"department_ids"`
	Position      int            `json:"position"`
}

// KBArticle is a knowledge base solution article.
type KBArticle struct {
	Base
	FolderID    string         `gorm:"type:uuid;index;not null" json:"folder_id"`
	Title       string         `gorm:"not null" json:"title"`
	Body        string         `gorm:"type:text" json:"body"`
	Status      string         `gorm:"index" json:"status"`
	ArticleType string         `json:"article_type"`
	Tags        datatypes.JSON `json:"tags"`
	Keywords    string         `json:"keywords"`
	AuthorID    string         `gorm:"type:text" json:"author_id"`
	Views       int            `json:"views"`
	ThumbsUp    int            `json:"thumbs_up"`
	ThumbsDown  int            `json:"thumbs_down"`
	ReviewDate  *time.Time     `json:"review_date"`
	PublishedAt *time.Time     `json:"published_at"`
}

// ---------------------------------------------------------------------------
// Automation & engagement
// ---------------------------------------------------------------------------

// Workflow is an event-driven automation rule.
type Workflow struct {
	Base
	Name           string         `gorm:"not null" json:"name"`
	Description    string         `json:"description"`
	Module         string         `json:"module"`
	Event          string         `gorm:"index" json:"event"`
	Active         bool           `json:"active"`
	Position       int            `json:"position"`
	Conditions     datatypes.JSON `json:"conditions"`
	Actions        datatypes.JSON `json:"actions"`
	StopProcessing bool           `json:"stop_processing"`
	ExecutionCount int            `json:"execution_count"`
	LastExecutedAt *time.Time     `json:"last_executed_at"`
}

// Scenario is a one-click bundle of actions agents can apply to a ticket.
type Scenario struct {
	Base
	Name        string         `gorm:"not null" json:"name"`
	Description string         `json:"description"`
	Actions     datatypes.JSON `json:"actions"`
	Visibility  string         `json:"visibility"`
	GroupIDs    datatypes.JSON `json:"group_ids"`
	CreatedByID string         `gorm:"type:text" json:"created_by_id"`
}

// CannedFolder organizes canned responses.
type CannedFolder struct {
	Base
	Name string `gorm:"not null" json:"name"`
}

// CannedResponse is a reusable reply template.
type CannedResponse struct {
	Base
	FolderID    *string        `gorm:"type:uuid;index" json:"folder_id"`
	Title       string         `gorm:"not null" json:"title"`
	Content     string         `gorm:"type:text" json:"content"`
	Visibility  string         `json:"visibility"`
	GroupIDs    datatypes.JSON `json:"group_ids"`
	CreatedByID string         `gorm:"type:text" json:"created_by_id"`
}

// FormField is a configurable field on a module's form.
type FormField struct {
	Base
	Entity                string         `gorm:"index;not null" json:"entity"`
	Name                  string         `gorm:"not null" json:"name"`
	Label                 string         `json:"label"`
	LabelForRequester     string         `json:"label_for_requester"`
	FieldType             string         `json:"field_type"`
	Choices               datatypes.JSON `json:"choices"`
	RequiredForAgents     bool           `json:"required_for_agents"`
	RequiredForClosure    bool           `json:"required_for_closure"`
	RequiredForRequesters bool           `json:"required_for_requesters"`
	DisplayedToRequester  bool           `json:"displayed_to_requester"`
	EditableByRequester   bool           `json:"editable_by_requester"`
	Position              int            `json:"position"`
	IsDefault             bool           `json:"is_default"`
	Active                bool           `json:"active"`
}

// Announcement is a banner shown to agents and/or requesters.
type Announcement struct {
	Base
	Title       string         `gorm:"not null" json:"title"`
	Body        string         `gorm:"type:text" json:"body"`
	Visibility  string         `json:"visibility"`
	GroupIDs    datatypes.JSON `json:"group_ids"`
	VisibleFrom time.Time      `json:"visible_from"`
	VisibleTill *time.Time     `json:"visible_till"`
	CreatedByID string         `gorm:"type:text" json:"created_by_id"`
}

// Survey configures customer satisfaction collection.
type Survey struct {
	Base
	Title           string `json:"title"`
	Question        string `json:"question"`
	ScaleType       int    `json:"scale_type"`
	ThankYouMessage string `json:"thank_you_message"`
	SendOn          string `json:"send_on"`
	Active          bool   `json:"active"`
}

// SurveyResponse stores one CSAT rating.
type SurveyResponse struct {
	Base
	TicketID    string  `gorm:"type:uuid;uniqueIndex;not null" json:"ticket_id"`
	RequesterID string  `gorm:"type:uuid" json:"requester_id"`
	AgentID     *string `gorm:"type:uuid;index" json:"agent_id"`
	GroupID     *string `gorm:"type:uuid" json:"group_id"`
	Rating      int     `json:"rating"`
	Feedback    string  `gorm:"type:text" json:"feedback"`
}

// EmailTemplate configures an email notification.
type EmailTemplate struct {
	Base
	Event     string `gorm:"index;not null" json:"event"`
	Recipient string `json:"recipient"`
	Name      string `json:"name"`
	Enabled   bool   `json:"enabled"`
	Subject   string `json:"subject"`
	Body      string `gorm:"type:text" json:"body"`
}

// EmailOutbox queues outgoing email for the delivery worker.
type EmailOutbox struct {
	Base
	ToAddr     string     `json:"to"`
	CC         string     `json:"cc"`
	Subject    string     `json:"subject"`
	Body       string     `gorm:"type:text" json:"body"`
	HTMLBody   string     `gorm:"type:text" json:"-"`
	Status     string     `gorm:"index" json:"status"`
	Attempts   int        `json:"attempts"`
	LastError  string     `json:"last_error"`
	SentAt     *time.Time `json:"sent_at"`
	EntityType string     `json:"entity_type"`
	EntityID   string     `json:"entity_id"`
}

// TableName keeps the outbox name singular.
func (EmailOutbox) TableName() string { return "itsm_email_outbox" }

// AuditLog records administrative actions.
type AuditLog struct {
	Base
	ActorID    *string        `gorm:"type:uuid;index" json:"actor_id"`
	Action     string         `gorm:"index" json:"action"`
	EntityType string         `json:"entity_type"`
	EntityID   string         `json:"entity_id"`
	Summary    string         `gorm:"type:text" json:"summary"`
	Details    datatypes.JSON `json:"details"`
	IP         string         `json:"ip"`
}

// OnCallSchedule rotates responsibility within a group.
type OnCallSchedule struct {
	Base
	Name          string         `gorm:"not null" json:"name"`
	GroupID       *string        `gorm:"type:uuid" json:"group_id"`
	MemberIDs     datatypes.JSON `json:"member_ids"`
	RotationType  string         `json:"rotation_type"`
	RotationStart time.Time      `json:"rotation_start"`
	HandoffTime   string         `json:"handoff_time"`
	TimeZone      string         `json:"time_zone"`
}

// APIKey authenticates programmatic access as an agent.
type APIKey struct {
	Base
	UserID     string     `gorm:"type:uuid;uniqueIndex;not null" json:"user_id"`
	KeyHash    string     `gorm:"uniqueIndex;not null" json:"-"`
	Prefix     string     `json:"prefix"`
	LastUsedAt *time.Time `json:"last_used_at"`
}

// RefreshSession tracks issued refresh tokens so they can be rotated and revoked.
type RefreshSession struct {
	ID        string     `gorm:"primaryKey;type:uuid" json:"id"`
	UserID    string     `gorm:"type:uuid;index;not null" json:"user_id"`
	TokenHash string     `gorm:"uniqueIndex;not null" json:"-"`
	ExpiresAt time.Time  `json:"expires_at"`
	RevokedAt *time.Time `json:"revoked_at"`
	CreatedAt time.Time  `json:"created_at"`
	UserAgent string     `json:"user_agent"`
	IP        string     `json:"ip"`
}

// AllModels lists every model for auto-migration.
// Project groups work items for a team, like a Freshservice project or a
// Plane workspace project. Agents see public projects and the private
// projects they belong to.
type Project struct {
	Base
	Key         string         `gorm:"not null" json:"key"`
	Name        string         `gorm:"not null" json:"name"`
	Description string         `gorm:"type:text" json:"description"`
	Color       string         `json:"color"`
	Status      string         `gorm:"index" json:"status"`
	Visibility  string         `json:"visibility"`
	LeadID      *string        `gorm:"type:uuid" json:"lead_id"`
	MemberIDs   datatypes.JSON `json:"member_ids"`
	StartDate   *time.Time     `json:"start_date"`
	EndDate     *time.Time     `json:"end_date"`
	Archived    bool           `gorm:"index" json:"archived"`
	CreatedByID string         `gorm:"type:uuid" json:"created_by_id"`
}

// WorkItem is a unit of work inside a project, shown on boards and lists.
type WorkItem struct {
	Base
	ProjectID   string         `gorm:"type:uuid;index;not null" json:"project_id"`
	Number      int64          `json:"number"`
	Title       string         `gorm:"not null" json:"title"`
	Description string         `gorm:"type:text" json:"description"`
	State       string         `gorm:"index" json:"state"`
	Priority    string         `json:"priority"`
	AssigneeID  *string        `gorm:"type:uuid;index" json:"assignee_id"`
	ReporterID  string         `gorm:"type:uuid" json:"reporter_id"`
	ParentID    *string        `gorm:"type:uuid;index" json:"parent_id"`
	CycleID     *string        `gorm:"type:uuid;index" json:"cycle_id"`
	Labels      datatypes.JSON `json:"labels"`
	ModuleIDs   datatypes.JSON `json:"module_ids"`
	WebLinks    datatypes.JSON `json:"web_links"`
	Estimate    *int           `json:"estimate"`
	StartDate   *time.Time     `json:"start_date"`
	DueDate     *time.Time     `json:"due_date"`
	SortOrder   float64        `json:"sort_order"`
	CompletedAt *time.Time     `json:"completed_at"`
}

// Cycle is a time-boxed iteration (sprint) within a project.
type Cycle struct {
	Base
	ProjectID   string     `gorm:"type:uuid;index;not null" json:"project_id"`
	Name        string     `gorm:"not null" json:"name"`
	Description string     `gorm:"type:text" json:"description"`
	StartDate   *time.Time `json:"start_date"`
	EndDate     *time.Time `json:"end_date"`
}

func AllModels() []interface{} {
	return []interface{}{
		&Settings{}, &Counter{}, &Person{}, &Role{}, &AgentGroup{}, &GroupMember{}, &Department{}, &Location{},
		&BusinessHours{}, &SLAPolicy{}, &Ticket{}, &Problem{}, &Change{}, &Release{}, &Conversation{},
		&WorkTask{}, &TimeEntry{}, &Activity{}, &Attachment{}, &Watcher{}, &Link{}, &Approval{},
		&AssetType{}, &Asset{}, &AssetRelationship{}, &Product{}, &Vendor{}, &Contract{}, &PurchaseOrder{},
		&Software{}, &SoftwareInstallation{}, &CatalogCategory{}, &CatalogItem{}, &RequestedItem{},
		&KBCategory{}, &KBFolder{}, &KBArticle{}, &Workflow{}, &Scenario{}, &CannedFolder{}, &CannedResponse{},
		&FormField{}, &Announcement{}, &Survey{}, &SurveyResponse{}, &EmailTemplate{}, &EmailOutbox{},
		&AuditLog{}, &OnCallSchedule{}, &APIKey{}, &RefreshSession{}, &Project{}, &WorkItem{}, &Cycle{},
		&Team{}, &TeamMember{}, &Avatar{}, &AuthToken{}, &JobRole{}, &Module{},
	}
}
