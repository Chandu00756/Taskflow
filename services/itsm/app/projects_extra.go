package app

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
)

// Modules, web links, attachments, relations and subscribers on work items,
// and the link between tickets and project work items.

// Module groups work items inside a project (an epic or feature area).
type Module struct {
	Base
	ProjectID   string     `gorm:"type:uuid;index;not null" json:"project_id"`
	Name        string     `gorm:"not null" json:"name"`
	Description string     `gorm:"type:text" json:"description"`
	Status      string     `json:"status"`
	LeadID      *string    `gorm:"type:uuid" json:"lead_id"`
	StartDate   *time.Time `json:"start_date"`
	TargetDate  *time.Time `json:"target_date"`
}

var moduleStatuses = []string{"backlog", "planned", "in_progress", "paused", "completed", "cancelled"}

// webLink is a URL attached to a work item.
type webLink struct {
	URL   string `json:"url"`
	Title string `json:"title"`
}

// Relation types between work items; each has an inverse seen from the other side.
var relationInverse = map[string]string{
	"blocks": "blocked_by", "blocked_by": "blocks", "relates_to": "relates_to", "duplicate_of": "duplicated_by", "duplicated_by": "duplicate_of",
}

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

type moduleDTO struct {
	Module
	Lead  *UserBrief `json:"lead"`
	Total int64      `json:"total"`
	Done  int64      `json:"done"`
}

// GET /projects/{id}/modules
func (a *App) listModules(c *Ctx) error {
	p, _, err := c.loadProject(c.Param("id"))
	if err != nil {
		return err
	}
	var mods []Module
	c.T(&Module{}).Where("project_id = ?", p.ID).Order("created_at").Find(&mods)
	var leadIDs []string
	for _, m := range mods {
		leadIDs = append(leadIDs, deref(m.LeadID))
	}
	l := c.lookup(leadIDs, nil, nil)
	out := make([]moduleDTO, len(mods))
	for i, m := range mods {
		out[i] = moduleDTO{Module: m, Lead: l.user(m.LeadID)}
		c.T(&WorkItem{}).Where("project_id = ? AND module_ids @> ?::jsonb", p.ID, string(jsonOf([]string{m.ID}))).Count(&out[i].Total)
		c.T(&WorkItem{}).Where("project_id = ? AND module_ids @> ?::jsonb AND state = 'done'", p.ID, string(jsonOf([]string{m.ID}))).Count(&out[i].Done)
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"items": out})
}

type moduleInput struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
	Status      *string `json:"status"`
	LeadID      *string `json:"lead_id"`
	StartDate   *string `json:"start_date"`
	TargetDate  *string `json:"target_date"`
}

func (c *Ctx) applyModuleInput(m *Module, p *Project, in *moduleInput) map[string]string {
	errs := map[string]string{}
	if in.Name != nil {
		m.Name = strings.Join(strings.Fields(*in.Name), " ")
	}
	if m.Name == "" {
		errs["name"] = "is required"
	}
	setText(&m.Description, in.Description)
	if in.Status != nil {
		if !oneOf(*in.Status, moduleStatuses...) {
			errs["status"] = "must be one of " + strings.Join(moduleStatuses, ", ")
		} else {
			m.Status = *in.Status
		}
	}
	if in.LeadID != nil {
		m.LeadID = strPtr(*in.LeadID)
		c.optionalRef(errs, "lead_id", m.LeadID, c.agentInOrg)
	}
	setTime(errs, "start_date", &m.StartDate, in.StartDate)
	setTime(errs, "target_date", &m.TargetDate, in.TargetDate)
	if m.StartDate != nil && m.TargetDate != nil && m.TargetDate.Before(*m.StartDate) {
		errs["target_date"] = "must be after the start date"
	}
	return errs
}

func (a *App) createModule(c *Ctx) error {
	p, perms, err := c.loadProject(c.Param("id"))
	if err != nil {
		return err
	}
	if !perms.edit {
		return errForbidden("only project members can add modules")
	}
	var in moduleInput
	if err := c.Bind(&in); err != nil {
		return err
	}
	m := Module{Base: Base{OrgID: c.P.OrgID}, ProjectID: p.ID, Status: "planned"}
	if errs := c.applyModuleInput(&m, p, &in); len(errs) > 0 {
		return errValidation(errs)
	}
	if err := c.DB().Create(&m).Error; err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, m)
}

func (c *Ctx) loadModule(id string) (*Module, *Project, projectPerms, error) {
	var m Module
	if !isUUID(id) || c.T(&Module{}).Where("id = ?", id).Take(&m).Error != nil {
		return nil, nil, projectPerms{}, errNotFound("module")
	}
	p, perms, err := c.loadProject(m.ProjectID)
	if err != nil {
		return nil, nil, perms, errNotFound("module")
	}
	return &m, p, perms, nil
}

func (a *App) updateModule(c *Ctx) error {
	m, p, perms, err := c.loadModule(c.Param("id"))
	if err != nil {
		return err
	}
	if !perms.edit {
		return errForbidden("only project members can change modules")
	}
	var in moduleInput
	if err := c.Bind(&in); err != nil {
		return err
	}
	if errs := c.applyModuleInput(m, p, &in); len(errs) > 0 {
		return errValidation(errs)
	}
	if err := c.DB().Save(m).Error; err != nil {
		return err
	}
	return c.JSON(http.StatusOK, m)
}

func (a *App) deleteModule(c *Ctx) error {
	m, _, perms, err := c.loadModule(c.Param("id"))
	if err != nil {
		return err
	}
	if !perms.edit {
		return errForbidden("only project members can delete modules")
	}
	err = c.DB().Transaction(func(tx *gorm.DB) error {
		// Work items keep everything except the membership in this module.
		if err := tx.Exec(`UPDATE itsm_work_items SET module_ids = COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(module_ids) x WHERE x <> to_jsonb(?::text)), '[]'::jsonb)
			WHERE org_id = ? AND project_id = ? AND module_ids @> ?::jsonb`, m.ID, c.P.OrgID, m.ProjectID, string(jsonOf([]string{m.ID}))).Error; err != nil {
			return err
		}
		return tx.Delete(m).Error
	})
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "deleted"})
}

// applyWorkItemExtras validates modules and web links.
func (c *Ctx) applyWorkItemExtras(w *WorkItem, p *Project, in *workItemInput, errs map[string]string) {
	if in.ModuleIDs != nil {
		ids := uniq(*in.ModuleIDs)
		var n int64
		if len(ids) > 0 {
			c.T(&Module{}).Where("project_id = ? AND id IN ?", p.ID, ids).Count(&n)
		}
		if int(n) != len(ids) {
			errs["module_ids"] = "contains a module from another project"
		}
		w.ModuleIDs = jsonOf(ids)
	}
	if in.WebLinks != nil {
		out := []webLink{}
		for _, l := range *in.WebLinks {
			u, err := url.Parse(strings.TrimSpace(l.URL))
			if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
				errs["web_links"] = "links must start with http:// or https://"
				break
			}
			out = append(out, webLink{URL: u.String(), Title: truncate(strings.TrimSpace(l.Title), 200)})
		}
		if len(out) > 50 {
			errs["web_links"] = "at most 50 links"
		}
		w.WebLinks = jsonOf(out)
	}
}

// ---------------------------------------------------------------------------
// Work item detail
// ---------------------------------------------------------------------------

type relationDTO struct {
	LinkID string        `json:"link_id"`
	Type   string        `json:"type"`
	Item   WorkItemBrief `json:"item"`
}

type linkedTicket struct {
	ID        string `json:"id"`
	DisplayID string `json:"display_id"`
	Subject   string `json:"subject"`
	Status    string `json:"status"`
	Tracked   bool   `json:"tracked"`
}

// WorkItemDetail adds permissions and related records to a work item.
type WorkItemDetail struct {
	WorkItemDTO
	CanEdit     bool           `json:"can_edit"`
	Modules     []Ref          `json:"modules"`
	WebLinks    []webLink      `json:"web_links"`
	Attachments []Attachment   `json:"attachments"`
	Relations   []relationDTO  `json:"relations"`
	Tickets     []linkedTicket `json:"tickets"`
	Subscribed  bool           `json:"subscribed"`
	Subscribers []*UserBrief   `json:"subscribers"`
}

func (a *App) workItemDetail(c *Ctx, w *WorkItem, canEdit bool) WorkItemDetail {
	d := WorkItemDetail{WorkItemDTO: c.workItemDTOs([]WorkItem{*w})[0], CanEdit: canEdit,
		Modules: []Ref{}, WebLinks: []webLink{}, Attachments: []Attachment{}, Relations: []relationDTO{}, Tickets: []linkedTicket{}, Subscribers: []*UserBrief{}}
	if ids := stringsFrom(w.ModuleIDs); len(ids) > 0 {
		var mods []Module
		c.T(&Module{}).Where("id IN ?", ids).Find(&mods)
		for _, m := range mods {
			d.Modules = append(d.Modules, Ref{ID: m.ID, Name: m.Name})
		}
	}
	_ = json.Unmarshal(w.WebLinks, &d.WebLinks)
	if d.WebLinks == nil {
		d.WebLinks = []webLink{}
	}
	c.T(&Attachment{}).Select("id, org_id, entity_type, entity_id, name, content_type, size, uploaded_by, created_at, updated_at").
		Where("entity_type = 'work_item' AND entity_id = ?", w.ID).Order("created_at").Find(&d.Attachments)
	// Relations to other work items, from either side.
	var links []Link
	c.T(&Link{}).Where("(source_type = 'work_item' AND source_id = ? AND target_type = 'work_item') OR (target_type = 'work_item' AND target_id = ? AND source_type = 'work_item')", w.ID, w.ID).Find(&links)
	for _, l := range links {
		other, typ := l.TargetID, l.LinkType
		if l.TargetID == w.ID {
			other, typ = l.SourceID, relationInverse[l.LinkType]
		}
		if typ == "" {
			continue
		}
		var o WorkItem
		if c.T(&WorkItem{}).Where("id = ?", other).Take(&o).Error != nil {
			continue
		}
		var op Project
		c.T(&Project{}).Select("key").Where("id = ?", o.ProjectID).Take(&op)
		d.Relations = append(d.Relations, relationDTO{LinkID: l.ID, Type: typ, Item: WorkItemBrief{ID: o.ID, DisplayID: displayID(op.Key, o.Number), Title: o.Title, State: o.State}})
	}
	// Linked tickets; the "project" link is the one whose status follows this item.
	var tl []Link
	c.T(&Link{}).Where("source_type = 'work_item' AND source_id = ? AND target_type = 'ticket'", w.ID).Find(&tl)
	s := c.settings()
	for _, l := range tl {
		var t Ticket
		if c.T(&Ticket{}).Where("id = ? AND NOT is_deleted", l.TargetID).Take(&t).Error == nil {
			d.Tickets = append(d.Tickets, linkedTicket{ID: t.ID, DisplayID: ticketDisplayID(s, &t), Subject: t.Subject, Status: t.Status, Tracked: l.LinkType == "project"})
		}
	}
	var subs []string
	c.DB().Model(&Watcher{}).Where("entity_type = 'work_item' AND entity_id = ?", w.ID).Pluck("user_id", &subs)
	lk := c.lookup(subs, nil, nil)
	for _, id := range subs {
		id := id
		if id == c.P.UserID {
			d.Subscribed = true
		}
		if u := lk.user(&id); u != nil {
			d.Subscribers = append(d.Subscribers, u)
		}
	}
	return d
}

// POST /work-items/{id}/attachments {attachment_ids}
func (a *App) attachToWorkItem(c *Ctx) error {
	w, p, perms, err := c.loadWorkItem(c.Param("id"))
	if err != nil {
		return err
	}
	if !perms.edit {
		return errForbidden("only project members can attach files")
	}
	var in struct {
		AttachmentIDs []string `json:"attachment_ids"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	var added []string
	err = c.DB().Transaction(func(tx *gorm.DB) error {
		added = c.attachFiles(tx, "work_item", w.ID, in.AttachmentIDs)
		if len(added) > 0 {
			c.activity(tx, "work_item", w.ID, "attached", "attached "+plural(len(added), "file"), nil)
		}
		return nil
	})
	if err != nil {
		return err
	}
	if len(added) > 0 {
		for _, id := range c.workItemAudience(w) {
			notify(c.DB(), id, "work_item_update", c.P.Name+" attached "+plural(len(added), "file")+" to "+displayID(p.Key, w.Number), w.Title,
				map[string]string{"work_item_id": w.ID, "project_id": p.ID})
		}
	}
	return c.JSON(http.StatusOK, a.workItemDetail(c, w, perms.edit))
}

func plural(n int, word string) string {
	if n == 1 {
		return "1 " + word
	}
	return strconv.Itoa(n) + " " + word + "s"
}

// POST /work-items/{id}/relations {type, target_id}
func (a *App) addWorkItemRelation(c *Ctx) error {
	w, _, perms, err := c.loadWorkItem(c.Param("id"))
	if err != nil {
		return err
	}
	if !perms.edit {
		return errForbidden("only project members can link work items")
	}
	var in struct {
		Type     string `json:"type"`
		TargetID string `json:"target_id"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	if _, ok := relationInverse[in.Type]; !ok || in.Type == "duplicated_by" {
		return errValidation(map[string]string{"type": "must be blocks, blocked_by, relates_to or duplicate_of"})
	}
	target, _, _, err := c.loadWorkItem(in.TargetID)
	if err != nil || target.ID == w.ID {
		return errValidation(map[string]string{"target_id": "is not a work item you can see"})
	}
	var n int64
	c.T(&Link{}).Where("((source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)) AND source_type = 'work_item' AND target_type = 'work_item'",
		w.ID, target.ID, target.ID, w.ID).Count(&n)
	if n > 0 {
		return errValidation(map[string]string{"target_id": "is already related to this work item"})
	}
	if err := c.DB().Create(&Link{Base: Base{OrgID: c.P.OrgID}, SourceType: "work_item", SourceID: w.ID, TargetType: "work_item", TargetID: target.ID, LinkType: in.Type}).Error; err != nil {
		return err
	}
	c.activity(c.DB(), "work_item", w.ID, "linked", "marked as "+strings.ReplaceAll(in.Type, "_", " ")+" "+target.Title, nil)
	return c.JSON(http.StatusOK, a.workItemDetail(c, w, perms.edit))
}

// DELETE /work-items/{id}/relations/{link_id}
func (a *App) removeWorkItemRelation(c *Ctx) error {
	w, _, perms, err := c.loadWorkItem(c.Param("id"))
	if err != nil {
		return err
	}
	if !perms.edit {
		return errForbidden("only project members can unlink work items")
	}
	res := c.T(&Link{}).Where("id = ? AND source_type = 'work_item' AND target_type = 'work_item' AND (source_id = ? OR target_id = ?)", c.Param("link_id"), w.ID, w.ID).Delete(&Link{})
	if res.RowsAffected == 0 {
		return errNotFound("relation")
	}
	return c.JSON(http.StatusOK, a.workItemDetail(c, w, perms.edit))
}

// POST/DELETE /work-items/{id}/subscribe
func (a *App) subscribeToWorkItem(on bool) handlerFunc {
	return func(c *Ctx) error {
		w, _, perms, err := c.loadWorkItem(c.Param("id"))
		if err != nil {
			return err
		}
		if on {
			subscribeWorkItem(c.DB(), c.P.OrgID, w.ID, c.P.UserID)
		} else {
			c.DB().Where("entity_type = 'work_item' AND entity_id = ? AND user_id = ?", w.ID, c.P.UserID).Delete(&Watcher{})
		}
		return c.JSON(http.StatusOK, a.workItemDetail(c, w, perms.edit))
	}
}

// ---------------------------------------------------------------------------
// Tickets ↔ projects
// ---------------------------------------------------------------------------

type ticketProjectDTO struct {
	Project  ProjectBrief  `json:"project"`
	WorkItem WorkItemBrief `json:"work_item"`
	CanEdit  bool          `json:"can_edit"`
}

// trackedWorkItem returns the work item whose status follows the ticket.
func (c *Ctx) trackedWorkItem(ticketID string) (*WorkItem, *Link) {
	var l Link
	if c.T(&Link{}).Where("source_type = 'work_item' AND target_type = 'ticket' AND target_id = ? AND link_type = 'project'", ticketID).
		Order("created_at DESC").Take(&l).Error != nil {
		return nil, nil
	}
	var w WorkItem
	if c.T(&WorkItem{}).Where("id = ?", l.SourceID).Take(&w).Error != nil {
		return nil, nil
	}
	return &w, &l
}

func (c *Ctx) ticketProject(t *Ticket) *ticketProjectDTO {
	w, _ := c.trackedWorkItem(t.ID)
	if w == nil {
		return nil
	}
	var p Project
	if c.T(&Project{}).Where("id = ?", w.ProjectID).Take(&p).Error != nil {
		return nil
	}
	perms := c.projectPerms(&p)
	return &ticketProjectDTO{
		Project:  ProjectBrief{ID: p.ID, Key: p.Key, Name: p.Name, Color: p.Color},
		WorkItem: WorkItemBrief{ID: w.ID, DisplayID: displayID(p.Key, w.Number), Title: w.Title, State: w.State},
		CanEdit:  perms.edit,
	}
}

// GET /tickets/{id}/project
func (a *App) getTicketProject(c *Ctx) error {
	t, err := c.loadTicket(c.Param("id"))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"link": c.ticketProject(t)})
}

var ticketToWorkItemPriority = map[int]string{4: "urgent", 3: "high", 2: "medium", 1: "low"}

// linkTicketToProject creates (or moves) the work item that tracks a ticket in
// a project and sets its state.
func (a *App) linkTicketToProject(c *Ctx, t *Ticket, projectID, state string) error {
	p, perms, err := c.loadProject(projectID)
	if err != nil {
		return errValidation(map[string]string{"project_id": "is not a project you can see"})
	}
	if !perms.edit {
		return errValidation(map[string]string{"project_id": "you are not a member of " + p.Name})
	}
	if state == "" {
		state = "todo"
	}
	if !oneOf(state, workItemStates...) {
		return errValidation(map[string]string{"state": "must be one of " + strings.Join(workItemStates, ", ")})
	}
	cur, link := c.trackedWorkItem(t.ID)
	if cur != nil && cur.ProjectID == p.ID {
		if cur.State != state {
			before := *cur
			st := state
			c.applyWorkItemInput(cur, p, &workItemInput{State: &st})
			cur.SortOrder = c.nextSortOrder(p.ID, cur.State)
			if err := c.DB().Save(cur).Error; err != nil {
				return err
			}
			c.activity(c.DB(), "work_item", cur.ID, "updated", "moved the work item to "+workItemLabels[cur.State]+" from ticket "+ticketDisplayID(c.settings(), t),
				diffFields(before, *cur, "state"))
			for _, id := range c.workItemAudience(cur) {
				notify(c.DB(), id, "work_item_update", c.P.Name+" moved "+displayID(p.Key, cur.Number)+" to "+workItemLabels[cur.State], cur.Title,
					map[string]string{"work_item_id": cur.ID, "project_id": p.ID})
			}
		}
		return nil
	}
	return c.DB().Transaction(func(tx *gorm.DB) error {
		if link != nil {
			// Moving to another project: the old item stays, related but no longer tracked.
			tx.Model(&Link{}).Where("id = ?", link.ID).Update("link_type", "related")
		}
		w := WorkItem{Base: Base{OrgID: c.P.OrgID}, ProjectID: p.ID, Title: truncate(t.Subject, 255), Description: t.Description,
			State: state, Priority: ticketToWorkItemPriority[t.Priority], ReporterID: c.P.UserID, Labels: jsonOf([]string{}),
			ModuleIDs: jsonOf([]string{}), WebLinks: jsonOf([]webLink{})}
		if w.Priority == "" {
			w.Priority = "none"
		}
		if t.ResponderID != nil && (deref(p.LeadID) == *t.ResponderID || containsString(stringsFrom(p.MemberIDs), *t.ResponderID)) {
			w.AssigneeID = t.ResponderID
		}
		if state == "done" {
			n := now()
			w.CompletedAt = &n
		}
		w.SortOrder = c.nextSortOrder(p.ID, state)
		n, err := nextNumber(tx, c.P.OrgID, "work_item:"+p.ID)
		if err != nil {
			return err
		}
		w.Number = n
		if err := tx.Create(&w).Error; err != nil {
			return err
		}
		tx.Create(&Link{Base: Base{OrgID: c.P.OrgID}, SourceType: "work_item", SourceID: w.ID, TargetType: "ticket", TargetID: t.ID, LinkType: "project"})
		c.activity(tx, "work_item", w.ID, "created", "created the work item from ticket "+ticketDisplayID(c.settings(), t), nil)
		c.activity(tx, "ticket", t.ID, "linked", "added to project "+p.Name+" as "+displayID(p.Key, w.Number), nil)
		subscribeWorkItem(tx, c.P.OrgID, w.ID, c.P.UserID, deref(w.AssigneeID))
		return nil
	})
}

// PUT /tickets/{id}/project {project_id, state}
func (a *App) setTicketProject(c *Ctx) error {
	t, err := c.loadTicket(c.Param("id"))
	if err != nil {
		return err
	}
	var in struct {
		ProjectID string `json:"project_id"`
		State     string `json:"state"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	if err := a.linkTicketToProject(c, t, in.ProjectID, in.State); err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"link": c.ticketProject(t)})
}

// DELETE /tickets/{id}/project stops tracking the ticket in its project; the
// work item stays.
func (a *App) unlinkTicketProject(c *Ctx) error {
	t, err := c.loadTicket(c.Param("id"))
	if err != nil {
		return err
	}
	if _, l := c.trackedWorkItem(t.ID); l != nil {
		c.DB().Model(&Link{}).Where("id = ?", l.ID).Update("link_type", "related")
		c.activity(c.DB(), "ticket", t.ID, "unlinked", "removed from its project (work item kept)", nil)
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"link": nil})
}

// syncTicketsFromWorkItem records state changes on the tickets an item tracks
// and tells their assignees.
func (c *Ctx) syncTicketsFromWorkItem(before, w *WorkItem, p *Project) {
	if before.State == w.State {
		return
	}
	var ids []string
	c.T(&Link{}).Where("source_type = 'work_item' AND source_id = ? AND target_type = 'ticket' AND link_type = 'project'", w.ID).Pluck("target_id", &ids)
	s := c.settings()
	for _, id := range ids {
		var t Ticket
		if c.T(&Ticket{}).Where("id = ?", id).Take(&t).Error != nil {
			continue
		}
		summary := "project status changed to " + workItemLabels[w.State] + " (" + displayID(p.Key, w.Number) + ")"
		c.activity(c.DB(), "ticket", t.ID, "updated", summary, []FieldChange{{Field: "project_status", From: workItemLabels[before.State], To: workItemLabels[w.State]}})
		if t.ResponderID != nil && *t.ResponderID != c.P.UserID {
			notify(c.DB(), *t.ResponderID, "ticket_update", c.P.Name+" moved "+ticketDisplayID(s, &t)+" to "+workItemLabels[w.State]+" in "+p.Name, t.Subject,
				map[string]string{"ticket_id": t.ID})
		}
	}
}

// syncWorkItemFromTicket finishes the tracked work item when its ticket is
// resolved or closed.
func (a *App) syncWorkItemFromTicket(c *Ctx, before, t *Ticket) {
	if before.Status == t.Status || (t.Status != "resolved" && t.Status != "closed") {
		return
	}
	w, _ := c.trackedWorkItem(t.ID)
	if w == nil || w.State == "done" || w.State == "cancelled" {
		return
	}
	_ = a.linkTicketToProject(c, t, w.ProjectID, "done")
}
