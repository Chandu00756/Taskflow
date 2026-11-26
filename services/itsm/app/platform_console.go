package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/chanduchitikam/task-management-system/pkg/auth"
	"github.com/chanduchitikam/task-management-system/pkg/mailer"
	"gorm.io/gorm"
)

// The platform console: what the super admin sees and does across every
// organization. Everything here is behind platformAuth (super admin only,
// verified, with a current session).

var startedAt = time.Now()

// ---------------------------------------------------------------------------
// Account review: which accounts look fake, and why
// ---------------------------------------------------------------------------

type reviewUser struct {
	ID          string     `json:"id"`
	Email       string     `json:"email"`
	Username    string     `json:"username"`
	FullName    string     `json:"full_name"`
	Role        string     `json:"role"`
	OrgID       *string    `json:"org_id"`
	OrgName     *string    `json:"org_name"`
	IsActive    bool       `json:"is_active"`
	Locked      bool       `json:"locked"`
	Pending     bool       `json:"email_verification_pending"`
	HasLoggedIn bool       `json:"has_logged_in"`
	SignupIP    *string    `json:"signup_ip"`
	LastLogin   *time.Time `json:"last_login"`
	CreatedAt   time.Time  `json:"created_at"`
	Passkeys    int64      `json:"passkeys"`
	Status      string     `json:"status"`
	Flags       []string   `json:"flags"`
	Score       int        `json:"risk_score"`
}

var (
	reLinkish   = regexp.MustCompile(`(?i)(https?://|www\.|\.(ru|cn|top|xyz|click|link|shop)\b|<a\s)`)
	reRandomish = regexp.MustCompile(`^[a-z0-9]{12,}$`)
	reDigitRun  = regexp.MustCompile(`\d{5,}`)
)

// gibberish reports whether s looks machine-generated: long runs of
// consonants or digits that people don't type as names.
func gibberish(s string) bool {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "" {
		return false
	}
	if reDigitRun.MatchString(s) {
		return true
	}
	run := 0
	for _, r := range s {
		switch {
		case strings.ContainsRune("aeiouy", r):
			run = 0
		case r >= 'a' && r <= 'z':
			run++
			if run >= 6 {
				return true
			}
		default:
			run = 0
		}
	}
	return reRandomish.MatchString(s) && !strings.ContainsAny(s, "aeiou")
}

// scoreAccounts fills Status, Flags and Score for each account.
func scoreAccounts(rows []reviewUser, at time.Time) {
	// Bursts: several sign-ups from one IP, or many within ten minutes.
	byIP := map[string]int{}
	for _, u := range rows {
		if u.SignupIP != nil && *u.SignupIP != "" {
			byIP[*u.SignupIP]++
		}
	}
	times := make([]time.Time, 0, len(rows))
	for _, u := range rows {
		times = append(times, u.CreatedAt)
	}
	sort.Slice(times, func(i, j int) bool { return times[i].Before(times[j]) })
	inBurst := func(t time.Time) bool {
		lo := sort.Search(len(times), func(i int) bool { return !times[i].Before(t.Add(-5 * time.Minute)) })
		hi := sort.Search(len(times), func(i int) bool { return times[i].After(t.Add(5 * time.Minute)) })
		return hi-lo >= 5
	}
	for i := range rows {
		u := &rows[i]
		switch {
		case !u.IsActive:
			u.Status = "deactivated"
		case u.Locked:
			u.Status = "locked"
		case u.Pending:
			u.Status = "unverified"
		default:
			u.Status = "active"
		}
		u.Flags = []string{}
		if auth.IsPlatformAdmin(u.Role) {
			continue
		}
		add := func(flag string, pts int) { u.Flags = append(u.Flags, flag); u.Score += pts }
		age := at.Sub(u.CreatedAt)
		if u.Pending && age > 24*time.Hour {
			add("unverified_24h", 35)
		} else if u.Pending {
			add("unverified", 15)
		}
		if mailer.IsDisposableDomain(mailer.Domain(u.Email)) {
			add("disposable_email", 40)
		}
		if !u.HasLoggedIn && age > 72*time.Hour {
			add("never_signed_in", 20)
		}
		names := u.FullName + " " + u.Username + " " + deref(u.OrgName)
		if reLinkish.MatchString(names) {
			add("link_in_name", 40)
		}
		if gibberish(u.FullName) || gibberish(u.Username) || gibberish(strings.Split(u.Email, "@")[0]) {
			add("random_looking_name", 15)
		}
		if u.SignupIP != nil && byIP[*u.SignupIP] >= 3 {
			add("same_ip_burst", 25)
		}
		if inBurst(u.CreatedAt) {
			add("signup_burst", 15)
		}
		if u.Score > 100 {
			u.Score = 100
		}
	}
}

func (a *App) loadReviewUsers(db *gorm.DB, where string, args ...interface{}) ([]reviewUser, error) {
	q := db.Table("users u").
		Select(`u.id, u.email, u.username, u.full_name, u.role, u.org_id, o.name AS org_name, u.is_active,
			(u.locked_until IS NOT NULL AND u.locked_until > now()) AS locked,
			COALESCE(u.email_verification_pending, false) AS pending, COALESCE(u.has_logged_in, false) AS has_logged_in,
			u.signup_ip, u.last_login, u.created_at,
			(SELECT count(*) FROM itsm_passkeys k WHERE k.user_id = u.id) AS passkeys`).
		Joins("LEFT JOIN organizations o ON o.id = u.org_id")
	if where != "" {
		q = q.Where(where, args...)
	}
	var rows []reviewUser
	if err := q.Order("u.created_at DESC").Limit(5000).Scan(&rows).Error; err != nil {
		return nil, err
	}
	scoreAccounts(rows, now())
	return rows, nil
}

// ---------------------------------------------------------------------------
// Purging fake accounts and organizations
// ---------------------------------------------------------------------------

// userScopedTables hold rows that belong to one account.
var userScopedTables = []string{
	"itsm_api_keys", "itsm_auth_tokens", "itsm_avatars", "itsm_passkeys", "itsm_recovery_codes",
	"itsm_refresh_sessions", "itsm_web_authn_challenges", "itsm_people", "itsm_group_members",
	"itsm_team_members", "itsm_watchers",
}

// footprint counts records a person created or is named on. Accounts with
// any are real enough that they must be deactivated, not deleted.
func footprint(db *gorm.DB, userID string) int64 {
	var n int64
	db.Raw(`SELECT
		(SELECT count(*) FROM itsm_tickets WHERE requester_id = ? OR responder_id = ? OR created_by_id = ?) +
		(SELECT count(*) FROM itsm_conversations WHERE user_id = ?)`, userID, userID, userID, userID).Scan(&n)
	return n
}

// orgFootprint counts service desk records an organization holds. The
// starter knowledge base articles every new organization gets (no author)
// do not count.
func orgFootprint(db *gorm.DB, orgID string) int64 {
	var n int64
	db.Raw(`SELECT
		(SELECT count(*) FROM itsm_tickets WHERE org_id = ?) + (SELECT count(*) FROM itsm_problems WHERE org_id = ?) +
		(SELECT count(*) FROM itsm_changes WHERE org_id = ?) + (SELECT count(*) FROM itsm_assets WHERE org_id = ?) +
		(SELECT count(*) FROM itsm_projects WHERE org_id = ?) + (SELECT count(*) FROM itsm_kb_articles WHERE org_id = ? AND author_id IS NOT NULL)`,
		orgID, orgID, orgID, orgID, orgID, orgID).Scan(&n)
	return n
}

// purgeOrg deletes an organization and every org-scoped row (no foreign
// keys tie them together, so each table is cleared explicitly).
func purgeOrg(tx *gorm.DB, orgID string) error {
	var tables []string
	if err := tx.Raw(`SELECT table_name FROM information_schema.columns
		WHERE column_name = 'org_id' AND table_schema = current_schema() AND table_name <> 'users'`).Scan(&tables).Error; err != nil {
		return err
	}
	for _, t := range tables {
		if t == "itsm_audit_logs" {
			continue // the record of what happened is kept
		}
		if err := tx.Exec(fmt.Sprintf(`DELETE FROM %q WHERE org_id = ?`, t), orgID).Error; err != nil {
			return err
		}
	}
	return tx.Exec(`DELETE FROM organizations WHERE id = ?`, orgID).Error
}

func purgeUser(tx *gorm.DB, userID string) error {
	for _, t := range userScopedTables {
		if err := tx.Exec(fmt.Sprintf(`DELETE FROM %q WHERE user_id = ?`, t), userID).Error; err != nil {
			return err
		}
	}
	return tx.Exec(`DELETE FROM users WHERE id = ?`, userID).Error
}

type purgeOutcome struct {
	ID     string `json:"id"`
	Email  string `json:"email"`
	Result string `json:"result"` // deleted | skipped
	Reason string `json:"reason,omitempty"`
}

// purgeAccounts deletes accounts that never became real: unverified, or
// never signed in, with nothing to their name. An organization goes with its
// last member when it holds no data.
func (a *App) purgeAccounts(db *gorm.DB, actor string, ids []string, ip string) ([]purgeOutcome, error) {
	out := []purgeOutcome{}
	for _, id := range ids {
		if !isUUID(id) {
			continue
		}
		var u struct {
			ID          string
			Email       string
			Role        string
			OrgID       *string
			Pending     bool
			HasLoggedIn bool
		}
		if db.Table("users").Select("id, email, role, org_id, COALESCE(email_verification_pending,false) AS pending, COALESCE(has_logged_in,false) AS has_logged_in").
			Where("id = ?", id).Take(&u).Error != nil {
			out = append(out, purgeOutcome{ID: id, Result: "skipped", Reason: "not found"})
			continue
		}
		skip := func(reason string) { out = append(out, purgeOutcome{ID: id, Email: u.Email, Result: "skipped", Reason: reason}) }
		switch {
		case id == actor || auth.IsPlatformAdmin(u.Role):
			skip("platform administrators are never deleted")
			continue
		case !u.Pending && u.HasLoggedIn:
			skip("verified account that has signed in; deactivate it instead")
			continue
		case footprint(db, id) > 0:
			skip("has tickets or replies; deactivate it instead")
			continue
		}
		err := db.Transaction(func(tx *gorm.DB) error {
			if err := purgeUser(tx, id); err != nil {
				return err
			}
			if u.OrgID == nil {
				return nil
			}
			var left int64
			tx.Table("users").Where("org_id = ?", *u.OrgID).Count(&left)
			if left == 0 && orgFootprint(tx, *u.OrgID) == 0 {
				return purgeOrg(tx, *u.OrgID)
			}
			return nil
		})
		if err != nil {
			return out, err
		}
		a.Invalidate(id)
		out = append(out, purgeOutcome{ID: id, Email: u.Email, Result: "deleted"})
		a.DB.Create(&AuditLog{Base: Base{OrgID: systemOrgID}, ActorID: &actor, Action: "platform.account_purged", EntityType: "user", EntityID: id,
			Summary: "Deleted fake or abandoned account " + u.Email, Details: jsonOf(map[string]interface{}{"org_id": u.OrgID}), IP: ip})
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

func readJSON(r *http.Request, v interface{}) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20))
	if err := dec.Decode(v); err != nil {
		return errBadRequest("invalid request body")
	}
	return nil
}

func (a *App) platformConsoleRoutes() {
	ipOf := func(r *http.Request) string { return (&Ctx{R: r}).ClientIP() }

	// Overview: the platform at a glance, all from real data.
	a.platform("GET /overview", func(w http.ResponseWriter, r *http.Request, _ string) error {
		db := a.DB.WithContext(r.Context())
		var c struct {
			Orgs, OrgsSuspended, Users, Unverified, Active7, Active30, NeverSignedIn, Locked, Deactivated, New24h, New7d int64
			Admins, AdminsWithPasskey, Tickets, OpenTickets, Passkeys                                                      int64
		}
		db.Raw(`SELECT
			(SELECT count(*) FROM organizations) AS orgs,
			(SELECT count(*) FROM organizations WHERE is_suspended) AS orgs_suspended,
			(SELECT count(*) FROM users WHERE role <> 'super_admin') AS users,
			(SELECT count(*) FROM users WHERE COALESCE(email_verification_pending,false)) AS unverified,
			(SELECT count(*) FROM users WHERE last_login > now() - interval '7 days') AS active7,
			(SELECT count(*) FROM users WHERE last_login > now() - interval '30 days') AS active30,
			(SELECT count(*) FROM users WHERE NOT COALESCE(has_logged_in,false) AND role <> 'super_admin') AS never_signed_in,
			(SELECT count(*) FROM users WHERE locked_until > now()) AS locked,
			(SELECT count(*) FROM users WHERE NOT is_active) AS deactivated,
			(SELECT count(*) FROM users WHERE created_at > now() - interval '24 hours') AS new24h,
			(SELECT count(*) FROM users WHERE created_at > now() - interval '7 days') AS new7d,
			(SELECT count(*) FROM users WHERE role IN ('super_admin','org_admin','admin') AND is_active AND NOT COALESCE(email_verification_pending,false)) AS admins,
			(SELECT count(DISTINCT u.id) FROM users u JOIN itsm_passkeys k ON k.user_id = u.id WHERE u.role IN ('super_admin','org_admin','admin')) AS admins_with_passkey,
			(SELECT count(*) FROM itsm_tickets WHERE NOT is_deleted) AS tickets,
			(SELECT count(*) FROM itsm_tickets WHERE NOT is_deleted AND status IN ('open','pending')) AS open_tickets,
			(SELECT count(*) FROM itsm_passkeys) AS passkeys`).Scan(&c)

		type day struct {
			Day        string `json:"day"`
			Verified   int64  `json:"verified"`
			Unverified int64  `json:"unverified"`
		}
		var days []day
		db.Raw(`SELECT to_char(d, 'YYYY-MM-DD') AS day,
			(SELECT count(*) FROM users u WHERE u.created_at >= d AND u.created_at < d + interval '1 day' AND NOT COALESCE(u.email_verification_pending,false)) AS verified,
			(SELECT count(*) FROM users u WHERE u.created_at >= d AND u.created_at < d + interval '1 day' AND COALESCE(u.email_verification_pending,false)) AS unverified
			FROM generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') d ORDER BY d`).Scan(&days)

		rows, err := a.loadReviewUsers(db, "")
		if err != nil {
			return err
		}
		suspicious := 0
		for _, u := range rows {
			if u.Score >= 50 {
				suspicious++
			}
		}
		var mail struct{ Queued, Failed24h, Sent24h int64 }
		db.Raw(`SELECT
			(SELECT count(*) FROM itsm_email_outbox WHERE status = 'queued') AS queued,
			(SELECT count(*) FROM itsm_email_outbox WHERE status = 'failed' AND updated_at > now() - interval '24 hours') AS failed24h,
			(SELECT count(*) FROM itsm_email_outbox WHERE status = 'sent' AND updated_at > now() - interval '24 hours') AS sent24h`).Scan(&mail)

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"organizations": map[string]int64{"total": c.Orgs, "suspended": c.OrgsSuspended},
			"users": map[string]interface{}{"total": c.Users, "unverified": c.Unverified, "active_7d": c.Active7, "active_30d": c.Active30,
				"never_signed_in": c.NeverSignedIn, "locked": c.Locked, "deactivated": c.Deactivated, "new_24h": c.New24h, "new_7d": c.New7d,
				"suspicious": suspicious},
			"security": map[string]int64{"admins": c.Admins, "admins_with_passkey": c.AdminsWithPasskey, "passkeys": c.Passkeys},
			"tickets":  map[string]int64{"total": c.Tickets, "open": c.OpenTickets},
			"email":    map[string]int64{"queued": mail.Queued, "failed_24h": mail.Failed24h, "sent_24h": mail.Sent24h},
			"signups":  days,
		})
		return nil
	})

	// Account review: every account with risk flags; ?filter narrows it.
	a.platform("GET /accounts", func(w http.ResponseWriter, r *http.Request, _ string) error {
		q := r.URL.Query()
		where, args := []string{}, []interface{}{}
		if v := strings.TrimSpace(q.Get("q")); v != "" {
			where = append(where, "(u.email ILIKE ? OR u.full_name ILIKE ? OR u.username ILIKE ? OR o.name ILIKE ?)")
			args = append(args, likeEscape(v), likeEscape(v), likeEscape(v), likeEscape(v))
		}
		if v := q.Get("org_id"); isUUID(v) {
			where = append(where, "u.org_id = ?")
			args = append(args, v)
		}
		rows, err := a.loadReviewUsers(a.DB.WithContext(r.Context()), strings.Join(where, " AND "), args...)
		if err != nil {
			return err
		}
		keep := func(u reviewUser) bool {
			switch q.Get("filter") {
			case "suspicious":
				return u.Score >= 50
			case "unverified":
				return u.Pending
			case "never_signed_in":
				return !u.HasLoggedIn && !auth.IsPlatformAdmin(u.Role)
			case "admins":
				return auth.IsPlatformAdmin(u.Role) || auth.IsOrgAdminRole(u.Role)
			case "admins_no_passkey":
				return (auth.IsPlatformAdmin(u.Role) || auth.IsOrgAdminRole(u.Role)) && u.Passkeys == 0 && !u.Pending
			case "locked":
				return u.Locked
			case "deactivated":
				return !u.IsActive
			}
			return true
		}
		items := []reviewUser{}
		for _, u := range rows {
			if keep(u) {
				items = append(items, u)
			}
		}
		if q.Get("sort") == "risk" {
			sort.SliceStable(items, func(i, j int) bool { return items[i].Score > items[j].Score })
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"items": items, "total": len(items)})
		return nil
	})

	a.platform("POST /accounts/purge", func(w http.ResponseWriter, r *http.Request, actor string) error {
		var in struct {
			IDs []string `json:"ids"`
		}
		if err := readJSON(r, &in); err != nil {
			return err
		}
		if len(in.IDs) == 0 || len(in.IDs) > 500 {
			return errBadRequest("choose between 1 and 500 accounts")
		}
		out, err := a.purgeAccounts(a.DB.WithContext(r.Context()), actor, in.IDs, ipOf(r))
		if err != nil {
			return err
		}
		deleted := 0
		for _, o := range out {
			if o.Result == "deleted" {
				deleted++
			}
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"deleted": deleted, "results": out})
		return nil
	})

	userOnly := func(r *http.Request, actor string) (accountRow, error) {
		id := r.PathValue("id")
		if !isUUID(id) {
			return accountRow{}, errNotFound("user")
		}
		acc, ok := findAccount(a.DB.WithContext(r.Context()), "id = ?", id)
		if !ok {
			return accountRow{}, errNotFound("user")
		}
		if acc.ID != actor && auth.IsPlatformAdmin(acc.Role) {
			return accountRow{}, errForbidden("other platform administrators cannot be changed here")
		}
		return acc, nil
	}
	platformAudit := func(r *http.Request, actor string, acc accountRow, action, summary string) {
		org := systemOrgID
		if acc.OrgID != nil {
			org = *acc.OrgID
		}
		a.DB.Create(&AuditLog{Base: Base{OrgID: org}, ActorID: &actor, Action: action, EntityType: "user", EntityID: acc.ID,
			Summary: summary, Details: jsonOf(nil), IP: ipOf(r)})
	}

	// Removes someone's passkeys and recovery codes and signs them out; they
	// set up a new passkey at their next sign-in (after an emailed code).
	a.platform("POST /users/{id}/reset-passkeys", func(w http.ResponseWriter, r *http.Request, actor string) error {
		acc, err := userOnly(r, actor)
		if err != nil {
			return err
		}
		if acc.ID == actor {
			return errBadRequest("manage your own passkeys under Account security")
		}
		resetSignInSecurity(a.DB.WithContext(r.Context()), acc.ID)
		a.Invalidate(acc.ID)
		platformAudit(r, actor, acc, "security.passkeys_reset", "Platform admin reset the passkeys of "+acc.Email)
		writeJSON(w, http.StatusOK, map[string]string{"message": "passkeys reset; they will set up a new one at their next sign-in"})
		return nil
	})

	a.platform("POST /users/{id}/sign-out", func(w http.ResponseWriter, r *http.Request, actor string) error {
		acc, err := userOnly(r, actor)
		if err != nil {
			return err
		}
		if acc.ID == actor {
			return errBadRequest("use Sign out everywhere on your own account")
		}
		db := a.DB.WithContext(r.Context())
		db.Table("users").Where("id = ?", acc.ID).Update("tokens_revoked_at", now())
		db.Model(&RefreshSession{}).Where("user_id = ? AND revoked_at IS NULL", acc.ID).Update("revoked_at", now())
		a.Invalidate(acc.ID)
		platformAudit(r, actor, acc, "security.signed_out_by_admin", "Platform admin signed "+acc.Email+" out everywhere")
		writeJSON(w, http.StatusOK, map[string]string{"message": "signed out everywhere"})
		return nil
	})

	a.platform("GET /users/{id}", func(w http.ResponseWriter, r *http.Request, actor string) error {
		acc, err := userOnly(r, actor)
		if err != nil {
			return err
		}
		db := a.DB.WithContext(r.Context())
		rows, err := a.loadReviewUsers(db, "u.id = ?", acc.ID)
		if err != nil || len(rows) == 0 {
			return errNotFound("user")
		}
		var sessions []RefreshSession
		db.Where("user_id = ? AND revoked_at IS NULL AND expires_at > ?", acc.ID, now()).Order("created_at DESC").Limit(20).Find(&sessions)
		var events []AuditLog
		db.Where("entity_type = 'user' AND entity_id = ?", acc.ID).Order("created_at DESC").Limit(30).Find(&events)
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"user": rows[0], "passkeys": loadPasskeys(db, acc.ID), "sessions": sessions, "events": events,
			"footprint": footprint(db, acc.ID),
		})
		return nil
	})

	a.platform("GET /organizations/{id}", func(w http.ResponseWriter, r *http.Request, _ string) error {
		id := r.PathValue("id")
		if !isUUID(id) {
			return errNotFound("organization")
		}
		db := a.DB.WithContext(r.Context())
		var org struct {
			ID          string    `json:"id"`
			Name        string    `json:"name"`
			Domain      *string   `json:"domain"`
			Description *string   `json:"description"`
			IsSuspended bool      `json:"is_suspended"`
			CreatedAt   time.Time `json:"created_at"`
		}
		if db.Table("organizations").Where("id = ?", id).Take(&org).Error != nil {
			return errNotFound("organization")
		}
		members, err := a.loadReviewUsers(db, "u.org_id = ?", id)
		if err != nil {
			return err
		}
		var counts struct{ Tickets, Problems, Changes, Assets, Projects, Articles int64 }
		db.Raw(`SELECT (SELECT count(*) FROM itsm_tickets WHERE org_id = ? AND NOT is_deleted) AS tickets,
			(SELECT count(*) FROM itsm_problems WHERE org_id = ?) AS problems, (SELECT count(*) FROM itsm_changes WHERE org_id = ?) AS changes,
			(SELECT count(*) FROM itsm_assets WHERE org_id = ?) AS assets, (SELECT count(*) FROM itsm_projects WHERE org_id = ?) AS projects,
			(SELECT count(*) FROM itsm_kb_articles WHERE org_id = ? AND author_id IS NOT NULL) AS articles`, id, id, id, id, id, id).Scan(&counts)
		var events []AuditLog
		db.Where("org_id = ?", id).Order("created_at DESC").Limit(25).Find(&events)
		writeJSON(w, http.StatusOK, map[string]interface{}{"organization": org, "members": members, "events": events,
			"data": map[string]int64{"tickets": counts.Tickets, "problems": counts.Problems, "changes": counts.Changes,
				"assets": counts.Assets, "projects": counts.Projects, "articles": counts.Articles},
			"deletable": orgFootprint(db, id) == 0})
		return nil
	})

	// Deletes an organization that holds no service desk data, with its
	// members. The caller repeats the organization's name to confirm.
	a.platform("DELETE /organizations/{id}", func(w http.ResponseWriter, r *http.Request, actor string) error {
		id := r.PathValue("id")
		if !isUUID(id) {
			return errNotFound("organization")
		}
		var in struct {
			ConfirmName string `json:"confirm_name"`
		}
		if err := readJSON(r, &in); err != nil {
			return err
		}
		db := a.DB.WithContext(r.Context())
		var name string
		if db.Table("organizations").Select("name").Where("id = ?", id).Scan(&name); name == "" {
			return errNotFound("organization")
		}
		if strings.TrimSpace(in.ConfirmName) != name {
			return errBadRequest("type the organization's name exactly to confirm")
		}
		if orgFootprint(db, id) > 0 {
			return errBadRequest("this organization has tickets, assets or other records; suspend it instead")
		}
		var ids []string
		db.Table("users").Where("org_id = ?", id).Pluck("id", &ids)
		for _, uid := range ids {
			var role string
			db.Table("users").Select("role").Where("id = ?", uid).Scan(&role)
			if auth.IsPlatformAdmin(role) {
				return errBadRequest("a platform administrator belongs to this organization")
			}
		}
		err := db.Transaction(func(tx *gorm.DB) error {
			for _, uid := range ids {
				if err := purgeUser(tx, uid); err != nil {
					return err
				}
			}
			return purgeOrg(tx, id)
		})
		if err != nil {
			return err
		}
		a.Invalidate(ids...)
		a.DB.Create(&AuditLog{Base: Base{OrgID: systemOrgID}, ActorID: &actor, Action: "platform.organization_deleted", EntityType: "organization", EntityID: id,
			Summary: fmt.Sprintf("Deleted organization %s and its %d member(s)", name, len(ids)), Details: jsonOf(nil), IP: ipOf(r)})
		writeJSON(w, http.StatusOK, map[string]interface{}{"deleted": true, "members_deleted": len(ids)})
		return nil
	})

	// Security events across the platform.
	a.platform("GET /security/events", func(w http.ResponseWriter, r *http.Request, _ string) error {
		type ev struct {
			ID         string    `json:"id"`
			OrgID      string    `json:"org_id"`
			OrgName    *string   `json:"org_name"`
			ActorEmail *string   `json:"actor_email"`
			Action     string    `json:"action"`
			EntityType string    `json:"entity_type"`
			EntityID   string    `json:"entity_id"`
			Summary    string    `json:"summary"`
			IP         string    `json:"ip"`
			CreatedAt  time.Time `json:"created_at"`
		}
		q := a.DB.WithContext(r.Context()).Table("itsm_audit_logs l").
			Select("l.id, l.org_id, o.name AS org_name, u.email AS actor_email, l.action, l.entity_type, l.entity_id, l.summary, l.ip, l.created_at").
			Joins("LEFT JOIN organizations o ON o.id = l.org_id").Joins("LEFT JOIN users u ON u.id = l.actor_id").
			Where(`l.action LIKE 'security.%' OR l.action LIKE 'platform.%' OR l.action LIKE 'organization.%'
				OR l.action IN ('user.deactivated','user.reactivated','user.unlocked','user.email_verified','me.password_reset_email','me.signed_out_everywhere','me.email_verified')`)
		if v := strings.TrimSpace(r.URL.Query().Get("action")); v != "" {
			q = q.Where("l.action LIKE ?", likeEscape(v))
		}
		var rows []ev
		if err := q.Order("l.created_at DESC").Limit(300).Scan(&rows).Error; err != nil {
			return err
		}
		if rows == nil {
			rows = []ev{}
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"items": rows})
		return nil
	})

	// Security posture: what is protecting the platform right now.
	a.platform("GET /security/posture", func(w http.ResponseWriter, r *http.Request, _ string) error {
		db := a.DB.WithContext(r.Context())
		type check struct {
			Key    string `json:"key"`
			Label  string `json:"label"`
			OK     bool   `json:"ok"`
			Detail string `json:"detail"`
		}
		var adminsNoKey int64
		db.Raw(`SELECT count(*) FROM users u WHERE u.role IN ('super_admin','org_admin','admin') AND u.is_active
			AND NOT COALESCE(u.email_verification_pending,false) AND NOT EXISTS (SELECT 1 FROM itsm_passkeys k WHERE k.user_id = u.id)`).Scan(&adminsNoKey)
		var superAdmins int64
		db.Table("users").Where("role = 'super_admin' AND is_active").Count(&superAdmins)
		mc := a.mailConfig()
		turnstile := strings.TrimSpace(os.Getenv("TURNSTILE_SITE_KEY")) != ""
		checks := []check{
			{"https", "Site served over HTTPS", strings.HasPrefix(a.Cfg.PublicURL, "https://"), a.Cfg.PublicURL},
			{"email", "Outgoing email configured", mc.Enabled(), map[bool]string{true: "verification, reset and security emails can be sent", false: "set SMTP_* so verification and security emails work"}[mc.Enabled()]},
			{"verification", "New sign-ups must verify their email", mailer.VerificationRequired(mc), "EMAIL_VERIFICATION=" + os.Getenv("EMAIL_VERIFICATION")},
			{"captcha", "Sign-up CAPTCHA (Cloudflare Turnstile)", turnstile, map[bool]string{true: "site key set; the gateway verifies tokens with its secret", false: "set TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY"}[turnstile]},
			{"passkeys", "Admins must sign in with a passkey", passkeyEnforced(), "PASSKEY_ENFORCEMENT is " + map[bool]string{true: "on", false: "off"}[passkeyEnforced()]},
			{"admin_keys", "Every admin has a passkey", adminsNoKey == 0, fmt.Sprintf("%d active admin(s) have not set one up yet; they will be asked at their next sign-in", adminsNoKey)},
			{"super_admins", "Few platform administrators", superAdmins <= 2, fmt.Sprintf("%d active super admin account(s)", superAdmins)},
			{"break_glass", "Break-glass passkey reset is off", os.Getenv("RESET_PASSKEYS_FOR") == "", "RESET_PASSKEYS_FOR should be unset after use"},
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"checks": checks})
		return nil
	})

	// Health from real measurements, not estimates.
	a.platform("GET /health", func(w http.ResponseWriter, r *http.Request, _ string) error {
		db := a.DB.WithContext(r.Context())
		t0 := time.Now()
		dbOK := db.Exec("SELECT 1").Error == nil
		latency := time.Since(t0)
		var size string
		db.Raw("SELECT pg_size_pretty(pg_database_size(current_database()))").Scan(&size)
		var conns int64
		db.Raw("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()").Scan(&conns)
		var ms runtime.MemStats
		runtime.ReadMemStats(&ms)
		stats := map[string]interface{}{}
		if sqlDB, err := a.DB.DB(); err == nil {
			s := sqlDB.Stats()
			stats = map[string]interface{}{"open": s.OpenConnections, "in_use": s.InUse, "idle": s.Idle, "max_open": s.MaxOpenConnections, "wait_count": s.WaitCount}
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"database":   map[string]interface{}{"ok": dbOK, "latency_ms": float64(latency.Microseconds()) / 1000, "size": size, "connections": conns, "pool": stats},
			"service":    map[string]interface{}{"uptime_seconds": int64(time.Since(startedAt).Seconds()), "go_version": runtime.Version(), "goroutines": runtime.NumGoroutine(), "memory_mb": ms.Alloc / (1 << 20), "environment": a.Cfg.Environment},
			"checked_at": now(),
		})
		return nil
	})
}
