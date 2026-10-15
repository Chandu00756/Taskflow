package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/mail"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

func jsonOf(v interface{}) datatypes.JSON {
	b, err := json.Marshal(v)
	if err != nil {
		return datatypes.JSON("null")
	}
	return datatypes.JSON(b)
}

func stringsFrom(j datatypes.JSON) []string {
	var out []string
	if len(j) > 0 {
		_ = json.Unmarshal(j, &out)
	}
	if out == nil {
		out = []string{}
	}
	return out
}

func normalizeTags(tags []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, t := range tags {
		t = strings.TrimSpace(strings.ToLower(t))
		if t == "" || seen[t] || len(t) > 64 {
			continue
		}
		seen[t] = true
		out = append(out, t)
	}
	sort.Strings(out)
	return out
}

func strPtr(s string) *string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	return &s
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func isUUID(s string) bool {
	_, err := uuid.Parse(s)
	return err == nil
}

func validEmail(s string) bool {
	a, err := mail.ParseAddress(s)
	return err == nil && a.Address == s
}

func oneOf(v string, allowed ...string) bool {
	for _, a := range allowed {
		if v == a {
			return true
		}
	}
	return false
}

func clampInt(v, lo, hi, fallback int) int {
	if v < lo || v > hi {
		return fallback
	}
	return v
}

func now() time.Time { return time.Now().UTC() }

// nextNumber atomically allocates the next display number for an entity.
func nextNumber(tx *gorm.DB, orgID, entity string) (int64, error) {
	var v int64
	err := tx.Raw(`INSERT INTO itsm_counters (org_id, entity, value) VALUES (?, ?, 1)
		ON CONFLICT (org_id, entity) DO UPDATE SET value = itsm_counters.value + 1
		RETURNING value`, orgID, entity).Scan(&v).Error
	return v, err
}

// ---------------------------------------------------------------------------
// Lookups used to enrich API responses
// ---------------------------------------------------------------------------

// UserBrief is the compact representation of a person.
type UserBrief struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Email    string `json:"email"`
	IsAgent  bool   `json:"is_agent"`
	JobTitle string `json:"job_title,omitempty"`
	Active   bool   `json:"active"`
	// AvatarURL is set when the person uploaded a profile picture.
	AvatarURL string `json:"avatar_url,omitempty"`
}

// Ref is a compact id/name pair.
type Ref struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type lookup struct {
	users  map[string]*UserBrief
	groups map[string]*Ref
	depts  map[string]*Ref
}

func uniq(ids []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if id != "" && !seen[id] && isUUID(id) {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

// uniqStrings removes blanks and duplicates while keeping order (any strings,
// unlike uniq which only keeps ids).
func uniqStrings(in []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, s := range in {
		if s != "" && !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

func (c *Ctx) lookup(userIDs, groupIDs, deptIDs []string) *lookup {
	l := &lookup{users: map[string]*UserBrief{}, groups: map[string]*Ref{}, depts: map[string]*Ref{}}
	if ids := uniq(userIDs); len(ids) > 0 {
		var rows []struct {
			ID       string
			Email    string
			FullName string
			Username string
			IsActive bool
			IsAgent  *bool
			JobTitle *string
			Role     string
			Avatar   *time.Time
		}
		c.DB().Table("users u").
			Select("u.id, u.email, u.full_name, u.username, u.is_active, u.role, p.is_agent, p.job_title, av.updated_at AS avatar").
			Joins("LEFT JOIN itsm_people p ON p.user_id = u.id").
			Joins("LEFT JOIN itsm_avatars av ON av.user_id = u.id").
			Where("u.id IN ? AND u.org_id = ?", ids, c.P.OrgID).Scan(&rows)
		for _, r := range rows {
			name := r.FullName
			if name == "" {
				name = r.Username
			}
			agent := r.IsAgent != nil && *r.IsAgent
			if r.Role == "org_admin" || r.Role == "admin" {
				agent = true
			}
			l.users[r.ID] = &UserBrief{ID: r.ID, Name: name, Email: r.Email, IsAgent: agent, JobTitle: deref(r.JobTitle), Active: r.IsActive}
			if r.Avatar != nil {
				l.users[r.ID].AvatarURL = avatarURL(r.ID, *r.Avatar)
			}
		}
	}
	if ids := uniq(groupIDs); len(ids) > 0 {
		var groups []AgentGroup
		c.T(&AgentGroup{}).Where("id IN ?", ids).Find(&groups)
		for _, g := range groups {
			l.groups[g.ID] = &Ref{ID: g.ID, Name: g.Name}
		}
	}
	if ids := uniq(deptIDs); len(ids) > 0 {
		var depts []Department
		c.T(&Department{}).Where("id IN ?", ids).Find(&depts)
		for _, d := range depts {
			l.depts[d.ID] = &Ref{ID: d.ID, Name: d.Name}
		}
	}
	return l
}

func (l *lookup) user(id *string) *UserBrief {
	if id == nil {
		return nil
	}
	return l.users[*id]
}

func (l *lookup) userS(id string) *UserBrief { return l.users[id] }

func (l *lookup) group(id *string) *Ref {
	if id == nil {
		return nil
	}
	return l.groups[*id]
}

func (l *lookup) dept(id *string) *Ref {
	if id == nil {
		return nil
	}
	return l.depts[*id]
}

// userInOrg verifies that a user id belongs to the caller's organization.
func (c *Ctx) userInOrg(id string) bool {
	if !isUUID(id) {
		return false
	}
	var n int64
	c.DB().Table("users").Where("id = ? AND org_id = ?", id, c.P.OrgID).Count(&n)
	return n > 0
}

// agentInOrg verifies that a user is an active agent in the caller's org.
func (c *Ctx) agentInOrg(id string) bool {
	if !isUUID(id) {
		return false
	}
	var n int64
	c.DB().Table("users u").Joins("LEFT JOIN itsm_people p ON p.user_id = u.id").
		Where("u.id = ? AND u.org_id = ? AND u.is_active AND (p.is_agent OR u.role IN ('org_admin','admin'))", id, c.P.OrgID).
		Count(&n)
	return n > 0
}

func (c *Ctx) existsInOrg(model interface{}, id string) bool {
	if !isUUID(id) {
		return false
	}
	var n int64
	c.T(model).Where("id = ?", id).Count(&n)
	return n > 0
}

// optionalRef validates an optional foreign key pointer within the org.
func (c *Ctx) optionalRef(errs map[string]string, field string, id *string, check func(string) bool) {
	if id == nil || *id == "" {
		return
	}
	if !check(*id) {
		errs[field] = "is invalid"
	}
}

// ---------------------------------------------------------------------------
// Activity, audit and notifications
// ---------------------------------------------------------------------------

// FieldChange is one recorded property change.
type FieldChange struct {
	Field string      `json:"field"`
	From  interface{} `json:"from"`
	To    interface{} `json:"to"`
}

func (c *Ctx) activity(tx *gorm.DB, entityType, entityID, action, summary string, changes []FieldChange) {
	var actor *string
	if c.P != nil {
		actor = &c.P.UserID
	}
	recordActivity(tx, orgOf(c), entityType, entityID, actor, action, summary, changes)
}

func orgOf(c *Ctx) string {
	if c.P == nil {
		return ""
	}
	return c.P.OrgID
}

func recordActivity(tx *gorm.DB, orgID, entityType, entityID string, actor *string, action, summary string, changes []FieldChange) {
	if changes == nil {
		changes = []FieldChange{}
	}
	tx.Create(&Activity{
		Base:       Base{OrgID: orgID},
		EntityType: entityType, EntityID: entityID, ActorID: actor,
		Action: action, Summary: summary, Changes: jsonOf(changes),
	})
}

func (c *Ctx) audit(action, entityType, entityID, summary string, details interface{}) {
	actor := c.P.UserID
	c.DB().Create(&AuditLog{
		Base:    Base{OrgID: c.P.OrgID},
		ActorID: &actor, Action: action, EntityType: entityType, EntityID: entityID,
		Summary: summary, Details: jsonOf(details), IP: c.ClientIP(),
	})
}

// notify writes an in-app notification into the shared notifications table.
func notify(db *gorm.DB, userID, kind, title, message string, meta map[string]string) {
	if userID == "" {
		return
	}
	if meta == nil {
		meta = map[string]string{}
	}
	var raw *string
	db.Table("itsm_people").Select("notification_prefs").Where("user_id = ?", userID).Scan(&raw)
	prefs := map[string]channelPrefs{}
	if raw != nil {
		_ = jsonUnmarshal(datatypes.JSON(*raw), &prefs)
	}
	if !notificationAllowed(prefs, kind) {
		return
	}
	db.Exec(`INSERT INTO notifications (id, user_id, type, title, message, read, metadata, created_at)
		VALUES (?, ?, ?, ?, ?, false, ?, ?)`,
		uuid.NewString(), userID, kind, title, message, string(jsonOf(meta)), now())
}

var placeholderRe = regexp.MustCompile(`\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}`)

// renderTemplate replaces {{placeholders}} with values; unknown keys render empty.
func renderTemplate(tpl string, vars map[string]string) string {
	return placeholderRe.ReplaceAllStringFunc(tpl, func(m string) string {
		key := placeholderRe.FindStringSubmatch(m)[1]
		return vars[key]
	})
}

// queueEmail renders the enabled template for event and queues it.
func (a *App) queueEmail(ctx context.Context, db *gorm.DB, orgID, event, to string, vars map[string]string, entityType, entityID string) {
	if to == "" || !validEmail(to) {
		return
	}
	var tpl EmailTemplate
	if err := db.WithContext(ctx).Where("org_id = ? AND event = ? AND enabled", orgID, event).Take(&tpl).Error; err != nil {
		return
	}
	// Respect the recipient's email preferences for agent-facing events.
	var raw *string
	db.WithContext(ctx).Table("users u").Select("p.notification_prefs").Joins("JOIN itsm_people p ON p.user_id = u.id").
		Where("u.org_id = ? AND LOWER(u.email) = LOWER(?)", orgID, to).Scan(&raw)
	prefs := map[string]channelPrefs{}
	if raw != nil {
		_ = jsonUnmarshal(datatypes.JSON(*raw), &prefs)
	}
	if !emailAllowed(prefs, event) {
		return
	}
	db.WithContext(ctx).Create(&EmailOutbox{
		Base:   Base{OrgID: orgID},
		ToAddr: to, Subject: renderTemplate(tpl.Subject, vars), Body: renderTemplate(tpl.Body, vars),
		Status: "queued", EntityType: entityType, EntityID: entityID,
	})
	a.kickMail()
}

func (a *App) userEmail(db *gorm.DB, id string) (email, name string) {
	var row struct {
		Email    string
		FullName string
		Username string
	}
	db.Table("users").Select("email, full_name, username").Where("id = ?", id).Take(&row)
	name = row.FullName
	if name == "" {
		name = row.Username
	}
	return row.Email, name
}

func priorityName(p int) string {
	switch p {
	case 1:
		return "Low"
	case 2:
		return "Medium"
	case 3:
		return "High"
	case 4:
		return "Urgent"
	}
	return "Medium"
}

func titleCase(s string) string {
	s = strings.ReplaceAll(s, "_", " ")
	words := strings.Fields(s)
	for i, w := range words {
		words[i] = strings.ToUpper(w[:1]) + w[1:]
	}
	return strings.Join(words, " ")
}

func displayID(prefix string, n int64) string { return fmt.Sprintf("%s-%d", prefix, n) }

// recordRefRe matches record references such as "#12", "INC-12", "prb-3" or "12".
var recordRefRe = regexp.MustCompile(`^#?(?:([A-Za-z][A-Za-z0-9]{0,9})-)?(\d{1,9})$`)

// refParts splits a reference typed into a search box into its upper-cased
// prefix (possibly empty) and number.
func refParts(v string) (string, int64, bool) {
	m := recordRefRe.FindStringSubmatch(strings.TrimSpace(v))
	if m == nil {
		return "", 0, false
	}
	n, err := strconv.ParseInt(m[2], 10, 64)
	return strings.ToUpper(m[1]), n, err == nil && n > 0
}

// refNumber extracts the record number from a reference typed into a search box.
func refNumber(v string) (int64, bool) {
	_, n, ok := refParts(v)
	return n, ok
}

// refType names the record type a reference prefix points at ("" when the
// reference has no prefix, "work_item" for anything that is not a desk prefix).
func refType(s *Settings, prefix string) string {
	switch prefix {
	case "":
		return ""
	case strings.ToUpper(s.PrefixIncident), strings.ToUpper(s.PrefixServiceRequest):
		return "ticket"
	case strings.ToUpper(s.PrefixProblem):
		return "problem"
	case strings.ToUpper(s.PrefixChange):
		return "change"
	case strings.ToUpper(s.PrefixRelease):
		return "release"
	case "ASSET":
		return "asset"
	}
	return "work_item"
}

// likeEscape escapes LIKE wildcards in user input.
func likeEscape(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return "%" + r.Replace(s) + "%"
}

func parseTime(s string) (*time.Time, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, true
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02T15:04", "2006-01-02"} {
		if t, err := time.Parse(layout, s); err == nil {
			u := t.UTC()
			return &u, true
		}
	}
	return nil, false
}

// atoiDefault parses an integer query value, falling back when it is missing or invalid.
func atoiDefault(v string, fallback int) int {
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil {
		return fallback
	}
	return n
}

// jsonUnmarshal decodes a JSON column, treating an empty value as no data.
func jsonUnmarshal(j datatypes.JSON, v interface{}) error {
	if len(j) == 0 {
		return nil
	}
	return json.Unmarshal(j, v)
}
