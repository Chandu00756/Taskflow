package app

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"
)

// ---------------------------------------------------------------------------
// Organizational units (stored as departments)
// ---------------------------------------------------------------------------

var unitKinds = []string{"company", "division", "business_unit", "department", "unit"}

// UnitDTO is an org unit with its place in the tree.
type UnitDTO struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	Description  string     `json:"description"`
	Kind         string     `json:"kind"`
	Code         string     `json:"code"`
	CostCenter   string     `json:"cost_center"`
	Email        string     `json:"email"`
	ParentID     *string    `json:"parent_id"`
	HeadUserID   *string    `json:"head_user_id"`
	PrimeUserID  *string    `json:"prime_user_id"`
	LocationID   *string    `json:"location_id"`
	Head         *UserBrief `json:"head"`
	PrimeUser    *UserBrief `json:"prime_user"`
	Location     *Ref       `json:"location"`
	Domains      []string   `json:"domains"`
	Path         []Ref      `json:"path"`
	Depth        int        `json:"depth"`
	ChildCount   int        `json:"child_count"`
	MemberCount  int64      `json:"member_count"`
	TotalMembers int64      `json:"total_members"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

// unitTree indexes an organization's units.
type unitTree struct {
	byID     map[string]*Department
	children map[string][]string
	roots    []string
}

func (c *Ctx) loadUnitTree() *unitTree {
	var units []Department
	c.T(&Department{}).Order("name").Find(&units)
	t := &unitTree{byID: map[string]*Department{}, children: map[string][]string{}}
	for i := range units {
		t.byID[units[i].ID] = &units[i]
	}
	for i := range units {
		u := &units[i]
		if u.ParentID != nil && t.byID[*u.ParentID] != nil {
			t.children[*u.ParentID] = append(t.children[*u.ParentID], u.ID)
		} else {
			t.roots = append(t.roots, u.ID)
		}
	}
	return t
}

// descendants returns id and every unit below it.
func (t *unitTree) descendants(id string) []string {
	out := []string{}
	stack := []string{id}
	seen := map[string]bool{}
	for len(stack) > 0 {
		cur := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if seen[cur] || t.byID[cur] == nil {
			continue
		}
		seen[cur] = true
		out = append(out, cur)
		stack = append(stack, t.children[cur]...)
	}
	return out
}

// path lists the ancestors of id from the root down, excluding id.
func (t *unitTree) path(id string) []Ref {
	out := []Ref{}
	seen := map[string]bool{id: true}
	cur := t.byID[id]
	for cur != nil && cur.ParentID != nil && !seen[*cur.ParentID] {
		p := t.byID[*cur.ParentID]
		if p == nil {
			break
		}
		seen[p.ID] = true
		out = append([]Ref{{ID: p.ID, Name: p.Name}}, out...)
		cur = p
	}
	return out
}

func (a *App) listDepartments(c *Ctx) error {
	t := c.loadUnitTree()
	uids := []string{}
	lids := []string{}
	for _, d := range t.byID {
		uids = append(uids, deref(d.HeadUserID), deref(d.PrimeUserID))
		lids = append(lids, deref(d.LocationID))
	}
	l := c.lookup(uids, nil, nil)
	locs := map[string]*Ref{}
	if ids := uniq(lids); len(ids) > 0 {
		var rows []Location
		c.T(&Location{}).Select("id, name").Where("id IN ?", ids).Find(&rows)
		for _, r := range rows {
			locs[r.ID] = &Ref{ID: r.ID, Name: r.Name}
		}
	}
	counts := map[string]int64{}
	var rows []struct {
		DepartmentID string
		N            int64
	}
	c.DB().Table("itsm_people p").Joins("JOIN users u ON u.id = p.user_id").
		Select("p.department_id, count(*) AS n").
		Where("p.org_id = ? AND p.department_id IS NOT NULL AND u.is_active", c.P.OrgID).Group("p.department_id").Scan(&rows)
	for _, r := range rows {
		counts[r.DepartmentID] = r.N
	}
	// Depth-first order so the list renders as a tree.
	out := []UnitDTO{}
	var walk func(id string, depth int)
	walk = func(id string, depth int) {
		d := t.byID[id]
		var total int64
		for _, x := range t.descendants(id) {
			total += counts[x]
		}
		dto := UnitDTO{ID: d.ID, Name: d.Name, Description: d.Description, Kind: d.Kind, Code: d.Code, CostCenter: d.CostCenter, Email: d.Email,
			ParentID: d.ParentID, HeadUserID: d.HeadUserID, PrimeUserID: d.PrimeUserID, LocationID: d.LocationID,
			Head: l.user(d.HeadUserID), PrimeUser: l.user(d.PrimeUserID), Domains: stringsFrom(d.Domains), Path: t.path(id),
			Depth: depth, ChildCount: len(t.children[id]), MemberCount: counts[id], TotalMembers: total, CreatedAt: d.CreatedAt, UpdatedAt: d.UpdatedAt}
		if dto.Kind == "" {
			dto.Kind = "department"
		}
		if d.LocationID != nil {
			dto.Location = locs[*d.LocationID]
		}
		out = append(out, dto)
		for _, ch := range t.children[id] {
			walk(ch, depth+1)
		}
	}
	for _, r := range t.roots {
		walk(r, 0)
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"items": out, "kinds": unitKinds})
}

type unitInput struct {
	Name        *string   `json:"name"`
	Description *string   `json:"description"`
	Kind        *string   `json:"kind"`
	Code        *string   `json:"code"`
	CostCenter  *string   `json:"cost_center"`
	Email       *string   `json:"email"`
	ParentID    *string   `json:"parent_id"`
	HeadUserID  *string   `json:"head_user_id"`
	PrimeUserID *string   `json:"prime_user_id"`
	LocationID  *string   `json:"location_id"`
	Domains     *[]string `json:"domains"`
}

func (a *App) saveDepartment(create bool) handlerFunc {
	return func(c *Ctx) error {
		d := Department{Base: Base{OrgID: c.P.OrgID}, Domains: jsonOf([]string{}), Kind: "department"}
		if !create {
			if err := c.T(&Department{}).Where("id = ?", c.Param("id")).Take(&d).Error; err != nil {
				return errNotFound("unit")
			}
		}
		var in unitInput
		if err := c.Bind(&in); err != nil {
			return err
		}
		errs := map[string]string{}
		if in.Name != nil {
			d.Name = strings.TrimSpace(*in.Name)
		}
		if d.Name == "" {
			errs["name"] = "is required"
		} else if len(d.Name) > 120 {
			errs["name"] = "must be at most 120 characters"
		}
		setText(&d.Description, in.Description)
		if in.Kind != nil {
			if !oneOf(*in.Kind, unitKinds...) {
				errs["kind"] = "must be one of " + strings.Join(unitKinds, ", ")
			} else {
				d.Kind = *in.Kind
			}
		}
		if in.Code != nil {
			d.Code = strings.ToUpper(strings.TrimSpace(*in.Code))
			if d.Code != "" {
				q := c.T(&Department{}).Where("UPPER(code) = ?", d.Code)
				if d.ID != "" {
					q = q.Where("id <> ?", d.ID)
				}
				var n int64
				q.Count(&n)
				if n > 0 {
					errs["code"] = "is already used by another unit"
				}
			}
		}
		if in.CostCenter != nil {
			d.CostCenter = strings.TrimSpace(*in.CostCenter)
		}
		if in.Email != nil {
			d.Email = strings.ToLower(strings.TrimSpace(*in.Email))
			if d.Email != "" && !validEmail(d.Email) {
				errs["email"] = "is invalid"
			}
		}
		if in.ParentID != nil {
			if *in.ParentID == "" {
				d.ParentID = nil
			} else {
				t := c.loadUnitTree()
				switch {
				case t.byID[*in.ParentID] == nil:
					errs["parent_id"] = "is not a unit in this organization"
				case d.ID != "" && containsString(t.descendants(d.ID), *in.ParentID):
					errs["parent_id"] = "cannot be the unit itself or one of its sub-units"
				default:
					d.ParentID = strPtr(*in.ParentID)
				}
			}
		}
		if in.HeadUserID != nil {
			d.HeadUserID = strPtr(*in.HeadUserID)
			c.optionalRef(errs, "head_user_id", d.HeadUserID, c.userInOrg)
		}
		if in.PrimeUserID != nil {
			d.PrimeUserID = strPtr(*in.PrimeUserID)
			c.optionalRef(errs, "prime_user_id", d.PrimeUserID, c.userInOrg)
		}
		if in.LocationID != nil {
			d.LocationID = strPtr(*in.LocationID)
			c.optionalRef(errs, "location_id", d.LocationID, func(id string) bool { return c.existsInOrg(&Location{}, id) })
		}
		if in.Domains != nil {
			doms := []string{}
			for _, dm := range *in.Domains {
				dm = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(dm)), "@")
				if dm == "" {
					continue
				}
				if !strings.Contains(dm, ".") || strings.ContainsAny(dm, " @/") {
					errs["domains"] = "must be domains such as example.com"
					break
				}
				doms = append(doms, dm)
			}
			d.Domains = jsonOf(uniqStrings(doms))
		}
		if len(errs) > 0 {
			return errValidation(errs)
		}
		var err error
		if create {
			err = c.DB().Create(&d).Error
		} else {
			err = c.DB().Save(&d).Error
		}
		if err != nil {
			return err
		}
		c.audit("unit.saved", "department", d.ID, "Saved unit "+d.Name, nil)
		return c.JSON(map[bool]int{true: http.StatusCreated, false: http.StatusOK}[create], d)
	}
}

// deleteDepartment removes a unit; its sub-units and members move up to its parent.
func (a *App) deleteDepartment(c *Ctx) error {
	var d Department
	if err := c.T(&Department{}).Where("id = ?", c.Param("id")).Take(&d).Error; err != nil {
		return errNotFound("unit")
	}
	var moved int64
	err := c.DB().Transaction(func(tx *gorm.DB) error {
		res := tx.Model(&Person{}).Where("org_id = ? AND department_id = ?", c.P.OrgID, d.ID).Update("department_id", d.ParentID)
		moved = res.RowsAffected
		tx.Model(&Department{}).Where("org_id = ? AND parent_id = ?", c.P.OrgID, d.ID).Update("parent_id", d.ParentID)
		tx.Model(&Team{}).Where("org_id = ? AND unit_id = ?", c.P.OrgID, d.ID).Update("unit_id", nil)
		for _, m := range []interface{}{&Ticket{}, &Problem{}, &Change{}, &Release{}, &Asset{}, &PurchaseOrder{}} {
			tx.Model(m).Where("org_id = ? AND department_id = ?", c.P.OrgID, d.ID).Update("department_id", d.ParentID)
		}
		return tx.Delete(&d).Error
	})
	if err != nil {
		return err
	}
	c.audit("unit.deleted", "department", d.ID, fmt.Sprintf("Deleted unit %s (%d people moved to the parent unit)", d.Name, moved), nil)
	return c.JSON(http.StatusOK, map[string]interface{}{"message": "deleted", "members_moved": moved})
}

// unitForEmail finds the unit whose email domains include the address's domain.
func unitForEmail(db *gorm.DB, orgID, email string) *Department {
	_, domain, ok := strings.Cut(strings.ToLower(email), "@")
	if !ok || domain == "" {
		return nil
	}
	var d Department
	if db.Where("org_id = ? AND domains @> ?::jsonb", orgID, string(jsonOf([]string{domain}))).Order("name").Take(&d).Error != nil {
		return nil
	}
	return &d
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

// TeamRules select the members of a dynamic team.
type TeamRules struct {
	Match      string          `json:"match"`
	Conditions []TeamCondition `json:"conditions"`
}

// TeamCondition is one rule; Field is one of teamRuleFields.
type TeamCondition struct {
	Field    string `json:"field"`
	Operator string `json:"operator"`
	Value    string `json:"value"`
}

var teamRuleFields = map[string][]string{
	"unit":              {"is", "is_not", "within"},
	"location":          {"is", "is_not"},
	"reporting_manager": {"is", "is_not"},
	"job_title":         {"contains", "is"},
	"email_domain":      {"is", "is_not"},
	"person_type":       {"is"},
	"vip":               {"is"},
}

func (r TeamRules) validate(c *Ctx) string {
	if !oneOf(r.Match, "all", "any") {
		return "match must be all or any"
	}
	if len(r.Conditions) == 0 {
		return "add at least one condition"
	}
	for _, cond := range r.Conditions {
		ops, ok := teamRuleFields[cond.Field]
		if !ok {
			return "unknown field " + cond.Field
		}
		if !oneOf(cond.Operator, ops...) {
			return fmt.Sprintf("%s does not support %s", cond.Field, cond.Operator)
		}
		v := strings.TrimSpace(cond.Value)
		switch cond.Field {
		case "unit":
			if !c.existsInOrg(&Department{}, v) {
				return "unit condition must reference a unit"
			}
		case "location":
			if !c.existsInOrg(&Location{}, v) {
				return "location condition must reference a location"
			}
		case "reporting_manager":
			if !c.userInOrg(v) {
				return "manager condition must reference a person"
			}
		case "person_type":
			if !oneOf(v, "agent", "requester") {
				return "person type must be agent or requester"
			}
		case "vip":
			if !oneOf(v, "true", "false") {
				return "vip must be true or false"
			}
		default:
			if v == "" {
				return cond.Field + " needs a value"
			}
		}
	}
	return ""
}

// ruleSQL turns team rules into a WHERE fragment over users u / itsm_people p.
func (c *Ctx) ruleSQL(r TeamRules) (string, []interface{}) {
	parts := []string{}
	args := []interface{}{}
	tree := c.loadUnitTree()
	for _, cond := range r.Conditions {
		v := strings.TrimSpace(cond.Value)
		var sql string
		var a []interface{}
		switch cond.Field {
		case "unit":
			switch cond.Operator {
			case "within":
				sql, a = "p.department_id IN ?", []interface{}{append(tree.descendants(v), v)}
			case "is":
				sql, a = "p.department_id = ?", []interface{}{v}
			default:
				sql, a = "(p.department_id IS NULL OR p.department_id <> ?)", []interface{}{v}
			}
		case "location":
			if cond.Operator == "is" {
				sql, a = "p.location_id = ?", []interface{}{v}
			} else {
				sql, a = "(p.location_id IS NULL OR p.location_id <> ?)", []interface{}{v}
			}
		case "reporting_manager":
			if cond.Operator == "is" {
				sql, a = "p.reporting_manager_id = ?", []interface{}{v}
			} else {
				sql, a = "(p.reporting_manager_id IS NULL OR p.reporting_manager_id <> ?)", []interface{}{v}
			}
		case "job_title":
			if cond.Operator == "contains" {
				sql, a = "p.job_title ILIKE ?", []interface{}{likeEscape(v)}
			} else {
				sql, a = "LOWER(p.job_title) = LOWER(?)", []interface{}{v}
			}
		case "email_domain":
			dom := "%@" + strings.TrimPrefix(strings.ToLower(v), "@")
			if cond.Operator == "is" {
				sql, a = "LOWER(u.email) LIKE ?", []interface{}{dom}
			} else {
				sql, a = "LOWER(u.email) NOT LIKE ?", []interface{}{dom}
			}
		case "person_type":
			if v == "agent" {
				sql = "(p.is_agent OR u.role IN ('org_admin','admin'))"
			} else {
				sql = "NOT (p.is_agent OR u.role IN ('org_admin','admin'))"
			}
		case "vip":
			sql, a = "p.v_ip = ?", []interface{}{v == "true"}
		}
		parts = append(parts, sql)
		args = append(args, a...)
	}
	joiner := " AND "
	if r.Match == "any" {
		joiner = " OR "
	}
	return "(" + strings.Join(parts, joiner) + ")", args
}

// teamMembersQuery selects the active users in a team.
func (c *Ctx) teamMembersQuery(t *Team) *gorm.DB {
	q := c.DB().Table("users u").Joins("JOIN itsm_people p ON p.user_id = u.id").Where("u.org_id = ? AND u.is_active", c.P.OrgID)
	if t.Kind == "dynamic" {
		var r TeamRules
		_ = jsonUnmarshal(t.Rules, &r)
		if len(r.Conditions) == 0 {
			return q.Where("false")
		}
		sql, args := c.ruleSQL(r)
		return q.Where(sql, args...)
	}
	return q.Where("u.id IN (?)", c.DB().Model(&TeamMember{}).Select("user_id").Where("team_id = ?", t.ID))
}

// TeamDTO adds people and counts to a team.
type TeamDTO struct {
	*Team
	Lead        *UserBrief   `json:"lead"`
	Unit        *Ref         `json:"unit"`
	MemberCount int64        `json:"member_count"`
	Preview     []*UserBrief `json:"preview"`
	Rules       TeamRules    `json:"rules"`
}

func (c *Ctx) teamDTO(t *Team, l *lookup) TeamDTO {
	var r TeamRules
	_ = jsonUnmarshal(t.Rules, &r)
	if r.Conditions == nil {
		r.Conditions = []TeamCondition{}
	}
	if r.Match == "" {
		r.Match = "all"
	}
	dto := TeamDTO{Team: t, Lead: l.user(t.LeadUserID), Unit: l.dept(t.UnitID), Rules: r, Preview: []*UserBrief{}}
	c.teamMembersQuery(t).Count(&dto.MemberCount)
	var ids []string
	c.teamMembersQuery(t).Order("u.full_name").Limit(5).Pluck("u.id", &ids)
	pl := c.lookup(ids, nil, nil)
	for _, id := range ids {
		if u := pl.userS(id); u != nil {
			dto.Preview = append(dto.Preview, u)
		}
	}
	return dto
}

func (a *App) listTeams(c *Ctx) error {
	var teams []Team
	q := c.T(&Team{})
	if v := strings.TrimSpace(c.Query("q")); v != "" {
		q = q.Where("(name ILIKE ? OR description ILIKE ?)", likeEscape(v), likeEscape(v))
	}
	q.Order("name").Find(&teams)
	uids, dids := []string{}, []string{}
	for _, t := range teams {
		uids = append(uids, deref(t.LeadUserID))
		dids = append(dids, deref(t.UnitID))
	}
	l := c.lookup(uids, nil, dids)
	out := make([]TeamDTO, len(teams))
	for i := range teams {
		out[i] = c.teamDTO(&teams[i], l)
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"items": out, "rule_fields": teamRuleFields})
}

func (c *Ctx) loadTeam(id string) (*Team, error) {
	var t Team
	if !isUUID(id) || c.T(&Team{}).Where("id = ?", id).Take(&t).Error != nil {
		return nil, errNotFound("team")
	}
	return &t, nil
}

func (a *App) getTeam(c *Ctx) error {
	t, err := c.loadTeam(c.Param("id"))
	if err != nil {
		return err
	}
	l := c.lookup([]string{deref(t.LeadUserID)}, nil, []string{deref(t.UnitID)})
	return c.JSON(http.StatusOK, c.teamDTO(t, l))
}

type teamInput struct {
	Name        *string    `json:"name"`
	Description *string    `json:"description"`
	Kind        *string    `json:"kind"`
	LeadUserID  *string    `json:"lead_user_id"`
	UnitID      *string    `json:"unit_id"`
	Email       *string    `json:"email"`
	Color       *string    `json:"color"`
	Rules       *TeamRules `json:"rules"`
	MemberIDs   *[]string  `json:"member_ids"`
}

func (a *App) saveTeam(create bool) handlerFunc {
	return func(c *Ctx) error {
		t := Team{Base: Base{OrgID: c.P.OrgID}, Kind: "static", Color: "#2563eb", Rules: jsonOf(TeamRules{Match: "all", Conditions: []TeamCondition{}})}
		if !create {
			loaded, err := c.loadTeam(c.Param("id"))
			if err != nil {
				return err
			}
			t = *loaded
		}
		var in teamInput
		if err := c.Bind(&in); err != nil {
			return err
		}
		errs := map[string]string{}
		if in.Name != nil {
			t.Name = strings.TrimSpace(*in.Name)
		}
		if t.Name == "" {
			errs["name"] = "is required"
		} else {
			q := c.T(&Team{}).Where("LOWER(name) = LOWER(?)", t.Name)
			if t.ID != "" {
				q = q.Where("id <> ?", t.ID)
			}
			var n int64
			q.Count(&n)
			if n > 0 {
				errs["name"] = "is already taken"
			}
		}
		setText(&t.Description, in.Description)
		if in.Kind != nil {
			if !oneOf(*in.Kind, "static", "dynamic") {
				errs["kind"] = "must be static or dynamic"
			} else {
				t.Kind = *in.Kind
			}
		}
		if in.LeadUserID != nil {
			t.LeadUserID = strPtr(*in.LeadUserID)
			c.optionalRef(errs, "lead_user_id", t.LeadUserID, c.userInOrg)
		}
		if in.UnitID != nil {
			t.UnitID = strPtr(*in.UnitID)
			c.optionalRef(errs, "unit_id", t.UnitID, func(id string) bool { return c.existsInOrg(&Department{}, id) })
		}
		if in.Email != nil {
			t.Email = strings.ToLower(strings.TrimSpace(*in.Email))
			if t.Email != "" && !validEmail(t.Email) {
				errs["email"] = "is invalid"
			}
		}
		if in.Color != nil {
			if !hexColor.MatchString(*in.Color) {
				errs["color"] = "must be a hex color"
			} else {
				t.Color = strings.ToLower(*in.Color)
			}
		}
		if in.Rules != nil {
			if in.Rules.Match == "" {
				in.Rules.Match = "all"
			}
			t.Rules = jsonOf(in.Rules)
		}
		if t.Kind == "dynamic" {
			var r TeamRules
			_ = jsonUnmarshal(t.Rules, &r)
			if msg := r.validate(c); msg != "" {
				errs["rules"] = msg
			}
		}
		members := []string{}
		if in.MemberIDs != nil {
			for _, id := range uniq(*in.MemberIDs) {
				if !c.userInOrg(id) {
					errs["member_ids"] = "contains an unknown person"
					break
				}
				members = append(members, id)
			}
		}
		if len(errs) > 0 {
			return errValidation(errs)
		}
		err := c.DB().Transaction(func(tx *gorm.DB) error {
			var err error
			if create {
				err = tx.Create(&t).Error
			} else {
				err = tx.Save(&t).Error
			}
			if err != nil {
				return err
			}
			if in.MemberIDs != nil && t.Kind == "static" {
				tx.Where("team_id = ?", t.ID).Delete(&TeamMember{})
				for _, id := range members {
					if err := tx.Create(&TeamMember{TeamID: t.ID, UserID: id, OrgID: c.P.OrgID}).Error; err != nil {
						return err
					}
				}
			}
			return nil
		})
		if err != nil {
			return err
		}
		c.audit("team.saved", "team", t.ID, "Saved team "+t.Name, nil)
		l := c.lookup([]string{deref(t.LeadUserID)}, nil, []string{deref(t.UnitID)})
		return c.JSON(map[bool]int{true: http.StatusCreated, false: http.StatusOK}[create], c.teamDTO(&t, l))
	}
}

func (a *App) deleteTeam(c *Ctx) error {
	t, err := c.loadTeam(c.Param("id"))
	if err != nil {
		return err
	}
	err = c.DB().Transaction(func(tx *gorm.DB) error {
		tx.Where("team_id = ?", t.ID).Delete(&TeamMember{})
		return tx.Delete(t).Error
	})
	if err != nil {
		return err
	}
	c.audit("team.deleted", "team", t.ID, "Deleted team "+t.Name, nil)
	return c.JSON(http.StatusOK, map[string]string{"message": "deleted"})
}

func (a *App) teamMembers(c *Ctx) error {
	t, err := c.loadTeam(c.Param("id"))
	if err != nil {
		return err
	}
	pg := c.Paging()
	q := c.teamMembersQuery(t)
	if v := strings.TrimSpace(c.Query("q")); v != "" {
		q = q.Where("(u.full_name ILIKE ? OR u.email ILIKE ?)", likeEscape(v), likeEscape(v))
	}
	var total int64
	q.Count(&total)
	var ids []string
	c.teamMembersQuery(t).Where("u.id IN (?)", q.Select("u.id")).Order("u.full_name").Offset(pg.Offset()).Limit(pg.PerPage).Pluck("u.id", &ids)
	l := c.lookup(ids, nil, nil)
	items := []*UserBrief{}
	for _, id := range ids {
		if u := l.userS(id); u != nil {
			items = append(items, u)
		}
	}
	return c.JSON(http.StatusOK, ListResponse{Items: items, Total: total, Page: pg.Page, PerPage: pg.PerPage})
}

func (a *App) addTeamMembers(c *Ctx) error {
	t, err := c.loadTeam(c.Param("id"))
	if err != nil {
		return err
	}
	if t.Kind != "static" {
		return errBadRequest("members of a dynamic team come from its rules")
	}
	var in struct {
		UserIDs []string `json:"user_ids"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	added := 0
	for _, id := range uniq(in.UserIDs) {
		if !c.userInOrg(id) {
			return errValidation(map[string]string{"user_ids": "contains an unknown person"})
		}
		res := c.DB().Where(TeamMember{TeamID: t.ID, UserID: id}).Attrs(TeamMember{OrgID: c.P.OrgID}).FirstOrCreate(&TeamMember{})
		if res.RowsAffected > 0 {
			added++
		}
	}
	return c.JSON(http.StatusOK, map[string]int{"added": added})
}

func (a *App) removeTeamMember(c *Ctx) error {
	t, err := c.loadTeam(c.Param("id"))
	if err != nil {
		return err
	}
	c.DB().Where("team_id = ? AND user_id = ?", t.ID, c.Param("user_id")).Delete(&TeamMember{})
	return c.JSON(http.StatusOK, map[string]string{"message": "removed"})
}

// previewTeamRules counts the people that rules would select, before saving.
func (a *App) previewTeamRules(c *Ctx) error {
	var r TeamRules
	if err := c.Bind(&r); err != nil {
		return err
	}
	if r.Match == "" {
		r.Match = "all"
	}
	if msg := r.validate(c); msg != "" {
		return errValidation(map[string]string{"rules": msg})
	}
	t := Team{Kind: "dynamic", Rules: jsonOf(r)}
	var total int64
	c.teamMembersQuery(&t).Count(&total)
	var ids []string
	c.teamMembersQuery(&t).Order("u.full_name").Limit(8).Pluck("u.id", &ids)
	l := c.lookup(ids, nil, nil)
	sample := []*UserBrief{}
	for _, id := range ids {
		if u := l.userS(id); u != nil {
			sample = append(sample, u)
		}
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"total": total, "sample": sample})
}

// teamsOf lists the teams a person belongs to (static and dynamic).
func (c *Ctx) teamsOf(userID string) []Ref {
	var teams []Team
	c.T(&Team{}).Order("name").Find(&teams)
	out := []Ref{}
	for i := range teams {
		var n int64
		c.teamMembersQuery(&teams[i]).Where("u.id = ?", userID).Count(&n)
		if n > 0 {
			out = append(out, Ref{ID: teams[i].ID, Name: teams[i].Name})
		}
	}
	return out
}

// ---------------------------------------------------------------------------
// People: bulk actions, import and export
// ---------------------------------------------------------------------------

func (a *App) bulkPeople(c *Ctx) error {
	var in struct {
		IDs    []string `json:"ids"`
		Action string   `json:"action"`
		Value  string   `json:"value"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	ids := uniq(in.IDs)
	if len(ids) == 0 || len(ids) > 500 {
		return errBadRequest("select between 1 and 500 people")
	}
	for _, id := range ids {
		if !c.userInOrg(id) {
			return errValidation(map[string]string{"ids": "contains an unknown person"})
		}
	}
	others := []string{}
	for _, id := range ids {
		if id != c.P.UserID {
			others = append(others, id)
		}
	}
	var updated int64
	var err error
	switch in.Action {
	case "set_unit", "set_location", "set_manager":
		col := map[string]string{"set_unit": "department_id", "set_location": "location_id", "set_manager": "reporting_manager_id"}[in.Action]
		var value interface{}
		if in.Value != "" {
			ok := false
			switch in.Action {
			case "set_unit":
				ok = c.existsInOrg(&Department{}, in.Value)
			case "set_location":
				ok = c.existsInOrg(&Location{}, in.Value)
			default:
				ok = c.userInOrg(in.Value)
			}
			if !ok {
				return errValidation(map[string]string{"value": "is invalid"})
			}
			value = in.Value
		}
		q := c.DB().Model(&Person{}).Where("org_id = ? AND user_id IN ?", c.P.OrgID, ids)
		if in.Action == "set_manager" && in.Value != "" {
			q = q.Where("user_id <> ?", in.Value)
		}
		res := q.Updates(map[string]interface{}{col: value, "updated_at": now()})
		updated, err = res.RowsAffected, res.Error
	case "add_to_team", "remove_from_team":
		t, terr := c.loadTeam(in.Value)
		if terr != nil {
			return errValidation(map[string]string{"value": "is not a team"})
		}
		if t.Kind != "static" {
			return errBadRequest("members of a dynamic team come from its rules")
		}
		for _, id := range ids {
			if in.Action == "add_to_team" {
				updated += c.DB().Where(TeamMember{TeamID: t.ID, UserID: id}).Attrs(TeamMember{OrgID: c.P.OrgID}).FirstOrCreate(&TeamMember{}).RowsAffected
			} else {
				updated += c.DB().Where("team_id = ? AND user_id = ?", t.ID, id).Delete(&TeamMember{}).RowsAffected
			}
		}
	case "deactivate", "reactivate":
		active := in.Action == "reactivate"
		q := c.DB().Table("users").Where("org_id = ? AND id IN ? AND role NOT IN ('super_admin')", c.P.OrgID, others)
		if !c.P.IsAccountAdmin {
			q = q.Where("role NOT IN ('org_admin','admin')")
		}
		if len(others) == 0 {
			break
		}
		res := q.Updates(map[string]interface{}{"is_active": active, "updated_at": now()})
		updated, err = res.RowsAffected, res.Error
		if !active && err == nil {
			c.DB().Model(&RefreshSession{}).Where("user_id IN ? AND revoked_at IS NULL", others).Update("revoked_at", now())
		}
	case "set_vip_on", "set_vip_off":
		res := c.DB().Model(&Person{}).Where("org_id = ? AND user_id IN ?", c.P.OrgID, ids).Updates(map[string]interface{}{"v_ip": in.Action == "set_vip_on", "updated_at": now()})
		updated, err = res.RowsAffected, res.Error
	default:
		return errBadRequest("unknown action")
	}
	if err != nil {
		return err
	}
	a.Invalidate(ids...)
	c.audit("people.bulk_"+in.Action, "user", "", fmt.Sprintf("Bulk %s on %d people", strings.ReplaceAll(in.Action, "_", " "), updated), map[string]interface{}{"ids": ids, "value": in.Value})
	return c.JSON(http.StatusOK, map[string]int64{"updated": updated})
}

var importColumns = []string{"name", "email", "job_title", "phone", "mobile", "unit", "location", "reporting_manager", "vip", "time_zone", "language", "groups", "roles"}

// ImportRow is the outcome for one CSV line.
type ImportRow struct {
	Line   int               `json:"line"`
	Email  string            `json:"email"`
	Name   string            `json:"name"`
	Action string            `json:"action"`
	Errors map[string]string `json:"errors,omitempty"`
	Temp   string            `json:"temporary_password,omitempty"`
}

// importPeople creates or updates agents or requesters from CSV. With
// dry_run it only validates and reports what would happen.
func (a *App) importPeople(c *Ctx) error {
	var in struct {
		Kind   string `json:"kind"`
		CSV    string `json:"csv"`
		DryRun bool   `json:"dry_run"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	agent := in.Kind == "agents"
	if !agent && in.Kind != "requesters" {
		return errValidation(map[string]string{"kind": "must be agents or requesters"})
	}
	if agent && !c.P.Can(PrivUsersManage) {
		return errForbidden("")
	}
	r := csv.NewReader(strings.NewReader(strings.TrimPrefix(in.CSV, "\uFEFF")))
	r.FieldsPerRecord = -1
	r.TrimLeadingSpace = true
	records, err := r.ReadAll()
	if err != nil {
		return errValidation(map[string]string{"csv": "could not be read: " + err.Error()})
	}
	if len(records) < 2 {
		return errValidation(map[string]string{"csv": "needs a header row and at least one person"})
	}
	if len(records) > 1001 {
		return errValidation(map[string]string{"csv": "import at most 1000 people at a time"})
	}
	header := map[string]int{}
	for i, h := range records[0] {
		header[strings.ReplaceAll(strings.ToLower(strings.TrimSpace(h)), " ", "_")] = i
	}
	if _, ok := header["email"]; !ok {
		return errValidation(map[string]string{"csv": "is missing the email column"})
	}
	get := func(rec []string, col string) string {
		if i, ok := header[col]; ok && i < len(rec) {
			return strings.TrimSpace(rec[i])
		}
		return ""
	}
	// Name lookups for units, locations, groups and roles (by name or code).
	units := map[string]string{}
	var ulist []Department
	c.T(&Department{}).Find(&ulist)
	for _, u := range ulist {
		units[strings.ToLower(u.Name)] = u.ID
		if u.Code != "" {
			units[strings.ToLower(u.Code)] = u.ID
		}
	}
	locs := map[string]string{}
	var llist []Location
	c.T(&Location{}).Find(&llist)
	for _, l := range llist {
		locs[strings.ToLower(l.Name)] = l.ID
	}
	groups := map[string]string{}
	var glist []AgentGroup
	c.T(&AgentGroup{}).Find(&glist)
	for _, g := range glist {
		groups[strings.ToLower(g.Name)] = g.ID
	}
	roles := map[string]string{}
	var rlist []Role
	c.T(&Role{}).Find(&rlist)
	for _, r := range rlist {
		roles[strings.ToLower(r.Name)] = r.ID
	}
	splitList := func(v string) []string {
		out := []string{}
		for _, s := range strings.FieldsFunc(v, func(r rune) bool { return r == ';' || r == '|' }) {
			if s = strings.TrimSpace(s); s != "" {
				out = append(out, s)
			}
		}
		return out
	}

	results := []ImportRow{}
	seen := map[string]bool{}
	summary := map[string]int{"create": 0, "update": 0, "error": 0}
	for i, rec := range records[1:] {
		row := ImportRow{Line: i + 2, Email: strings.ToLower(get(rec, "email")), Name: get(rec, "name"), Errors: map[string]string{}}
		if row.Email == "" && row.Name == "" && strings.Join(rec, "") == "" {
			continue
		}
		pin := personInput{Email: row.Email}
		str := func(col string) *string {
			if v := get(rec, col); v != "" {
				return &v
			}
			return nil
		}
		pin.JobTitle, pin.Phone, pin.Mobile, pin.TimeZone, pin.Language = str("job_title"), str("phone"), str("mobile"), str("time_zone"), str("language")
		if row.Name != "" {
			pin.Name = &row.Name
		}
		if !validEmail(row.Email) {
			row.Errors["email"] = "is invalid"
		} else if seen[row.Email] {
			row.Errors["email"] = "appears more than once in the file"
		}
		seen[row.Email] = true
		if v := get(rec, "unit"); v != "" {
			if id, ok := units[strings.ToLower(v)]; ok {
				pin.DepartmentID = &id
			} else {
				row.Errors["unit"] = "no unit named " + v
			}
		} else if v := get(rec, "department"); v != "" {
			if id, ok := units[strings.ToLower(v)]; ok {
				pin.DepartmentID = &id
			} else {
				row.Errors["unit"] = "no unit named " + v
			}
		}
		if v := get(rec, "location"); v != "" {
			if id, ok := locs[strings.ToLower(v)]; ok {
				pin.LocationID = &id
			} else {
				row.Errors["location"] = "no location named " + v
			}
		}
		if v := strings.ToLower(get(rec, "reporting_manager")); v != "" {
			var mid string
			c.DB().Table("users").Select("id").Where("org_id = ? AND LOWER(email) = ?", c.P.OrgID, v).Scan(&mid)
			if mid == "" {
				row.Errors["reporting_manager"] = "no person with email " + v
			} else {
				pin.ReportingManagerID = &mid
			}
		}
		if v := strings.ToLower(get(rec, "vip")); v != "" {
			b := oneOf(v, "true", "yes", "1", "y")
			pin.VIP = &b
		}
		var groupIDs, roleIDs []string
		if agent {
			for _, g := range splitList(get(rec, "groups")) {
				if id, ok := groups[strings.ToLower(g)]; ok {
					groupIDs = append(groupIDs, id)
				} else {
					row.Errors["groups"] = "no group named " + g
				}
			}
			for _, r := range splitList(get(rec, "roles")) {
				if id, ok := roles[strings.ToLower(r)]; ok {
					roleIDs = append(roleIDs, id)
				} else {
					row.Errors["roles"] = "no role named " + r
				}
			}
			if len(roleIDs) > 0 {
				pin.RoleIDs = &roleIDs
			}
		}
		var existing struct {
			ID    string
			OrgID *string
		}
		if validEmail(row.Email) {
			c.DB().Table("users").Select("id, org_id").Where("LOWER(email) = ?", row.Email).Scan(&existing)
		}
		switch {
		case existing.ID != "" && deref(existing.OrgID) != c.P.OrgID:
			row.Errors["email"] = "belongs to another organization"
		case existing.ID != "":
			row.Action = "update"
		default:
			row.Action = "create"
			if row.Name == "" {
				row.Errors["name"] = "is required for new people"
			}
		}
		if len(row.Errors) == 0 && !in.DryRun {
			if err := a.applyImportRow(c, &row, existing.ID, agent, &pin, groupIDs); err != nil {
				row.Errors["row"] = err.Error()
			}
		}
		if len(row.Errors) > 0 {
			row.Action = "error"
		} else {
			row.Errors = nil
		}
		summary[row.Action]++
		results = append(results, row)
	}
	if !in.DryRun {
		c.audit("people.imported", "user", "", fmt.Sprintf("Imported %s: %d created, %d updated, %d failed", in.Kind, summary["create"], summary["update"], summary["error"]), summary)
	}
	if !in.DryRun {
		a.kickMail() // invitations queued inside the import transaction
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"rows": results, "summary": summary, "dry_run": in.DryRun, "columns": importColumns})
}

func (a *App) applyImportRow(c *Ctx, row *ImportRow, existingID string, agent bool, pin *personInput, groupIDs []string) error {
	return c.DB().Transaction(func(tx *gorm.DB) error {
		id := existingID
		if id == "" {
			role := "member"
			if agent {
				role = "agent"
			}
			newID, temp, err := a.createUser(tx, c.P.OrgID, row.Email, row.Name, role, agent)
			if err != nil {
				return fmt.Errorf("email %s", err.Error())
			}
			id = newID
			if !a.inviteUser(tx, c, id, row.Email, row.Name) {
				row.Temp = temp
			}
			if agent && pin.RoleIDs == nil {
				var r Role
				if c.T(&Role{}).Where("name = 'SD Agent'").Take(&r).Error == nil {
					ids := []string{r.ID}
					pin.RoleIDs = &ids
				}
			}
		}
		var p Person
		if err := tx.Where("user_id = ?", id).Take(&p).Error; err != nil {
			p = a.defaultPerson(c.R.Context(), id, c.P.OrgID, "member")
		}
		isAgent := p.IsAgent || agent
		if errs := c.applyPersonInput(&p, pin, isAgent); len(errs) > 0 {
			for k, v := range errs {
				row.Errors[k] = v
			}
			return fmt.Errorf("validation failed")
		}
		if err := tx.Save(&p).Error; err != nil {
			return err
		}
		if pin.Name != nil && existingID != "" {
			tx.Table("users").Where("id = ?", id).Updates(map[string]interface{}{"full_name": strings.TrimSpace(*pin.Name), "updated_at": now()})
		}
		if agent && len(groupIDs) > 0 {
			for _, g := range uniq(groupIDs) {
				tx.Where(GroupMember{GroupID: g, UserID: id}).Attrs(GroupMember{OrgID: c.P.OrgID}).FirstOrCreate(&GroupMember{})
			}
		}
		a.Invalidate(id)
		return nil
	})
}

// exportPeople downloads agents or requesters as CSV in the import format.
func (a *App) exportPeople(c *Ctx) error {
	agent := c.Query("kind") == "agents"
	var rows []struct {
		ID       string
		Email    string
		FullName string
		IsActive bool
		JobTitle string
		Phone    string
		Mobile   string
		Unit     *string
		Location *string
		Manager  *string
		VIP      bool
		TimeZone string
		Language string
	}
	c.peopleQuery(agent).
		Select(`u.id, u.email, u.full_name, u.is_active, p.job_title, p.phone, p.mobile, d.name AS unit, l.name AS location,
			m.email AS manager, p.v_ip, p.time_zone, p.language`).
		Joins("LEFT JOIN itsm_departments d ON d.id = p.department_id").
		Joins("LEFT JOIN itsm_locations l ON l.id = p.location_id").
		Joins("LEFT JOIN users m ON m.id = p.reporting_manager_id").
		Order("u.full_name").Scan(&rows)
	groupsOf := map[string][]string{}
	rolesOf := map[string][]string{}
	if agent {
		var gm []struct {
			UserID string
			Name   string
		}
		c.DB().Table("itsm_group_members gm").Select("gm.user_id, g.name").Joins("JOIN itsm_agent_groups g ON g.id = gm.group_id").
			Where("gm.org_id = ?", c.P.OrgID).Order("g.name").Scan(&gm)
		for _, r := range gm {
			groupsOf[r.UserID] = append(groupsOf[r.UserID], r.Name)
		}
		var roles []Role
		c.T(&Role{}).Find(&roles)
		names := map[string]string{}
		for _, r := range roles {
			names[r.ID] = r.Name
		}
		var people []Person
		c.T(&Person{}).Select("user_id, role_ids").Find(&people)
		for _, p := range people {
			for _, id := range stringsFrom(p.RoleIDs) {
				if n := names[id]; n != "" {
					rolesOf[p.UserID] = append(rolesOf[p.UserID], n)
				}
			}
		}
	}
	var buf bytes.Buffer
	w := csv.NewWriter(&buf)
	header := append([]string{}, importColumns[:11]...)
	if agent {
		header = append(header, "groups", "roles")
	}
	header = append(header, "status")
	_ = w.Write(header)
	for _, r := range rows {
		status := "active"
		if !r.IsActive {
			status = "deactivated"
		}
		rec := []string{r.FullName, r.Email, r.JobTitle, r.Phone, r.Mobile, deref(r.Unit), deref(r.Location), deref(r.Manager),
			map[bool]string{true: "yes", false: ""}[r.VIP], r.TimeZone, r.Language}
		if agent {
			sort.Strings(groupsOf[r.ID])
			rec = append(rec, strings.Join(groupsOf[r.ID], "; "), strings.Join(rolesOf[r.ID], "; "))
		}
		rec = append(rec, status)
		for i := range rec {
			rec[i] = csvSafe(rec[i])
		}
		_ = w.Write(rec)
	}
	w.Flush()
	name := map[bool]string{true: "agents", false: "requesters"}[agent]
	c.W.Header().Set("Content-Type", "text/csv; charset=utf-8")
	c.W.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s-%s.csv"`, name, now().Format("2006-01-02")))
	c.W.WriteHeader(http.StatusOK)
	_, err := io.Copy(c.W, &buf)
	return err
}

// OrgContext places a person in the organization: unit path, manager chain,
// direct reports and teams.
type OrgContext struct {
	UnitPath      []Ref        `json:"unit_path"`
	ManagerChain  []*UserBrief `json:"manager_chain"`
	DirectReports []*UserBrief `json:"direct_reports"`
	Teams         []Ref        `json:"teams"`
}

func (c *Ctx) orgContext(userID string, unitID *string) OrgContext {
	out := OrgContext{UnitPath: []Ref{}, ManagerChain: []*UserBrief{}, DirectReports: []*UserBrief{}, Teams: c.teamsOf(userID)}
	if unitID != nil {
		t := c.loadUnitTree()
		if u := t.byID[*unitID]; u != nil {
			out.UnitPath = append(t.path(u.ID), Ref{ID: u.ID, Name: u.Name})
		}
	}
	// Walk up the reporting line (bounded, cycle-safe).
	chain := []string{}
	seen := map[string]bool{userID: true}
	cur := userID
	for i := 0; i < 10; i++ {
		var mgr *string
		c.DB().Model(&Person{}).Select("reporting_manager_id").Where("user_id = ? AND org_id = ?", cur, c.P.OrgID).Scan(&mgr)
		if mgr == nil || seen[*mgr] {
			break
		}
		seen[*mgr] = true
		chain = append(chain, *mgr)
		cur = *mgr
	}
	var reports []string
	c.DB().Table("itsm_people p").Joins("JOIN users u ON u.id = p.user_id").
		Where("p.org_id = ? AND p.reporting_manager_id = ? AND u.is_active", c.P.OrgID, userID).
		Order("u.full_name").Limit(200).Pluck("p.user_id", &reports)
	l := c.lookup(append(append([]string{}, chain...), reports...), nil, nil)
	for _, id := range chain {
		if u := l.userS(id); u != nil {
			out.ManagerChain = append(out.ManagerChain, u)
		}
	}
	for _, id := range reports {
		if u := l.userS(id); u != nil {
			out.DirectReports = append(out.DirectReports, u)
		}
	}
	return out
}

// inAnyUnit reports whether the caller belongs to one of units, directly or
// through a sub-unit (someone in Payroll is in Finance when Payroll sits
// under Finance).
func (c *Ctx) inAnyUnit(units []string) bool {
	if c.P.DepartmentID == nil || len(units) == 0 {
		return false
	}
	if c.myUnits == nil {
		c.myUnits = map[string]bool{*c.P.DepartmentID: true}
		for _, r := range c.loadUnitTree().path(*c.P.DepartmentID) {
			c.myUnits[r.ID] = true
		}
	}
	for _, u := range units {
		if c.myUnits[u] {
			return true
		}
	}
	return false
}
