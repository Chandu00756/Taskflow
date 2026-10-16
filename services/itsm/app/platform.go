package app

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/chanduchitikam/task-management-system/pkg/auth"
	"github.com/chanduchitikam/task-management-system/pkg/mailer"
	"gorm.io/gorm"
)

// Platform administration is available only to the platform super admin,
// who has no organization and therefore no service desk principal.

func (a *App) platformAuth(r *http.Request) (string, error) {
	h := strings.TrimSpace(r.Header.Get("Authorization"))
	if len(h) <= 7 || !strings.EqualFold(h[:7], "bearer ") {
		return "", errUnauthorized
	}
	claims, err := a.JWT.ValidateToken(strings.TrimSpace(h[7:]))
	if err != nil || claims.Email == "" {
		return "", &APIError{Status: http.StatusUnauthorized, Message: "invalid or expired token"}
	}
	var row struct {
		Role              string
		IsActive          bool
		PasswordChangedAt *time.Time
	}
	if err := a.DB.WithContext(r.Context()).Table("users").Select("role, is_active, password_changed_at").Where("id = ?", claims.UserID).Take(&row).Error; err != nil || !row.IsActive {
		return "", errUnauthorized
	}
	if row.PasswordChangedAt != nil && claims.IssuedAt != nil && claims.IssuedAt.Time.Before(row.PasswordChangedAt.Truncate(time.Second)) {
		return "", &APIError{Status: http.StatusUnauthorized, Message: "session expired, please sign in again"}
	}
	if !auth.IsPlatformAdmin(row.Role) {
		return "", errForbidden("platform administrator access required")
	}
	return claims.UserID, nil
}

func (a *App) platform(pattern string, h func(w http.ResponseWriter, r *http.Request, actor string) error) {
	method, path, _ := strings.Cut(pattern, " ")
	a.mux.HandleFunc(method+" /api/v2/platform"+path, func(w http.ResponseWriter, r *http.Request) {
		actor, err := a.platformAuth(r)
		if err == nil {
			err = h(w, r, actor)
		}
		if err != nil {
			a.writeError(w, err)
		}
	})
}

func (a *App) platformRoutes() {
	a.platform("GET /organizations", func(w http.ResponseWriter, r *http.Request, _ string) error {
		type orgRow struct {
			ID          string     `json:"id"`
			Name        string     `json:"name"`
			Domain      *string    `json:"domain"`
			Description *string    `json:"description"`
			IsSuspended bool       `json:"is_suspended"`
			Status      string     `json:"status"`
			MemberCount int64      `json:"member_count"`
			AgentCount  int64      `json:"agent_count"`
			TicketCount int64      `json:"ticket_count"`
			OpenTickets int64      `json:"open_tickets"`
			LastLogin   *time.Time `json:"last_login"`
			CreatedAt   time.Time  `json:"created_at"`
		}
		var rows []orgRow
		err := a.DB.WithContext(r.Context()).Raw(`
			SELECT o.id, o.name, o.domain, o.description, o.is_suspended, o.created_at,
			  (SELECT count(*) FROM users u WHERE u.org_id = o.id) AS member_count,
			  (SELECT count(*) FROM users u LEFT JOIN itsm_people p ON p.user_id = u.id
			     WHERE u.org_id = o.id AND (p.is_agent OR u.role IN ('org_admin','admin'))) AS agent_count,
			  (SELECT count(*) FROM itsm_tickets t WHERE t.org_id = o.id AND NOT t.is_deleted) AS ticket_count,
			  (SELECT count(*) FROM itsm_tickets t WHERE t.org_id = o.id AND NOT t.is_deleted AND t.status NOT IN ('resolved','closed')) AS open_tickets,
			  (SELECT max(u.last_login) FROM users u WHERE u.org_id = o.id) AS last_login
			FROM organizations o ORDER BY o.created_at DESC`).Scan(&rows).Error
		if err != nil {
			return err
		}
		for i := range rows {
			rows[i].Status = map[bool]string{true: "suspended", false: "active"}[rows[i].IsSuspended]
		}
		if rows == nil {
			rows = []orgRow{}
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"items": rows})
		return nil
	})

	setOrgSuspended := func(suspend bool) func(http.ResponseWriter, *http.Request, string) error {
		return func(w http.ResponseWriter, r *http.Request, actor string) error {
			id := r.PathValue("id")
			if !isUUID(id) {
				return errNotFound("organization")
			}
			res := a.DB.WithContext(r.Context()).Table("organizations").Where("id = ?", id).Updates(map[string]interface{}{"is_suspended": suspend, "updated_at": now()})
			if res.Error != nil {
				return res.Error
			}
			if res.RowsAffected == 0 {
				return errNotFound("organization")
			}
			// Drop cached identities so the change applies immediately.
			var ids []string
			a.DB.Table("users").Where("org_id = ?", id).Pluck("id", &ids)
			a.Invalidate(ids...)
			if suspend {
				a.DB.Model(&RefreshSession{}).Where("user_id IN ? AND revoked_at IS NULL", append(ids, "00000000-0000-0000-0000-000000000000")).Update("revoked_at", now())
			}
			action := map[bool]string{true: "organization.suspended", false: "organization.activated"}[suspend]
			a.DB.Create(&AuditLog{Base: Base{OrgID: id}, ActorID: &actor, Action: action, EntityType: "organization", EntityID: id,
				Summary: titleCase(strings.ReplaceAll(action, ".", " ")) + " by platform admin", Details: jsonOf(nil), IP: (&Ctx{R: r}).ClientIP()})
			writeJSON(w, http.StatusOK, map[string]interface{}{"id": id, "status": map[bool]string{true: "suspended", false: "active"}[suspend]})
			return nil
		}
	}
	a.platform("POST /organizations/{id}/suspend", setOrgSuspended(true))
	a.platform("POST /organizations/{id}/activate", setOrgSuspended(false))

	a.platform("GET /users", func(w http.ResponseWriter, r *http.Request, _ string) error {
		type userRow struct {
			ID        string     `json:"id"`
			Email     string     `json:"email"`
			Username  string     `json:"username"`
			FullName  string     `json:"full_name"`
			Role      string     `json:"role"`
			OrgID     *string    `json:"org_id"`
			OrgName   *string    `json:"org_name"`
			IsActive  bool       `json:"is_active"`
			Locked    bool       `json:"locked"`
			Pending   bool       `json:"email_verification_pending"`
			Status    string     `json:"status"`
			LastLogin *time.Time `json:"last_login"`
			CreatedAt time.Time  `json:"created_at"`
		}
		q := a.DB.WithContext(r.Context()).Table("users u").
			Select(`u.id, u.email, u.username, u.full_name, u.role, u.org_id, o.name AS org_name, u.is_active,
				(u.locked_until IS NOT NULL AND u.locked_until > now()) AS locked,
				COALESCE(u.email_verification_pending, false) AS pending, u.last_login, u.created_at`).
			Joins("LEFT JOIN organizations o ON o.id = u.org_id")
		if v := strings.TrimSpace(r.URL.Query().Get("q")); v != "" {
			q = q.Where("(u.email ILIKE ? OR u.full_name ILIKE ? OR u.username ILIKE ?)", likeEscape(v), likeEscape(v), likeEscape(v))
		}
		if v := r.URL.Query().Get("org_id"); isUUID(v) {
			q = q.Where("u.org_id = ?", v)
		}
		var rows []userRow
		if err := q.Order("u.created_at DESC").Limit(1000).Scan(&rows).Error; err != nil {
			return err
		}
		for i := range rows {
			switch {
			case !rows[i].IsActive:
				rows[i].Status = "deactivated"
			case rows[i].Locked:
				rows[i].Status = "locked"
			case rows[i].Pending:
				rows[i].Status = "unverified"
			default:
				rows[i].Status = "active"
			}
		}
		if rows == nil {
			rows = []userRow{}
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"items": rows})
		return nil
	})

	userAction := func(updates func() map[string]interface{}, action string) func(http.ResponseWriter, *http.Request, string) error {
		return func(w http.ResponseWriter, r *http.Request, actor string) error {
			id := r.PathValue("id")
			if !isUUID(id) {
				return errNotFound("user")
			}
			if id == actor {
				return errBadRequest("you cannot change your own account here")
			}
			var row struct {
				Role  string
				OrgID *string
			}
			if err := a.DB.Table("users").Select("role, org_id").Where("id = ?", id).Take(&row).Error; err != nil {
				return errNotFound("user")
			}
			if auth.IsPlatformAdmin(row.Role) {
				return errForbidden("platform administrators cannot be changed here")
			}
			if err := a.DB.WithContext(r.Context()).Table("users").Where("id = ?", id).Updates(updates()).Error; err != nil {
				return err
			}
			if action == "user.deactivated" {
				a.DB.Model(&RefreshSession{}).Where("user_id = ? AND revoked_at IS NULL", id).Update("revoked_at", now())
				a.DB.Where("user_id = ?", id).Delete(&APIKey{})
			}
			a.Invalidate(id)
			if row.OrgID != nil {
				a.DB.Create(&AuditLog{Base: Base{OrgID: *row.OrgID}, ActorID: &actor, Action: action, EntityType: "user", EntityID: id,
					Summary: titleCase(strings.ReplaceAll(action, ".", " ")) + " by platform admin", Details: jsonOf(nil), IP: (&Ctx{R: r}).ClientIP()})
			}
			writeJSON(w, http.StatusOK, map[string]string{"id": id, "message": "updated"})
			return nil
		}
	}
	a.platform("POST /users/{id}/deactivate", userAction(func() map[string]interface{} {
		return map[string]interface{}{"is_active": false, "updated_at": now()}
	}, "user.deactivated"))
	a.platform("POST /users/{id}/reactivate", userAction(func() map[string]interface{} {
		return map[string]interface{}{"is_active": true, "updated_at": now()}
	}, "user.reactivated"))
	a.platform("POST /users/{id}/unlock", userAction(func() map[string]interface{} {
		return map[string]interface{}{"failed_login_attempts": 0, "locked_until": nil}
	}, "user.unlocked"))
	// Confirms an address by hand, e.g. when the verification mail cannot arrive.
	a.platform("POST /users/{id}/verify-email", userAction(func() map[string]interface{} {
		return map[string]interface{}{"email_verification_pending": false, "updated_at": now()}
	}, "user.email_verified"))

	a.platform("GET /email", a.platformEmailStatus)
	a.platform("POST /email/test", a.platformEmailTest)
	a.platform("POST /email/retry", a.platformEmailRetry)
}

// platformEmailStatus reports the mail settings (never the password) and
// recent delivery results across all organizations.
func (a *App) platformEmailStatus(w http.ResponseWriter, r *http.Request, _ string) error {
	mc := a.mailConfig()
	from := ""
	if addr, err := mc.Sender(); err == nil {
		from = addr.String()
	} else if mc.Enabled() {
		from = "invalid: " + err.Error()
	}
	db := a.DB.WithContext(r.Context())
	type count struct {
		Status string
		N      int64
	}
	var counts []count
	db.Model(&EmailOutbox{}).Select("status, COUNT(*) AS n").Where("created_at > ? OR status IN ('queued','sending')", now().Add(-24*time.Hour)).
		Group("status").Scan(&counts)
	stats := map[string]int64{"queued": 0, "sending": 0, "sent": 0, "failed": 0, "skipped": 0}
	for _, c := range counts {
		stats[c.Status] = c.N
	}
	type recentRow struct {
		To        string     `json:"to"`
		Subject   string     `json:"subject"`
		Status    string     `json:"status"`
		Attempts  int        `json:"attempts"`
		LastError string     `json:"last_error"`
		OrgName   *string    `json:"org_name"`
		CreatedAt time.Time  `json:"created_at"`
		SentAt    *time.Time `json:"sent_at"`
	}
	var recent []recentRow
	db.Table("itsm_email_outbox e").Select("e.to_addr AS \"to\", e.subject, e.status, e.attempts, e.last_error, o.name AS org_name, e.created_at, e.sent_at").
		Joins("LEFT JOIN organizations o ON o.id = e.org_id").Order("e.created_at DESC").Limit(25).Scan(&recent)
	if recent == nil {
		recent = []recentRow{}
	}
	note, _ := a.mailNote.Load().(string)
	var pausedUntil *time.Time
	until, reason, kind, paused := a.mailGate.paused(now())
	if paused {
		pausedUntil = &until
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"sender_note":        note,
		"paused_until":       pausedUntil,
		"pause_reason":       reason,
		"pause_kind":         kind,
		"max_per_minute":     a.Cfg.SMTPMaxPerMinute,
		"max_per_day":        a.Cfg.SMTPMaxPerDay,
		"sent_last_24h":      sentLast24h(db),
		"configured":         mc.Enabled(),
		"host":               mc.Host,
		"port":               mc.Port,
		"user":               mc.User,
		"from":               from,
		"public_url":         a.Cfg.PublicURL,
		"email_verification": mailer.VerificationRequired(mc),
		"last_24h":           stats,
		"recent":             recent,
	})
	return nil
}

// platformEmailTest sends one message right away and returns the mail
// server's answer, so settings can be checked without waiting for the queue.
func (a *App) platformEmailTest(w http.ResponseWriter, r *http.Request, actor string) error {
	var in struct {
		To string `json:"to"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		return errBadRequest("invalid JSON body")
	}
	to := strings.TrimSpace(in.To)
	if !validEmail(to) {
		return errValidation(map[string]string{"to": "is invalid"})
	}
	mc := a.mailConfig()
	if !mc.Enabled() {
		return errBadRequest("Email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM in the server's .env, then restart the itsm-service.")
	}
	body := fmt.Sprintf("This is a test message from TaskFlow at %s.\n\nIf you can read this, outgoing email works.\n\nSent through %s:%s as %s.",
		a.Cfg.PublicURL, mc.Host, mc.Port, mc.User)
	l := a.emailLayout(a.DB, systemOrgID)
	l.Title = "Your email settings work"
	l.Preheader = "This is a test message from TaskFlow."
	l.Paragraphs = []string{"If you can read this, TaskFlow can send email. Notifications, invitations, verification and password reset links will reach your people."}
	l.Details = []mailer.Detail{{Label: "Mail server", Value: mc.Host + ":" + mc.Port}, {Label: "Signed in as", Value: mc.User}, {Label: "Sent at", Value: now().UTC().Format("Jan 2, 2006 15:04 MST")}}
	l.Button = &mailer.Button{Label: "Open TaskFlow", URL: a.publicURL("/")}
	l.Footer = "Sent from the TaskFlow platform console."
	res, err := mc.SendWithResult(mailer.Message{To: to, Subject: "TaskFlow test email", Text: body, HTML: mailer.RenderHTML(l)})
	if err != nil {
		msg := "The mail server refused the message: " + err.Error()
		if mailer.Throttled(err) {
			until := a.mailGate.throttled(now(), truncate(err.Error(), 300))
			msg += fmt.Sprintf(" The mail provider is limiting this account, so queued emails are paused until %s UTC. Use a sending service built for apps (ZeptoMail, Brevo, Amazon SES) or contact the provider.", until.UTC().Format("15:04"))
		}
		return &APIError{Status: http.StatusBadGateway, Message: msg}
	}
	// The server accepts mail again: resume the queue.
	a.mailGate.clear()
	a.kickMail()
	msg := "Test email sent to " + to + ". Check the inbox (and spam folder)."
	if res.Fallback {
		a.noteSenderFallback(mc, res.From)
		msg += " Note: it was sent from " + res.From + " because the mail server refused the configured sender."
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"message": msg, "fallback": res.Fallback, "from": res.From})
	return nil
}

// platformEmailRetry queues failed emails from the last 7 days again and
// sends emails waiting between attempts now, e.g. after fixing the mail
// settings; it also lifts a throttling pause.
func (a *App) platformEmailRetry(w http.ResponseWriter, r *http.Request, _ string) error {
	a.mailGate.clear()
	res := a.DB.WithContext(r.Context()).Model(&EmailOutbox{}).
		Where("((status = 'failed' AND created_at > ?) OR (status = 'queued' AND attempts > 0))", now().AddDate(0, 0, -7)).
		Updates(map[string]interface{}{"status": "queued", "attempts": 0, "last_error": "", "updated_at": now()})
	if res.Error != nil {
		return res.Error
	}
	a.kickMail()
	writeJSON(w, http.StatusOK, map[string]interface{}{"requeued": res.RowsAffected, "message": fmt.Sprintf("%d emails queued to send now", res.RowsAffected)})
	return nil
}

// orgSuspended reports whether an organization has been suspended.
func orgSuspended(db *gorm.DB, orgID string) bool {
	var suspended bool
	db.Table("organizations").Select("COALESCE(is_suspended, false)").Where("id = ?", orgID).Scan(&suspended)
	return suspended
}
