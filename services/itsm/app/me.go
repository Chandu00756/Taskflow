package app

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Avatars
// ---------------------------------------------------------------------------

const maxAvatarBytes = 1 << 20

var avatarTypes = map[string]bool{"image/png": true, "image/jpeg": true, "image/webp": true, "image/gif": true}

// avatarURL builds the public, cache-busted URL for a stored avatar.
func avatarURL(userID string, updated time.Time) string {
	return "/api/v2/avatars/" + userID + "?v=" + strconv.FormatInt(updated.Unix(), 36)
}

// setMyAvatar stores a profile picture sent as a data URI.
func (a *App) setMyAvatar(c *Ctx) error {
	var in struct {
		DataURL string `json:"data_url"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	meta, data, ok := strings.Cut(in.DataURL, ",")
	if !ok || !strings.HasPrefix(meta, "data:") || !strings.HasSuffix(meta, ";base64") {
		return errValidation(map[string]string{"data_url": "must be a base64 image data URL"})
	}
	contentType := strings.TrimSuffix(strings.TrimPrefix(meta, "data:"), ";base64")
	if !avatarTypes[contentType] {
		return errValidation(map[string]string{"data_url": "must be a PNG, JPEG, WebP or GIF image"})
	}
	raw, err := base64.StdEncoding.DecodeString(data)
	if err != nil || len(raw) == 0 {
		return errValidation(map[string]string{"data_url": "is not valid base64"})
	}
	if len(raw) > maxAvatarBytes {
		return errValidation(map[string]string{"data_url": "must be smaller than 1 MB"})
	}
	// Trust the bytes, not the declared type.
	if sniffed := http.DetectContentType(raw); sniffed != contentType {
		return errValidation(map[string]string{"data_url": "does not contain a " + contentType + " image"})
	}
	av := Avatar{UserID: c.P.UserID, OrgID: c.P.OrgID, ContentType: contentType, Data: raw, UpdatedAt: now()}
	if err := c.DB().Save(&av).Error; err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]string{"avatar_url": avatarURL(av.UserID, av.UpdatedAt)})
}

func (a *App) deleteMyAvatar(c *Ctx) error {
	c.DB().Where("user_id = ?", c.P.UserID).Delete(&Avatar{})
	return c.JSON(http.StatusOK, map[string]string{"message": "removed"})
}

// serveAvatar returns a profile picture. Avatars are addressed by unguessable
// user id and contain no other data, so they are served without a token
// (image tags cannot send one).
func (a *App) serveAvatar(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var av Avatar
	if !isUUID(id) || a.DB.WithContext(r.Context()).Where("user_id = ?", id).Take(&av).Error != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	etag := `"` + strconv.FormatInt(av.UpdatedAt.UnixNano(), 36) + `"`
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", av.ContentType)
	w.Header().Set("Content-Length", strconv.Itoa(len(av.Data)))
	_, _ = w.Write(av.Data)
}

// ---------------------------------------------------------------------------
// Out of office
// ---------------------------------------------------------------------------

// oooActive reports whether an out-of-office window covers t.
func oooActive(p *Person, t time.Time) bool {
	return p.OOOStart != nil && p.OOOEnd != nil && !t.Before(*p.OOOStart) && t.Before(*p.OOOEnd)
}

func (a *App) setOutOfOffice(c *Ctx) error {
	var in struct {
		Start      string `json:"start"`
		End        string `json:"end"`
		DelegateID string `json:"delegate_id"`
		Message    string `json:"message"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	errs := map[string]string{}
	start, ok1 := parseTime(in.Start)
	end, ok2 := parseTime(in.End)
	if !ok1 || start == nil {
		errs["start"] = "is required"
	}
	if !ok2 || end == nil {
		errs["end"] = "is required"
	} else if start != nil && !end.After(*start) {
		errs["end"] = "must be after the start"
	} else if end.Before(now()) {
		errs["end"] = "must be in the future"
	}
	var delegate *string
	if in.DelegateID != "" {
		switch {
		case in.DelegateID == c.P.UserID:
			errs["delegate_id"] = "cannot be yourself"
		case !c.userInOrg(in.DelegateID):
			errs["delegate_id"] = "is not a person in your organization"
		default:
			delegate = strPtr(in.DelegateID)
		}
	}
	if len(strings.TrimSpace(in.Message)) > 500 {
		errs["message"] = "must be at most 500 characters"
	}
	if len(errs) > 0 {
		return errValidation(errs)
	}
	err := c.DB().Model(&Person{}).Where("user_id = ?", c.P.UserID).Updates(map[string]interface{}{
		"ooo_start": start, "ooo_end": end, "ooo_delegate_id": delegate, "ooo_message": strings.TrimSpace(in.Message), "updated_at": now(),
	}).Error
	if err != nil {
		return err
	}
	c.audit("me.out_of_office", "user", c.P.UserID, fmt.Sprintf("Set out of office %s – %s", start.Format("Jan 2"), end.Format("Jan 2")), nil)
	return a.getMe(c)
}

func (a *App) clearOutOfOffice(c *Ctx) error {
	c.DB().Model(&Person{}).Where("user_id = ?", c.P.UserID).Updates(map[string]interface{}{
		"ooo_start": nil, "ooo_end": nil, "ooo_delegate_id": nil, "ooo_message": "", "updated_at": now(),
	})
	return a.getMe(c)
}

// delegateFor returns who should act for userID right now: the delegate of an
// out-of-office person, otherwise the person themselves.
func delegateFor(c *Ctx, userID string) (string, bool) {
	var p Person
	if c.DB().Where("user_id = ?", userID).Take(&p).Error != nil || !oooActive(&p, now()) || p.OOODelegateID == nil {
		return userID, false
	}
	var active bool
	c.DB().Table("users").Select("is_active").Where("id = ? AND org_id = ?", *p.OOODelegateID, c.P.OrgID).Scan(&active)
	if !active {
		return userID, false
	}
	return *p.OOODelegateID, true
}

// ---------------------------------------------------------------------------
// Notification preferences
// ---------------------------------------------------------------------------

// NotificationEvent describes a preference the user can switch.
type NotificationEvent struct {
	Key         string   `json:"key"`
	Label       string   `json:"label"`
	Group       string   `json:"group"`
	AgentOnly   bool     `json:"agent_only"`
	Email       bool     `json:"email"`
	EmailEvents []string `json:"-"`
}

var notificationEvents = []NotificationEvent{
	{Key: "ticket_assigned", Label: "A ticket is assigned to me or my group", Group: "Tickets", AgentOnly: true, Email: true, EmailEvents: []string{"ticket_assigned_agent", "ticket_assigned_group"}},
	{Key: "ticket_reply", Label: "Someone replies on a ticket I work on or raised", Group: "Tickets", Email: true, EmailEvents: []string{"requester_reply_agent"}},
	{Key: "ticket_status", Label: "The status of a ticket I raised changes", Group: "Tickets", Email: true},
	{Key: "ticket_update", Label: "A ticket I raised or watch is updated", Group: "Tickets", Email: true},
	{Key: "ticket_watch", Label: "Activity on tickets I watch", Group: "Tickets", AgentOnly: true, Email: true},
	{Key: "mention", Label: "Someone mentions me in a note or comment", Group: "Collaboration", AgentOnly: true, Email: true},
	{Key: "task_assigned", Label: "A task is assigned to me", Group: "Collaboration", AgentOnly: true, Email: true},
	{Key: "approval_requested", Label: "My approval is requested", Group: "Approvals", Email: true, EmailEvents: []string{"approval_requested"}},
	{Key: "sla_violation", Label: "An SLA is breached on my tickets", Group: "Service levels", AgentOnly: true, Email: true, EmailEvents: []string{"sla_violation"}},
	{Key: "unassigned_escalation", Label: "Tickets in my group stay unassigned too long", Group: "Service levels", AgentOnly: true, Email: true},
	{Key: "problem_assigned", Label: "A problem is assigned to me", Group: "ITIL", AgentOnly: true, Email: true},
	{Key: "change_assigned", Label: "A change is assigned to me", Group: "ITIL", AgentOnly: true, Email: true},
	{Key: "itil_update", Label: "A problem or change I own or raised changes status", Group: "ITIL", AgentOnly: true, Email: true},
	{Key: "asset_assigned", Label: "An asset is assigned to me", Group: "Assets", Email: true},
	{Key: "contract_expiring", Label: "A contract I own is about to expire", Group: "Assets", AgentOnly: true, Email: true, EmailEvents: []string{"contract_expiring"}},
	{Key: "work_item_assigned", Label: "A project work item is assigned to me", Group: "Projects", AgentOnly: true, Email: true},
	{Key: "work_item_created", Label: "A work item is created in a project I lead", Group: "Projects", AgentOnly: true, Email: true},
	{Key: "work_item_update", Label: "Work items I'm assigned to, reported or subscribe to change", Group: "Projects", AgentOnly: true, Email: true},
	{Key: "work_item_comment", Label: "Comments on work items I own or reported", Group: "Projects", AgentOnly: true, Email: true},
	{Key: "project_member_added", Label: "I am added to a project", Group: "Projects", AgentOnly: true, Email: true},
}

type channelPrefs struct {
	InApp *bool `json:"in_app,omitempty"`
	Email *bool `json:"email,omitempty"`
}

func prefsOf(p *Person) map[string]channelPrefs {
	out := map[string]channelPrefs{}
	_ = jsonUnmarshal(p.NotificationPrefs, &out)
	return out
}

// notificationAllowed reports whether userID wants an in-app notification of kind.
func notificationAllowed(prefs map[string]channelPrefs, kind string) bool {
	if cp, ok := prefs[kind]; ok && cp.InApp != nil {
		return *cp.InApp
	}
	return true
}

// emailAllowed reports whether the person wants the email for an email event.
func emailAllowed(prefs map[string]channelPrefs, emailEvent string) bool {
	for _, ev := range notificationEvents {
		for _, e := range ev.EmailEvents {
			if e == emailEvent {
				if cp, ok := prefs[ev.Key]; ok && cp.Email != nil {
					return *cp.Email
				}
				return true
			}
		}
	}
	return true
}

func (a *App) getNotificationPrefs(c *Ctx) error {
	var p Person
	c.DB().Where("user_id = ?", c.P.UserID).Take(&p)
	prefs := prefsOf(&p)
	items := []map[string]interface{}{}
	for _, ev := range notificationEvents {
		if ev.AgentOnly && !c.P.IsAgent {
			continue
		}
		cp := prefs[ev.Key]
		inApp, email := true, ev.Email
		if cp.InApp != nil {
			inApp = *cp.InApp
		}
		if cp.Email != nil && ev.Email {
			email = *cp.Email
		}
		items = append(items, map[string]interface{}{"key": ev.Key, "label": ev.Label, "group": ev.Group, "in_app": inApp,
			"email": email, "email_available": ev.Email})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"items": items})
}

func (a *App) setNotificationPrefs(c *Ctx) error {
	var in map[string]channelPrefs
	if err := c.Bind(&in); err != nil {
		return err
	}
	known := map[string]NotificationEvent{}
	for _, ev := range notificationEvents {
		known[ev.Key] = ev
	}
	var p Person
	if err := c.DB().Where("user_id = ?", c.P.UserID).Take(&p).Error; err != nil {
		return errNotFound("profile")
	}
	prefs := prefsOf(&p)
	for k, v := range in {
		ev, ok := known[k]
		if !ok {
			return errValidation(map[string]string{k: "is not a notification event"})
		}
		cur := prefs[k]
		if v.InApp != nil {
			cur.InApp = v.InApp
		}
		if v.Email != nil && ev.Email {
			cur.Email = v.Email
		}
		prefs[k] = cur
	}
	if err := c.DB().Model(&Person{}).Where("user_id = ?", c.P.UserID).Update("notification_prefs", jsonOf(prefs)).Error; err != nil {
		return err
	}
	return a.getNotificationPrefs(c)
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

func (a *App) listSessions(c *Ctx) error {
	var sessions []RefreshSession
	c.DB().Where("user_id = ? AND revoked_at IS NULL AND expires_at > ?", c.P.UserID, now()).Order("created_at DESC").Limit(50).Find(&sessions)
	current := strings.ToLower(strings.TrimSpace(c.R.Header.Get("X-Session-Hash")))
	items := []map[string]interface{}{}
	for _, s := range sessions {
		items = append(items, map[string]interface{}{"id": s.ID, "created_at": s.CreatedAt, "expires_at": s.ExpiresAt,
			"user_agent": s.UserAgent, "ip": s.IP, "current": current != "" && s.TokenHash == current})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"items": items})
}

func (a *App) revokeSession(c *Ctx) error {
	res := c.DB().Model(&RefreshSession{}).Where("id = ? AND user_id = ? AND revoked_at IS NULL", c.Param("id"), c.P.UserID).Update("revoked_at", now())
	if res.RowsAffected == 0 {
		return errNotFound("session")
	}
	c.audit("me.session_revoked", "user", c.P.UserID, "Signed out a session", nil)
	return c.JSON(http.StatusOK, map[string]string{"message": "signed out"})
}

// signOutOthers ends every other session, including access tokens already
// issued, and returns fresh tokens for this browser.
func (a *App) signOutOthers(c *Ctx) error {
	ts := now()
	if err := c.DB().Table("users").Where("id = ?", c.P.UserID).Update("tokens_revoked_at", ts).Error; err != nil {
		return err
	}
	c.DB().Model(&RefreshSession{}).Where("user_id = ? AND revoked_at IS NULL", c.P.UserID).Update("revoked_at", ts)
	a.Invalidate(c.P.UserID)
	c.audit("me.signed_out_everywhere", "user", c.P.UserID, "Signed out of all other sessions", nil)
	// New tokens carry iat >= the cut-off second, so they stay valid.
	tokens, err := a.issueTokens(c, c.P.UserID)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, tokens)
}
