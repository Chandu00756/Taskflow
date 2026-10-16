package app

import (
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/chanduchitikam/task-management-system/pkg/auth"
	"github.com/chanduchitikam/task-management-system/pkg/mailer"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Emailed links: verifying a new account's address and resetting a forgotten
// password. Each link carries a random single-use token; only its hash is stored.

const (
	tokenVerifyEmail   = "verify_email"
	tokenResetPassword = "reset_password"
	tokenActivate      = "activate"
	verifyTokenTTL     = 48 * time.Hour
	resetTokenTTL      = time.Hour
	adminResetTTL      = 24 * time.Hour
	activateTokenTTL   = 7 * 24 * time.Hour
	// systemOrgID tags outgoing mail that belongs to no organization (the
	// platform admin's own account).
	systemOrgID = "00000000-0000-0000-0000-000000000000"
)

// AuthToken is one emailed link.
type AuthToken struct {
	ID        string     `gorm:"primaryKey;type:uuid"`
	UserID    string     `gorm:"type:uuid;index;not null"`
	Purpose   string     `gorm:"index;not null"`
	TokenHash string     `gorm:"uniqueIndex;not null"`
	ExpiresAt time.Time  `gorm:"not null"`
	UsedAt    *time.Time `gorm:"index"`
	CreatedAt time.Time
}

// mailConfig is the SMTP configuration as a mailer.Config.
func (a *App) mailConfig() mailer.Config {
	return mailer.Config{Host: a.Cfg.SMTPHost, Port: a.Cfg.SMTPPort, User: a.Cfg.SMTPUser, Pass: a.Cfg.SMTPPass, From: a.Cfg.SMTPFrom}
}

func (a *App) link(path, token string) string {
	return strings.TrimRight(a.Cfg.PublicURL, "/") + path + "?token=" + url.QueryEscape(token)
}

// issueAuthToken creates a fresh link token for userID. Older unused links for
// the same purpose stop working. It refuses (ok=false) when a link was sent in
// the last minute or five in the last hour, so the endpoints cannot be used to
// flood an inbox.
func issueAuthToken(db *gorm.DB, userID, purpose string, ttl time.Duration) (raw string, ok bool) {
	var recent, hourly int64
	db.Model(&AuthToken{}).Where("user_id = ? AND purpose = ? AND created_at > ?", userID, purpose, now().Add(-time.Minute)).Count(&recent)
	db.Model(&AuthToken{}).Where("user_id = ? AND purpose = ? AND created_at > ?", userID, purpose, now().Add(-time.Hour)).Count(&hourly)
	if recent > 0 || hourly >= 5 {
		return "", false
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", false
	}
	raw = base64.RawURLEncoding.EncodeToString(b)
	db.Model(&AuthToken{}).Where("user_id = ? AND purpose = ? AND used_at IS NULL", userID, purpose).Update("used_at", now())
	if err := db.Create(&AuthToken{ID: uuid.NewString(), UserID: userID, Purpose: purpose, TokenHash: hashToken(raw), ExpiresAt: now().Add(ttl)}).Error; err != nil {
		return "", false
	}
	return raw, true
}

// lookupAuthToken returns the token row for raw; usable is false when it was
// already used or has expired.
func lookupAuthToken(db *gorm.DB, raw, purpose string) (tok AuthToken, usable bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > 200 {
		return tok, false
	}
	if db.Where("token_hash = ? AND purpose = ?", hashToken(raw), purpose).Take(&tok).Error != nil {
		return AuthToken{}, false
	}
	return tok, tok.UsedAt == nil && tok.ExpiresAt.After(now())
}

// consumeAuthToken marks tok used; false means another request used it first.
func consumeAuthToken(db *gorm.DB, tok AuthToken) bool {
	res := db.Model(&AuthToken{}).Where("id = ? AND used_at IS NULL", tok.ID).Update("used_at", now())
	return res.Error == nil && res.RowsAffected == 1
}

type accountRow struct {
	ID       string
	OrgID    *string
	Email    string
	FullName string
	Username string
	Role     string
	IsActive bool
	Pending  bool
}

func findAccount(db *gorm.DB, where string, arg interface{}) (accountRow, bool) {
	var r accountRow
	err := db.Table("users").Select("id, org_id, email, full_name, username, role, is_active, COALESCE(email_verification_pending, false) AS pending").
		Where(where, arg).Take(&r).Error
	return r, err == nil
}

func (r accountRow) name() string {
	if strings.TrimSpace(r.FullName) != "" {
		return strings.TrimSpace(r.FullName)
	}
	return r.Username
}

// GET /auth/config tells the sign-in pages which email features are on.
func (a *App) authConfig(c *Ctx) error {
	mc := a.mailConfig()
	return c.JSON(http.StatusOK, map[string]bool{
		"email_enabled":      mc.Enabled(),
		"email_verification": mailer.VerificationRequired(mc),
	})
}

// POST /auth/verify-email/send {email}
func (a *App) sendVerification(c *Ctx) error {
	var in struct {
		Email string `json:"email"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	reply := map[string]string{"message": "If this address is waiting to be verified, a new link is on its way. Check your inbox and spam folder."}
	r, ok := findAccount(c.DB(), "LOWER(email) = ?", strings.ToLower(strings.TrimSpace(in.Email)))
	if !ok || !r.IsActive || !r.Pending {
		return c.JSON(http.StatusOK, reply)
	}
	raw, ok := issueAuthToken(c.DB(), r.ID, tokenVerifyEmail, verifyTokenTTL)
	if ok {
		a.queueRich(c.DB(), r.OrgID, r.Email, "Verify your email for TaskFlow", mailer.Layout{
			Title:      "Confirm your email address",
			Preheader:  "One click to finish setting up your TaskFlow account.",
			Greeting:   "Hi " + r.name() + ",",
			Paragraphs: []string{"Thanks for signing up. Confirm that " + r.Email + " is your address to activate your account."},
			Button:     &mailer.Button{Label: "Verify my email", URL: a.link("/verify-email", raw)},
			Note:       "The link expires in 48 hours and works once. If you did not create a TaskFlow account, you can ignore this email.",
		}, "user", r.ID)
	}
	return c.JSON(http.StatusOK, reply)
}

// POST /auth/verify-email {token}
func (a *App) verifyEmail(c *Ctx) error {
	var in struct {
		Token string `json:"token"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	tok, usable := lookupAuthToken(c.DB(), in.Token, tokenVerifyEmail)
	if tok.ID != "" {
		r, ok := findAccount(c.DB(), "id = ?", tok.UserID)
		if ok && !r.Pending {
			return c.JSON(http.StatusOK, map[string]string{"message": "Your email is already verified. You can sign in.", "email": r.Email})
		}
		if ok && usable && consumeAuthToken(c.DB(), tok) {
			c.DB().Table("users").Where("id = ?", r.ID).Updates(map[string]interface{}{"email_verification_pending": false, "updated_at": now()})
			a.claimOrgDomain(c.DB(), r)
			if r.OrgID != nil {
				c.DB().Create(&AuditLog{Base: Base{OrgID: *r.OrgID}, ActorID: &r.ID, Action: "me.email_verified", EntityType: "user", EntityID: r.ID,
					Summary: "Verified email address " + r.Email, Details: jsonOf(nil), IP: c.ClientIP()})
			}
			return c.JSON(http.StatusOK, map[string]string{"message": "Your email is verified. You can sign in now.", "email": r.Email})
		}
	}
	return &APIError{Status: http.StatusBadRequest, Message: "This verification link is invalid or has expired. Request a new one from the sign-in page."}
}

// claimOrgDomain attaches the company domain to a new organization once its
// admin proves they own an address there, so colleagues are recognised.
func (a *App) claimOrgDomain(db *gorm.DB, r accountRow) {
	if r.OrgID == nil || !auth.IsOrgAdminRole(r.Role) {
		return
	}
	d := mailer.Domain(r.Email)
	if d == "" || mailer.IsPublicDomain(d) {
		return
	}
	db.Exec(`UPDATE organizations SET domain = ? WHERE id = ? AND (domain IS NULL OR domain = '')
		AND NOT EXISTS (SELECT 1 FROM organizations o2 WHERE LOWER(o2.domain) = ?)`, d, *r.OrgID, d)
}

// POST /auth/forgot/email {email}
func (a *App) forgotEmail(c *Ctx) error {
	if !a.mailConfig().Enabled() {
		return &APIError{Status: http.StatusBadRequest, Message: "Email reset is not available yet. Use your security questions or contact your administrator."}
	}
	var in struct {
		Email string `json:"email"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	email := strings.ToLower(strings.TrimSpace(in.Email))
	if !validEmail(email) {
		return errValidation(map[string]string{"email": "is invalid"})
	}
	reply := map[string]string{"message": "If an account exists for that email, we've sent a link to reset the password. It expires in 1 hour."}
	r, ok := findAccount(c.DB(), "LOWER(email) = ?", email)
	if !ok || !r.IsActive || (r.OrgID != nil && orgSuspended(c.DB(), *r.OrgID)) {
		return c.JSON(http.StatusOK, reply)
	}
	raw, ok := issueAuthToken(c.DB(), r.ID, tokenResetPassword, resetTokenTTL)
	if ok {
		a.queueRich(c.DB(), r.OrgID, r.Email, "Reset your TaskFlow password", mailer.Layout{
			Title:      "Reset your password",
			Preheader:  "Use this link to choose a new password. It expires in 1 hour.",
			Greeting:   "Hi " + r.name() + ",",
			Paragraphs: []string{"We received a request to reset the password for " + r.Email + ". Choose a new one with the button below."},
			Button:     &mailer.Button{Label: "Choose a new password", URL: a.link("/reset-password", raw)},
			Details:    []mailer.Detail{{Label: "Requested from", Value: c.ClientIP()}, {Label: "Requested at", Value: now().UTC().Format("Jan 2, 2006 15:04 MST")}},
			Note:       "The link expires in 1 hour and works once. If you did not ask for this, ignore this email; your password stays the same.",
		}, "user", r.ID)
	}
	return c.JSON(http.StatusOK, reply)
}

var errResetLink = &APIError{Status: http.StatusBadRequest, Message: "This reset link is invalid or has expired. Request a new one."}

// POST /auth/forgot/email/check {token} — lets the page show whose password
// is being reset before the user types a new one.
func (a *App) forgotEmailCheck(c *Ctx) error {
	var in struct {
		Token string `json:"token"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	tok, usable := lookupAuthToken(c.DB(), in.Token, tokenResetPassword)
	if !usable {
		return errResetLink
	}
	r, ok := findAccount(c.DB(), "id = ?", tok.UserID)
	if !ok || !r.IsActive {
		return errResetLink
	}
	return c.JSON(http.StatusOK, map[string]string{"email": r.Email})
}

// POST /auth/forgot/email/reset {token, new_password}
func (a *App) forgotEmailReset(c *Ctx) error {
	var in struct {
		Token       string `json:"token"`
		NewPassword string `json:"new_password"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	tok, usable := lookupAuthToken(c.DB(), in.Token, tokenResetPassword)
	if !usable {
		return errResetLink
	}
	r, ok := findAccount(c.DB(), "id = ?", tok.UserID)
	if !ok || !r.IsActive || (r.OrgID != nil && orgSuspended(c.DB(), *r.OrgID)) {
		return errResetLink
	}
	var s *Settings
	if r.OrgID != nil {
		var st Settings
		if c.DB().Where("org_id = ?", *r.OrgID).Take(&st).Error == nil {
			s = &st
		}
	}
	if err := validatePassword(s, in.NewPassword); err != nil {
		return errValidation(map[string]string{"new_password": err.Error()})
	}
	hash, err := auth.HashPassword(in.NewPassword)
	if err != nil {
		return err
	}
	if !consumeAuthToken(c.DB(), tok) {
		return errResetLink
	}
	// Receiving the link also proves the address belongs to the user.
	c.DB().Table("users").Where("id = ?", r.ID).Updates(map[string]interface{}{
		"password": hash, "must_change_password": false, "failed_login_attempts": 0, "locked_until": nil,
		"password_changed_at": now(), "email_verification_pending": false, "updated_at": now(),
	})
	c.DB().Model(&RefreshSession{}).Where("user_id = ? AND revoked_at IS NULL", r.ID).Update("revoked_at", now())
	a.Invalidate(r.ID)
	if r.Pending {
		a.claimOrgDomain(c.DB(), r)
	}
	if r.OrgID != nil {
		c.DB().Create(&AuditLog{Base: Base{OrgID: *r.OrgID}, ActorID: &r.ID, Action: "me.password_reset_email",
			EntityType: "user", EntityID: r.ID, Summary: "Reset password with an emailed link", Details: jsonOf(nil), IP: c.ClientIP()})
	}
	a.queueRich(c.DB(), r.OrgID, r.Email, "Your TaskFlow password was changed", mailer.Layout{
		Title:      "Your password was changed",
		Preheader:  "All devices were signed out.",
		Greeting:   "Hi " + r.name() + ",",
		Paragraphs: []string{"The password for " + r.Email + " was just changed using a reset link, and every device was signed out."},
		Details:    []mailer.Detail{{Label: "Changed at", Value: now().UTC().Format("Jan 2, 2006 15:04 MST")}, {Label: "From", Value: c.ClientIP()}},
		Button:     &mailer.Button{Label: "Sign in", URL: a.publicURL("/login")},
		Note:       "If this was not you, reset your password again right away and tell your administrator.",
	}, "user", r.ID)
	return c.JSON(http.StatusOK, map[string]string{"message": "password updated; you can now sign in"})
}

// ---------------------------------------------------------------------------
// Invitations: people an admin adds confirm their address and choose a password
// ---------------------------------------------------------------------------

func displayName(name, email string) string {
	if strings.TrimSpace(name) != "" {
		return strings.TrimSpace(name)
	}
	return strings.Split(email, "@")[0]
}

// inviteUser emails an activation link when email is configured and marks the
// address unverified until it is used. It returns false when email is off, so
// the caller hands the temporary password to the admin instead. db may be a
// transaction (CSV import).
func (a *App) inviteUser(db *gorm.DB, c *Ctx, userID, email, name string) bool {
	if !a.mailConfig().Enabled() {
		return false
	}
	db.Table("users").Where("id = ?", userID).Updates(map[string]interface{}{"email_verification_pending": true, "updated_at": now()})
	raw, ok := issueAuthToken(db, userID, tokenActivate, activateTokenTTL)
	if !ok {
		return true // an invitation went out moments ago and is still valid
	}
	s := c.settings()
	orgID := c.P.OrgID
	a.queueRich(db, &orgID, email, "You're invited to "+s.HelpdeskName, mailer.Layout{
		Title:      "You're invited to " + s.HelpdeskName,
		Preheader:  c.P.Name + " invited you. Activate your account to get started.",
		Greeting:   "Hi " + displayName(name, email) + ",",
		Paragraphs: []string{c.P.Name + " invited you to " + s.HelpdeskName + ". Activate your account and choose a password to get started."},
		Button:     &mailer.Button{Label: "Activate my account", URL: a.link("/activate", raw)},
		Details:    []mailer.Detail{{Label: "Your sign-in email", Value: email}, {Label: "Invited by", Value: c.P.Name}},
		Note:       "The link confirms that this address is yours, works once and expires in 7 days. If you were not expecting this, you can ignore this email.",
	}, "user", userID)
	return true
}

// POST /people/{id}/invite resends the activation email.
func (a *App) resendInvite(c *Ctx) error {
	r, err := c.loadPersonRow(c.Param("id"))
	if err != nil {
		return err
	}
	if !r.IsActive {
		return errBadRequest("reactivate this person before inviting them")
	}
	if !r.Pending && r.HasLoggedIn {
		return errBadRequest(r.Email + " has already activated their account")
	}
	if !a.mailConfig().Enabled() {
		return errBadRequest("Email is not configured. Use Reset password to get a temporary password instead.")
	}
	var recent int64
	c.DB().Model(&AuthToken{}).Where("user_id = ? AND purpose = ? AND created_at > ?", r.ID, tokenActivate, now().Add(-time.Minute)).Count(&recent)
	if recent > 0 {
		return &APIError{Status: http.StatusTooManyRequests, Message: "an invitation was sent less than a minute ago"}
	}
	a.inviteUser(c.DB(), c, r.ID, r.Email, r.FullName)
	c.audit("person.invited", "user", r.ID, "Sent an invitation to "+r.Email, nil)
	return c.JSON(http.StatusOK, map[string]string{"message": "Invitation sent to " + r.Email})
}

var errActivateLink = &APIError{Status: http.StatusBadRequest, Message: "This invitation link is invalid or has expired. Ask your administrator to send a new one."}

// POST /auth/activate/check {token}
func (a *App) activateCheck(c *Ctx) error {
	var in struct {
		Token string `json:"token"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	tok, usable := lookupAuthToken(c.DB(), in.Token, tokenActivate)
	if !usable {
		return errActivateLink
	}
	r, ok := findAccount(c.DB(), "id = ?", tok.UserID)
	if !ok || !r.IsActive {
		return errActivateLink
	}
	var org string
	if r.OrgID != nil {
		c.DB().Table("organizations").Select("name").Where("id = ?", *r.OrgID).Scan(&org)
	}
	return c.JSON(http.StatusOK, map[string]string{"email": r.Email, "name": r.name(), "organization": org})
}

// POST /auth/activate {token, new_password}
func (a *App) activateAccount(c *Ctx) error {
	var in struct {
		Token       string `json:"token"`
		NewPassword string `json:"new_password"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	tok, usable := lookupAuthToken(c.DB(), in.Token, tokenActivate)
	if !usable {
		return errActivateLink
	}
	r, ok := findAccount(c.DB(), "id = ?", tok.UserID)
	if !ok || !r.IsActive || (r.OrgID != nil && orgSuspended(c.DB(), *r.OrgID)) {
		return errActivateLink
	}
	var s *Settings
	if r.OrgID != nil {
		var st Settings
		if c.DB().Where("org_id = ?", *r.OrgID).Take(&st).Error == nil {
			s = &st
		}
	}
	if err := validatePassword(s, in.NewPassword); err != nil {
		return errValidation(map[string]string{"new_password": err.Error()})
	}
	hash, err := auth.HashPassword(in.NewPassword)
	if err != nil {
		return err
	}
	if !consumeAuthToken(c.DB(), tok) {
		return errActivateLink
	}
	c.DB().Table("users").Where("id = ?", r.ID).Updates(map[string]interface{}{
		"password": hash, "must_change_password": false, "failed_login_attempts": 0, "locked_until": nil,
		"password_changed_at": now(), "email_verification_pending": false, "updated_at": now(),
	})
	c.DB().Model(&RefreshSession{}).Where("user_id = ? AND revoked_at IS NULL", r.ID).Update("revoked_at", now())
	a.Invalidate(r.ID)
	if r.OrgID != nil {
		c.DB().Create(&AuditLog{Base: Base{OrgID: *r.OrgID}, ActorID: &r.ID, Action: "person.activated", EntityType: "user", EntityID: r.ID,
			Summary: "Activated account and verified " + r.Email, Details: jsonOf(nil), IP: c.ClientIP()})
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "Your account is active. Sign in with your new password.", "email": r.Email})
}
