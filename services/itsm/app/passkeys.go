package app

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/chanduchitikam/task-management-system/pkg/auth"
	"github.com/chanduchitikam/task-management-system/pkg/mailer"
	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// Sign-in security: passwords, passkeys (WebAuthn) and recovery codes.
//
// Every account signs in at POST /auth/login. Accounts that administer
// something (the platform super admin and organization admins) must also
// prove possession of a passkey; anyone else who has added one is asked for
// it too. The password step returns a short-lived "step token" instead of a
// session; the passkey (or a one-time recovery code) step exchanges it for
// tokens. An admin without a passkey yet registers one at that point, after
// confirming a code emailed to their address.

const (
	tokenStep          = "signin_step"       // password accepted, second step pending
	tokenSetupCode     = "passkey_setup"     // emailed code for a first passkey
	stepTokenTTL       = 10 * time.Minute    //
	setupCodeTTL       = 15 * time.Minute    //
	challengeTTL       = 5 * time.Minute     //
	maxCodeAttempts    = 5                   //
	recoveryCodeCount  = 10                  //
	loginMaxFailures   = 5                   // same as the user service
	loginLockout       = 15 * time.Minute    //
	passkeyNameMaxLen  = 60
	challengeKindLogin = "login"
	challengeKindSetup = "register"
)

// dummyPasswordHash is checked against for unknown emails so a failed
// sign-in takes the same time whether or not the account exists.
var dummyPasswordHash, _ = auth.HashPassword(randomToken())

// Passkey is one registered WebAuthn credential.
type Passkey struct {
	ID           string         `gorm:"primaryKey;type:uuid" json:"id"`
	UserID       string         `gorm:"type:uuid;index;not null" json:"-"`
	Name         string         `gorm:"not null" json:"name"`
	CredentialID string         `gorm:"uniqueIndex;not null" json:"-"`
	Credential   datatypes.JSON `gorm:"not null" json:"-"`
	Synced       bool           `json:"synced"`
	CreatedAt    time.Time      `json:"created_at"`
	LastUsedAt   *time.Time     `json:"last_used_at"`
	LastUsedIP   string         `json:"last_used_ip"`
}

// RecoveryCode is a one-time code for signing in without a passkey.
type RecoveryCode struct {
	ID        string     `gorm:"primaryKey;type:uuid"`
	UserID    string     `gorm:"type:uuid;index;not null"`
	CodeHash  string     `gorm:"not null"`
	UsedAt    *time.Time `gorm:"index"`
	CreatedAt time.Time
}

// WebAuthnChallenge holds a ceremony's server-side state between its two calls.
type WebAuthnChallenge struct {
	ID        string         `gorm:"primaryKey;type:uuid"`
	UserID    string         `gorm:"index"`
	Kind      string         `gorm:"not null"`
	Session   datatypes.JSON `gorm:"not null"`
	ExpiresAt time.Time      `gorm:"index;not null"`
	CreatedAt time.Time
}

// SecurityModels are migrated with the rest of the schema.
func SecurityModels() []interface{} {
	return []interface{}{&Passkey{}, &RecoveryCode{}, &WebAuthnChallenge{}}
}

// passkeyEnforced reports whether admins must use a passkey. It can be turned
// off with PASSKEY_ENFORCEMENT=off (local development, smoke tests).
func passkeyEnforced() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("PASSKEY_ENFORCEMENT"))) {
	case "off", "false", "disabled":
		return false
	}
	return true
}

// passkeyRequiredRole reports whether a platform role must sign in with a passkey.
func passkeyRequiredRole(role string) bool {
	return passkeyEnforced() && (auth.IsPlatformAdmin(role) || auth.IsOrgAdminRole(role))
}

// setupEmailCodeRequired reports whether a first passkey needs an emailed code.
func (a *App) setupEmailCodeRequired() bool {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("PASSKEY_SETUP_EMAIL_CODE")), "off") {
		return false
	}
	return a.mailConfig().Enabled()
}

// webAuthn builds the relying party from PUBLIC_URL (or WEBAUTHN_RP_ID /
// WEBAUTHN_ORIGINS when the site is served from several origins).
func (a *App) webAuthn() (*webauthn.WebAuthn, error) {
	u, err := url.Parse(strings.TrimRight(a.Cfg.PublicURL, "/"))
	if err != nil || u.Hostname() == "" {
		return nil, fmt.Errorf("PUBLIC_URL is not a valid URL")
	}
	rpID := strings.TrimSpace(os.Getenv("WEBAUTHN_RP_ID"))
	if rpID == "" {
		rpID = u.Hostname()
	}
	origins := []string{u.Scheme + "://" + u.Host}
	for _, o := range strings.Split(os.Getenv("WEBAUTHN_ORIGINS"), ",") {
		if o = strings.TrimRight(strings.TrimSpace(o), "/"); o != "" {
			origins = append(origins, o)
		}
	}
	return webauthn.New(&webauthn.Config{
		RPDisplayName: "TaskFlow",
		RPID:          rpID,
		RPOrigins:     origins,
		AuthenticatorSelection: protocol.AuthenticatorSelection{
			ResidentKey:      protocol.ResidentKeyRequirementRequired,
			UserVerification: protocol.VerificationRequired,
		},
		AttestationPreference: protocol.PreferNoAttestation,
	})
}

// ---------------------------------------------------------------------------
// WebAuthn user
// ---------------------------------------------------------------------------

type waUser struct {
	row   accountRow
	creds []webauthn.Credential
}

func (u *waUser) WebAuthnID() []byte                         { return []byte(u.row.ID) }
func (u *waUser) WebAuthnName() string                       { return u.row.Email }
func (u *waUser) WebAuthnDisplayName() string                { return u.row.name() }
func (u *waUser) WebAuthnCredentials() []webauthn.Credential { return u.creds }

func loadPasskeys(db *gorm.DB, userID string) []Passkey {
	var keys []Passkey
	db.Where("user_id = ?", userID).Order("created_at").Find(&keys)
	return keys
}

func waUserFor(db *gorm.DB, r accountRow) *waUser {
	u := &waUser{row: r}
	for _, k := range loadPasskeys(db, r.ID) {
		var c webauthn.Credential
		if json.Unmarshal(k.Credential, &c) == nil {
			u.creds = append(u.creds, c)
		}
	}
	return u
}

func credentialKey(id []byte) string { return base64.RawURLEncoding.EncodeToString(id) }

// ---------------------------------------------------------------------------
// Step tokens, codes and challenges
// ---------------------------------------------------------------------------

func randomToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// issueStepToken starts the second sign-in step for userID.
func issueStepToken(db *gorm.DB, userID string) (string, error) {
	raw := randomToken()
	db.Model(&AuthToken{}).Where("user_id = ? AND purpose = ? AND used_at IS NULL AND expires_at < ?", userID, tokenStep, now()).Update("used_at", now())
	err := db.Create(&AuthToken{ID: uuid.NewString(), UserID: userID, Purpose: tokenStep, TokenHash: hashToken(raw), ExpiresAt: now().Add(stepTokenTTL)}).Error
	return raw, err
}

var errStepExpired = &APIError{Status: http.StatusUnauthorized, Message: "Your sign-in timed out. Enter your email and password again."}

// stepAccount resolves a step token to its account; it stays usable until
// the second step succeeds.
func stepAccount(db *gorm.DB, raw string) (AuthToken, accountRow, error) {
	tok, usable := lookupAuthToken(db, raw, tokenStep)
	if !usable {
		return tok, accountRow{}, errStepExpired
	}
	r, ok := findAccount(db, "id = ?", tok.UserID)
	if !ok || !r.IsActive || r.Pending {
		return tok, accountRow{}, errStepExpired
	}
	return tok, r, nil
}

func sixDigitCode() string {
	n, _ := rand.Int(rand.Reader, big.NewInt(1000000))
	return fmt.Sprintf("%06d", n.Int64())
}

func codeHash(userID, code string) string { return hashToken(userID + ":" + strings.TrimSpace(code)) }

// checkSetupCode verifies the emailed code for a first passkey.
func checkSetupCode(db *gorm.DB, userID, code string) bool {
	var tok AuthToken
	if db.Where("user_id = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?", userID, tokenSetupCode, now()).
		Order("created_at DESC").Take(&tok).Error != nil {
		return false
	}
	if tok.Attempts >= maxCodeAttempts {
		return false
	}
	if subtle.ConstantTimeCompare([]byte(tok.TokenHash), []byte(codeHash(userID, code))) != 1 {
		db.Model(&AuthToken{}).Where("id = ?", tok.ID).Update("attempts", gorm.Expr("attempts + 1"))
		return false
	}
	return true
}

func saveChallenge(db *gorm.DB, userID, kind string, s *webauthn.SessionData) (string, error) {
	db.Where("expires_at < ?", now()).Delete(&WebAuthnChallenge{})
	raw, err := json.Marshal(s)
	if err != nil {
		return "", err
	}
	ch := WebAuthnChallenge{ID: uuid.NewString(), UserID: userID, Kind: kind, Session: raw, ExpiresAt: now().Add(challengeTTL)}
	return ch.ID, db.Create(&ch).Error
}

var errChallenge = &APIError{Status: http.StatusBadRequest, Message: "The passkey request expired. Please try again."}

// takeChallenge loads and deletes a challenge so it can be answered once.
func takeChallenge(db *gorm.DB, id, userID, kind string) (webauthn.SessionData, error) {
	var ch WebAuthnChallenge
	var s webauthn.SessionData
	if _, err := uuid.Parse(id); err != nil {
		return s, errChallenge
	}
	if db.Where("id = ? AND kind = ? AND expires_at > ?", id, kind, now()).Take(&ch).Error != nil {
		return s, errChallenge
	}
	if db.Where("id = ?", ch.ID).Delete(&WebAuthnChallenge{}).RowsAffected != 1 || ch.UserID != userID {
		return s, errChallenge
	}
	if json.Unmarshal(ch.Session, &s) != nil {
		return s, errChallenge
	}
	return s, nil
}

// newRecoveryCodes replaces userID's recovery codes and returns the new ones.
func newRecoveryCodes(db *gorm.DB, userID string) ([]string, error) {
	const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
	codes := make([]string, recoveryCodeCount)
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ?", userID).Delete(&RecoveryCode{}).Error; err != nil {
			return err
		}
		for i := range codes {
			var b strings.Builder
			for j := 0; j < 10; j++ {
				if j == 5 {
					b.WriteByte('-')
				}
				n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
				b.WriteByte(alphabet[n.Int64()])
			}
			codes[i] = b.String()
			if err := tx.Create(&RecoveryCode{ID: uuid.NewString(), UserID: userID, CodeHash: codeHash(userID, codes[i])}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	return codes, err
}

func normalizeRecoveryCode(code string) string {
	code = strings.ToLower(strings.ReplaceAll(strings.TrimSpace(code), " ", ""))
	if len(code) == 10 && !strings.Contains(code, "-") {
		code = code[:5] + "-" + code[5:]
	}
	return code
}

// ---------------------------------------------------------------------------
// Audit and notification helpers
// ---------------------------------------------------------------------------

func (a *App) securityAudit(c *Ctx, r accountRow, action, summary string) {
	org := systemOrgID
	if r.OrgID != nil && *r.OrgID != "" {
		org = *r.OrgID
	}
	id := r.ID
	c.DB().Create(&AuditLog{Base: Base{OrgID: org}, ActorID: &id, Action: action, EntityType: "user", EntityID: r.ID,
		Summary: summary, Details: jsonOf(map[string]string{"user_agent": truncate(c.R.UserAgent(), 200)}), IP: c.ClientIP()})
}

func (a *App) securityMail(c *Ctx, r accountRow, subject, title, line string) {
	a.queueRich(c.DB(), r.OrgID, r.Email, subject, mailer.Layout{
		Title:      title,
		Preheader:  line,
		Greeting:   "Hi " + r.name() + ",",
		Paragraphs: []string{line},
		Details:    []mailer.Detail{{Label: "When", Value: now().UTC().Format("Jan 2, 2006 15:04 MST")}, {Label: "From", Value: c.ClientIP()}},
		Note:       "If this was not you, sign in and remove unknown passkeys, change your password, and tell your administrator right away.",
	}, "user", r.ID)
}

// ---------------------------------------------------------------------------
// POST /auth/login {email, password}
// ---------------------------------------------------------------------------

type loginUser struct {
	ID       string `json:"id"`
	UserID   string `json:"user_id"`
	Email    string `json:"email"`
	Username string `json:"username"`
	FullName string `json:"full_name"`
	Role     string `json:"role"`
	OrgID    string `json:"org_id"`
}

type loginResult struct {
	AccessToken              string     `json:"access_token,omitempty"`
	RefreshToken             string     `json:"refresh_token,omitempty"`
	ExpiresIn                int        `json:"expires_in,omitempty"`
	User                     *loginUser `json:"user,omitempty"`
	MustChangePassword       bool       `json:"must_change_password,omitempty"`
	MustSetSecurityQuestions bool       `json:"must_set_security_questions,omitempty"`
	RecoveryCodes            []string   `json:"recovery_codes,omitempty"`
	Warning                  string     `json:"warning,omitempty"`

	// Second step: passkey (or recovery code) needed, or a first passkey to set up.
	PasskeyRequired      bool   `json:"passkey_required,omitempty"`
	PasskeySetupRequired bool   `json:"passkey_setup_required,omitempty"`
	EmailCodeRequired    bool   `json:"email_code_required,omitempty"`
	StepToken            string `json:"step_token,omitempty"`
}

var errBadLogin = &APIError{Status: http.StatusUnauthorized, Message: "invalid email or password"}

func (a *App) passwordLogin(c *Ctx) error {
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	email := strings.ToLower(strings.TrimSpace(in.Email))
	if email == "" || in.Password == "" || len(in.Password) > 256 {
		return errValidation(map[string]string{"email": "email and password are required"})
	}
	var u struct {
		ID                  string
		Password            string
		Role                string
		IsActive            bool
		Pending             bool
		OrgID               *string
		FailedLoginAttempts int
		LockedUntil         *time.Time
	}
	err := c.DB().Table("users").Select("id, password, role, is_active, COALESCE(email_verification_pending, false) AS pending, org_id, COALESCE(failed_login_attempts, 0) AS failed_login_attempts, locked_until").
		Where("LOWER(email) = ?", email).Take(&u).Error
	if err != nil {
		// Same work as a real check so response time does not reveal accounts.
		_ = auth.CheckPassword(in.Password, dummyPasswordHash)
		return errBadLogin
	}
	if !u.IsActive {
		return errForbidden("This account has been deactivated. Contact your administrator.")
	}
	if u.OrgID != nil && orgSuspended(c.DB(), *u.OrgID) {
		return errForbidden("Your organization has been suspended. Contact support.")
	}
	if u.LockedUntil != nil && u.LockedUntil.After(now()) {
		return errForbidden("Account temporarily locked after too many failed attempts. Try again after " + u.LockedUntil.UTC().Format(time.RFC1123) + " or contact your administrator.")
	}
	if auth.CheckPassword(in.Password, u.Password) != nil {
		updates := map[string]interface{}{"failed_login_attempts": u.FailedLoginAttempts + 1}
		if u.FailedLoginAttempts+1 >= loginMaxFailures {
			until := now().Add(loginLockout)
			updates["locked_until"] = &until
			updates["failed_login_attempts"] = 0
		}
		c.DB().Table("users").Where("id = ?", u.ID).Updates(updates)
		return errBadLogin
	}
	if u.Pending {
		return errForbidden("Please verify your email address before signing in. Use the link we sent to your inbox, or request a new one.")
	}
	c.DB().Table("users").Where("id = ?", u.ID).Updates(map[string]interface{}{"failed_login_attempts": 0, "locked_until": nil})

	var keys int64
	c.DB().Model(&Passkey{}).Where("user_id = ?", u.ID).Count(&keys)
	if keys > 0 || passkeyRequiredRole(u.Role) {
		step, err := issueStepToken(c.DB(), u.ID)
		if err != nil {
			return err
		}
		if keys > 0 {
			return c.JSON(http.StatusOK, loginResult{PasskeyRequired: true, StepToken: step})
		}
		res := loginResult{PasskeySetupRequired: true, StepToken: step, EmailCodeRequired: a.setupEmailCodeRequired()}
		if res.EmailCodeRequired {
			r, _ := findAccount(c.DB(), "id = ?", u.ID)
			a.sendSetupCode(c, r)
		}
		return c.JSON(http.StatusOK, res)
	}
	return a.completeSignIn(c, u.ID, nil)
}

// sendSetupCode emails a code that confirms the person setting up a first
// passkey can read the account's inbox.
func (a *App) sendSetupCode(c *Ctx, r accountRow) bool {
	var recent int64
	c.DB().Model(&AuthToken{}).Where("user_id = ? AND purpose = ? AND created_at > ?", r.ID, tokenSetupCode, now().Add(-time.Minute)).Count(&recent)
	if recent > 0 {
		return false
	}
	code := sixDigitCode()
	c.DB().Model(&AuthToken{}).Where("user_id = ? AND purpose = ? AND used_at IS NULL", r.ID, tokenSetupCode).Update("used_at", now())
	if c.DB().Create(&AuthToken{ID: uuid.NewString(), UserID: r.ID, Purpose: tokenSetupCode, TokenHash: codeHash(r.ID, code), ExpiresAt: now().Add(setupCodeTTL)}).Error != nil {
		return false
	}
	a.queueRich(c.DB(), r.OrgID, r.Email, "Your TaskFlow passkey setup code: "+code, mailer.Layout{
		Title:      "Set up your passkey",
		Preheader:  "Your code is " + code + ". It expires in 15 minutes.",
		Greeting:   "Hi " + r.name() + ",",
		Paragraphs: []string{"Your account now signs in with a passkey. Enter this code on the sign-in page to set one up:", code},
		Details:    []mailer.Detail{{Label: "Requested from", Value: c.ClientIP()}, {Label: "Requested at", Value: now().UTC().Format("Jan 2, 2006 15:04 MST")}},
		Note:       "The code expires in 15 minutes. If you did not just sign in with your password, change your password now; someone else knows it.",
	}, "user", r.ID)
	return true
}

// completeSignIn records the sign-in and returns a session for userID.
func (a *App) completeSignIn(c *Ctx, userID string, extra func(*loginResult)) error {
	var u struct {
		ID                 string
		Email              string
		Username           string
		FullName           string
		Role               string
		OrgID              *string
		MustChangePassword bool
		SecurityQuestions  string
	}
	if err := c.DB().Table("users").Select("id, email, username, full_name, role, org_id, COALESCE(must_change_password, false) AS must_change_password, COALESCE(security_questions, '') AS security_questions").
		Where("id = ?", userID).Take(&u).Error; err != nil {
		return errBadLogin
	}
	tokens, err := a.issueTokens(c, userID)
	if err != nil {
		return err
	}
	c.DB().Table("users").Where("id = ?", userID).Updates(map[string]interface{}{"has_logged_in": true, "last_login": now()})
	res := loginResult{
		AccessToken: tokens.AccessToken, RefreshToken: tokens.RefreshToken, ExpiresIn: tokens.ExpiresIn,
		User:                     &loginUser{ID: u.ID, UserID: u.ID, Email: u.Email, Username: u.Username, FullName: u.FullName, Role: u.Role, OrgID: deref(u.OrgID)},
		MustChangePassword:       u.MustChangePassword,
		MustSetSecurityQuestions: !auth.IsPlatformAdmin(u.Role) && (u.SecurityQuestions == "" || u.SecurityQuestions == "null"),
	}
	if extra != nil {
		extra(&res)
	}
	return c.JSON(http.StatusOK, res)
}

// ---------------------------------------------------------------------------
// Passkey sign-in
// ---------------------------------------------------------------------------

// POST /auth/passkey/options {step_token?} — with a step token the options
// name that account's passkeys; without one any passkey for this site works.
func (a *App) passkeyLoginOptions(c *Ctx) error {
	var in struct {
		StepToken string `json:"step_token"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	wa, err := a.webAuthn()
	if err != nil {
		return err
	}
	var assertion *protocol.CredentialAssertion
	var session *webauthn.SessionData
	userID := ""
	if in.StepToken != "" {
		_, r, err := stepAccount(c.DB(), in.StepToken)
		if err != nil {
			return err
		}
		u := waUserFor(c.DB(), r)
		if len(u.creds) == 0 {
			return errBadRequest("This account has no passkey yet.")
		}
		assertion, session, err = wa.BeginLogin(u, webauthn.WithUserVerification(protocol.VerificationRequired))
		if err != nil {
			return err
		}
		userID = r.ID
	} else {
		assertion, session, err = wa.BeginDiscoverableLogin(webauthn.WithUserVerification(protocol.VerificationRequired))
		if err != nil {
			return err
		}
	}
	id, err := saveChallenge(c.DB(), userID, challengeKindLogin, session)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"challenge_id": id, "options": assertion})
}

var errPasskeyFailed = &APIError{Status: http.StatusUnauthorized, Message: "That passkey could not be verified. Try again or use a different passkey."}

// POST /auth/passkey/verify {challenge_id, step_token?, credential}
func (a *App) passkeyLoginVerify(c *Ctx) error {
	var in struct {
		ChallengeID string          `json:"challenge_id"`
		StepToken   string          `json:"step_token"`
		Credential  json.RawMessage `json:"credential"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	wa, err := a.webAuthn()
	if err != nil {
		return err
	}
	parsed, perr := protocol.ParseCredentialRequestResponseBytes(in.Credential)
	if perr != nil {
		return errPasskeyFailed
	}
	var stepTok AuthToken
	var r accountRow
	var cred *webauthn.Credential
	if in.StepToken != "" {
		stepTok, r, err = stepAccount(c.DB(), in.StepToken)
		if err != nil {
			return err
		}
		session, err := takeChallenge(c.DB(), in.ChallengeID, r.ID, challengeKindLogin)
		if err != nil {
			return err
		}
		if cred, err = wa.ValidateLogin(waUserFor(c.DB(), r), session, parsed); err != nil {
			return errPasskeyFailed
		}
	} else {
		session, err := takeChallenge(c.DB(), in.ChallengeID, "", challengeKindLogin)
		if err != nil {
			return err
		}
		handler := func(rawID, userHandle []byte) (webauthn.User, error) {
			var k Passkey
			if c.DB().Where("credential_id = ?", credentialKey(rawID)).Take(&k).Error != nil || k.UserID != string(userHandle) {
				return nil, fmt.Errorf("unknown passkey")
			}
			acc, ok := findAccount(c.DB(), "id = ?", k.UserID)
			if !ok {
				return nil, fmt.Errorf("unknown account")
			}
			r = acc
			return waUserFor(c.DB(), acc), nil
		}
		if _, cred, err = wa.ValidatePasskeyLogin(handler, session, parsed); err != nil {
			return errPasskeyFailed
		}
		if !r.IsActive {
			return errForbidden("This account has been deactivated. Contact your administrator.")
		}
		if r.Pending {
			return errForbidden("Please verify your email address before signing in.")
		}
	}
	if cred.Authenticator.CloneWarning {
		a.securityAudit(c, r, "security.passkey_clone_warning", "Refused a passkey whose signature counter went backwards (possible cloned authenticator)")
		return errPasskeyFailed
	}
	if err := a.recordPasskeyUse(c, r.ID, cred); err != nil {
		return err
	}
	if stepTok.ID != "" && !consumeAuthToken(c.DB(), stepTok) {
		return errStepExpired
	}
	a.securityAudit(c, r, "security.signed_in_passkey", "Signed in with a passkey")
	return a.completeSignIn(c, r.ID, nil)
}

// recordPasskeyUse stores the updated sign counter and last-use details.
func (a *App) recordPasskeyUse(c *Ctx, userID string, cred *webauthn.Credential) error {
	raw, err := json.Marshal(cred)
	if err != nil {
		return err
	}
	ts := now()
	return c.DB().Model(&Passkey{}).Where("user_id = ? AND credential_id = ?", userID, credentialKey(cred.ID)).
		Updates(map[string]interface{}{"credential": datatypes.JSON(raw), "last_used_at": &ts, "last_used_ip": c.ClientIP()}).Error
}

// POST /auth/recovery {step_token, code}
func (a *App) recoveryCodeLogin(c *Ctx) error {
	var in struct {
		StepToken string `json:"step_token"`
		Code      string `json:"code"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	stepTok, r, err := stepAccount(c.DB(), in.StepToken)
	if err != nil {
		return err
	}
	var failures int64
	c.DB().Model(&AuditLog{}).Where("entity_id = ? AND action = ? AND created_at > ?", r.ID, "security.recovery_code_failed", now().Add(-time.Hour)).Count(&failures)
	if failures >= 10 {
		return &APIError{Status: http.StatusTooManyRequests, Message: "Too many attempts. Try again in an hour or contact your administrator."}
	}
	res := c.DB().Model(&RecoveryCode{}).Where("user_id = ? AND code_hash = ? AND used_at IS NULL", r.ID, codeHash(r.ID, normalizeRecoveryCode(in.Code))).Update("used_at", now())
	if res.RowsAffected != 1 {
		a.securityAudit(c, r, "security.recovery_code_failed", "Entered a wrong recovery code")
		return &APIError{Status: http.StatusUnauthorized, Message: "That recovery code is not valid or was already used."}
	}
	if !consumeAuthToken(c.DB(), stepTok) {
		return errStepExpired
	}
	var left int64
	c.DB().Model(&RecoveryCode{}).Where("user_id = ? AND used_at IS NULL", r.ID).Count(&left)
	a.securityAudit(c, r, "security.signed_in_recovery_code", fmt.Sprintf("Signed in with a recovery code (%d left)", left))
	a.securityMail(c, r, "A TaskFlow recovery code was used", "A recovery code was used",
		fmt.Sprintf("Someone signed in to %s with a one-time recovery code. %d codes are left.", r.Email, left))
	return a.completeSignIn(c, r.ID, func(res *loginResult) {
		res.Warning = fmt.Sprintf("You signed in with a recovery code; %d left. Add a new passkey under Account security if you lost yours.", left)
	})
}

// ---------------------------------------------------------------------------
// First passkey during sign-in
// ---------------------------------------------------------------------------

// POST /auth/passkey/setup/code {step_token} resends the emailed setup code.
func (a *App) passkeySetupResend(c *Ctx) error {
	var in struct {
		StepToken string `json:"step_token"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	_, r, err := stepAccount(c.DB(), in.StepToken)
	if err != nil {
		return err
	}
	if a.setupEmailCodeRequired() && !a.sendSetupCode(c, r) {
		return &APIError{Status: http.StatusTooManyRequests, Message: "A code was sent less than a minute ago. Check your inbox and spam folder."}
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "A new code is on its way."})
}

// POST /auth/passkey/setup/options {step_token, email_code}
func (a *App) passkeySetupOptions(c *Ctx) error {
	var in struct {
		StepToken string `json:"step_token"`
		EmailCode string `json:"email_code"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	_, r, err := stepAccount(c.DB(), in.StepToken)
	if err != nil {
		return err
	}
	if n := len(loadPasskeys(c.DB(), r.ID)); n > 0 {
		return errBadRequest("This account already has a passkey. Sign in with it.")
	}
	if a.setupEmailCodeRequired() && !checkSetupCode(c.DB(), r.ID, in.EmailCode) {
		return &APIError{Status: http.StatusBadRequest, Message: "That code is not right or has expired. Check the latest email or send a new code."}
	}
	return a.beginRegistration(c, r)
}

func (a *App) beginRegistration(c *Ctx, r accountRow) error {
	wa, err := a.webAuthn()
	if err != nil {
		return err
	}
	u := waUserFor(c.DB(), r)
	exclude := webauthn.Credentials(u.creds).CredentialDescriptors()
	creation, session, err := wa.BeginRegistration(u, webauthn.WithExclusions(exclude),
		webauthn.WithResidentKeyRequirement(protocol.ResidentKeyRequirementRequired))
	if err != nil {
		return err
	}
	id, err := saveChallenge(c.DB(), r.ID, challengeKindSetup, session)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"challenge_id": id, "options": creation})
}

// finishRegistration validates a new credential and stores it. It returns
// fresh recovery codes when this is the account's first passkey.
func (a *App) finishRegistration(c *Ctx, r accountRow, challengeID, name string, credential json.RawMessage) (*Passkey, []string, error) {
	wa, err := a.webAuthn()
	if err != nil {
		return nil, nil, err
	}
	session, err := takeChallenge(c.DB(), challengeID, r.ID, challengeKindSetup)
	if err != nil {
		return nil, nil, err
	}
	parsed, err := protocol.ParseCredentialCreationResponseBytes(credential)
	if err != nil {
		return nil, nil, &APIError{Status: http.StatusBadRequest, Message: "The passkey could not be created. Please try again."}
	}
	u := waUserFor(c.DB(), r)
	cred, err := wa.CreateCredential(u, session, parsed)
	if err != nil {
		return nil, nil, &APIError{Status: http.StatusBadRequest, Message: "The passkey could not be verified. Please try again."}
	}
	raw, err := json.Marshal(cred)
	if err != nil {
		return nil, nil, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Passkey"
	}
	if len(name) > passkeyNameMaxLen {
		name = name[:passkeyNameMaxLen]
	}
	first := len(u.creds) == 0
	k := Passkey{ID: uuid.NewString(), UserID: r.ID, Name: name, CredentialID: credentialKey(cred.ID), Credential: raw, Synced: cred.Flags.BackupEligible}
	if err := c.DB().Create(&k).Error; err != nil {
		return nil, nil, errConflict("That passkey is already registered.")
	}
	var codes []string
	if first {
		if codes, err = newRecoveryCodes(c.DB(), r.ID); err != nil {
			return nil, nil, err
		}
	}
	a.securityAudit(c, r, "security.passkey_added", "Added passkey \""+name+"\"")
	a.securityMail(c, r, "A passkey was added to your TaskFlow account", "New passkey added",
		"The passkey \""+name+"\" was added to "+r.Email+". It can now be used to sign in.")
	return &k, codes, nil
}

// POST /auth/passkey/setup/verify {step_token, challenge_id, credential, name}
func (a *App) passkeySetupVerify(c *Ctx) error {
	var in struct {
		StepToken   string          `json:"step_token"`
		ChallengeID string          `json:"challenge_id"`
		Name        string          `json:"name"`
		Credential  json.RawMessage `json:"credential"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	stepTok, r, err := stepAccount(c.DB(), in.StepToken)
	if err != nil {
		return err
	}
	_, codes, err := a.finishRegistration(c, r, in.ChallengeID, in.Name, in.Credential)
	if err != nil {
		return err
	}
	consumeAuthToken(c.DB(), stepTok)
	c.DB().Model(&AuthToken{}).Where("user_id = ? AND purpose = ? AND used_at IS NULL", r.ID, tokenSetupCode).Update("used_at", now())
	return a.completeSignIn(c, r.ID, func(res *loginResult) { res.RecoveryCodes = codes })
}

// ---------------------------------------------------------------------------
// Account security for any signed-in person (including the super admin,
// who has no organization and so no service desk profile)
// ---------------------------------------------------------------------------

// accountAuth authenticates a bearer token to an active, verified account.
func (a *App) accountAuth(r *http.Request) (accountRow, error) {
	h := strings.TrimSpace(r.Header.Get("Authorization"))
	if len(h) <= 7 || !strings.EqualFold(h[:7], "bearer ") {
		return accountRow{}, errUnauthorized
	}
	claims, err := a.JWT.ValidateToken(strings.TrimSpace(h[7:]))
	if err != nil || claims.UserID == "" || claims.Email == "" {
		return accountRow{}, &APIError{Status: http.StatusUnauthorized, Message: "invalid or expired token"}
	}
	acc, ok := findAccount(a.DB.WithContext(r.Context()), "id = ?", claims.UserID)
	if !ok || !acc.IsActive {
		return accountRow{}, errUnauthorized
	}
	if acc.Pending {
		return accountRow{}, errEmailUnverified
	}
	var cut struct {
		PasswordChangedAt *time.Time
		TokensRevokedAt   *time.Time
	}
	a.DB.WithContext(r.Context()).Table("users").Select("password_changed_at, tokens_revoked_at").Where("id = ?", acc.ID).Scan(&cut)
	if claims.IssuedAt != nil && tokenRevoked(claims.IssuedAt.Time, cut.PasswordChangedAt, cut.TokensRevokedAt) {
		return accountRow{}, &APIError{Status: http.StatusUnauthorized, Message: "session expired, please sign in again"}
	}
	return acc, nil
}

func (a *App) account(pattern string, h func(c *Ctx, r accountRow) error) {
	method, path, _ := strings.Cut(pattern, " ")
	a.mux.HandleFunc(method+" /api/v2/account"+path, func(w http.ResponseWriter, req *http.Request) {
		c := &Ctx{W: w, R: req, App: a}
		acc, err := a.accountAuth(req)
		if err == nil {
			err = h(c, acc)
		}
		if err != nil {
			a.writeError(w, err)
		}
	})
}

func (a *App) accountRoutes() {
	a.account("GET /security", func(c *Ctx, r accountRow) error {
		var left int64
		c.DB().Model(&RecoveryCode{}).Where("user_id = ? AND used_at IS NULL", r.ID).Count(&left)
		var events []AuditLog
		c.DB().Where("entity_type = 'user' AND entity_id = ? AND (action LIKE 'security.%' OR action LIKE 'me.%')", r.ID).
			Order("created_at DESC").Limit(20).Find(&events)
		type event struct {
			Action    string    `json:"action"`
			Summary   string    `json:"summary"`
			IP        string    `json:"ip"`
			CreatedAt time.Time `json:"created_at"`
		}
		out := make([]event, 0, len(events))
		for _, e := range events {
			out = append(out, event{e.Action, e.Summary, e.IP, e.CreatedAt})
		}
		return c.JSON(http.StatusOK, map[string]interface{}{
			"email":                    r.Email,
			"role":                     r.Role,
			"passkeys":                 loadPasskeys(c.DB(), r.ID),
			"passkey_required":         passkeyRequiredRole(r.Role),
			"recovery_codes_remaining": left,
			"events":                   out,
		})
	})
	a.account("POST /passkeys/options", func(c *Ctx, r accountRow) error {
		if len(loadPasskeys(c.DB(), r.ID)) >= 10 {
			return errBadRequest("You can have up to 10 passkeys. Remove one first.")
		}
		return a.beginRegistration(c, r)
	})
	a.account("POST /passkeys", func(c *Ctx, r accountRow) error {
		var in struct {
			ChallengeID string          `json:"challenge_id"`
			Name        string          `json:"name"`
			Credential  json.RawMessage `json:"credential"`
		}
		if err := c.Bind(&in); err != nil {
			return err
		}
		k, codes, err := a.finishRegistration(c, r, in.ChallengeID, in.Name, in.Credential)
		if err != nil {
			return err
		}
		return c.JSON(http.StatusCreated, map[string]interface{}{"passkey": k, "recovery_codes": codes})
	})
	a.account("PUT /passkeys/{id}", func(c *Ctx, r accountRow) error {
		var in struct {
			Name string `json:"name"`
		}
		if err := c.Bind(&in); err != nil {
			return err
		}
		name := strings.TrimSpace(in.Name)
		if name == "" || len(name) > passkeyNameMaxLen {
			return errValidation(map[string]string{"name": fmt.Sprintf("must be 1-%d characters", passkeyNameMaxLen)})
		}
		res := c.DB().Model(&Passkey{}).Where("id = ? AND user_id = ?", c.Param("id"), r.ID).Update("name", name)
		if res.RowsAffected == 0 {
			return errNotFound("passkey")
		}
		return c.JSON(http.StatusOK, map[string]string{"message": "renamed"})
	})
	a.account("DELETE /passkeys/{id}", func(c *Ctx, r accountRow) error {
		keys := loadPasskeys(c.DB(), r.ID)
		var target *Passkey
		for i := range keys {
			if keys[i].ID == c.Param("id") {
				target = &keys[i]
			}
		}
		if target == nil {
			return errNotFound("passkey")
		}
		if len(keys) == 1 && passkeyRequiredRole(r.Role) {
			return errBadRequest("Your account must keep at least one passkey. Add another one before removing this one.")
		}
		c.DB().Where("id = ?", target.ID).Delete(&Passkey{})
		if len(keys) == 1 {
			c.DB().Where("user_id = ?", r.ID).Delete(&RecoveryCode{})
		}
		a.securityAudit(c, r, "security.passkey_removed", "Removed passkey \""+target.Name+"\"")
		a.securityMail(c, r, "A passkey was removed from your TaskFlow account", "Passkey removed",
			"The passkey \""+target.Name+"\" was removed from "+r.Email+" and can no longer be used to sign in.")
		return c.JSON(http.StatusOK, map[string]string{"message": "removed"})
	})
	a.account("POST /recovery-codes", func(c *Ctx, r accountRow) error {
		if len(loadPasskeys(c.DB(), r.ID)) == 0 {
			return errBadRequest("Add a passkey first; recovery codes stand in for a lost passkey.")
		}
		codes, err := newRecoveryCodes(c.DB(), r.ID)
		if err != nil {
			return err
		}
		a.securityAudit(c, r, "security.recovery_codes_regenerated", "Generated new recovery codes")
		a.securityMail(c, r, "New TaskFlow recovery codes were generated", "New recovery codes",
			"New recovery codes were generated for "+r.Email+". The old ones no longer work.")
		return c.JSON(http.StatusOK, map[string]interface{}{"recovery_codes": codes})
	})
}

// resetSignInSecurity removes a person's passkeys and recovery codes and ends
// their sessions, so they set up a new passkey at their next sign-in.
func resetSignInSecurity(db *gorm.DB, userID string) {
	db.Where("user_id = ?", userID).Delete(&Passkey{})
	db.Where("user_id = ?", userID).Delete(&RecoveryCode{})
	db.Table("users").Where("id = ?", userID).Update("tokens_revoked_at", now())
	db.Model(&RefreshSession{}).Where("user_id = ? AND revoked_at IS NULL", userID).Update("revoked_at", now())
}

// BreakGlassResetPasskeys clears the passkeys of the account named by
// RESET_PASSKEYS_FOR at start-up: the way back in for a super admin who lost
// every passkey and recovery code. It needs access to the server.
func BreakGlassResetPasskeys(db *gorm.DB) {
	email := strings.ToLower(strings.TrimSpace(os.Getenv("RESET_PASSKEYS_FOR")))
	if email == "" {
		return
	}
	var id string
	if db.Table("users").Select("id").Where("LOWER(email) = ?", email).Scan(&id); id == "" {
		fmt.Printf("RESET_PASSKEYS_FOR: no account %s\n", email)
		return
	}
	resetSignInSecurity(db, id)
	fmt.Printf("RESET_PASSKEYS_FOR: cleared passkeys and recovery codes for %s; remove the variable and restart\n", email)
}
