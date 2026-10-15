package app

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode"

	"github.com/chanduchitikam/task-management-system/pkg/auth"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ---------------------------------------------------------------------------
// User creation & password policy
// ---------------------------------------------------------------------------

const passwordAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"

func randomFrom(alphabet string, n int) string {
	out := make([]byte, n)
	for i := range out {
		v, _ := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		out[i] = alphabet[v.Int64()]
	}
	return string(out)
}

// tempPassword satisfies every supported policy: upper, lower, digit, special.
func tempPassword() string {
	return randomFrom("ABCDEFGHJKLMNPQRSTUVWXYZ", 2) + randomFrom("abcdefghijkmnopqrstuvwxyz", 4) +
		randomFrom("23456789", 3) + randomFrom("!@#$%*", 1) + randomFrom(passwordAlphabet, 4)
}

func validatePassword(s *Settings, pw string) error {
	min := 8
	if s != nil && s.PasswordMinLength > min {
		min = s.PasswordMinLength
	}
	if len(pw) < min {
		return fmt.Errorf("must be at least %d characters", min)
	}
	if len(pw) > 128 {
		return fmt.Errorf("must be at most 128 characters")
	}
	var upper, number, special bool
	for _, r := range pw {
		switch {
		case unicode.IsUpper(r):
			upper = true
		case unicode.IsDigit(r):
			number = true
		case !unicode.IsLetter(r) && !unicode.IsSpace(r):
			special = true
		}
	}
	if s != nil {
		if s.PasswordRequireUpper && !upper {
			return fmt.Errorf("must contain an uppercase letter")
		}
		if s.PasswordRequireNumber && !number {
			return fmt.Errorf("must contain a number")
		}
		if s.PasswordRequireSpecial && !special {
			return fmt.Errorf("must contain a special character")
		}
	}
	return nil
}

var usernameStrip = regexp.MustCompile(`[^a-z0-9._-]`)

func (a *App) uniqueUsername(db *gorm.DB, email string) string {
	local := strings.ToLower(strings.Split(email, "@")[0])
	base := usernameStrip.ReplaceAllString(local, "")
	if len(base) < 3 {
		base = "user" + base
	}
	if len(base) > 40 {
		base = base[:40]
	}
	candidate := base
	for i := 0; i < 20; i++ {
		var n int64
		db.Table("users").Where("username = ?", candidate).Count(&n)
		if n == 0 {
			return candidate
		}
		candidate = base + randomFrom("0123456789", 4)
	}
	return base + "-" + uuid.NewString()[:8]
}

// createUser inserts a platform user with a temporary password.
func (a *App) createUser(db *gorm.DB, orgID, email, name, platformRole string, isAgent bool) (string, string, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if !validEmail(email) {
		return "", "", fmt.Errorf("is invalid")
	}
	var n int64
	db.Table("users").Where("LOWER(email) = ?", email).Count(&n)
	if n > 0 {
		return "", "", fmt.Errorf("is already in use")
	}
	pw := tempPassword()
	hash, err := auth.HashPassword(pw)
	if err != nil {
		return "", "", err
	}
	id := uuid.NewString()
	name = strings.TrimSpace(name)
	if name == "" {
		name = strings.Split(email, "@")[0]
	}
	ts := now()
	err = db.Exec(`INSERT INTO users (id, email, username, password, full_name, role, org_id, must_change_password, has_logged_in,
		failed_login_attempts, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, true, false, 0, true, ?, ?)`,
		id, email, a.uniqueUsername(db, email), hash, name, platformRole, orgID, ts, ts).Error
	if err != nil {
		return "", "", err
	}
	person := Person{UserID: id, OrgID: orgID, IsAgent: isAgent, TicketScope: "global", AgentType: "full_time",
		RoleIDs: jsonOf([]string{}), Available: true}
	// Requesters land in the unit that claims their email domain.
	if !isAgent {
		if u := unitForEmail(db, orgID, email); u != nil {
			person.DepartmentID = &u.ID
			person.LocationID = u.LocationID
		}
	}
	if err := db.Create(&person).Error; err != nil {
		return "", "", err
	}
	return id, pw, nil
}

// ---------------------------------------------------------------------------
// People listing
// ---------------------------------------------------------------------------

// PersonDTO combines platform account data with the helpdesk profile.
type PersonDTO struct {
	ID                 string     `json:"id"`
	Email              string     `json:"email"`
	Username           string     `json:"username"`
	Name               string     `json:"name"`
	PlatformRole       string     `json:"platform_role"`
	IsAccountAdmin     bool       `json:"is_account_admin"`
	Active             bool       `json:"active"`
	Locked             bool       `json:"locked"`
	HasLoggedIn        bool       `json:"has_logged_in"`
	LastLogin          *time.Time `json:"last_login"`
	MustChangePassword bool       `json:"must_change_password"`
	CreatedAt          time.Time  `json:"created_at"`
	Person
	Department       *Ref       `json:"department"`
	Location         *Ref       `json:"location"`
	ReportingManager *UserBrief `json:"reporting_manager"`
	Roles            []Ref      `json:"roles"`
	Groups           []Ref      `json:"groups"`
	ObserverOf       []Ref      `json:"observer_of"`
	RoleIDList       []string   `json:"role_ids"`
	AvatarURL        string     `json:"avatar_url,omitempty"`
	OutOfOffice      bool       `json:"out_of_office"`
	OOODelegate      *UserBrief `json:"ooo_delegate"`
}

type personRow struct {
	ID                 string
	Email              string
	Username           string
	FullName           string
	Role               string
	IsActive           bool
	HasLoggedIn        bool
	LastLogin          *time.Time
	LockedUntil        *time.Time
	MustChangePassword bool
	CreatedAt          time.Time
}

func (c *Ctx) peopleQuery(agents bool) *gorm.DB {
	q := c.DB().Table("users u").
		Select(`u.id, u.email, u.username, u.full_name, u.role, u.is_active, u.has_logged_in, u.last_login, u.locked_until,
			u.must_change_password, u.created_at`).
		Joins("LEFT JOIN itsm_people p ON p.user_id = u.id").
		Where("u.org_id = ?", c.P.OrgID)
	if agents {
		q = q.Where("(p.is_agent OR u.role IN ('org_admin','admin'))")
	} else {
		q = q.Where("NOT (COALESCE(p.is_agent, false) OR u.role IN ('org_admin','admin'))")
	}
	return q
}

func (c *Ctx) peopleDTOs(rows []personRow) []PersonDTO {
	if len(rows) == 0 {
		return []PersonDTO{}
	}
	ids := make([]string, len(rows))
	for i, r := range rows {
		ids[i] = r.ID
	}
	var persons []Person
	c.DB().Where("user_id IN ?", ids).Find(&persons)
	pm := map[string]Person{}
	var deptIDs, locIDs, mgrIDs, roleIDs []string
	for _, p := range persons {
		pm[p.UserID] = p
		deptIDs = append(deptIDs, deref(p.DepartmentID))
		locIDs = append(locIDs, deref(p.LocationID))
		mgrIDs = append(mgrIDs, deref(p.ReportingManagerID), deref(p.OOODelegateID))
		roleIDs = append(roleIDs, stringsFrom(p.RoleIDs)...)
	}
	l := c.lookup(mgrIDs, nil, deptIDs)
	locs := map[string]*Ref{}
	if ids := uniq(locIDs); len(ids) > 0 {
		var ls []Location
		c.T(&Location{}).Where("id IN ?", ids).Find(&ls)
		for _, x := range ls {
			locs[x.ID] = &Ref{ID: x.ID, Name: x.Name}
		}
	}
	roles := map[string]Ref{}
	if ids := uniq(roleIDs); len(ids) > 0 {
		var rs []Role
		c.T(&Role{}).Where("id IN ?", ids).Find(&rs)
		for _, r := range rs {
			roles[r.ID] = Ref{ID: r.ID, Name: r.Name}
		}
	}
	groups := map[string][]Ref{}
	observes := map[string][]Ref{}
	var gm []struct {
		UserID string
		ID     string
		Name   string
		Role   string
	}
	c.DB().Table("itsm_group_members m").Select("m.user_id, g.id, g.name, m.role").
		Joins("JOIN itsm_agent_groups g ON g.id = m.group_id").Where("m.user_id IN ?", ids).Order("g.name").Scan(&gm)
	for _, x := range gm {
		if x.Role == "observer" {
			observes[x.UserID] = append(observes[x.UserID], Ref{ID: x.ID, Name: x.Name})
		} else {
			groups[x.UserID] = append(groups[x.UserID], Ref{ID: x.ID, Name: x.Name})
		}
	}
	avatars := map[string]time.Time{}
	var av []struct {
		UserID    string
		UpdatedAt time.Time
	}
	c.DB().Model(&Avatar{}).Select("user_id, updated_at").Where("user_id IN ?", ids).Scan(&av)
	for _, x := range av {
		avatars[x.UserID] = x.UpdatedAt
	}
	out := make([]PersonDTO, len(rows))
	for i, r := range rows {
		p := pm[r.ID]
		name := r.FullName
		if name == "" {
			name = r.Username
		}
		d := PersonDTO{ID: r.ID, Email: r.Email, Username: r.Username, Name: name, PlatformRole: r.Role,
			IsAccountAdmin: auth.IsOrgAdminRole(r.Role), Active: r.IsActive, HasLoggedIn: r.HasLoggedIn, LastLogin: r.LastLogin,
			Locked: r.LockedUntil != nil && r.LockedUntil.After(now()), MustChangePassword: r.MustChangePassword, CreatedAt: r.CreatedAt,
			Person: p, Department: l.dept(p.DepartmentID), ReportingManager: l.user(p.ReportingManagerID), Roles: []Ref{}, Groups: groups[r.ID],
			ObserverOf: observes[r.ID], RoleIDList: stringsFrom(p.RoleIDs), OutOfOffice: oooActive(&p, now())}
		if d.OutOfOffice {
			d.OOODelegate = l.user(p.OOODelegateID)
		}
		if t, ok := avatars[r.ID]; ok {
			d.AvatarURL = avatarURL(r.ID, t)
		}
		if d.Groups == nil {
			d.Groups = []Ref{}
		}
		if d.ObserverOf == nil {
			d.ObserverOf = []Ref{}
		}
		d.Person.UserID = r.ID
		if d.IsAccountAdmin {
			d.Person.IsAgent = true
		}
		if p.LocationID != nil {
			d.Location = locs[*p.LocationID]
		}
		for _, rid := range stringsFrom(p.RoleIDs) {
			if ref, ok := roles[rid]; ok {
				d.Roles = append(d.Roles, ref)
			}
		}
		if d.Groups == nil {
			d.Groups = []Ref{}
		}
		out[i] = d
	}
	return out
}

func (a *App) listPeople(agents bool) handlerFunc {
	return func(c *Ctx) error {
		if !agents && !c.P.Can(PrivUsersManage) && !c.P.Can(PrivTicketsManage) {
			return errForbidden("")
		}
		a.ensureAllPeople(c)
		pg := c.Paging()
		var unitIDs []string
		if v := c.Query("department_id"); isUUID(v) && c.Query("include_children") == "true" {
			unitIDs = c.loadUnitTree().descendants(v)
		}
		var team *Team
		if v := c.Query("team_id"); isUUID(v) {
			t, err := c.loadTeam(v)
			if err != nil {
				return err
			}
			team = t
		}
		build := func() *gorm.DB {
			q := c.peopleQuery(agents)
			switch c.Query("state") {
			case "deactivated":
				q = q.Where("NOT u.is_active")
			case "all":
			case "locked":
				q = q.Where("u.is_active AND u.locked_until > ?", now())
			case "invited":
				q = q.Where("u.is_active AND NOT u.has_logged_in")
			case "out_of_office":
				q = q.Where("u.is_active AND p.ooo_start <= ? AND p.ooo_end > ?", now(), now())
			case "vip":
				q = q.Where("u.is_active AND p.v_ip")
			default:
				q = q.Where("u.is_active")
			}
			if team != nil {
				q = q.Where("u.id IN (?)", c.teamMembersQuery(team).Select("u.id"))
			}
			if v := c.Query("q"); v != "" {
				like := likeEscape(strings.TrimSpace(v))
				q = q.Where(`(u.full_name ILIKE ? OR u.email ILIKE ? OR u.username ILIKE ? OR p.job_title ILIKE ? OR p.phone ILIKE ? OR p.mobile ILIKE ?
					OR p.department_id IN (SELECT id FROM itsm_departments WHERE org_id = ? AND name ILIKE ?))`,
					like, like, like, like, like, like, c.P.OrgID, like)
			}
			if len(unitIDs) > 0 {
				q = q.Where("p.department_id IN ?", unitIDs)
			} else if v := c.Query("department_id"); v == "none" {
				q = q.Where("p.department_id IS NULL")
			} else if isUUID(v) {
				q = q.Where("p.department_id = ?", v)
			}
			if v := c.Query("location_id"); isUUID(v) {
				q = q.Where("p.location_id = ?", v)
			}
			if v := c.Query("group_id"); isUUID(v) {
				q = q.Where("u.id IN (?)", c.DB().Model(&GroupMember{}).Select("user_id").Where("group_id = ?", v))
			}
			if v := c.Query("role_id"); isUUID(v) {
				q = q.Where("p.role_ids @> ?", string(jsonOf([]string{v})))
			}
			return q
		}
		var total int64
		if err := build().Count(&total).Error; err != nil {
			return err
		}
		var rows []personRow
		if err := build().Order("u.full_name ASC, u.email ASC").Offset(pg.Offset()).Limit(pg.PerPage).Scan(&rows).Error; err != nil {
			return err
		}
		return c.JSON(http.StatusOK, ListResponse{Items: c.peopleDTOs(rows), Total: total, Page: pg.Page, PerPage: pg.PerPage})
	}
}

// ensureAllPeople creates missing profiles so every org user is listed.
func (a *App) ensureAllPeople(c *Ctx) {
	var missing []struct {
		ID   string
		Role string
	}
	c.DB().Table("users u").Select("u.id, u.role").
		Where("u.org_id = ? AND NOT EXISTS (SELECT 1 FROM itsm_people p WHERE p.user_id = u.id)", c.P.OrgID).Scan(&missing)
	for _, m := range missing {
		p := a.defaultPerson(c.R.Context(), m.ID, c.P.OrgID, m.Role)
		c.DB().Where("user_id = ?", m.ID).FirstOrCreate(&p)
	}
}

func (c *Ctx) loadPersonRow(id string) (*personRow, error) {
	if !isUUID(id) {
		return nil, errNotFound("user")
	}
	var r personRow
	err := c.DB().Table("users u").
		Select(`u.id, u.email, u.username, u.full_name, u.role, u.is_active, u.has_logged_in, u.last_login, u.locked_until,
			u.must_change_password, u.created_at`).
		Where("u.id = ? AND u.org_id = ?", id, c.P.OrgID).Take(&r).Error
	if err != nil {
		return nil, errNotFound("user")
	}
	return &r, nil
}

func (a *App) getPerson(c *Ctx) error {
	if !c.P.IsAgent && c.Param("id") != c.P.UserID {
		return errForbidden("")
	}
	r, err := c.loadPersonRow(c.Param("id"))
	if err != nil {
		return err
	}
	a.ensureAllPeople(c)
	dto := c.peopleDTOs([]personRow{*r})[0]
	out := map[string]interface{}{"person": dto}
	if c.P.IsAgent {
		var tickets []Ticket
		c.visibleTickets(c.T(&Ticket{})).Where("requester_id = ? AND NOT is_deleted", r.ID).Order("created_at DESC").Limit(10).Find(&tickets)
		out["recent_tickets"] = c.ticketDTOs(tickets)
		var assets []Asset
		c.T(&Asset{}).Where("user_id = ? AND NOT is_deleted", r.ID).Order("name").Limit(50).Find(&assets)
		out["assets"] = assets
		var stats struct {
			Open     int64 `json:"open"`
			Resolved int64 `json:"resolved"`
			Assigned int64 `json:"assigned"`
		}
		c.T(&Ticket{}).Where("requester_id = ? AND status NOT IN ('resolved','closed') AND NOT is_deleted", r.ID).Count(&stats.Open)
		c.T(&Ticket{}).Where("requester_id = ? AND status IN ('resolved','closed') AND NOT is_deleted", r.ID).Count(&stats.Resolved)
		c.T(&Ticket{}).Where("responder_id = ? AND status NOT IN ('resolved','closed') AND NOT is_deleted", r.ID).Count(&stats.Assigned)
		out["stats"] = stats
	}
	out["org"] = c.orgContext(r.ID, dto.Person.DepartmentID)
	return c.JSON(http.StatusOK, out)
}

type personInput struct {
	Email              string    `json:"email"`
	Name               *string   `json:"name"`
	JobTitle           *string   `json:"job_title"`
	Phone              *string   `json:"phone"`
	Mobile             *string   `json:"mobile"`
	DepartmentID       *string   `json:"department_id"`
	LocationID         *string   `json:"location_id"`
	ReportingManagerID *string   `json:"reporting_manager_id"`
	TimeZone           *string   `json:"time_zone"`
	Language           *string   `json:"language"`
	Address            *string   `json:"address"`
	Background         *string   `json:"background"`
	VIP                *bool     `json:"vip"`
	ExternalID         *string   `json:"external_id"`
	Signature          *string   `json:"signature"`
	AgentType          *string   `json:"agent_type"`
	TicketScope        *string   `json:"ticket_scope"`
	RoleIDs            *[]string `json:"role_ids"`
	GroupIDs           *[]string `json:"group_ids"`
	IsAccountAdmin     *bool     `json:"is_account_admin"`
}

func (c *Ctx) applyPersonInput(p *Person, in *personInput, agent bool) map[string]string {
	errs := map[string]string{}
	set := func(dst *string, v *string) {
		if v != nil {
			*dst = strings.TrimSpace(*v)
		}
	}
	set(&p.JobTitle, in.JobTitle)
	set(&p.Phone, in.Phone)
	set(&p.Mobile, in.Mobile)
	set(&p.Language, in.Language)
	set(&p.Address, in.Address)
	set(&p.Background, in.Background)
	set(&p.ExternalID, in.ExternalID)
	if in.TimeZone != nil {
		if _, err := time.LoadLocation(*in.TimeZone); err != nil && *in.TimeZone != "" {
			errs["time_zone"] = "is not a valid IANA time zone"
		} else {
			p.TimeZone = *in.TimeZone
		}
	}
	if in.VIP != nil {
		p.VIP = *in.VIP
	}
	if in.DepartmentID != nil {
		p.DepartmentID = strPtr(*in.DepartmentID)
		c.optionalRef(errs, "department_id", p.DepartmentID, func(id string) bool { return c.existsInOrg(&Department{}, id) })
	}
	if in.LocationID != nil {
		p.LocationID = strPtr(*in.LocationID)
		c.optionalRef(errs, "location_id", p.LocationID, func(id string) bool { return c.existsInOrg(&Location{}, id) })
	}
	if in.ReportingManagerID != nil {
		p.ReportingManagerID = strPtr(*in.ReportingManagerID)
		if p.ReportingManagerID != nil && *p.ReportingManagerID == p.UserID {
			errs["reporting_manager_id"] = "cannot be the same person"
		}
		c.optionalRef(errs, "reporting_manager_id", p.ReportingManagerID, c.userInOrg)
	}
	if agent {
		set(&p.Signature, in.Signature)
		if in.AgentType != nil {
			if !oneOf(*in.AgentType, "full_time", "occasional") {
				errs["agent_type"] = "must be full_time or occasional"
			} else {
				p.AgentType = *in.AgentType
			}
		}
		if in.TicketScope != nil {
			if !oneOf(*in.TicketScope, "global", "group", "restricted") {
				errs["ticket_scope"] = "must be global, group or restricted"
			} else {
				p.TicketScope = *in.TicketScope
			}
		}
		if in.RoleIDs != nil {
			ids := uniq(*in.RoleIDs)
			var n int64
			if len(ids) > 0 {
				c.T(&Role{}).Where("id IN ?", ids).Count(&n)
			}
			if int(n) != len(ids) {
				errs["role_ids"] = "contains an unknown role"
			}
			p.RoleIDs = jsonOf(ids)
		}
	}
	return errs
}

func (c *Ctx) setGroups(tx *gorm.DB, userID string, groupIDs []string) error {
	ids := uniq(groupIDs)
	if len(ids) > 0 {
		var n int64
		c.T(&AgentGroup{}).Where("id IN ?", ids).Count(&n)
		if int(n) != len(ids) {
			return errValidation(map[string]string{"group_ids": "contains an unknown group"})
		}
	}
	// Only full memberships are managed here; observer roles stay as they are
	// unless the person is now made a member of that group.
	if err := tx.Where("org_id = ? AND user_id = ? AND role = 'member'", c.P.OrgID, userID).Delete(&GroupMember{}).Error; err != nil {
		return err
	}
	for _, g := range ids {
		tx.Where("group_id = ? AND user_id = ?", g, userID).Delete(&GroupMember{})
		if err := tx.Create(&GroupMember{GroupID: g, UserID: userID, OrgID: c.P.OrgID, Role: "member"}).Error; err != nil {
			return err
		}
	}
	return nil
}

func (a *App) createPerson(agent bool) handlerFunc {
	return func(c *Ctx) error {
		var in personInput
		if err := c.Bind(&in); err != nil {
			return err
		}
		email := strings.ToLower(strings.TrimSpace(in.Email))
		errs := map[string]string{}
		if !validEmail(email) {
			errs["email"] = "is invalid"
		}
		name := ""
		if in.Name != nil {
			name = strings.TrimSpace(*in.Name)
		}
		if name == "" {
			errs["name"] = "is required"
		}
		if len(errs) > 0 {
			return errValidation(errs)
		}
		if agent && in.IsAccountAdmin != nil && *in.IsAccountAdmin && !c.P.IsAccountAdmin {
			return errForbidden("only account admins can create account admins")
		}
		var userID, temp string
		err := c.DB().Transaction(func(tx *gorm.DB) error {
			platformRole := "member"
			if agent {
				platformRole = "agent"
				if in.IsAccountAdmin != nil && *in.IsAccountAdmin {
					platformRole = "org_admin"
				}
			}
			id, pw, err := a.createUser(tx, c.P.OrgID, email, name, platformRole, agent)
			if err != nil {
				return errValidation(map[string]string{"email": err.Error()})
			}
			userID, temp = id, pw
			var p Person
			if err := tx.Where("user_id = ?", id).Take(&p).Error; err != nil {
				return err
			}
			if agent && in.RoleIDs == nil {
				var role Role
				if c.T(&Role{}).Where("name = 'SD Agent'").Take(&role).Error == nil {
					p.RoleIDs = jsonOf([]string{role.ID})
				}
			}
			if errs := c.applyPersonInput(&p, &in, agent); len(errs) > 0 {
				return errValidation(errs)
			}
			if err := tx.Save(&p).Error; err != nil {
				return err
			}
			if agent && in.GroupIDs != nil {
				return c.setGroups(tx, id, *in.GroupIDs)
			}
			return nil
		})
		if err != nil {
			return err
		}
		kind := "requester"
		if agent {
			kind = "agent"
		}
		c.audit(kind+".created", kind, userID, "Created "+kind+" "+email, nil)
		a.queueWelcome(c, userID, email, name, temp)
		r, _ := c.loadPersonRow(userID)
		resp := map[string]interface{}{"person": c.peopleDTOs([]personRow{*r})[0]}
		if a.Cfg.SMTPHost == "" {
			// Without email delivery the admin must hand over the temporary password.
			resp["temporary_password"] = temp
		}
		return c.JSON(http.StatusCreated, resp)
	}
}

func (a *App) queueWelcome(c *Ctx, userID, email, name, temp string) {
	s := c.settings()
	body := fmt.Sprintf("Hi %s,\n\nAn account has been created for you on %s.\n\nSign in at %s/login with:\nEmail: %s\nTemporary password: %s\n\nYou will be asked to choose a new password after signing in.",
		name, s.HelpdeskName, strings.TrimRight(a.Cfg.PublicURL, "/"), email, temp)
	c.DB().Create(&EmailOutbox{Base: Base{OrgID: c.P.OrgID}, ToAddr: email, Subject: "Your " + s.HelpdeskName + " account",
		Body: body, Status: "queued", EntityType: "user", EntityID: userID})
	a.kickMail()
}

func (a *App) updatePerson(agent bool) handlerFunc {
	return func(c *Ctx) error {
		r, err := c.loadPersonRow(c.Param("id"))
		if err != nil {
			return err
		}
		var in personInput
		if err := c.Bind(&in); err != nil {
			return err
		}
		p, err := a.ensurePerson(c.R.Context(), r.ID, c.P.OrgID, r.Role)
		if err != nil {
			return err
		}
		isAgent := p.IsAgent || auth.IsOrgAdminRole(r.Role)
		if agent != isAgent {
			return errNotFound(map[bool]string{true: "agent", false: "requester"}[agent])
		}
		errs := c.applyPersonInput(p, &in, agent)
		if in.Name != nil && strings.TrimSpace(*in.Name) == "" {
			errs["name"] = "is required"
		}
		newEmail := strings.ToLower(strings.TrimSpace(in.Email))
		if newEmail != "" && newEmail != r.Email {
			if !validEmail(newEmail) {
				errs["email"] = "is invalid"
			} else {
				var n int64
				c.DB().Table("users").Where("LOWER(email) = ? AND id <> ?", newEmail, r.ID).Count(&n)
				if n > 0 {
					errs["email"] = "is already in use"
				}
			}
		}
		if len(errs) > 0 {
			return errValidation(errs)
		}
		var newRole string
		if agent && in.IsAccountAdmin != nil && *in.IsAccountAdmin != auth.IsOrgAdminRole(r.Role) {
			if !c.P.IsAccountAdmin {
				return errForbidden("only account admins can change account admin access")
			}
			if !*in.IsAccountAdmin {
				if r.ID == c.P.UserID {
					return errBadRequest("you cannot remove your own account admin access")
				}
				newRole = "agent"
			} else {
				newRole = "org_admin"
			}
		}
		err = c.DB().Transaction(func(tx *gorm.DB) error {
			if err := tx.Save(p).Error; err != nil {
				return err
			}
			userUpdates := map[string]interface{}{"updated_at": now()}
			if in.Name != nil {
				userUpdates["full_name"] = strings.TrimSpace(*in.Name)
			}
			if newEmail != "" && newEmail != r.Email {
				userUpdates["email"] = newEmail
			}
			if newRole != "" {
				userUpdates["role"] = newRole
			}
			if err := tx.Table("users").Where("id = ?", r.ID).Updates(userUpdates).Error; err != nil {
				return err
			}
			if agent && in.GroupIDs != nil {
				return c.setGroups(tx, r.ID, *in.GroupIDs)
			}
			return nil
		})
		if err != nil {
			return err
		}
		a.Invalidate(r.ID)
		c.audit("person.updated", "user", r.ID, "Updated profile of "+r.Email, nil)
		r, _ = c.loadPersonRow(r.ID)
		return c.JSON(http.StatusOK, c.peopleDTOs([]personRow{*r})[0])
	}
}

// convertPerson switches a user between requester and agent.
func (a *App) convertPerson(toAgent bool) handlerFunc {
	return func(c *Ctx) error {
		r, err := c.loadPersonRow(c.Param("id"))
		if err != nil {
			return err
		}
		if auth.IsOrgAdminRole(r.Role) && !toAgent {
			return errBadRequest("remove account admin access before converting to a requester")
		}
		var in struct {
			RoleIDs  []string `json:"role_ids"`
			GroupIDs []string `json:"group_ids"`
		}
		_ = json.NewDecoder(c.R.Body).Decode(&in)
		p, err := a.ensurePerson(c.R.Context(), r.ID, c.P.OrgID, r.Role)
		if err != nil {
			return err
		}
		err = c.DB().Transaction(func(tx *gorm.DB) error {
			p.IsAgent = toAgent
			role := "member"
			if toAgent {
				role = "agent"
				ids := uniq(in.RoleIDs)
				if len(ids) == 0 {
					var def Role
					if c.T(&Role{}).Where("name = 'SD Agent'").Take(&def).Error == nil {
						ids = []string{def.ID}
					}
				}
				p.RoleIDs = jsonOf(ids)
				if r.Role == "team_lead" {
					role = r.Role
				}
			} else {
				p.RoleIDs = jsonOf([]string{})
				tx.Where("org_id = ? AND user_id = ?", c.P.OrgID, r.ID).Delete(&GroupMember{})
				// Release tickets owned by the former agent.
				tx.Model(&Ticket{}).Where("org_id = ? AND responder_id = ? AND status NOT IN ('resolved','closed')", c.P.OrgID, r.ID).Update("responder_id", nil)
			}
			if err := tx.Save(p).Error; err != nil {
				return err
			}
			if toAgent && len(in.GroupIDs) > 0 {
				if err := c.setGroups(tx, r.ID, in.GroupIDs); err != nil {
					return err
				}
			}
			return tx.Table("users").Where("id = ?", r.ID).Update("role", role).Error
		})
		if err != nil {
			return err
		}
		a.Invalidate(r.ID)
		verb := "requester"
		if toAgent {
			verb = "agent"
		}
		c.audit("person.converted", "user", r.ID, "Converted "+r.Email+" to "+verb, nil)
		r, _ = c.loadPersonRow(r.ID)
		return c.JSON(http.StatusOK, c.peopleDTOs([]personRow{*r})[0])
	}
}

func (a *App) setActive(active bool) handlerFunc {
	return func(c *Ctx) error {
		r, err := c.loadPersonRow(c.Param("id"))
		if err != nil {
			return err
		}
		if r.ID == c.P.UserID {
			return errBadRequest("you cannot change your own activation state")
		}
		if auth.IsOrgAdminRole(r.Role) && !c.P.IsAccountAdmin {
			return errForbidden("only account admins can deactivate account admins")
		}
		err = c.DB().Transaction(func(tx *gorm.DB) error {
			if err := tx.Table("users").Where("id = ?", r.ID).Updates(map[string]interface{}{"is_active": active, "updated_at": now()}).Error; err != nil {
				return err
			}
			if !active {
				tx.Model(&Ticket{}).Where("org_id = ? AND responder_id = ? AND status NOT IN ('resolved','closed')", c.P.OrgID, r.ID).Update("responder_id", nil)
				tx.Where("user_id = ?", r.ID).Delete(&APIKey{})
				tx.Model(&RefreshSession{}).Where("user_id = ? AND revoked_at IS NULL", r.ID).Update("revoked_at", now())
			}
			return nil
		})
		if err != nil {
			return err
		}
		a.Invalidate(r.ID)
		action := "reactivated"
		if !active {
			action = "deactivated"
		}
		c.audit("person."+action, "user", r.ID, titleCase(action)+" "+r.Email, nil)
		return c.JSON(http.StatusOK, map[string]interface{}{"id": r.ID, "active": active})
	}
}

func (a *App) adminResetPassword(c *Ctx) error {
	r, err := c.loadPersonRow(c.Param("id"))
	if err != nil {
		return err
	}
	if auth.IsOrgAdminRole(r.Role) && !c.P.IsAccountAdmin {
		return errForbidden("only account admins can reset an account admin's password")
	}
	pw := tempPassword()
	hash, err := auth.HashPassword(pw)
	if err != nil {
		return err
	}
	err = c.DB().Table("users").Where("id = ?", r.ID).Updates(map[string]interface{}{
		"password": hash, "must_change_password": true, "failed_login_attempts": 0, "locked_until": nil,
		"password_changed_at": now(), "updated_at": now(),
	}).Error
	if err != nil {
		return err
	}
	c.DB().Model(&RefreshSession{}).Where("user_id = ? AND revoked_at IS NULL", r.ID).Update("revoked_at", now())
	a.Invalidate(r.ID)
	c.audit("person.password_reset", "user", r.ID, "Reset password for "+r.Email, nil)
	a.queueWelcome(c, r.ID, r.Email, r.FullName, pw)
	resp := map[string]interface{}{"message": "password reset; the user must choose a new password at next sign in"}
	if a.Cfg.SMTPHost == "" {
		resp["temporary_password"] = pw
	}
	return c.JSON(http.StatusOK, resp)
}

func (a *App) unlockPerson(c *Ctx) error {
	r, err := c.loadPersonRow(c.Param("id"))
	if err != nil {
		return err
	}
	c.DB().Table("users").Where("id = ?", r.ID).Updates(map[string]interface{}{"failed_login_attempts": 0, "locked_until": nil})
	c.audit("person.unlocked", "user", r.ID, "Unlocked "+r.Email, nil)
	return c.JSON(http.StatusOK, map[string]string{"message": "account unlocked"})
}

// forgetPerson anonymizes a requester (right to be forgotten).
func (a *App) forgetPerson(c *Ctx) error {
	r, err := c.loadPersonRow(c.Param("id"))
	if err != nil {
		return err
	}
	if auth.IsOrgAdminRole(r.Role) || r.ID == c.P.UserID {
		return errBadRequest("account admins and yourself cannot be forgotten")
	}
	anon := "deleted-" + r.ID[:8] + "@invalid.local"
	err = c.DB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Table("users").Where("id = ?", r.ID).Updates(map[string]interface{}{
			"email": anon, "full_name": "Deleted user", "username": "deleted-" + r.ID[:8], "is_active": false,
			"security_questions": "", "updated_at": now(),
		}).Error; err != nil {
			return err
		}
		tx.Model(&Person{}).Where("user_id = ?", r.ID).Updates(map[string]interface{}{
			"phone": "", "mobile": "", "address": "", "background": "", "job_title": "", "external_id": "", "signature": "",
		})
		tx.Where("user_id = ?", r.ID).Delete(&APIKey{})
		tx.Where("org_id = ? AND user_id = ?", c.P.OrgID, r.ID).Delete(&GroupMember{})
		return nil
	})
	if err != nil {
		return err
	}
	a.Invalidate(r.ID)
	c.audit("person.forgotten", "user", r.ID, "Anonymized user "+r.ID, nil)
	return c.JSON(http.StatusOK, map[string]string{"message": "user data anonymized"})
}

// ---------------------------------------------------------------------------
// Groups, departments, locations, roles
// ---------------------------------------------------------------------------

// GroupDTO adds members to an agent group.
type GroupDTO struct {
	*AgentGroup
	Members     []*UserBrief `json:"members"`
	Observers   []*UserBrief `json:"observers"`
	MemberIDs   []string     `json:"member_ids"`
	ObserverIDs []string     `json:"observer_ids"`
	Leader      *UserBrief   `json:"leader"`
	EscalateTo  *UserBrief   `json:"escalate_to"`
	OpenTickets int64        `json:"open_tickets"`
}

func (a *App) listGroups(c *Ctx) error {
	var groups []AgentGroup
	c.T(&AgentGroup{}).Order("name").Find(&groups)
	var gm []GroupMember
	c.T(&GroupMember{}).Find(&gm)
	byGroup := map[string][]string{}
	observers := map[string][]string{}
	uids := []string{}
	for _, m := range gm {
		if m.Role == "observer" {
			observers[m.GroupID] = append(observers[m.GroupID], m.UserID)
		} else {
			byGroup[m.GroupID] = append(byGroup[m.GroupID], m.UserID)
		}
		uids = append(uids, m.UserID)
	}
	for _, g := range groups {
		uids = append(uids, deref(g.EscalateToID), deref(g.LeaderID))
	}
	open := map[string]int64{}
	var counts []struct {
		GroupID string
		N       int64
	}
	c.T(&Ticket{}).Select("group_id, count(*) AS n").Where("group_id IS NOT NULL AND NOT is_deleted AND NOT is_spam AND status NOT IN ('resolved','closed')").
		Group("group_id").Scan(&counts)
	for _, x := range counts {
		open[x.GroupID] = x.N
	}
	l := c.lookup(uids, nil, nil)
	briefs := func(ids []string) []*UserBrief {
		out := []*UserBrief{}
		for _, id := range ids {
			if u := l.userS(id); u != nil {
				out = append(out, u)
			}
		}
		return out
	}
	out := make([]GroupDTO, len(groups))
	for i := range groups {
		g := &groups[i]
		mids, oids := byGroup[g.ID], observers[g.ID]
		if mids == nil {
			mids = []string{}
		}
		if oids == nil {
			oids = []string{}
		}
		out[i] = GroupDTO{AgentGroup: g, Members: briefs(mids), Observers: briefs(oids), MemberIDs: mids, ObserverIDs: oids,
			Leader: l.user(g.LeaderID), EscalateTo: l.user(g.EscalateToID), OpenTickets: open[g.ID]}
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"items": out})
}

type groupInput struct {
	Name                 *string   `json:"name"`
	Description          *string   `json:"description"`
	EscalateToID         *string   `json:"escalate_to_id"`
	UnassignedForMinutes *int      `json:"unassigned_for_minutes"`
	BusinessHoursID      *string   `json:"business_hours_id"`
	AutoAssign           *bool     `json:"auto_assign"`
	Restricted           *bool     `json:"restricted"`
	MemberIDs            *[]string `json:"member_ids"`
	ObserverIDs          *[]string `json:"observer_ids"`
	LeaderID             *string   `json:"leader_id"`
	Email                *string   `json:"email"`
}

func (a *App) saveGroup(c *Ctx, g *AgentGroup, in *groupInput, create bool) error {
	errs := map[string]string{}
	if in.Name != nil {
		g.Name = strings.TrimSpace(*in.Name)
	}
	if g.Name == "" {
		errs["name"] = "is required"
	} else {
		excl := g.ID
		if excl == "" {
			excl = "00000000-0000-0000-0000-000000000000"
		}
		var n int64
		c.T(&AgentGroup{}).Where("LOWER(name) = LOWER(?) AND id <> ?", g.Name, excl).Count(&n)
		if n > 0 {
			errs["name"] = "is already taken"
		}
	}
	if in.Description != nil {
		g.Description = *in.Description
	}
	if in.EscalateToID != nil {
		g.EscalateToID = strPtr(*in.EscalateToID)
		c.optionalRef(errs, "escalate_to_id", g.EscalateToID, c.agentInOrg)
	}
	if in.UnassignedForMinutes != nil {
		g.UnassignedForMinutes = clampInt(*in.UnassignedForMinutes, 0, 10080, 0)
	}
	if in.BusinessHoursID != nil {
		g.BusinessHoursID = strPtr(*in.BusinessHoursID)
		c.optionalRef(errs, "business_hours_id", g.BusinessHoursID, func(id string) bool { return c.existsInOrg(&BusinessHours{}, id) })
	}
	if in.AutoAssign != nil {
		g.AutoAssign = *in.AutoAssign
	}
	if in.Restricted != nil {
		g.Restricted = *in.Restricted
	}
	if in.MemberIDs != nil {
		for _, id := range *in.MemberIDs {
			if !c.agentInOrg(id) {
				errs["member_ids"] = "must contain active agents"
			}
		}
	}
	if in.ObserverIDs != nil {
		for _, id := range *in.ObserverIDs {
			if !c.agentInOrg(id) {
				errs["observer_ids"] = "must contain active agents"
			}
		}
	}
	if in.MemberIDs != nil && in.ObserverIDs != nil {
		for _, id := range *in.ObserverIDs {
			if containsString(*in.MemberIDs, id) {
				errs["observer_ids"] = "an agent cannot be both a member and an observer"
			}
		}
	}
	if in.LeaderID != nil {
		g.LeaderID = strPtr(*in.LeaderID)
		c.optionalRef(errs, "leader_id", g.LeaderID, c.agentInOrg)
	}
	if in.Email != nil {
		g.Email = strings.ToLower(strings.TrimSpace(*in.Email))
		if g.Email != "" && !validEmail(g.Email) {
			errs["email"] = "is invalid"
		}
	}
	if len(errs) > 0 {
		return errValidation(errs)
	}
	return c.DB().Transaction(func(tx *gorm.DB) error {
		var err error
		if create {
			err = tx.Create(g).Error
		} else {
			err = tx.Save(g).Error
		}
		if err != nil {
			return err
		}
		// Replace each membership role only when the request includes it.
		for role, ids := range map[string]*[]string{"member": in.MemberIDs, "observer": in.ObserverIDs} {
			if ids == nil {
				continue
			}
			var old []string
			tx.Model(&GroupMember{}).Where("group_id = ? AND role = ?", g.ID, role).Pluck("user_id", &old)
			a.Invalidate(old...)
			tx.Where("group_id = ? AND role = ?", g.ID, role).Delete(&GroupMember{})
			for _, id := range uniq(*ids) {
				tx.Where("group_id = ? AND user_id = ?", g.ID, id).Delete(&GroupMember{})
				if err := tx.Create(&GroupMember{GroupID: g.ID, UserID: id, OrgID: c.P.OrgID, Role: role}).Error; err != nil {
					return err
				}
				a.Invalidate(id)
			}
		}
		return nil
	})
}

func (a *App) createGroup(c *Ctx) error {
	var in groupInput
	if err := c.Bind(&in); err != nil {
		return err
	}
	g := AgentGroup{Base: Base{OrgID: c.P.OrgID}}
	if err := a.saveGroup(c, &g, &in, true); err != nil {
		return err
	}
	c.audit("group.created", "group", g.ID, "Created group "+g.Name, nil)
	return c.JSON(http.StatusCreated, g)
}

func (a *App) updateGroup(c *Ctx) error {
	var g AgentGroup
	if err := c.T(&AgentGroup{}).Where("id = ?", c.Param("id")).Take(&g).Error; err != nil {
		return errNotFound("group")
	}
	var in groupInput
	if err := c.Bind(&in); err != nil {
		return err
	}
	var before []string
	c.DB().Model(&GroupMember{}).Where("group_id = ?", g.ID).Pluck("user_id", &before)
	if err := a.saveGroup(c, &g, &in, false); err != nil {
		return err
	}
	a.Invalidate(before...)
	c.audit("group.updated", "group", g.ID, "Updated group "+g.Name, nil)
	return c.JSON(http.StatusOK, g)
}

func (a *App) deleteGroup(c *Ctx) error {
	var g AgentGroup
	if err := c.T(&AgentGroup{}).Where("id = ?", c.Param("id")).Take(&g).Error; err != nil {
		return errNotFound("group")
	}
	var members []string
	c.DB().Model(&GroupMember{}).Where("group_id = ?", g.ID).Pluck("user_id", &members)
	err := c.DB().Transaction(func(tx *gorm.DB) error {
		tx.Where("group_id = ?", g.ID).Delete(&GroupMember{})
		for _, m := range []interface{}{&Ticket{}, &Problem{}, &Change{}, &Release{}, &WorkTask{}, &Asset{}} {
			tx.Model(m).Where("org_id = ? AND group_id = ?", c.P.OrgID, g.ID).Update("group_id", nil)
		}
		tx.Model(&CatalogItem{}).Where("org_id = ? AND delivery_group_id = ?", c.P.OrgID, g.ID).Update("delivery_group_id", nil)
		return tx.Delete(&g).Error
	})
	if err != nil {
		return err
	}
	a.Invalidate(members...)
	c.audit("group.deleted", "group", g.ID, "Deleted group "+g.Name, nil)
	return c.JSON(http.StatusOK, map[string]string{"message": "deleted"})
}

func (a *App) listLocations(c *Ctx) error {
	var locs []Location
	c.T(&Location{}).Order("name").Find(&locs)
	return c.JSON(http.StatusOK, map[string]interface{}{"items": locs})
}

func (a *App) saveLocation(create bool) handlerFunc {
	return func(c *Ctx) error {
		l := Location{Base: Base{OrgID: c.P.OrgID}}
		if !create {
			if err := c.T(&Location{}).Where("id = ?", c.Param("id")).Take(&l).Error; err != nil {
				return errNotFound("location")
			}
		}
		before := l
		if err := c.Bind(&l); err != nil {
			return err
		}
		l.Base = before.Base
		l.Name = strings.TrimSpace(l.Name)
		errs := map[string]string{}
		if l.Name == "" {
			errs["name"] = "is required"
		}
		if l.ParentID != nil && *l.ParentID != "" {
			if *l.ParentID == l.ID || !c.existsInOrg(&Location{}, *l.ParentID) {
				errs["parent_id"] = "is invalid"
			}
		} else {
			l.ParentID = nil
		}
		if l.Email != "" && !validEmail(l.Email) {
			errs["email"] = "is invalid"
		}
		if len(errs) > 0 {
			return errValidation(errs)
		}
		var err error
		if create {
			err = c.DB().Create(&l).Error
		} else {
			err = c.DB().Save(&l).Error
		}
		if err != nil {
			return err
		}
		return c.JSON(map[bool]int{true: http.StatusCreated, false: http.StatusOK}[create], l)
	}
}

func (a *App) deleteLocation(c *Ctx) error {
	var l Location
	if err := c.T(&Location{}).Where("id = ?", c.Param("id")).Take(&l).Error; err != nil {
		return errNotFound("location")
	}
	err := c.DB().Transaction(func(tx *gorm.DB) error {
		tx.Model(&Person{}).Where("org_id = ? AND location_id = ?", c.P.OrgID, l.ID).Update("location_id", nil)
		tx.Model(&Asset{}).Where("org_id = ? AND location_id = ?", c.P.OrgID, l.ID).Update("location_id", nil)
		tx.Model(&Location{}).Where("org_id = ? AND parent_id = ?", c.P.OrgID, l.ID).Update("parent_id", nil)
		return tx.Delete(&l).Error
	})
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "deleted"})
}

func (a *App) listRoles(c *Ctx) error {
	var roles []Role
	c.T(&Role{}).Order("is_default DESC, name").Find(&roles)
	out := []map[string]interface{}{}
	for _, r := range roles {
		var n int64
		c.DB().Model(&Person{}).Where("org_id = ? AND role_ids @> ?", c.P.OrgID, string(jsonOf([]string{r.ID}))).Count(&n)
		out = append(out, map[string]interface{}{"id": r.ID, "name": r.Name, "description": r.Description, "privileges": stringsFrom(r.Privileges),
			"is_default": r.IsDefault, "agent_count": n, "created_at": r.CreatedAt, "updated_at": r.UpdatedAt})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"items": out, "privileges": AllPrivileges})
}

func (a *App) saveRole(create bool) handlerFunc {
	return func(c *Ctx) error {
		r := Role{Base: Base{OrgID: c.P.OrgID}}
		if !create {
			if err := c.T(&Role{}).Where("id = ?", c.Param("id")).Take(&r).Error; err != nil {
				return errNotFound("role")
			}
			if r.Name == "Account Admin" {
				return errBadRequest("the Account Admin role cannot be modified")
			}
		}
		var in struct {
			Name        *string   `json:"name"`
			Description *string   `json:"description"`
			Privileges  *[]string `json:"privileges"`
		}
		if err := c.Bind(&in); err != nil {
			return err
		}
		errs := map[string]string{}
		if in.Name != nil {
			r.Name = strings.TrimSpace(*in.Name)
		}
		if r.Name == "" {
			errs["name"] = "is required"
		}
		if in.Description != nil {
			r.Description = *in.Description
		}
		if in.Privileges != nil {
			valid := map[string]bool{}
			for _, k := range allPrivilegeKeys() {
				valid[k] = true
			}
			privs := []string{}
			for _, p := range *in.Privileges {
				if !valid[p] {
					errs["privileges"] = "contains an unknown privilege: " + p
				}
				privs = append(privs, p)
			}
			r.Privileges = jsonOf(privs)
		} else if create {
			r.Privileges = jsonOf([]string{})
		}
		if len(errs) > 0 {
			return errValidation(errs)
		}
		var err error
		if create {
			err = c.DB().Create(&r).Error
		} else {
			err = c.DB().Save(&r).Error
		}
		if err != nil {
			return err
		}
		a.cache.mu.Lock()
		a.cache.m = map[string]cachedPrincipal{}
		a.cache.mu.Unlock()
		c.audit("role.saved", "role", r.ID, "Saved role "+r.Name, map[string]interface{}{"privileges": stringsFrom(r.Privileges)})
		return c.JSON(map[bool]int{true: http.StatusCreated, false: http.StatusOK}[create], r)
	}
}

func (a *App) deleteRole(c *Ctx) error {
	var r Role
	if err := c.T(&Role{}).Where("id = ?", c.Param("id")).Take(&r).Error; err != nil {
		return errNotFound("role")
	}
	if r.IsDefault {
		return errBadRequest("default roles cannot be deleted")
	}
	var n int64
	c.DB().Model(&Person{}).Where("org_id = ? AND role_ids @> ?", c.P.OrgID, string(jsonOf([]string{r.ID}))).Count(&n)
	if n > 0 {
		return errConflict(fmt.Sprintf("this role is assigned to %d agent(s)", n))
	}
	if err := c.DB().Delete(&r).Error; err != nil {
		return err
	}
	c.audit("role.deleted", "role", r.ID, "Deleted role "+r.Name, nil)
	return c.JSON(http.StatusOK, map[string]string{"message": "deleted"})
}

// ---------------------------------------------------------------------------
// Self service: /me
// ---------------------------------------------------------------------------

func (a *App) getMe(c *Ctx) error {
	r, err := c.loadPersonRow(c.P.UserID)
	if err != nil {
		return err
	}
	dto := c.peopleDTOs([]personRow{*r})[0]
	s := c.settings()
	var org struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	c.DB().Table("organizations").Select("id, name").Where("id = ?", c.P.OrgID).Scan(&org)
	privs := []string{}
	if c.P.IsAccountAdmin {
		privs = allPrivilegeKeys()
	} else {
		for k := range c.P.Privileges {
			privs = append(privs, k)
		}
	}
	var sq string
	c.DB().Table("users").Select("COALESCE(security_questions, '')").Where("id = ?", c.P.UserID).Scan(&sq)
	return c.JSON(http.StatusOK, map[string]interface{}{
		"user": dto, "is_agent": c.P.IsAgent, "is_account_admin": c.P.IsAccountAdmin, "privileges": privs,
		"org":          c.orgContext(c.P.UserID, dto.Person.DepartmentID),
		"ticket_scope": c.P.TicketScope, "group_ids": c.P.GroupIDs, "organization": org,
		"has_security_questions": sq != "" && sq != "null",
		"settings": map[string]interface{}{
			"helpdesk_name": s.HelpdeskName, "portal_name": s.PortalName, "portal_welcome": s.PortalWelcome,
			"primary_color": s.PrimaryColor, "logo_url": s.LogoURL, "time_zone": s.TimeZone, "csat_enabled": s.CSATEnabled,
			"requester_can_close": s.RequesterCanClose, "requester_can_reopen": s.RequesterCanReopen,
			"custom_statuses": customStatuses(s), "password_min_length": max(8, s.PasswordMinLength),
			"password_require_upper": s.PasswordRequireUpper, "password_require_number": s.PasswordRequireNumber,
			"password_require_special": s.PasswordRequireSpecial, "session_timeout_minutes": s.SessionTimeoutMinutes,
			"prefixes": map[string]string{"incident": s.PrefixIncident, "service_request": s.PrefixServiceRequest,
				"problem": s.PrefixProblem, "change": s.PrefixChange, "release": s.PrefixRelease},
		},
	})
}

func (a *App) updateMe(c *Ctx) error {
	var in personInput
	if err := c.Bind(&in); err != nil {
		return err
	}
	p, err := a.ensurePerson(c.R.Context(), c.P.UserID, c.P.OrgID, c.P.PlatformRole)
	if err != nil {
		return err
	}
	// Self-service may not change routing, roles or reporting lines.
	in.DepartmentID, in.LocationID, in.ReportingManagerID = nil, nil, nil
	in.RoleIDs, in.GroupIDs, in.TicketScope, in.AgentType, in.IsAccountAdmin, in.VIP, in.ExternalID, in.Background = nil, nil, nil, nil, nil, nil, nil, nil
	errs := c.applyPersonInput(p, &in, c.P.IsAgent)
	if in.Name != nil && strings.TrimSpace(*in.Name) == "" {
		errs["name"] = "is required"
	}
	if len(errs) > 0 {
		return errValidation(errs)
	}
	err = c.DB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(p).Error; err != nil {
			return err
		}
		if in.Name != nil {
			return tx.Table("users").Where("id = ?", c.P.UserID).Updates(map[string]interface{}{"full_name": strings.TrimSpace(*in.Name), "updated_at": now()}).Error
		}
		return nil
	})
	if err != nil {
		return err
	}
	a.Invalidate(c.P.UserID)
	return a.getMe(c)
}

func (a *App) changePassword(c *Ctx) error {
	var in struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	var hash string
	c.DB().Table("users").Select("password").Where("id = ?", c.P.UserID).Scan(&hash)
	if auth.CheckPassword(in.CurrentPassword, hash) != nil {
		return errValidation(map[string]string{"current_password": "is incorrect"})
	}
	if err := validatePassword(c.settings(), in.NewPassword); err != nil {
		return errValidation(map[string]string{"new_password": err.Error()})
	}
	if in.NewPassword == in.CurrentPassword {
		return errValidation(map[string]string{"new_password": "must differ from the current password"})
	}
	newHash, err := auth.HashPassword(in.NewPassword)
	if err != nil {
		return err
	}
	err = c.DB().Table("users").Where("id = ?", c.P.UserID).Updates(map[string]interface{}{
		"password": newHash, "must_change_password": false, "password_changed_at": now(), "updated_at": now(),
	}).Error
	if err != nil {
		return err
	}
	c.DB().Model(&RefreshSession{}).Where("user_id = ? AND revoked_at IS NULL", c.P.UserID).Update("revoked_at", now())
	a.Invalidate(c.P.UserID)
	c.audit("me.password_changed", "user", c.P.UserID, "Changed own password", nil)
	tokens, err := a.issueTokens(c, c.P.UserID)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, tokens)
}

func (a *App) getAPIKey(c *Ctx) error {
	var k APIKey
	if err := c.DB().Where("user_id = ?", c.P.UserID).Take(&k).Error; err != nil {
		return c.JSON(http.StatusOK, map[string]interface{}{"api_key": nil})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"api_key": k})
}

func (a *App) regenerateAPIKey(c *Ctx) error {
	if !c.P.IsAgent {
		return errForbidden("API keys are available to agents only")
	}
	key := "tf_" + randomKey(24)
	k := APIKey{Base: Base{OrgID: c.P.OrgID}, UserID: c.P.UserID, KeyHash: hashToken(key), Prefix: key[:10]}
	err := c.DB().Transaction(func(tx *gorm.DB) error {
		tx.Where("user_id = ?", c.P.UserID).Delete(&APIKey{})
		return tx.Create(&k).Error
	})
	if err != nil {
		return err
	}
	c.audit("me.api_key_generated", "user", c.P.UserID, "Generated a new API key", nil)
	return c.JSON(http.StatusCreated, map[string]interface{}{"api_key": k, "key": key})
}

func (a *App) deleteAPIKey(c *Ctx) error {
	c.DB().Where("user_id = ?", c.P.UserID).Delete(&APIKey{})
	c.audit("me.api_key_revoked", "user", c.P.UserID, "Revoked API key", nil)
	return c.JSON(http.StatusOK, map[string]string{"message": "revoked"})
}

func (a *App) setAvailability(c *Ctx) error {
	var in struct {
		Available bool `json:"available"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	c.DB().Model(&Person{}).Where("user_id = ?", c.P.UserID).Update("available", in.Available)
	return c.JSON(http.StatusOK, map[string]bool{"available": in.Available})
}

func (a *App) listNotifications(c *Ctx) error {
	pg := c.Paging()
	type row struct {
		ID        string          `json:"id"`
		Type      string          `json:"type"`
		Title     string          `json:"title"`
		Message   string          `json:"message"`
		Read      bool            `json:"read"`
		Metadata  json.RawMessage `json:"metadata"`
		CreatedAt time.Time       `json:"created_at"`
	}
	q := func() *gorm.DB {
		q := c.DB().Table("notifications").Where("user_id = ?", c.P.UserID)
		if c.Query("unread") == "1" {
			q = q.Where("NOT read")
		}
		return q
	}
	var total, unread int64
	q().Count(&total)
	c.DB().Table("notifications").Where("user_id = ? AND NOT read", c.P.UserID).Count(&unread)
	var rows []row
	q().Select("id, type, title, message, read, COALESCE(metadata, '{}'::jsonb) AS metadata, created_at").
		Order("created_at DESC").Offset(pg.Offset()).Limit(pg.PerPage).Scan(&rows)
	if rows == nil {
		rows = []row{}
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"items": rows, "total": total, "unread": unread, "page": pg.Page, "per_page": pg.PerPage})
}

func (a *App) markNotifications(c *Ctx) error {
	var in struct {
		IDs []string `json:"ids"`
		All bool     `json:"all"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	q := c.DB().Table("notifications").Where("user_id = ?", c.P.UserID)
	if !in.All {
		ids := uniq(in.IDs)
		if len(ids) == 0 {
			return errBadRequest("ids or all is required")
		}
		q = q.Where("id IN ?", ids)
	}
	q.Update("read", true)
	return c.JSON(http.StatusOK, map[string]string{"message": "ok"})
}

// ---------------------------------------------------------------------------
// Tokens: refresh, logout, forgot password
// ---------------------------------------------------------------------------

type tokenPair struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
}

func (a *App) issueTokens(c *Ctx, userID string) (*tokenPair, error) {
	var u userRow
	if err := c.DB().Table("users").Select("id, email, role, org_id, is_active").Where("id = ?", userID).Take(&u).Error; err != nil || !u.IsActive {
		return nil, &APIError{Status: http.StatusUnauthorized, Message: "account unavailable"}
	}
	if u.OrgID != nil && orgSuspended(c.DB(), *u.OrgID) {
		return nil, &APIError{Status: http.StatusForbidden, Message: "your organization has been suspended. Contact support."}
	}
	access, err := a.JWT.GenerateAccessToken(u.ID, u.Email, u.Role, deref(u.OrgID))
	if err != nil {
		return nil, err
	}
	refresh, err := a.JWT.GenerateRefreshToken(u.ID)
	if err != nil {
		return nil, err
	}
	// Refresh tokens are JWTs; add a random suffix-free session record keyed by hash.
	sess := RefreshSession{ID: uuid.NewString(), UserID: u.ID, TokenHash: hashToken(refresh), ExpiresAt: now().Add(a.Cfg.RefreshTokenTTL),
		UserAgent: truncate(c.R.UserAgent(), 250), IP: c.ClientIP()}
	if err := c.DB().Create(&sess).Error; err != nil {
		// Two refreshes within the same second produce identical JWTs; reuse the session.
		if !strings.Contains(err.Error(), "duplicate") {
			return nil, err
		}
	}
	return &tokenPair{AccessToken: access, RefreshToken: refresh, ExpiresIn: 86400}, nil
}

func (a *App) refreshToken(c *Ctx) error {
	var in struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	claims, err := a.JWT.ValidateToken(strings.TrimSpace(in.RefreshToken))
	if err != nil || claims.UserID == "" || claims.Email != "" {
		return &APIError{Status: http.StatusUnauthorized, Message: "invalid refresh token"}
	}
	h := hashToken(in.RefreshToken)
	var sess RefreshSession
	found := c.DB().Where("token_hash = ?", h).Take(&sess).Error == nil
	if found && sess.RevokedAt != nil {
		// Reuse of a rotated token: revoke every session for this user.
		c.DB().Model(&RefreshSession{}).Where("user_id = ? AND revoked_at IS NULL", sess.UserID).Update("revoked_at", now())
		return &APIError{Status: http.StatusUnauthorized, Message: "refresh token was already used"}
	}
	var cut struct {
		PasswordChangedAt *time.Time
		TokensRevokedAt   *time.Time
	}
	c.DB().Table("users").Select("password_changed_at, tokens_revoked_at").Where("id = ?", claims.UserID).Scan(&cut)
	if claims.IssuedAt != nil && tokenRevoked(claims.IssuedAt.Time, cut.PasswordChangedAt, cut.TokensRevokedAt) {
		return &APIError{Status: http.StatusUnauthorized, Message: "session expired, please sign in again"}
	}
	if found {
		c.DB().Model(&RefreshSession{}).Where("id = ?", sess.ID).Update("revoked_at", now())
	} else {
		// Token issued at login by the user service: record it as consumed.
		c.DB().Create(&RefreshSession{ID: uuid.NewString(), UserID: claims.UserID, TokenHash: h, ExpiresAt: claims.ExpiresAt.Time, RevokedAt: ptrTime(now())})
	}
	a.Invalidate(claims.UserID)
	tokens, err := a.issueTokens(c, claims.UserID)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, tokens)
}

func ptrTime(t time.Time) *time.Time { return &t }

func (a *App) logout(c *Ctx) error {
	var in struct {
		RefreshToken string `json:"refresh_token"`
	}
	_ = json.NewDecoder(c.R.Body).Decode(&in)
	if in.RefreshToken != "" {
		h := hashToken(in.RefreshToken)
		res := c.DB().Model(&RefreshSession{}).Where("token_hash = ?", h).Update("revoked_at", now())
		if res.RowsAffected == 0 {
			if claims, err := a.JWT.ValidateToken(in.RefreshToken); err == nil && claims.Email == "" {
				c.DB().Create(&RefreshSession{ID: uuid.NewString(), UserID: claims.UserID, TokenHash: h, ExpiresAt: claims.ExpiresAt.Time, RevokedAt: ptrTime(now())})
			}
		}
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "signed out"})
}

type storedQuestion struct {
	Question   string `json:"question"`
	AnswerHash string `json:"answer_hash"`
}

func (a *App) forgotQuestions(c *Ctx) error {
	var in struct {
		Email string `json:"email"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	var row struct {
		SecurityQuestions string
		IsActive          bool
	}
	err := c.DB().Table("users").Select("COALESCE(security_questions, '') AS security_questions, is_active").
		Where("LOWER(email) = ?", strings.ToLower(strings.TrimSpace(in.Email))).Take(&row).Error
	var qs []storedQuestion
	if err == nil && row.IsActive {
		_ = json.Unmarshal([]byte(row.SecurityQuestions), &qs)
	}
	if len(qs) == 0 {
		return &APIError{Status: http.StatusNotFound, Message: "self-service reset is not available for this account. Contact your administrator."}
	}
	questions := make([]string, len(qs))
	for i, q := range qs {
		questions[i] = q.Question
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"questions": questions})
}

func normalizeAnswer(a string) string {
	return strings.ToLower(strings.Join(strings.Fields(a), " "))
}

func (a *App) forgotReset(c *Ctx) error {
	var in struct {
		Email   string `json:"email"`
		Answers []struct {
			Question string `json:"question"`
			Answer   string `json:"answer"`
		} `json:"answers"`
		NewPassword string `json:"new_password"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	var row struct {
		ID                string
		OrgID             *string
		SecurityQuestions string
		IsActive          bool
		LockedUntil       *time.Time
	}
	generic := &APIError{Status: http.StatusUnauthorized, Message: "the answers do not match our records"}
	err := c.DB().Table("users").Select("id, org_id, COALESCE(security_questions, '') AS security_questions, is_active, locked_until").
		Where("LOWER(email) = ?", strings.ToLower(strings.TrimSpace(in.Email))).Take(&row).Error
	if err != nil || !row.IsActive {
		return generic
	}
	if row.LockedUntil != nil && row.LockedUntil.After(now()) {
		return &APIError{Status: http.StatusTooManyRequests, Message: "too many attempts; try again later"}
	}
	var qs []storedQuestion
	_ = json.Unmarshal([]byte(row.SecurityQuestions), &qs)
	if len(qs) == 0 || len(in.Answers) != len(qs) {
		return generic
	}
	answers := map[string]string{}
	for _, an := range in.Answers {
		answers[an.Question] = an.Answer
	}
	for _, q := range qs {
		ans, ok := answers[q.Question]
		if !ok || (auth.CheckPassword(normalizeAnswer(ans), q.AnswerHash) != nil && auth.CheckPassword(ans, q.AnswerHash) != nil) {
			c.DB().Exec(`UPDATE users SET failed_login_attempts = failed_login_attempts + 1,
				locked_until = CASE WHEN failed_login_attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END
				WHERE id = ?`, row.ID)
			return generic
		}
	}
	var s *Settings
	if row.OrgID != nil {
		var st Settings
		if c.DB().Where("org_id = ?", *row.OrgID).Take(&st).Error == nil {
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
	c.DB().Table("users").Where("id = ?", row.ID).Updates(map[string]interface{}{
		"password": hash, "must_change_password": false, "failed_login_attempts": 0, "locked_until": nil,
		"password_changed_at": now(), "updated_at": now(),
	})
	c.DB().Model(&RefreshSession{}).Where("user_id = ? AND revoked_at IS NULL", row.ID).Update("revoked_at", now())
	a.Invalidate(row.ID)
	if row.OrgID != nil {
		c.DB().Create(&AuditLog{Base: Base{OrgID: *row.OrgID}, ActorID: &row.ID, Action: "me.password_reset_questions",
			EntityType: "user", EntityID: row.ID, Summary: "Reset password with security questions", Details: jsonOf(nil), IP: c.ClientIP()})
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "password updated; you can now sign in"})
}
