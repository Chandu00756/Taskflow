package app

import (
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
)

// Every in-app notification is also emailed, unless an editable email
// template already covers the same event (those are sent by queueEmail) or
// the person switched the email off in their notification preferences.

// notificationMailer is installed by New; notify calls it after writing the
// in-app notification.
var notificationMailer func(db *gorm.DB, userID, kind, title, message string, meta map[string]string)

// templateCovered are notification kinds whose email comes from an email
// template (Admin → Email notifications) rather than this generic email.
var templateCovered = map[string]bool{
	"ticket_assigned":    true, // ticket_assigned_agent / ticket_assigned_group
	"ticket_reply":       true, // agent_reply_requester / requester_reply_agent
	"ticket_new":         true, // ticket_assigned_group
	"ticket_resolved":    true, // ticket_resolved_requester
	"approval_requested": true,
	"sla_violation":      true,
	"contract_expiring":  true,
}

// notificationPath mirrors the app's notification links.
func notificationPath(meta map[string]string, agent bool) string {
	switch {
	case meta["ticket_id"] != "":
		if agent {
			return "/tickets/" + meta["ticket_id"]
		}
		return "/portal/tickets/" + meta["ticket_id"]
	case meta["problem_id"] != "":
		return "/problems/" + meta["problem_id"]
	case meta["change_id"] != "":
		return "/changes/" + meta["change_id"]
	case meta["release_id"] != "":
		return "/releases/" + meta["release_id"]
	case meta["asset_id"] != "":
		return "/assets/" + meta["asset_id"]
	case meta["approval_id"] != "":
		if agent {
			return "/approvals"
		}
		return "/portal/approvals"
	case meta["contract_id"] != "":
		return "/assets/contracts"
	case meta["work_item_id"] != "" && meta["project_id"] != "":
		return "/projects/" + meta["project_id"] + "?item=" + meta["work_item_id"]
	case meta["project_id"] != "":
		return "/projects/" + meta["project_id"]
	}
	if agent {
		return "/dashboard"
	}
	return "/portal"
}

// mailNotification queues the email copy of a notification.
func (a *App) mailNotification(db *gorm.DB, userID, kind, title, message string, meta map[string]string) {
	if templateCovered[kind] || !a.mailConfig().Enabled() {
		return
	}
	var u struct {
		Email    string
		FullName string
		OrgID    *string
		IsActive bool
		Pending  bool
		IsAgent  bool
	}
	db.Table("users u").
		Select(`u.email, u.full_name, u.org_id, u.is_active, COALESCE(u.email_verification_pending, false) AS pending,
			(COALESCE(p.is_agent, false) OR u.role IN ('org_admin','admin')) AS is_agent`).
		Joins("LEFT JOIN itsm_people p ON p.user_id = u.id").
		Where("u.id = ?", userID).Scan(&u)
	// Nobody receives mail before they activated their account.
	if u.Email == "" || !u.IsActive || u.Pending || !validEmail(u.Email) {
		return
	}
	helpdesk := "TaskFlow"
	org := systemOrgID
	if u.OrgID != nil {
		org = *u.OrgID
		var name string
		db.Model(&Settings{}).Select("helpdesk_name").Where("org_id = ?", org).Scan(&name)
		if strings.TrimSpace(name) != "" {
			helpdesk = name
		}
	}
	base := strings.TrimRight(a.Cfg.PublicURL, "/")
	var b strings.Builder
	fmt.Fprintf(&b, "Hi %s,\n\n%s\n", displayName(u.FullName, u.Email), title)
	if strings.TrimSpace(message) != "" {
		fmt.Fprintf(&b, "\n%s\n", strings.TrimSpace(message))
	}
	fmt.Fprintf(&b, "\nOpen it in %s:\n%s%s\n\n— %s\n\nYou get this email because of your notification settings. Change them at %s/profile#notifications",
		helpdesk, base, notificationPath(meta, u.IsAgent), helpdesk, base)
	entityID := ""
	for _, k := range []string{"ticket_id", "work_item_id", "problem_id", "change_id", "release_id", "asset_id", "approval_id", "project_id", "contract_id"} {
		if meta[k] != "" {
			entityID = meta[k]
			break
		}
	}
	db.Create(&EmailOutbox{Base: Base{OrgID: org}, ToAddr: u.Email, Subject: truncate("["+helpdesk+"] "+title, 200), Body: b.String(),
		Status: "queued", EntityType: kind, EntityID: entityID})
	a.kickMail()
	// Notifications written inside a transaction become visible when it
	// commits; look again shortly so they are not left for the next tick.
	time.AfterFunc(2*time.Second, a.kickMail)
}

// emailWanted reports whether the person keeps the email copy of kind on.
func emailWanted(prefs map[string]channelPrefs, kind string) bool {
	if cp, ok := prefs[kind]; ok && cp.Email != nil {
		return *cp.Email
	}
	return true
}
