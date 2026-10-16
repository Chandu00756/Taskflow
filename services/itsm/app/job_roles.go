package app

import (
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
)

// Job roles are an organization's designations (Chief Executive Officer,
// Vice President, Manager…) with a seniority level and the role they report
// to. They give the people org chart its hierarchy; permissions stay with
// agent roles.

// JobRole is one designation.
type JobRole struct {
	Base
	Name        string  `gorm:"not null" json:"name"`
	Level       int     `json:"level"`
	ParentID    *string `gorm:"type:uuid;index" json:"parent_id"`
	Description string  `json:"description"`
	Position    int     `json:"position"`
}

// JobRoleRef is the short form shown on people.
type JobRoleRef struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Level int    `json:"level"`
}

type jobRoleSeed struct {
	name, parent, description string
	level                     int
}

func defaultJobRoles() []jobRoleSeed {
	return []jobRoleSeed{
		{"Chief Executive Officer", "", "Leads the organization", 1},
		{"Chief Information Officer", "Chief Executive Officer", "Owns IT strategy and services", 2},
		{"Chief Technology Officer", "Chief Executive Officer", "Owns technology and engineering", 2},
		{"Chief Operating Officer", "Chief Executive Officer", "Runs day-to-day operations", 2},
		{"Chief Financial Officer", "Chief Executive Officer", "Owns finance", 2},
		{"Senior Vice President", "Chief Executive Officer", "Leads a major business area", 3},
		{"Vice President", "Senior Vice President", "Leads a function", 4},
		{"Senior Director", "Vice President", "", 5},
		{"Director", "Senior Director", "", 6},
		{"Senior Manager", "Director", "", 7},
		{"Manager", "Senior Manager", "Manages a team", 8},
		{"Team Lead", "Manager", "Leads day-to-day work of a team", 9},
		{"Senior Specialist", "Team Lead", "Senior engineer, analyst or specialist", 10},
		{"Specialist", "Senior Specialist", "Engineer, analyst or specialist", 11},
		{"Associate", "Specialist", "", 12},
		{"Intern", "Associate", "", 13},
	}
}

// seedJobRoles creates the default designations for an organization that has none.
func seedJobRoles(tx *gorm.DB, orgID string) error {
	var n int64
	tx.Model(&JobRole{}).Where("org_id = ?", orgID).Count(&n)
	if n > 0 {
		return nil
	}
	ids := map[string]string{}
	for i, s := range defaultJobRoles() {
		r := JobRole{Base: Base{OrgID: orgID}, Name: s.name, Level: s.level, Description: s.description, Position: i}
		if s.parent != "" {
			p := ids[s.parent]
			r.ParentID = &p
		}
		if err := tx.Create(&r).Error; err != nil {
			return err
		}
		ids[s.name] = r.ID
	}
	return nil
}

type jobRoleDTO struct {
	JobRole
	PeopleCount int64 `json:"people_count"`
}

// GET /job-roles
func (a *App) listJobRoles(c *Ctx) error {
	var roles []JobRole
	c.T(&JobRole{}).Order("level, position, name").Find(&roles)
	var counts []struct {
		JobRoleID string
		N         int64
	}
	c.DB().Table("itsm_people p").Select("p.job_role_id, count(*) AS n").Joins("JOIN users u ON u.id = p.user_id").
		Where("p.org_id = ? AND p.job_role_id IS NOT NULL AND u.is_active", c.P.OrgID).Group("p.job_role_id").Scan(&counts)
	cm := map[string]int64{}
	for _, x := range counts {
		cm[x.JobRoleID] = x.N
	}
	out := make([]jobRoleDTO, len(roles))
	for i, r := range roles {
		out[i] = jobRoleDTO{JobRole: r, PeopleCount: cm[r.ID]}
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"items": out})
}

func (c *Ctx) jobRoleByID(id string) (*JobRole, bool) {
	var r JobRole
	if !isUUID(id) || c.T(&JobRole{}).Where("id = ?", id).Take(&r).Error != nil {
		return nil, false
	}
	return &r, true
}

// saveJobRole handles POST /job-roles and PUT /job-roles/{id}.
func (a *App) saveJobRole(create bool) handlerFunc {
	return func(c *Ctx) error {
		r := JobRole{Base: Base{OrgID: c.P.OrgID}, Level: 1}
		if !create {
			cur, ok := c.jobRoleByID(c.Param("id"))
			if !ok {
				return errNotFound("job role")
			}
			r = *cur
		}
		var in struct {
			Name        *string `json:"name"`
			Level       *int    `json:"level"`
			ParentID    *string `json:"parent_id"`
			Description *string `json:"description"`
		}
		if err := c.Bind(&in); err != nil {
			return err
		}
		errs := map[string]string{}
		if in.Name != nil {
			r.Name = strings.Join(strings.Fields(*in.Name), " ")
		}
		if r.Name == "" {
			errs["name"] = "is required"
		} else if len(r.Name) > 80 {
			errs["name"] = "must be at most 80 characters"
		} else {
			var n int64
			excl := r.ID
			if excl == "" {
				excl = "00000000-0000-0000-0000-000000000000"
			}
			c.T(&JobRole{}).Where("LOWER(name) = LOWER(?) AND id <> ?", r.Name, excl).Count(&n)
			if n > 0 {
				errs["name"] = "is already used by another job role"
			}
		}
		if in.Description != nil {
			r.Description = strings.TrimSpace(*in.Description)
		}
		if in.ParentID != nil {
			r.ParentID = strPtr(*in.ParentID)
		}
		var parent *JobRole
		if r.ParentID != nil {
			p, ok := c.jobRoleByID(*r.ParentID)
			switch {
			case !ok:
				errs["parent_id"] = "is not a job role in this organization"
			case p.ID == r.ID || (r.ID != "" && c.jobRoleIsBelow(p.ID, r.ID)):
				errs["parent_id"] = "would create a loop in the hierarchy"
			default:
				parent = p
			}
		}
		if in.Level != nil {
			r.Level = *in.Level
		} else if create && parent != nil {
			r.Level = parent.Level + 1
		}
		if r.Level < 1 || r.Level > 30 {
			errs["level"] = "must be between 1 (most senior) and 30"
		} else if parent != nil && parent.Level >= r.Level {
			errs["level"] = "must be below the role it reports to (level " + strconv.Itoa(parent.Level) + ")"
		}
		if len(errs) > 0 {
			return errValidation(errs)
		}
		if create {
			var maxPos int
			c.T(&JobRole{}).Select("COALESCE(MAX(position), 0)").Scan(&maxPos)
			r.Position = maxPos + 1
		}
		if err := saveOnly(c, &r, create); err != nil {
			return err
		}
		c.audit("job_role.saved", "job_role", r.ID, "Saved job role "+r.Name, nil)
		return c.JSON(map[bool]int{true: http.StatusCreated, false: http.StatusOK}[create], r)
	}
}

// jobRoleIsBelow reports whether role id sits somewhere under ancestor.
func (c *Ctx) jobRoleIsBelow(id, ancestor string) bool {
	cur := id
	for i := 0; i < 64 && cur != ""; i++ {
		var r JobRole
		if c.T(&JobRole{}).Where("id = ?", cur).Take(&r).Error != nil || r.ParentID == nil {
			return false
		}
		if *r.ParentID == ancestor {
			return true
		}
		cur = *r.ParentID
	}
	return false
}

// DELETE /job-roles/{id}: people lose the role and roles that reported to it
// move up to its parent.
func (a *App) deleteJobRole(c *Ctx) error {
	r, ok := c.jobRoleByID(c.Param("id"))
	if !ok {
		return errNotFound("job role")
	}
	err := c.DB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&JobRole{}).Where("org_id = ? AND parent_id = ?", c.P.OrgID, r.ID).Update("parent_id", r.ParentID).Error; err != nil {
			return err
		}
		if err := tx.Model(&Person{}).Where("org_id = ? AND job_role_id = ?", c.P.OrgID, r.ID).Update("job_role_id", nil).Error; err != nil {
			return err
		}
		return tx.Delete(r).Error
	})
	if err != nil {
		return err
	}
	c.audit("job_role.deleted", "job_role", r.ID, "Deleted job role "+r.Name, nil)
	return c.JSON(http.StatusOK, map[string]string{"message": "deleted"})
}

// managerLoop reports whether making managerID the manager of userID would
// create a reporting loop.
func (c *Ctx) managerLoop(userID, managerID string) bool {
	cur := managerID
	for i := 0; i < 200 && cur != ""; i++ {
		if cur == userID {
			return true
		}
		var next *string
		c.DB().Table("itsm_people").Select("reporting_manager_id").Where("user_id = ? AND org_id = ?", cur, c.P.OrgID).Scan(&next)
		if next == nil {
			return false
		}
		cur = *next
	}
	return false
}

// GET /org-chart/people: everyone active with their manager, for the people
// org chart. Requesters are included so the chart shows the whole company.
func (a *App) peopleOrgChart(c *Ctx) error {
	// scanned holds the query columns; row is what the chart receives.
	type scanned struct {
		ID        string
		Name      string
		Email     string
		JobTitle  string
		ManagerID *string
		IsAgent   bool
		JobRoleID *string
		DeptID    *string
		AvatarAt  *time.Time
	}
	type row struct {
		ID         string      `json:"id"`
		Name       string      `json:"name"`
		Email      string      `json:"email"`
		JobTitle   string      `json:"job_title"`
		ManagerID  *string     `json:"manager_id"`
		IsAgent    bool        `json:"is_agent"`
		Department *Ref        `json:"department"`
		JobRole    *JobRoleRef `json:"job_role"`
		AvatarURL  string      `json:"avatar_url,omitempty"`
		jobRoleID  *string
		deptID     *string
	}
	var found []scanned
	q := c.DB().Table("users u").
		Select(`u.id, COALESCE(NULLIF(u.full_name, ''), u.username) AS name, u.email, p.job_title, p.reporting_manager_id AS manager_id,
			(p.is_agent OR u.role IN ('org_admin','admin')) AS is_agent, p.job_role_id, p.department_id AS dept_id, av.updated_at AS avatar_at`).
		Joins("JOIN itsm_people p ON p.user_id = u.id").
		Joins("LEFT JOIN itsm_avatars av ON av.user_id = u.id").
		Where("u.org_id = ? AND u.is_active", c.P.OrgID)
	if v := c.Query("department_id"); isUUID(v) {
		q = q.Where("p.department_id = ?", v)
	}
	if err := q.Limit(5000).Scan(&found).Error; err != nil {
		return err
	}
	rows := make([]row, len(found))
	for i, f := range found {
		rows[i] = row{ID: f.ID, Name: f.Name, Email: f.Email, JobTitle: f.JobTitle, ManagerID: f.ManagerID, IsAgent: f.IsAgent, jobRoleID: f.JobRoleID, deptID: f.DeptID}
		if f.AvatarAt != nil {
			rows[i].AvatarURL = avatarURL(f.ID, *f.AvatarAt)
		}
	}
	var roles []JobRole
	c.T(&JobRole{}).Find(&roles)
	rm := map[string]JobRole{}
	for _, r := range roles {
		rm[r.ID] = r
	}
	var deptIDs []string
	for _, r := range rows {
		deptIDs = append(deptIDs, deref(r.deptID))
	}
	l := c.lookup(nil, nil, deptIDs)
	ids := map[string]bool{}
	for _, r := range rows {
		ids[r.ID] = true
	}
	for i := range rows {
		r := &rows[i]
		if r.jobRoleID != nil {
			if jr, ok := rm[*r.jobRoleID]; ok {
				r.JobRole = &JobRoleRef{ID: jr.ID, Name: jr.Name, Level: jr.Level}
			}
		}
		r.Department = l.dept(r.deptID)
		// Managers outside the filtered set (or deactivated) make the person a root.
		if r.ManagerID != nil && !ids[*r.ManagerID] {
			r.ManagerID = nil
		}
	}
	level := func(r row) int {
		if r.JobRole != nil {
			return r.JobRole.Level
		}
		return 99
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if level(rows[i]) != level(rows[j]) {
			return level(rows[i]) < level(rows[j])
		}
		return strings.ToLower(rows[i].Name) < strings.ToLower(rows[j].Name)
	})
	return c.JSON(http.StatusOK, map[string]interface{}{"items": rows})
}
