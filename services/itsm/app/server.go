package app

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/chanduchitikam/task-management-system/pkg/auth"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"gorm.io/gorm"
)

// Config carries runtime configuration for the service.
type Config struct {
	Environment string
	PublicURL   string // base URL of the web app, used in emails
	SMTPHost    string
	SMTPPort    string
	SMTPUser    string
	SMTPPass    string
	SMTPFrom    string
	// SMTPMaxPerMinute caps outgoing emails per minute (0 = no cap).
	SMTPMaxPerMinute int
	// SMTPMaxPerDay caps emails per 24 hours, e.g. a provider's free plan (0 = no cap).
	SMTPMaxPerDay   int
	MaxUploadBytes  int64
	RefreshTokenTTL time.Duration
}

// App wires the database, auth and HTTP routes together.
type App struct {
	DB     *gorm.DB
	JWT    *auth.JWTManager
	Cfg    Config
	mux    *http.ServeMux
	cache  *principalCache
	seedMu sync.Mutex
	seeded sync.Map // orgID -> true

	mailMu    sync.Mutex  // one immediate delivery run at a time
	mailAgain atomic.Bool // more mail was queued while a run was busy
	// mailNote explains a sender fallback (SMTP_FROM refused by the server).
	mailNote atomic.Value
	// mailGate paces sending and pauses it while the provider throttles.
	mailGate mailGate
	// mailWake is set while a delayed delivery run is scheduled.
	mailWake atomic.Bool
	// mailRun serializes delivery runs.
	mailRun sync.Mutex
}

// New builds the application and registers every route.
func New(db *gorm.DB, jwt *auth.JWTManager, cfg Config) *App {
	if cfg.MaxUploadBytes == 0 {
		cfg.MaxUploadBytes = 15 << 20
	}
	if cfg.RefreshTokenTTL == 0 {
		cfg.RefreshTokenTTL = 7 * 24 * time.Hour
	}
	a := &App{DB: db, JWT: jwt, Cfg: cfg, mux: http.NewServeMux(), cache: newPrincipalCache(20 * time.Second)}
	a.routes()
	notificationMailer = a.mailNotification
	return a
}

// Handler returns the root HTTP handler with recovery, metrics and logging.
func (a *App) Handler() http.Handler {
	return a.instrument(a.mux)
}

// ---------------------------------------------------------------------------
// Errors & responses
// ---------------------------------------------------------------------------

// APIError is returned by handlers to produce a structured error response.
type APIError struct {
	Status  int               `json:"code"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"errors,omitempty"`
}

func (e *APIError) Error() string { return e.Message }

func errBadRequest(msg string) *APIError {
	return &APIError{Status: http.StatusBadRequest, Message: msg}
}
func errNotFound(what string) *APIError {
	return &APIError{Status: http.StatusNotFound, Message: what + " not found"}
}
func errForbidden(msg string) *APIError {
	if msg == "" {
		msg = "you do not have permission to perform this action"
	}
	return &APIError{Status: http.StatusForbidden, Message: msg}
}
func errConflict(msg string) *APIError { return &APIError{Status: http.StatusConflict, Message: msg} }
func errValidation(fields map[string]string) *APIError {
	return &APIError{Status: http.StatusUnprocessableEntity, Message: "validation failed", Fields: fields}
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}

// ---------------------------------------------------------------------------
// Request context
// ---------------------------------------------------------------------------

// Ctx is passed to every handler.
type Ctx struct {
	W   http.ResponseWriter
	R   *http.Request
	P   *Principal
	App *App
	// myUnits caches the caller's unit and its ancestors for this request.
	myUnits map[string]bool
}

// Param returns a path parameter.
func (c *Ctx) Param(name string) string { return c.R.PathValue(name) }

// Query returns a trimmed query string value.
func (c *Ctx) Query(name string) string { return strings.TrimSpace(c.R.URL.Query().Get(name)) }

// QueryInt returns an integer query parameter or the fallback.
func (c *Ctx) QueryInt(name string, fallback int) int {
	if v, err := strconv.Atoi(c.Query(name)); err == nil {
		return v
	}
	return fallback
}

// Bind decodes a JSON request body.
func (c *Ctx) Bind(v interface{}) error {
	if c.R.Body == nil {
		return errBadRequest("request body is required")
	}
	dec := json.NewDecoder(http.MaxBytesReader(c.W, c.R.Body, 4<<20))
	if err := dec.Decode(v); err != nil {
		return errBadRequest("invalid JSON body: " + err.Error())
	}
	return nil
}

// JSON writes a JSON response.
func (c *Ctx) JSON(status int, v interface{}) error {
	writeJSON(c.W, status, v)
	return nil
}

// DB returns a database handle bound to the request context.
func (c *Ctx) DB() *gorm.DB { return c.App.DB.WithContext(c.R.Context()) }

// T returns a query on model scoped to the caller's organization.
func (c *Ctx) T(model interface{}) *gorm.DB {
	return c.DB().Model(model).Where("org_id = ?", c.P.OrgID)
}

// ClientIP returns the best-effort client address.
func (c *Ctx) ClientIP() string {
	if fwd := c.R.Header.Get("X-Forwarded-For"); fwd != "" {
		return strings.TrimSpace(strings.Split(fwd, ",")[0])
	}
	host, _, err := net.SplitHostPort(c.R.RemoteAddr)
	if err != nil {
		return c.R.RemoteAddr
	}
	return host
}

// Page holds pagination parameters.
type Page struct {
	Page    int
	PerPage int
}

// Paging reads ?page and ?per_page with sane bounds.
func (c *Ctx) Paging() Page {
	p := Page{Page: c.QueryInt("page", 1), PerPage: c.QueryInt("per_page", 30)}
	if p.Page < 1 {
		p.Page = 1
	}
	if p.PerPage < 1 {
		p.PerPage = 30
	}
	if p.PerPage > 100 {
		p.PerPage = 100
	}
	return p
}

// Offset returns the SQL offset for the page.
func (p Page) Offset() int { return (p.Page - 1) * p.PerPage }

// ListResponse is the envelope for paginated collections.
type ListResponse struct {
	Items   interface{} `json:"items"`
	Total   int64       `json:"total"`
	Page    int         `json:"page"`
	PerPage int         `json:"per_page"`
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

type handlerFunc func(c *Ctx) error

type routeOpts struct {
	public    bool
	agent     bool
	privilege string
}

type routeOpt func(*routeOpts)

// public marks a route that needs no authentication.
func public() routeOpt { return func(o *routeOpts) { o.public = true } }

// agentOnly restricts a route to agents.
func agentOnly() routeOpt { return func(o *routeOpts) { o.agent = true } }

// priv restricts a route to agents holding a privilege.
func priv(p string) routeOpt {
	return func(o *routeOpts) { o.agent = true; o.privilege = p }
}

// handle registers pattern ("METHOD /path") under /api/v2.
func (a *App) handle(pattern string, h handlerFunc, opts ...routeOpt) {
	var o routeOpts
	for _, fn := range opts {
		fn(&o)
	}
	method, path, _ := strings.Cut(pattern, " ")
	full := method + " /api/v2" + path
	a.mux.HandleFunc(full, func(w http.ResponseWriter, r *http.Request) {
		c := &Ctx{W: w, R: r, App: a}
		if !o.public {
			p, err := a.authenticate(r)
			if err != nil {
				a.writeError(w, err)
				return
			}
			c.P = p
			if o.agent && !p.IsAgent {
				a.writeError(w, errForbidden("this area is restricted to agents"))
				return
			}
			if o.privilege != "" && !p.Can(o.privilege) {
				a.writeError(w, errForbidden(""))
				return
			}
			if err := a.ensureOrgReady(r.Context(), p.OrgID); err != nil {
				a.writeError(w, err)
				return
			}
		}
		if err := h(c); err != nil {
			a.writeError(w, err)
		}
	})
}

func (a *App) writeError(w http.ResponseWriter, err error) {
	var apiErr *APIError
	switch {
	case errors.As(err, &apiErr):
		writeJSON(w, apiErr.Status, apiErr)
	case errors.Is(err, gorm.ErrRecordNotFound):
		writeJSON(w, http.StatusNotFound, &APIError{Status: http.StatusNotFound, Message: "record not found"})
	default:
		log.Printf("itsm: internal error: %v", err)
		writeJSON(w, http.StatusInternalServerError, &APIError{Status: http.StatusInternalServerError, Message: "internal server error"})
	}
}

var (
	httpRequests = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "itsm_http_requests_total", Help: "HTTP requests handled by the ITSM service.",
	}, []string{"method", "code"})
	httpDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name: "itsm_http_request_duration_seconds", Help: "Latency of ITSM HTTP requests.",
		Buckets: prometheus.DefBuckets,
	}, []string{"method"})
)

func init() {
	prometheus.MustRegister(httpRequests, httpDuration)
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

func (a *App) instrument(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/metrics" {
			promhttp.Handler().ServeHTTP(w, r)
			return
		}
		if r.URL.Path == "/health" || r.URL.Path == "/ready" {
			if r.URL.Path == "/ready" {
				if sqlDB, err := a.DB.DB(); err != nil || sqlDB.PingContext(r.Context()) != nil {
					writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
					return
				}
			}
			writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
			return
		}
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		defer func() {
			if v := recover(); v != nil {
				log.Printf("itsm: panic serving %s %s: %v\n%s", r.Method, r.URL.Path, v, debug.Stack())
				writeJSON(rec, http.StatusInternalServerError, &APIError{Status: 500, Message: "internal server error"})
			}
			httpRequests.WithLabelValues(r.Method, strconv.Itoa(rec.status)).Inc()
			httpDuration.WithLabelValues(r.Method).Observe(time.Since(start).Seconds())
		}()
		rec.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(rec, r)
	})
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

// Principal is the authenticated caller.
type Principal struct {
	UserID             string
	OrgID              string
	Email              string
	Name               string
	Username           string
	PlatformRole       string
	IsAgent            bool
	IsAccountAdmin     bool
	TicketScope        string
	Privileges         map[string]bool
	GroupIDs           []string
	DepartmentID       *string
	MustChangePassword bool
	PasswordChangedAt  *time.Time
	// TokensRevokedAt is set by "sign out of all other sessions".
	TokensRevokedAt *time.Time
	ViaAPIKey       bool
}

// Can reports whether the principal holds a privilege.
func (p *Principal) Can(privilege string) bool {
	return p.IsAccountAdmin || p.Privileges[privilege]
}

// InGroup reports group membership.
func (p *Principal) InGroup(id *string) bool {
	if id == nil {
		return false
	}
	for _, g := range p.GroupIDs {
		if g == *id {
			return true
		}
	}
	return false
}

type principalCache struct {
	mu  sync.Mutex
	ttl time.Duration
	m   map[string]cachedPrincipal
}

type cachedPrincipal struct {
	p   *Principal
	exp time.Time
}

func newPrincipalCache(ttl time.Duration) *principalCache {
	return &principalCache{ttl: ttl, m: map[string]cachedPrincipal{}}
}

func (pc *principalCache) get(id string) *Principal {
	pc.mu.Lock()
	defer pc.mu.Unlock()
	if e, ok := pc.m[id]; ok && time.Now().Before(e.exp) {
		cp := *e.p
		return &cp
	}
	return nil
}

func (pc *principalCache) put(p *Principal) {
	pc.mu.Lock()
	defer pc.mu.Unlock()
	if len(pc.m) > 10000 {
		pc.m = map[string]cachedPrincipal{}
	}
	pc.m[p.UserID] = cachedPrincipal{p: p, exp: time.Now().Add(pc.ttl)}
}

// Invalidate drops cached identity for users whose access changed.
func (a *App) Invalidate(userIDs ...string) {
	a.cache.mu.Lock()
	defer a.cache.mu.Unlock()
	for _, id := range userIDs {
		delete(a.cache.m, id)
	}
}

var errUnauthorized = &APIError{Status: http.StatusUnauthorized, Message: "authentication required"}

func hashToken(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func (a *App) authenticate(r *http.Request) (*Principal, error) {
	h := strings.TrimSpace(r.Header.Get("Authorization"))
	var userID string
	var issuedAt time.Time
	viaKey := false
	switch {
	case len(h) > 7 && strings.EqualFold(h[:7], "bearer "):
		claims, err := a.JWT.ValidateToken(strings.TrimSpace(h[7:]))
		// Refresh tokens carry no email and must never be used as access tokens.
		if err != nil || claims.UserID == "" || claims.Email == "" {
			return nil, &APIError{Status: http.StatusUnauthorized, Message: "invalid or expired token"}
		}
		userID = claims.UserID
		if claims.IssuedAt != nil {
			issuedAt = claims.IssuedAt.Time
		}
	case len(h) > 6 && strings.EqualFold(h[:6], "basic "):
		// Freshservice-style API key auth: base64("<api_key>:X")
		raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(h[6:]))
		if err != nil {
			return nil, errUnauthorized
		}
		key, _, _ := strings.Cut(string(raw), ":")
		var k APIKey
		if err := a.DB.Where("key_hash = ?", hashToken(key)).First(&k).Error; err != nil {
			return nil, &APIError{Status: http.StatusUnauthorized, Message: "invalid API key"}
		}
		now := time.Now()
		a.DB.Model(&APIKey{}).Where("id = ?", k.ID).Update("last_used_at", &now)
		userID = k.UserID
		viaKey = true
	default:
		return nil, errUnauthorized
	}
	p := a.cache.get(userID)
	if p == nil {
		loaded, err := a.loadPrincipal(r.Context(), userID)
		if err != nil {
			return nil, err
		}
		a.cache.put(loaded)
		cp := *loaded
		p = &cp
	}
	// Tokens minted before the last password change or "sign out everywhere"
	// are revoked. JWT iat has one-second precision, so compare by second.
	if !viaKey && !issuedAt.IsZero() && tokenRevoked(issuedAt, p.PasswordChangedAt, p.TokensRevokedAt) {
		return nil, &APIError{Status: http.StatusUnauthorized, Message: "session expired, please sign in again"}
	}
	p.ViaAPIKey = viaKey
	return p, nil
}

type userRow struct {
	ID                 string
	Email              string
	Username           string
	FullName           string
	Role               string
	OrgID              *string
	IsActive           bool
	MustChangePassword bool
	PasswordChangedAt  *time.Time
	TokensRevokedAt    *time.Time
}

// tokenRevoked reports whether a token issued at iat predates a revocation.
func tokenRevoked(iat time.Time, cutoffs ...*time.Time) bool {
	for _, c := range cutoffs {
		if c != nil && iat.Before(c.Truncate(time.Second)) {
			return true
		}
	}
	return false
}

func (a *App) loadPrincipal(ctx context.Context, userID string) (*Principal, error) {
	var u userRow
	err := a.DB.WithContext(ctx).Table("users").
		Select("id, email, username, full_name, role, org_id, is_active, COALESCE(must_change_password, false) AS must_change_password, password_changed_at, tokens_revoked_at").
		Where("id = ?", userID).Take(&u).Error
	if err != nil {
		return nil, &APIError{Status: http.StatusUnauthorized, Message: "account not found"}
	}
	if !u.IsActive {
		return nil, &APIError{Status: http.StatusUnauthorized, Message: "account deactivated"}
	}
	if u.OrgID == nil || *u.OrgID == "" {
		return nil, &APIError{Status: http.StatusForbidden, Message: "the service desk requires an organization account"}
	}
	if orgSuspended(a.DB.WithContext(ctx), *u.OrgID) {
		return nil, &APIError{Status: http.StatusForbidden, Message: "your organization has been suspended. Contact support."}
	}
	p := &Principal{
		UserID: u.ID, OrgID: *u.OrgID, Email: u.Email, Name: u.FullName, Username: u.Username,
		PlatformRole: u.Role, MustChangePassword: u.MustChangePassword, PasswordChangedAt: u.PasswordChangedAt, TokensRevokedAt: u.TokensRevokedAt, Privileges: map[string]bool{},
	}
	if p.Name == "" {
		p.Name = u.Username
	}
	person, err := a.ensurePerson(ctx, u.ID, *u.OrgID, u.Role)
	if err != nil {
		return nil, err
	}
	p.IsAccountAdmin = auth.IsOrgAdminRole(u.Role)
	p.IsAgent = person.IsAgent || p.IsAccountAdmin
	p.TicketScope = person.TicketScope
	if p.TicketScope == "" || p.IsAccountAdmin {
		p.TicketScope = "global"
	}
	p.DepartmentID = person.DepartmentID
	if p.IsAgent {
		var roleIDs []string
		_ = json.Unmarshal(person.RoleIDs, &roleIDs)
		if len(roleIDs) > 0 {
			var roles []Role
			a.DB.WithContext(ctx).Where("org_id = ? AND id IN ?", p.OrgID, roleIDs).Find(&roles)
			for _, r := range roles {
				var privs []string
				_ = json.Unmarshal(r.Privileges, &privs)
				for _, pv := range privs {
					p.Privileges[pv] = true
				}
			}
		}
		a.DB.WithContext(ctx).Model(&GroupMember{}).Where("org_id = ? AND user_id = ?", p.OrgID, p.UserID).Pluck("group_id", &p.GroupIDs)
	}
	return p, nil
}

// ensurePerson returns the helpdesk profile for a user, creating a default
// one on first access. Org admins and team leads start as agents.
func (a *App) ensurePerson(ctx context.Context, userID, orgID, platformRole string) (*Person, error) {
	var person Person
	err := a.DB.WithContext(ctx).Where("user_id = ?", userID).Take(&person).Error
	if err == nil {
		if person.OrgID != orgID {
			// User moved organizations; reset the profile.
			a.DB.WithContext(ctx).Where("user_id = ?", userID).Delete(&Person{})
		} else {
			return &person, nil
		}
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if err := a.ensureOrgReady(ctx, orgID); err != nil {
		return nil, err
	}
	person = a.defaultPerson(ctx, userID, orgID, platformRole)
	if err := a.DB.WithContext(ctx).Where("user_id = ?", userID).FirstOrCreate(&person).Error; err != nil {
		return nil, err
	}
	return &person, nil
}

func (a *App) defaultPerson(ctx context.Context, userID, orgID, platformRole string) Person {
	person := Person{UserID: userID, OrgID: orgID, TicketScope: "global", AgentType: "full_time", RoleIDs: jsonOf([]string{}), Available: true}
	roleName := ""
	switch {
	case auth.IsOrgAdminRole(platformRole):
		roleName = "Account Admin"
	case platformRole == "team_lead":
		roleName = "SD Supervisor"
	case platformRole == "agent":
		roleName = "SD Agent"
	}
	if roleName != "" {
		person.IsAgent = true
		var role Role
		if a.DB.WithContext(ctx).Where("org_id = ? AND name = ?", orgID, roleName).Take(&role).Error == nil {
			person.RoleIDs = jsonOf([]string{role.ID})
		}
	}
	return person
}

// ensureOrgReady seeds default configuration the first time an org is used.
func (a *App) ensureOrgReady(ctx context.Context, orgID string) error {
	if _, ok := a.seeded.Load(orgID); ok {
		return nil
	}
	a.seedMu.Lock()
	defer a.seedMu.Unlock()
	if _, ok := a.seeded.Load(orgID); ok {
		return nil
	}
	if err := a.seedOrg(ctx, orgID); err != nil {
		return fmt.Errorf("seed org %s: %w", orgID, err)
	}
	a.seeded.Store(orgID, true)
	return nil
}
