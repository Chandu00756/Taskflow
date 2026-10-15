package app

import (
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
)

// ---------------------------------------------------------------------------
// Project management: projects, work items (board / list) and cycles
// ---------------------------------------------------------------------------

var (
	workItemStates     = []string{"backlog", "todo", "in_progress", "done", "cancelled"}
	workItemPriorities = []string{"urgent", "high", "medium", "low", "none"}
	projectStatuses    = []string{"planned", "active", "on_hold", "completed"}
	projectKeyRe       = regexp.MustCompile(`^[A-Z][A-Z0-9]{1,9}$`)
	workItemRefRe      = regexp.MustCompile(`^(?:[A-Za-z][A-Za-z0-9]*-)?(\d{1,9})$`)
	projectColors      = []string{"#2563eb", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0891b2", "#ca8a04", "#4f46e5"}
)

const maxBoardItems = 2000

type projectPerms struct {
	view, edit, manage, member bool
}

// projectPerms resolves what the caller may do in a project. Public projects
// are visible to every agent; members edit work items; the lead and holders
// of the projects privilege manage the project itself.
func (c *Ctx) projectPerms(p *Project) projectPerms {
	if !c.P.IsAgent {
		return projectPerms{}
	}
	lead := deref(p.LeadID) == c.P.UserID
	member := lead || containsString(stringsFrom(p.MemberIDs), c.P.UserID)
	admin := c.P.Can(PrivProjectsManage)
	perms := projectPerms{member: member}
	perms.view = admin || member || p.Visibility != "private"
	perms.manage = admin || lead
	perms.edit = !p.Archived && (perms.manage || member)
	return perms
}

func containsString(list []string, v string) bool {
	for _, s := range list {
		if s == v {
			return true
		}
	}
	return false
}

func (c *Ctx) loadProject(id string) (*Project, projectPerms, error) {
	var p Project
	if !isUUID(id) || c.T(&Project{}).Where("id = ?", id).Take(&p).Error != nil {
		return nil, projectPerms{}, errNotFound("project")
	}
	perms := c.projectPerms(&p)
	if !perms.view {
		return nil, perms, errNotFound("project")
	}
	return &p, perms, nil
}

func (c *Ctx) loadWorkItem(id string) (*WorkItem, *Project, projectPerms, error) {
	var w WorkItem
	if !isUUID(id) || c.T(&WorkItem{}).Where("id = ?", id).Take(&w).Error != nil {
		return nil, nil, projectPerms{}, errNotFound("work item")
	}
	p, perms, err := c.loadProject(w.ProjectID)
	if err != nil {
		return nil, nil, perms, errNotFound("work item")
	}
	return &w, p, perms, nil
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

// ProjectDTO enriches a project with people and progress.
type ProjectDTO struct {
	*Project
	Lead       *UserBrief       `json:"lead"`
	Members    []*UserBrief     `json:"members"`
	MemberIDs  []string         `json:"member_ids"`
	Counts     map[string]int64 `json:"counts"`
	TotalItems int64            `json:"total_items"`
	OpenItems  int64            `json:"open_items"`
	Progress   int              `json:"progress"`
	CanEdit    bool             `json:"can_edit"`
	CanManage  bool             `json:"can_manage"`
	IsMember   bool             `json:"is_member"`
}

func (c *Ctx) projectDTOs(items []Project) []ProjectDTO {
	var uids, ids []string
	for _, p := range items {
		uids = append(uids, deref(p.LeadID))
		uids = append(uids, stringsFrom(p.MemberIDs)...)
		ids = append(ids, p.ID)
	}
	l := c.lookup(uids, nil, nil)
	counts := map[string]map[string]int64{}
	if len(ids) > 0 {
		var rows []struct {
			ProjectID string
			State     string
			N         int64
		}
		c.DB().Raw(`SELECT project_id, state, count(*) AS n FROM itsm_work_items
			WHERE org_id = ? AND project_id IN ? GROUP BY project_id, state`, c.P.OrgID, ids).Scan(&rows)
		for _, r := range rows {
			if counts[r.ProjectID] == nil {
				counts[r.ProjectID] = map[string]int64{}
			}
			counts[r.ProjectID][r.State] = r.N
		}
	}
	out := make([]ProjectDTO, len(items))
	for i := range items {
		p := &items[i]
		perms := c.projectPerms(p)
		memberIDs := stringsFrom(p.MemberIDs)
		members := []*UserBrief{}
		for _, id := range memberIDs {
			if u := l.userS(id); u != nil {
				members = append(members, u)
			}
		}
		cs := counts[p.ID]
		if cs == nil {
			cs = map[string]int64{}
		}
		var total int64
		for _, n := range cs {
			total += n
		}
		progress := 0
		if active := total - cs["cancelled"]; active > 0 {
			progress = int(cs["done"] * 100 / active)
		}
		out[i] = ProjectDTO{Project: p, Lead: l.user(p.LeadID), Members: members, MemberIDs: memberIDs, Counts: cs,
			TotalItems: total, OpenItems: total - cs["done"] - cs["cancelled"], Progress: progress,
			CanEdit: perms.edit, CanManage: perms.manage, IsMember: perms.member}
	}
	return out
}

func (a *App) listProjects(c *Ctx) error {
	q := c.T(&Project{}).Where("archived = ?", c.Query("archived") == "true")
	if !c.P.Can(PrivProjectsManage) {
		q = q.Where("(visibility <> 'private' OR lead_id = ? OR member_ids @> ?::jsonb)", c.P.UserID, string(jsonOf([]string{c.P.UserID})))
	}
	if v := strings.TrimSpace(c.Query("q")); v != "" {
		like := likeEscape(v)
		q = q.Where("(name ILIKE ? OR key ILIKE ?)", like, like)
	}
	var items []Project
	if err := q.Order("name ASC").Limit(500).Find(&items).Error; err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"items": c.projectDTOs(items)})
}

type projectInput struct {
	Key         *string   `json:"key"`
	Name        *string   `json:"name"`
	Description *string   `json:"description"`
	Color       *string   `json:"color"`
	Status      *string   `json:"status"`
	Visibility  *string   `json:"visibility"`
	LeadID      *string   `json:"lead_id"`
	MemberIDs   *[]string `json:"member_ids"`
	StartDate   *string   `json:"start_date"`
	EndDate     *string   `json:"end_date"`
	Archived    *bool     `json:"archived"`
}

// deriveProjectKey builds an identifier such as "KAIRV" from a project name.
func deriveProjectKey(name string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(name) {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	key := b.String()
	if key == "" || key[0] < 'A' || key[0] > 'Z' {
		key = "P" + key
	}
	if len(key) > 5 {
		key = key[:5]
	}
	if len(key) < 2 {
		key = "PRJ"
	}
	return key
}

func (c *Ctx) projectKeyTaken(key, exceptID string) bool {
	q := c.T(&Project{}).Where("key = ?", key)
	if exceptID != "" {
		q = q.Where("id <> ?", exceptID)
	}
	var n int64
	q.Count(&n)
	return n > 0
}

func (c *Ctx) applyProjectInput(p *Project, in *projectInput) map[string]string {
	errs := map[string]string{}
	if in.Name != nil {
		p.Name = strings.TrimSpace(*in.Name)
	}
	if p.Name == "" {
		errs["name"] = "is required"
	} else if len(p.Name) > 120 {
		errs["name"] = "must be at most 120 characters"
	}
	if in.Key != nil {
		key := strings.ToUpper(strings.TrimSpace(*in.Key))
		switch {
		case key == "" && p.Key == "":
		case !projectKeyRe.MatchString(key):
			errs["key"] = "must be 2-10 letters or digits and start with a letter"
		case c.projectKeyTaken(key, p.ID):
			errs["key"] = "is already used by another project"
		default:
			p.Key = key
		}
	}
	if p.Key == "" && p.Name != "" {
		base := deriveProjectKey(p.Name)
		key := base
		for i := 2; c.projectKeyTaken(key, p.ID) && i < 100; i++ {
			suffix := strconv.Itoa(i)
			trimmed := base
			if len(trimmed)+len(suffix) > 10 {
				trimmed = trimmed[:10-len(suffix)]
			}
			key = trimmed + suffix
		}
		p.Key = key
	}
	setText(&p.Description, in.Description)
	if in.Color != nil {
		if !hexColor.MatchString(*in.Color) {
			errs["color"] = "must be a hex color such as #2563eb"
		} else {
			p.Color = strings.ToLower(*in.Color)
		}
	}
	if in.Status != nil {
		if !oneOf(*in.Status, projectStatuses...) {
			errs["status"] = "must be one of " + strings.Join(projectStatuses, ", ")
		} else {
			p.Status = *in.Status
		}
	}
	if in.Visibility != nil {
		if !oneOf(*in.Visibility, "public", "private") {
			errs["visibility"] = "must be public or private"
		} else {
			p.Visibility = *in.Visibility
		}
	}
	if in.LeadID != nil {
		if *in.LeadID == "" {
			p.LeadID = nil
		} else if !c.agentInOrg(*in.LeadID) {
			errs["lead_id"] = "must be an agent"
		} else {
			p.LeadID = strPtr(*in.LeadID)
		}
	}
	members := stringsFrom(p.MemberIDs)
	if in.MemberIDs != nil {
		members = []string{}
		for _, id := range uniq(*in.MemberIDs) {
			if !c.agentInOrg(id) {
				errs["member_ids"] = "must all be agents"
				break
			}
			members = append(members, id)
		}
	}
	if p.LeadID != nil && !containsString(members, *p.LeadID) {
		members = append(members, *p.LeadID)
	}
	p.MemberIDs = jsonOf(members)
	setTime(errs, "start_date", &p.StartDate, in.StartDate)
	setTime(errs, "end_date", &p.EndDate, in.EndDate)
	if p.StartDate != nil && p.EndDate != nil && p.EndDate.Before(*p.StartDate) {
		errs["end_date"] = "must be on or after the start date"
	}
	if in.Archived != nil {
		p.Archived = *in.Archived
	}
	return errs
}

func (a *App) createProject(c *Ctx) error {
	var in projectInput
	if err := c.Bind(&in); err != nil {
		return err
	}
	var count int64
	c.T(&Project{}).Count(&count)
	p := Project{Base: Base{OrgID: c.P.OrgID}, Status: "active", Visibility: "public",
		Color: projectColors[int(count)%len(projectColors)], MemberIDs: jsonOf([]string{}), CreatedByID: c.P.UserID}
	if in.LeadID == nil {
		in.LeadID = strPtr(c.P.UserID)
	}
	if in.MemberIDs != nil && !containsString(*in.MemberIDs, c.P.UserID) {
		ids := append(*in.MemberIDs, c.P.UserID)
		in.MemberIDs = &ids
	}
	in.Archived = nil
	if errs := c.applyProjectInput(&p, &in); len(errs) > 0 {
		return errValidation(errs)
	}
	if err := c.DB().Create(&p).Error; err != nil {
		if strings.Contains(err.Error(), "ux_itsm_projects_key") {
			return errValidation(map[string]string{"key": "is already used by another project"})
		}
		return err
	}
	c.audit("project.created", "project", p.ID, "Created project "+p.Name, map[string]string{"key": p.Key})
	return c.JSON(http.StatusCreated, c.projectDTOs([]Project{p})[0])
}

func (a *App) getProject(c *Ctx) error {
	p, _, err := c.loadProject(c.Param("id"))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, c.projectDTOs([]Project{*p})[0])
}

func (a *App) updateProject(c *Ctx) error {
	p, perms, err := c.loadProject(c.Param("id"))
	if err != nil {
		return err
	}
	if !perms.manage {
		return errForbidden("only the project lead or a project administrator can change project settings")
	}
	var in projectInput
	if err := c.Bind(&in); err != nil {
		return err
	}
	before := *p
	if errs := c.applyProjectInput(p, &in); len(errs) > 0 {
		return errValidation(errs)
	}
	if err := c.DB().Save(p).Error; err != nil {
		if strings.Contains(err.Error(), "ux_itsm_projects_key") {
			return errValidation(map[string]string{"key": "is already used by another project"})
		}
		return err
	}
	if before.Archived != p.Archived {
		verb := map[bool]string{true: "Archived", false: "Restored"}[p.Archived]
		c.audit("project.archived", "project", p.ID, verb+" project "+p.Name, nil)
	}
	for _, id := range stringsFrom(p.MemberIDs) {
		if id != c.P.UserID && !containsString(stringsFrom(before.MemberIDs), id) {
			notify(c.DB(), id, "project_member_added", "You were added to project "+p.Name, p.Description, map[string]string{"project_id": p.ID})
		}
	}
	return c.JSON(http.StatusOK, c.projectDTOs([]Project{*p})[0])
}

// deleteWorkItemsTx removes work items and everything attached to them.
func deleteWorkItemsTx(tx *gorm.DB, orgID string, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	var convIDs []string
	tx.Model(&Conversation{}).Where("org_id = ? AND entity_type = 'work_item' AND entity_id IN ?", orgID, ids).Pluck("id", &convIDs)
	if len(convIDs) > 0 {
		if err := tx.Where("org_id = ? AND entity_type = 'conversation' AND entity_id IN ?", orgID, convIDs).Delete(&Attachment{}).Error; err != nil {
			return err
		}
	}
	steps := []struct {
		model interface{}
		where string
	}{
		{&Conversation{}, "entity_type = 'work_item' AND entity_id IN ?"},
		{&Activity{}, "entity_type = 'work_item' AND entity_id IN ?"},
		{&Attachment{}, "entity_type = 'work_item' AND entity_id IN ?"},
		{&WorkTask{}, "entity_type = 'work_item' AND entity_id IN ?"},
		{&TimeEntry{}, "entity_type = 'work_item' AND entity_id IN ?"},
	}
	for _, s := range steps {
		if err := tx.Where("org_id = ? AND "+s.where, orgID, ids).Delete(s.model).Error; err != nil {
			return err
		}
	}
	if err := tx.Where("org_id = ? AND ((source_type = 'work_item' AND source_id IN ?) OR (target_type = 'work_item' AND target_id IN ?))", orgID, ids, ids).Delete(&Link{}).Error; err != nil {
		return err
	}
	if err := tx.Model(&WorkItem{}).Where("org_id = ? AND parent_id IN ?", orgID, ids).Update("parent_id", nil).Error; err != nil {
		return err
	}
	return tx.Where("org_id = ? AND id IN ?", orgID, ids).Delete(&WorkItem{}).Error
}

func (a *App) deleteProject(c *Ctx) error {
	p, _, err := c.loadProject(c.Param("id"))
	if err != nil {
		return err
	}
	err = c.DB().Transaction(func(tx *gorm.DB) error {
		var ids []string
		tx.Model(&WorkItem{}).Where("org_id = ? AND project_id = ?", c.P.OrgID, p.ID).Pluck("id", &ids)
		if err := deleteWorkItemsTx(tx, c.P.OrgID, ids); err != nil {
			return err
		}
		if err := tx.Where("org_id = ? AND project_id = ?", c.P.OrgID, p.ID).Delete(&Cycle{}).Error; err != nil {
			return err
		}
		tx.Where("org_id = ? AND entity = ?", c.P.OrgID, "work_item:"+p.ID).Delete(&Counter{})
		return tx.Delete(p).Error
	})
	if err != nil {
		return err
	}
	c.audit("project.deleted", "project", p.ID, "Deleted project "+p.Name, map[string]string{"key": p.Key})
	return c.JSON(http.StatusOK, map[string]string{"message": "project deleted"})
}

// ---------------------------------------------------------------------------
// Work items
// ---------------------------------------------------------------------------

// WorkItemBrief is a compact reference to a work item.
type WorkItemBrief struct {
	ID        string `json:"id"`
	DisplayID string `json:"display_id"`
	Title     string `json:"title"`
	State     string `json:"state"`
}

// ProjectBrief is a compact reference to a project.
type ProjectBrief struct {
	ID    string `json:"id"`
	Key   string `json:"key"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

// WorkItemDTO enriches a work item for boards and detail views.
type WorkItemDTO struct {
	*WorkItem
	DisplayID    string         `json:"display_id"`
	Assignee     *UserBrief     `json:"assignee"`
	Reporter     *UserBrief     `json:"reporter"`
	Labels       []string       `json:"labels"`
	Cycle        *Ref           `json:"cycle"`
	Parent       *WorkItemBrief `json:"parent"`
	Project      *ProjectBrief  `json:"project"`
	SubItems     int64          `json:"sub_items"`
	SubItemsDone int64          `json:"sub_items_done"`
	Comments     int64          `json:"comments"`
	Links        int64          `json:"links"`
}

func (c *Ctx) workItemDTOs(items []WorkItem) []WorkItemDTO {
	if len(items) == 0 {
		return []WorkItemDTO{}
	}
	var uids, ids, projectIDs, cycleIDs, parentIDs []string
	for _, w := range items {
		uids = append(uids, deref(w.AssigneeID), w.ReporterID)
		ids = append(ids, w.ID)
		projectIDs = append(projectIDs, w.ProjectID)
		if w.CycleID != nil {
			cycleIDs = append(cycleIDs, *w.CycleID)
		}
		if w.ParentID != nil {
			parentIDs = append(parentIDs, *w.ParentID)
		}
	}
	l := c.lookup(uids, nil, nil)

	projects := map[string]*ProjectBrief{}
	var prows []Project
	c.T(&Project{}).Select("id, key, name, color").Where("id IN ?", uniq(projectIDs)).Find(&prows)
	for _, p := range prows {
		projects[p.ID] = &ProjectBrief{ID: p.ID, Key: p.Key, Name: p.Name, Color: p.Color}
	}
	keyOf := func(projectID string) string {
		if p := projects[projectID]; p != nil {
			return p.Key
		}
		return "ITEM"
	}

	cycles := map[string]*Ref{}
	if len(cycleIDs) > 0 {
		var crows []Cycle
		c.T(&Cycle{}).Select("id, name").Where("id IN ?", uniq(cycleIDs)).Find(&crows)
		for _, cy := range crows {
			cycles[cy.ID] = &Ref{ID: cy.ID, Name: cy.Name}
		}
	}
	parents := map[string]*WorkItemBrief{}
	if len(parentIDs) > 0 {
		var rows []WorkItem
		c.T(&WorkItem{}).Select("id, project_id, number, title, state").Where("id IN ?", uniq(parentIDs)).Find(&rows)
		for _, r := range rows {
			parents[r.ID] = &WorkItemBrief{ID: r.ID, DisplayID: displayID(keyOf(r.ProjectID), r.Number), Title: r.Title, State: r.State}
		}
	}
	type countRow struct {
		ID   string
		N    int64
		Done int64
	}
	subs := map[string]countRow{}
	var srows []countRow
	c.DB().Raw(`SELECT parent_id AS id, count(*) AS n, count(*) FILTER (WHERE state IN ('done','cancelled')) AS done
		FROM itsm_work_items WHERE org_id = ? AND parent_id IN ? GROUP BY parent_id`, c.P.OrgID, ids).Scan(&srows)
	for _, r := range srows {
		subs[r.ID] = r
	}
	comments := map[string]int64{}
	var crows []countRow
	c.DB().Raw(`SELECT entity_id AS id, count(*) AS n FROM itsm_conversations
		WHERE org_id = ? AND entity_type = 'work_item' AND entity_id IN ? GROUP BY entity_id`, c.P.OrgID, ids).Scan(&crows)
	for _, r := range crows {
		comments[r.ID] = r.N
	}
	links := map[string]int64{}
	var lrows []countRow
	c.DB().Raw(`SELECT x.id, count(*) AS n FROM (
			SELECT source_id AS id FROM itsm_links WHERE org_id = ? AND source_type = 'work_item' AND source_id IN ?
			UNION ALL SELECT target_id AS id FROM itsm_links WHERE org_id = ? AND target_type = 'work_item' AND target_id IN ?
		) x GROUP BY x.id`, c.P.OrgID, ids, c.P.OrgID, ids).Scan(&lrows)
	for _, r := range lrows {
		links[r.ID] = r.N
	}

	out := make([]WorkItemDTO, len(items))
	for i := range items {
		w := &items[i]
		dto := WorkItemDTO{WorkItem: w, DisplayID: displayID(keyOf(w.ProjectID), w.Number), Assignee: l.user(w.AssigneeID),
			Reporter: l.userS(w.ReporterID), Labels: stringsFrom(w.Labels), Project: projects[w.ProjectID],
			SubItems: subs[w.ID].N, SubItemsDone: subs[w.ID].Done, Comments: comments[w.ID], Links: links[w.ID]}
		if w.CycleID != nil {
			dto.Cycle = cycles[*w.CycleID]
		}
		if w.ParentID != nil {
			dto.Parent = parents[*w.ParentID]
		}
		out[i] = dto
	}
	return out
}

func splitParam(v string) []string {
	out := []string{}
	for _, s := range strings.Split(v, ",") {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func (a *App) listWorkItems(c *Ctx) error {
	p, _, err := c.loadProject(c.Param("id"))
	if err != nil {
		return err
	}
	q := c.T(&WorkItem{}).Where("project_id = ?", p.ID)
	if v := splitParam(c.Query("state")); len(v) > 0 {
		q = q.Where("state IN ?", v)
	}
	if v := splitParam(c.Query("priority")); len(v) > 0 {
		q = q.Where("priority IN ?", v)
	}
	switch v := c.Query("assignee_id"); {
	case v == "me":
		q = q.Where("assignee_id = ?", c.P.UserID)
	case v == "none":
		q = q.Where("assignee_id IS NULL")
	case isUUID(v):
		q = q.Where("assignee_id = ?", v)
	}
	switch v := c.Query("cycle_id"); {
	case v == "none":
		q = q.Where("cycle_id IS NULL")
	case isUUID(v):
		q = q.Where("cycle_id = ?", v)
	}
	switch v := c.Query("parent_id"); {
	case v == "none":
		q = q.Where("parent_id IS NULL")
	case isUUID(v):
		q = q.Where("parent_id = ?", v)
	}
	if v := strings.TrimSpace(strings.ToLower(c.Query("label"))); v != "" {
		q = q.Where("labels @> ?::jsonb", string(jsonOf([]string{v})))
	}
	if v := strings.TrimSpace(c.Query("q")); v != "" {
		like := likeEscape(v)
		if m := workItemRefRe.FindStringSubmatch(v); m != nil {
			n, _ := strconv.ParseInt(m[1], 10, 64)
			q = q.Where("(number = ? OR title ILIKE ?)", n, like)
		} else {
			q = q.Where("(title ILIKE ? OR description ILIKE ?)", like, like)
		}
	}
	var items []WorkItem
	if err := q.Order("sort_order ASC, number ASC").Limit(maxBoardItems).Find(&items).Error; err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"items": c.workItemDTOs(items), "total": len(items)})
}

type workItemInput struct {
	Title       *string   `json:"title"`
	Description *string   `json:"description"`
	State       *string   `json:"state"`
	Priority    *string   `json:"priority"`
	AssigneeID  *string   `json:"assignee_id"`
	ParentID    *string   `json:"parent_id"`
	CycleID     *string   `json:"cycle_id"`
	Labels      *[]string `json:"labels"`
	Estimate    *int      `json:"estimate"`
	StartDate   *string   `json:"start_date"`
	DueDate     *string   `json:"due_date"`
	SortOrder   *float64  `json:"sort_order"`
	TicketID    string    `json:"ticket_id"`
}

func (c *Ctx) applyWorkItemInput(w *WorkItem, p *Project, in *workItemInput) map[string]string {
	errs := map[string]string{}
	if in.Title != nil {
		w.Title = strings.TrimSpace(*in.Title)
	}
	if w.Title == "" {
		errs["title"] = "is required"
	} else if len(w.Title) > 255 {
		errs["title"] = "must be at most 255 characters"
	}
	setText(&w.Description, in.Description)
	if in.State != nil {
		if !oneOf(*in.State, workItemStates...) {
			errs["state"] = "must be one of " + strings.Join(workItemStates, ", ")
		} else {
			if *in.State == "done" && w.State != "done" {
				n := now()
				w.CompletedAt = &n
			} else if *in.State != "done" {
				w.CompletedAt = nil
			}
			w.State = *in.State
		}
	}
	if in.Priority != nil {
		if !oneOf(*in.Priority, workItemPriorities...) {
			errs["priority"] = "must be one of " + strings.Join(workItemPriorities, ", ")
		} else {
			w.Priority = *in.Priority
		}
	}
	if in.AssigneeID != nil {
		members := stringsFrom(p.MemberIDs)
		switch {
		case *in.AssigneeID == "":
			w.AssigneeID = nil
		case !containsString(members, *in.AssigneeID) && deref(p.LeadID) != *in.AssigneeID:
			errs["assignee_id"] = "must be a member of the project"
		case !c.agentInOrg(*in.AssigneeID):
			errs["assignee_id"] = "must be an active agent"
		default:
			w.AssigneeID = strPtr(*in.AssigneeID)
		}
	}
	if in.ParentID != nil {
		if *in.ParentID == "" {
			w.ParentID = nil
		} else if err := c.validParent(w, *in.ParentID); err != "" {
			errs["parent_id"] = err
		} else {
			w.ParentID = strPtr(*in.ParentID)
		}
	}
	if in.CycleID != nil {
		if *in.CycleID == "" {
			w.CycleID = nil
		} else {
			var n int64
			if isUUID(*in.CycleID) {
				c.T(&Cycle{}).Where("id = ? AND project_id = ?", *in.CycleID, p.ID).Count(&n)
			}
			if n == 0 {
				errs["cycle_id"] = "must be a cycle in this project"
			} else {
				w.CycleID = strPtr(*in.CycleID)
			}
		}
	}
	if in.Labels != nil {
		w.Labels = jsonOf(normalizeTags(*in.Labels))
	}
	if in.Estimate != nil {
		switch {
		case *in.Estimate == 0:
			w.Estimate = nil
		case *in.Estimate < 0 || *in.Estimate > 1000:
			errs["estimate"] = "must be between 1 and 1000 points"
		default:
			v := *in.Estimate
			w.Estimate = &v
		}
	}
	setTime(errs, "start_date", &w.StartDate, in.StartDate)
	setTime(errs, "due_date", &w.DueDate, in.DueDate)
	if w.StartDate != nil && w.DueDate != nil && w.DueDate.Before(*w.StartDate) {
		errs["due_date"] = "must be on or after the start date"
	}
	if in.SortOrder != nil {
		w.SortOrder = *in.SortOrder
	}
	return errs
}

// validParent checks that a parent belongs to the same project and that the
// assignment does not create a loop.
func (c *Ctx) validParent(w *WorkItem, parentID string) string {
	if !isUUID(parentID) {
		return "is invalid"
	}
	if parentID == w.ID {
		return "cannot be the work item itself"
	}
	cur := parentID
	for depth := 0; depth < 50; depth++ {
		var row WorkItem
		if c.T(&WorkItem{}).Select("id, project_id, parent_id").Where("id = ?", cur).Take(&row).Error != nil {
			return "is invalid"
		}
		if depth == 0 && row.ProjectID != w.ProjectID {
			return "must be in the same project"
		}
		if w.ID != "" && row.ID == w.ID {
			return "would create a loop"
		}
		if row.ParentID == nil {
			return ""
		}
		cur = *row.ParentID
	}
	return "is nested too deeply"
}

func (c *Ctx) nextSortOrder(projectID, state string) float64 {
	var max *float64
	c.T(&WorkItem{}).Where("project_id = ? AND state = ?", projectID, state).Select("max(sort_order)").Scan(&max)
	if max == nil {
		return 65535
	}
	return *max + 65535
}

func (a *App) createWorkItem(c *Ctx) error {
	p, perms, err := c.loadProject(c.Param("id"))
	if err != nil {
		return err
	}
	if !perms.edit {
		return errForbidden("only project members can add work items")
	}
	var in workItemInput
	if err := c.Bind(&in); err != nil {
		return err
	}
	w := WorkItem{Base: Base{OrgID: c.P.OrgID}, ProjectID: p.ID, State: "todo", Priority: "none", ReporterID: c.P.UserID, Labels: jsonOf([]string{})}
	if errs := c.applyWorkItemInput(&w, p, &in); len(errs) > 0 {
		return errValidation(errs)
	}
	if in.SortOrder == nil {
		w.SortOrder = c.nextSortOrder(p.ID, w.State)
	}
	var ticket *Ticket
	if in.TicketID != "" {
		t, err := c.loadTicket(in.TicketID)
		if err != nil {
			return errValidation(map[string]string{"ticket_id": "is invalid"})
		}
		ticket = t
		if w.Description == "" {
			w.Description = t.Description
		}
	}
	err = c.DB().Transaction(func(tx *gorm.DB) error {
		n, err := nextNumber(tx, c.P.OrgID, "work_item:"+p.ID)
		if err != nil {
			return err
		}
		w.Number = n
		if err := tx.Create(&w).Error; err != nil {
			return err
		}
		c.activity(tx, "work_item", w.ID, "created", "created the work item", nil)
		if ticket != nil {
			tx.Create(&Link{Base: Base{OrgID: c.P.OrgID}, SourceType: "work_item", SourceID: w.ID, TargetType: "ticket", TargetID: ticket.ID, LinkType: "related"})
			c.activity(tx, "ticket", ticket.ID, "linked", "created work item "+displayID(p.Key, w.Number)+" in "+p.Name, nil)
		}
		return nil
	})
	if err != nil {
		return err
	}
	c.notifyWorkItemAssignee(p, &w)
	return c.JSON(http.StatusCreated, c.workItemDTOs([]WorkItem{w})[0])
}

func (c *Ctx) notifyWorkItemAssignee(p *Project, w *WorkItem) {
	if w.AssigneeID == nil || *w.AssigneeID == c.P.UserID {
		return
	}
	notify(c.DB(), *w.AssigneeID, "work_item_assigned", displayID(p.Key, w.Number)+" assigned to you", w.Title,
		map[string]string{"work_item_id": w.ID, "project_id": p.ID})
}

// WorkItemDetail adds permissions to the work item representation.
type WorkItemDetail struct {
	WorkItemDTO
	CanEdit bool `json:"can_edit"`
}

func (a *App) getWorkItem(c *Ctx) error {
	w, _, perms, err := c.loadWorkItem(c.Param("id"))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, WorkItemDetail{WorkItemDTO: c.workItemDTOs([]WorkItem{*w})[0], CanEdit: perms.edit})
}

var workItemLabels = map[string]string{
	"backlog": "Backlog", "todo": "Todo", "in_progress": "In Progress", "done": "Done", "cancelled": "Cancelled",
}

func (a *App) updateWorkItem(c *Ctx) error {
	w, p, perms, err := c.loadWorkItem(c.Param("id"))
	if err != nil {
		return err
	}
	if !perms.edit {
		return errForbidden("only project members can change work items")
	}
	var in workItemInput
	if err := c.Bind(&in); err != nil {
		return err
	}
	before := *w
	if errs := c.applyWorkItemInput(w, p, &in); len(errs) > 0 {
		return errValidation(errs)
	}
	if in.State != nil && *in.State != before.State && in.SortOrder == nil {
		w.SortOrder = c.nextSortOrder(p.ID, w.State)
	}
	changes := diffFields(before, *w, "title", "state", "priority", "assignee_id", "cycle_id", "parent_id", "estimate", "start_date", "due_date", "labels")
	err = c.DB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(w).Error; err != nil {
			return err
		}
		if len(changes) > 0 {
			summary := "updated the work item"
			if len(changes) == 1 && changes[0].Field == "state" {
				summary = "moved the work item to " + workItemLabels[w.State]
			}
			c.activity(tx, "work_item", w.ID, "updated", summary, changes)
		} else if before.Description != w.Description {
			c.activity(tx, "work_item", w.ID, "updated", "updated the description", nil)
		}
		return nil
	})
	if err != nil {
		return err
	}
	if deref(before.AssigneeID) != deref(w.AssigneeID) {
		c.notifyWorkItemAssignee(p, w)
	}
	return c.JSON(http.StatusOK, WorkItemDetail{WorkItemDTO: c.workItemDTOs([]WorkItem{*w})[0], CanEdit: perms.edit})
}

func (a *App) deleteWorkItem(c *Ctx) error {
	w, p, perms, err := c.loadWorkItem(c.Param("id"))
	if err != nil {
		return err
	}
	if !perms.edit {
		return errForbidden("only project members can delete work items")
	}
	if err := c.DB().Transaction(func(tx *gorm.DB) error {
		return deleteWorkItemsTx(tx, c.P.OrgID, []string{w.ID})
	}); err != nil {
		return err
	}
	c.audit("work_item.deleted", "work_item", w.ID, "Deleted "+displayID(p.Key, w.Number)+" "+w.Title, nil)
	return c.JSON(http.StatusOK, map[string]string{"message": "work item deleted"})
}

func (a *App) myWorkItems(c *Ctx) error {
	q := c.T(&WorkItem{}).Where("assignee_id = ?", c.P.UserID)
	if c.Query("state") != "all" {
		q = q.Where("state NOT IN ?", []string{"done", "cancelled"})
	}
	var items []WorkItem
	if err := q.Order("due_date ASC NULLS LAST, updated_at DESC").Limit(500).Find(&items).Error; err != nil {
		return err
	}
	// Drop items from archived projects or projects the agent can no longer see.
	ids := []string{}
	for _, w := range items {
		ids = append(ids, w.ProjectID)
	}
	var projects []Project
	if len(ids) > 0 {
		c.T(&Project{}).Where("id IN ?", uniq(ids)).Find(&projects)
	}
	visible := map[string]bool{}
	for i := range projects {
		if !projects[i].Archived && c.projectPerms(&projects[i]).view {
			visible[projects[i].ID] = true
		}
	}
	out := items[:0]
	for _, w := range items {
		if visible[w.ProjectID] {
			out = append(out, w)
		}
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"items": c.workItemDTOs(out)})
}

// ---------------------------------------------------------------------------
// Cycles
// ---------------------------------------------------------------------------

// CycleDTO adds progress and a derived status to a cycle.
type CycleDTO struct {
	*Cycle
	Status   string `json:"status"`
	Total    int64  `json:"total"`
	Done     int64  `json:"done"`
	Progress int    `json:"progress"`
}

func cycleStatus(cy *Cycle, at time.Time) string {
	switch {
	case cy.StartDate == nil || cy.EndDate == nil:
		return "draft"
	case at.Before(*cy.StartDate):
		return "upcoming"
	case at.After(cy.EndDate.Add(24 * time.Hour)):
		return "completed"
	default:
		return "current"
	}
}

func (c *Ctx) cycleDTOs(items []Cycle) []CycleDTO {
	ids := []string{}
	for _, cy := range items {
		ids = append(ids, cy.ID)
	}
	type row struct {
		CycleID   string
		Total     int64
		Done      int64
		Cancelled int64
	}
	stats := map[string]row{}
	if len(ids) > 0 {
		var rows []row
		c.DB().Raw(`SELECT cycle_id, count(*) AS total,
				count(*) FILTER (WHERE state = 'done') AS done,
				count(*) FILTER (WHERE state = 'cancelled') AS cancelled
			FROM itsm_work_items WHERE org_id = ? AND cycle_id IN ? GROUP BY cycle_id`, c.P.OrgID, ids).Scan(&rows)
		for _, r := range rows {
			stats[r.CycleID] = r
		}
	}
	at := now()
	out := make([]CycleDTO, len(items))
	for i := range items {
		s := stats[items[i].ID]
		progress := 0
		if active := s.Total - s.Cancelled; active > 0 {
			progress = int(s.Done * 100 / active)
		}
		out[i] = CycleDTO{Cycle: &items[i], Status: cycleStatus(&items[i], at), Total: s.Total, Done: s.Done, Progress: progress}
	}
	return out
}

func (a *App) listCycles(c *Ctx) error {
	p, _, err := c.loadProject(c.Param("id"))
	if err != nil {
		return err
	}
	var items []Cycle
	if err := c.T(&Cycle{}).Where("project_id = ?", p.ID).Order("start_date DESC NULLS FIRST, created_at DESC").Find(&items).Error; err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"items": c.cycleDTOs(items)})
}

type cycleInput struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
	StartDate   *string `json:"start_date"`
	EndDate     *string `json:"end_date"`
}

func (c *Ctx) applyCycleInput(cy *Cycle, in *cycleInput) map[string]string {
	errs := map[string]string{}
	if in.Name != nil {
		cy.Name = strings.TrimSpace(*in.Name)
	}
	if cy.Name == "" {
		errs["name"] = "is required"
	} else if len(cy.Name) > 120 {
		errs["name"] = "must be at most 120 characters"
	}
	setText(&cy.Description, in.Description)
	setTime(errs, "start_date", &cy.StartDate, in.StartDate)
	setTime(errs, "end_date", &cy.EndDate, in.EndDate)
	if (cy.StartDate == nil) != (cy.EndDate == nil) {
		errs["end_date"] = "set both the start and end dates, or neither"
	} else if cy.StartDate != nil && cy.EndDate.Before(*cy.StartDate) {
		errs["end_date"] = "must be on or after the start date"
	}
	if len(errs) == 0 && cy.StartDate != nil {
		q := c.T(&Cycle{}).Where("project_id = ? AND start_date <= ? AND end_date >= ?", cy.ProjectID, *cy.EndDate, *cy.StartDate)
		if cy.ID != "" {
			q = q.Where("id <> ?", cy.ID)
		}
		var other Cycle
		if q.Take(&other).Error == nil {
			errs["start_date"] = fmt.Sprintf("overlaps with cycle %q", other.Name)
		}
	}
	return errs
}

func (a *App) createCycle(c *Ctx) error {
	p, perms, err := c.loadProject(c.Param("id"))
	if err != nil {
		return err
	}
	if !perms.edit {
		return errForbidden("only project members can plan cycles")
	}
	var in cycleInput
	if err := c.Bind(&in); err != nil {
		return err
	}
	cy := Cycle{Base: Base{OrgID: c.P.OrgID}, ProjectID: p.ID}
	if errs := c.applyCycleInput(&cy, &in); len(errs) > 0 {
		return errValidation(errs)
	}
	if err := c.DB().Create(&cy).Error; err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, c.cycleDTOs([]Cycle{cy})[0])
}

func (c *Ctx) loadCycle(id string) (*Cycle, projectPerms, error) {
	var cy Cycle
	if !isUUID(id) || c.T(&Cycle{}).Where("id = ?", id).Take(&cy).Error != nil {
		return nil, projectPerms{}, errNotFound("cycle")
	}
	_, perms, err := c.loadProject(cy.ProjectID)
	if err != nil {
		return nil, perms, errNotFound("cycle")
	}
	return &cy, perms, nil
}

func (a *App) updateCycle(c *Ctx) error {
	cy, perms, err := c.loadCycle(c.Param("id"))
	if err != nil {
		return err
	}
	if !perms.edit {
		return errForbidden("only project members can plan cycles")
	}
	var in cycleInput
	if err := c.Bind(&in); err != nil {
		return err
	}
	if errs := c.applyCycleInput(cy, &in); len(errs) > 0 {
		return errValidation(errs)
	}
	if err := c.DB().Save(cy).Error; err != nil {
		return err
	}
	return c.JSON(http.StatusOK, c.cycleDTOs([]Cycle{*cy})[0])
}

func (a *App) deleteCycle(c *Ctx) error {
	cy, perms, err := c.loadCycle(c.Param("id"))
	if err != nil {
		return err
	}
	if !perms.edit {
		return errForbidden("only project members can plan cycles")
	}
	err = c.DB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&WorkItem{}).Where("org_id = ? AND cycle_id = ?", c.P.OrgID, cy.ID).Update("cycle_id", nil).Error; err != nil {
			return err
		}
		return tx.Delete(cy).Error
	})
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "cycle deleted"})
}
