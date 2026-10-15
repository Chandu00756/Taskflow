package app

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/chanduchitikam/task-management-system/services/itsm/rules"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// TicketDTO is the API representation of a ticket.
type TicketDTO struct {
	*Ticket
	DisplayID  string      `json:"display_id"`
	Requester  *UserBrief  `json:"requester"`
	Responder  *UserBrief  `json:"responder"`
	Group      *Ref        `json:"group"`
	Department *Ref        `json:"department"`
	SLAState   string      `json:"sla_state"`
	Tags       []string    `json:"tags"`
	CCEmails   []string    `json:"cc_emails"`
	CustomFlds interface{} `json:"custom_fields"`
}

func slaState(t *Ticket) string {
	if !isActiveStatus(t.Status) {
		if t.DueBy != nil && t.ResolvedAt != nil && t.ResolvedAt.After(*t.DueBy) {
			return "violated"
		}
		if t.DueBy != nil {
			return "met"
		}
		return "none"
	}
	if t.DueBy == nil {
		return "none"
	}
	n := now()
	switch {
	case t.PendingSince != nil:
		return "paused"
	case t.DueBy.Before(n):
		return "overdue"
	case t.DueBy.Sub(n) < 2*time.Hour:
		return "due_soon"
	}
	return "on_track"
}

func (c *Ctx) ticketDTOs(tickets []Ticket) []TicketDTO {
	var uids, gids, dids []string
	for _, t := range tickets {
		uids = append(uids, t.RequesterID, deref(t.ResponderID))
		gids = append(gids, deref(t.GroupID))
		dids = append(dids, deref(t.DepartmentID))
	}
	l := c.lookup(uids, gids, dids)
	s := c.settings()
	out := make([]TicketDTO, len(tickets))
	for i := range tickets {
		t := &tickets[i]
		var custom interface{} = map[string]interface{}{}
		_ = json.Unmarshal(t.CustomFields, &custom)
		out[i] = TicketDTO{
			Ticket: t, DisplayID: ticketDisplayID(s, t), Requester: l.userS(t.RequesterID), Responder: l.user(t.ResponderID),
			Group: l.group(t.GroupID), Department: l.dept(t.DepartmentID), SLAState: slaState(t),
			Tags: stringsFrom(t.Tags), CCEmails: stringsFrom(t.CCEmails), CustomFlds: custom,
		}
		if !c.P.IsAgent {
			// Requesters never see internal routing fields.
			out[i].Ticket = redactedForRequester(t)
		}
	}
	return out
}

func redactedForRequester(t *Ticket) *Ticket {
	cp := *t
	cp.IsEscalated, cp.FrEscalated = false, false
	cp.SLAPolicyID = nil
	cp.FrDueBy = nil
	return &cp
}

// settings returns the caller org's helpdesk settings (cached per request).
func (c *Ctx) settings() *Settings {
	var s Settings
	if err := c.DB().Where("org_id = ?", c.P.OrgID).Take(&s).Error; err != nil {
		return &Settings{OrgID: c.P.OrgID, PrefixIncident: "INC", PrefixServiceRequest: "SR"}
	}
	return &s
}

// visibleTickets scopes a ticket query to what the caller may see.
func (c *Ctx) visibleTickets(q *gorm.DB) *gorm.DB {
	p := c.P
	if p.IsAgent {
		switch p.TicketScope {
		case "group":
			if len(p.GroupIDs) == 0 {
				return q.Where("responder_id = ?", p.UserID)
			}
			return q.Where("(group_id IN ? OR responder_id = ?)", p.GroupIDs, p.UserID)
		case "restricted":
			return q.Where("responder_id = ?", p.UserID)
		}
		return q
	}
	s := c.settings()
	if s.DeptHeadSeesDeptTickets {
		var deptIDs []string
		c.T(&Department{}).Where("head_user_id = ? OR prime_user_id = ?", p.UserID, p.UserID).Pluck("id", &deptIDs)
		if len(deptIDs) > 0 {
			return q.Where("(requester_id = ? OR department_id IN ?)", p.UserID, deptIDs)
		}
	}
	return q.Where("requester_id = ?", p.UserID)
}

func (c *Ctx) loadTicket(id string) (*Ticket, error) {
	if !isUUID(id) {
		return nil, errNotFound("ticket")
	}
	var t Ticket
	if err := c.visibleTickets(c.T(&Ticket{}).Where("id = ?", id)).Take(&t).Error; err != nil {
		return nil, errNotFound("ticket")
	}
	return &t, nil
}

func (a *App) listTickets(c *Ctx) error {
	pg := c.Paging()
	build := func() *gorm.DB {
		q := c.visibleTickets(c.T(&Ticket{}))
		view := c.Query("view")
		switch view {
		case "spam":
			q = q.Where("is_spam AND NOT is_deleted")
		case "trash":
			q = q.Where("is_deleted")
		default:
			q = q.Where("NOT is_deleted AND NOT is_spam")
		}
		active := []string{"resolved", "closed"}
		switch view {
		case "open":
			q = q.Where("status NOT IN ?", active)
		case "my_open":
			q = q.Where("responder_id = ? AND status NOT IN ?", c.P.UserID, active)
		case "unassigned":
			q = q.Where("responder_id IS NULL AND status NOT IN ?", active)
		case "my_groups":
			if len(c.P.GroupIDs) == 0 {
				q = q.Where("1 = 0")
			} else {
				q = q.Where("group_id IN ? AND status NOT IN ?", c.P.GroupIDs, active)
			}
		case "overdue":
			q = q.Where("due_by < ? AND status NOT IN ? AND pending_since IS NULL", now(), active)
		case "due_today":
			end := now().Truncate(24 * time.Hour).Add(24 * time.Hour)
			q = q.Where("due_by < ? AND status NOT IN ?", end, active)
		case "pending":
			q = q.Where("status = 'pending'")
		case "resolved":
			q = q.Where("status = 'resolved'")
		case "closed":
			q = q.Where("status = 'closed'")
		case "raised_by_me":
			q = q.Where("requester_id = ?", c.P.UserID)
		case "watching":
			q = q.Where("id IN (?)", c.DB().Model(&Watcher{}).Select("entity_id").Where("entity_type = 'ticket' AND user_id = ?", c.P.UserID))
		}
		if v := c.Query("status"); v != "" {
			q = q.Where("status IN ?", strings.Split(v, ","))
		}
		if v := c.Query("priority"); v != "" {
			var ps []int
			for _, s := range strings.Split(v, ",") {
				if n, err := strconv.Atoi(s); err == nil {
					ps = append(ps, n)
				}
			}
			if len(ps) > 0 {
				q = q.Where("priority IN ?", ps)
			}
		}
		if v := c.Query("type"); v != "" {
			q = q.Where("type = ?", v)
		}
		if v := c.Query("source"); v != "" {
			q = q.Where("source IN ?", strings.Split(v, ","))
		}
		if v := c.Query("group_id"); isUUID(v) {
			q = q.Where("group_id = ?", v)
		}
		if v := c.Query("responder_id"); v == "none" {
			q = q.Where("responder_id IS NULL")
		} else if isUUID(v) {
			q = q.Where("responder_id = ?", v)
		}
		if v := c.Query("requester_id"); isUUID(v) {
			q = q.Where("requester_id = ?", v)
		}
		if v := c.Query("department_id"); isUUID(v) {
			q = q.Where("department_id = ?", v)
		}
		if v := c.Query("category"); v != "" {
			q = q.Where("category = ?", v)
		}
		if v := c.Query("tag"); v != "" {
			q = q.Where("tags @> ?", string(jsonOf([]string{strings.ToLower(v)})))
		}
		if v, ok := parseTime(c.Query("created_from")); ok && v != nil {
			q = q.Where("created_at >= ?", *v)
		}
		if v, ok := parseTime(c.Query("created_to")); ok && v != nil {
			q = q.Where("created_at <= ?", *v)
		}
		if v := strings.TrimSpace(c.Query("q")); v != "" {
			q = c.ticketTextSearch(q, v)
		}
		return q
	}
	var total int64
	if err := build().Count(&total).Error; err != nil {
		return err
	}
	order := "created_at DESC"
	sortKey := c.Query("sort")
	dir := "DESC"
	if strings.EqualFold(c.Query("order"), "asc") {
		dir = "ASC"
	}
	switch sortKey {
	case "updated_at", "created_at", "priority", "number", "status":
		order = sortKey + " " + dir
	case "due_by":
		order = "due_by " + dir + " NULLS LAST"
	}
	var tickets []Ticket
	if err := build().Order(order).Offset(pg.Offset()).Limit(pg.PerPage).Find(&tickets).Error; err != nil {
		return err
	}
	return c.JSON(http.StatusOK, ListResponse{Items: c.ticketDTOs(tickets), Total: total, Page: pg.Page, PerPage: pg.PerPage})
}

// ticketInput is accepted by create and update.
type ticketInput struct {
	Subject       *string                `json:"subject"`
	Description   *string                `json:"description"`
	Type          *string                `json:"type"`
	Status        *string                `json:"status"`
	Priority      *int                   `json:"priority"`
	Urgency       *int                   `json:"urgency"`
	Impact        *int                   `json:"impact"`
	Source        *string                `json:"source"`
	RequesterID   *string                `json:"requester_id"`
	Email         string                 `json:"email"`
	Name          string                 `json:"name"`
	ResponderID   *string                `json:"responder_id"`
	GroupID       *string                `json:"group_id"`
	DepartmentID  *string                `json:"department_id"`
	Category      *string                `json:"category"`
	SubCategory   *string                `json:"sub_category"`
	ItemCategory  *string                `json:"item_category"`
	Tags          *[]string              `json:"tags"`
	CCEmails      *[]string              `json:"cc_emails"`
	CustomFields  map[string]interface{} `json:"custom_fields"`
	DueBy         *string                `json:"due_by"`
	ParentID      *string                `json:"parent_id"`
	AttachmentIDs []string               `json:"attachment_ids"`
	AssetIDs      []string               `json:"asset_ids"`
	Resolution    *string                `json:"resolution_notes"`
}

var ticketSources = []string{"portal", "email", "phone", "chat", "walkup", "slack", "ms_teams", "api", "monitoring", "feedback_widget"}

func (a *App) createTicket(c *Ctx) error {
	var in ticketInput
	if err := c.Bind(&in); err != nil {
		return err
	}
	s := c.settings()
	errs := map[string]string{}
	t := Ticket{Base: Base{OrgID: c.P.OrgID}, Status: "open", Priority: 2, Urgency: 1, Impact: 1, Type: "incident",
		Source: "portal", CreatedByID: c.P.UserID}
	if in.Subject == nil || strings.TrimSpace(*in.Subject) == "" {
		errs["subject"] = "is required"
	} else if len(*in.Subject) > 255 {
		errs["subject"] = "must be at most 255 characters"
	} else {
		t.Subject = strings.TrimSpace(*in.Subject)
	}
	if in.Description != nil {
		t.Description = *in.Description
	}
	if in.Type != nil {
		if !oneOf(*in.Type, "incident", "service_request") {
			errs["type"] = "must be incident or service_request"
		} else {
			t.Type = *in.Type
		}
	}
	if in.Category != nil {
		t.Category = *in.Category
	}
	if in.SubCategory != nil {
		t.SubCategory = *in.SubCategory
	}
	if in.ItemCategory != nil {
		t.ItemCategory = *in.ItemCategory
	}
	if in.Urgency != nil {
		t.Urgency = clampInt(*in.Urgency, 1, 3, 1)
	}
	if in.Impact != nil {
		t.Impact = clampInt(*in.Impact, 1, 3, 1)
	}
	t.Tags = jsonOf([]string{})
	if in.Tags != nil {
		t.Tags = jsonOf(normalizeTags(*in.Tags))
	}
	cc := []string{}
	if in.CCEmails != nil {
		for _, e := range *in.CCEmails {
			if e = strings.TrimSpace(strings.ToLower(e)); e != "" {
				if !validEmail(e) {
					errs["cc_emails"] = "contains an invalid address"
				}
				cc = append(cc, e)
			}
		}
	}
	t.CCEmails = jsonOf(cc)
	if in.CustomFields == nil {
		in.CustomFields = map[string]interface{}{}
	}
	t.CustomFields = jsonOf(in.CustomFields)

	if c.P.IsAgent {
		if !c.P.Can(PrivTicketsManage) {
			return errForbidden("")
		}
		if in.Status != nil {
			if !validTicketStatus(s, *in.Status) {
				errs["status"] = "is invalid"
			} else {
				t.Status = *in.Status
			}
		}
		if in.Priority != nil {
			t.Priority = clampInt(*in.Priority, 1, 4, 2)
		}
		if in.Source != nil {
			if !oneOf(*in.Source, ticketSources...) {
				errs["source"] = "is invalid"
			} else {
				t.Source = *in.Source
			}
		} else {
			t.Source = "phone"
		}
		t.ResponderID = strPtr(deref(in.ResponderID))
		t.GroupID = strPtr(deref(in.GroupID))
		t.DepartmentID = strPtr(deref(in.DepartmentID))
		c.optionalRef(errs, "responder_id", t.ResponderID, c.agentInOrg)
		c.optionalRef(errs, "group_id", t.GroupID, func(id string) bool { return c.existsInOrg(&AgentGroup{}, id) })
		c.optionalRef(errs, "department_id", t.DepartmentID, func(id string) bool { return c.existsInOrg(&Department{}, id) })
		if in.ParentID != nil && *in.ParentID != "" {
			if _, err := c.loadTicket(*in.ParentID); err != nil {
				errs["parent_id"] = "is invalid"
			} else {
				t.ParentID = in.ParentID
			}
		}
		// Requester: explicit id, or email (auto-create), or the agent themself.
		switch {
		case in.RequesterID != nil && *in.RequesterID != "":
			if !c.userInOrg(*in.RequesterID) {
				errs["requester_id"] = "is invalid"
			}
			t.RequesterID = *in.RequesterID
		case strings.TrimSpace(in.Email) != "":
			email := strings.ToLower(strings.TrimSpace(in.Email))
			if !validEmail(email) {
				errs["email"] = "is invalid"
				break
			}
			if len(errs) > 0 {
				break
			}
			id, _, err := a.findOrCreateRequester(c.DB(), c.P.OrgID, email, in.Name)
			if err != nil {
				errs["email"] = err.Error()
			}
			t.RequesterID = id
		default:
			t.RequesterID = c.P.UserID
		}
	} else {
		// Requesters always raise tickets for themselves through the portal.
		t.RequesterID = c.P.UserID
		t.Source = "portal"
		if in.Priority != nil {
			t.Priority = clampInt(*in.Priority, 1, 3, 2)
		}
	}
	if len(errs) > 0 {
		return errValidation(errs)
	}
	if t.DepartmentID == nil {
		var dept *string
		c.DB().Model(&Person{}).Select("department_id").Where("user_id = ?", t.RequesterID).Scan(&dept)
		t.DepartmentID = dept
	}
	// Priority matrix: derive from urgency × impact when not set explicitly.
	if in.Priority == nil && (in.Urgency != nil || in.Impact != nil) {
		t.Priority = clampInt((t.Urgency+t.Impact+1)/2+boolInt(t.Urgency == 3 && t.Impact == 3), 1, 4, 2)
	}

	var res automationResult
	err := c.DB().Transaction(func(tx *gorm.DB) error {
		n, err := nextNumber(tx, c.P.OrgID, "ticket")
		if err != nil {
			return err
		}
		t.Number = n
		t.CreatedAt = now()
		res = a.runWorkflows(c.R.Context(), tx, s, "ticket_created", &t, nil)
		autoAssign(tx, &t)
		applySLA(tx, &t)
		if in.DueBy != nil && c.P.IsAgent {
			if due, ok := parseTime(*in.DueBy); ok && due != nil {
				t.DueBy = due
			}
		}
		if t.Status != "open" {
			transitionStatus(tx, s, &t, "open", t.Status)
		}
		if err := tx.Create(&t).Error; err != nil {
			return err
		}
		c.attachFiles(tx, "ticket", t.ID, in.AttachmentIDs)
		for _, assetID := range uniq(in.AssetIDs) {
			if c.existsInOrg(&Asset{}, assetID) {
				tx.Create(&Link{Base: Base{OrgID: t.OrgID}, SourceType: "ticket", SourceID: t.ID, TargetType: "asset", TargetID: assetID, LinkType: "affected"})
			}
		}
		if t.ParentID != nil {
			tx.Create(&Link{Base: Base{OrgID: t.OrgID}, SourceType: "ticket", SourceID: *t.ParentID, TargetType: "ticket", TargetID: t.ID, LinkType: "child"})
		}
		summary := "created the ticket"
		c.activity(tx, "ticket", t.ID, "created", summary, res.changes)
		a.finishAutomation(c.R.Context(), tx, &t, res, s)
		return nil
	})
	if err != nil {
		return err
	}
	a.afterTicketCreated(c, &t, s)
	return c.JSON(http.StatusCreated, c.ticketDTOs([]Ticket{t})[0])
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// afterTicketCreated sends notifications for a new ticket.
func (a *App) afterTicketCreated(c *Ctx, t *Ticket, s *Settings) {
	db := c.DB()
	vars := a.ticketVars(db, t, s)
	reqEmail, _ := a.userEmail(db, t.RequesterID)
	a.queueEmail(c.R.Context(), db, t.OrgID, "ticket_created_requester", reqEmail, vars, "ticket", t.ID)
	if t.ResponderID != nil {
		a.notifyAssignment(c, t, s, vars)
	} else if t.GroupID != nil {
		var members []string
		db.Model(&GroupMember{}).Where("group_id = ?", *t.GroupID).Pluck("user_id", &members)
		for _, m := range members {
			notify(db, m, "ticket_new", "New ticket "+vars["ticket.id"]+" in "+vars["ticket.group"], t.Subject, map[string]string{"ticket_id": t.ID})
			if email, _ := a.userEmail(db, m); email != "" {
				a.queueEmail(c.R.Context(), db, t.OrgID, "ticket_assigned_group", email, vars, "ticket", t.ID)
			}
		}
	}
}

func (a *App) notifyAssignment(c *Ctx, t *Ticket, s *Settings, vars map[string]string) {
	if t.ResponderID == nil || *t.ResponderID == c.P.UserID {
		return
	}
	db := c.DB()
	if vars == nil {
		vars = a.ticketVars(db, t, s)
	}
	notify(db, *t.ResponderID, "ticket_assigned", "Ticket "+vars["ticket.id"]+" assigned to you", t.Subject, map[string]string{"ticket_id": t.ID})
	if email, _ := a.userEmail(db, *t.ResponderID); email != "" {
		a.queueEmail(c.R.Context(), db, t.OrgID, "ticket_assigned_agent", email, vars, "ticket", t.ID)
	}
}

func (a *App) getTicket(c *Ctx) error {
	t, err := c.loadTicket(c.Param("id"))
	if err != nil {
		return err
	}
	dto := c.ticketDTOs([]Ticket{*t})[0]
	out := map[string]interface{}{"ticket": dto}
	var reqItems []RequestedItem
	c.T(&RequestedItem{}).Where("ticket_id = ?", t.ID).Find(&reqItems)
	if len(reqItems) > 0 {
		items := []map[string]interface{}{}
		for _, ri := range reqItems {
			var item CatalogItem
			c.T(&CatalogItem{}).Where("id = ?", ri.ItemID).Take(&item)
			var fv interface{}
			_ = json.Unmarshal(ri.FieldValues, &fv)
			items = append(items, map[string]interface{}{"id": ri.ID, "item_id": ri.ItemID, "name": item.Name, "quantity": ri.Quantity,
				"stage": ri.Stage, "cost": ri.Cost, "field_values": fv})
		}
		out["requested_items"] = items
	}
	var survey SurveyResponse
	if c.T(&SurveyResponse{}).Where("ticket_id = ?", t.ID).Take(&survey).Error == nil {
		out["satisfaction"] = survey
	}
	var watching int64
	c.DB().Model(&Watcher{}).Where("entity_type = 'ticket' AND entity_id = ? AND user_id = ?", t.ID, c.P.UserID).Count(&watching)
	out["watching"] = watching > 0
	return c.JSON(http.StatusOK, out)
}

func (a *App) updateTicket(c *Ctx) error {
	t, err := c.loadTicket(c.Param("id"))
	if err != nil {
		return err
	}
	if t.IsDeleted {
		return errBadRequest("restore the ticket before editing it")
	}
	var in ticketInput
	if err := c.Bind(&in); err != nil {
		return err
	}
	s := c.settings()
	if !c.P.IsAgent {
		return a.requesterUpdate(c, t, s, &in)
	}
	if !c.P.Can(PrivTicketsManage) {
		return errForbidden("")
	}
	before := *t
	errs := map[string]string{}
	var changes []FieldChange
	ruleChanges := map[string]rules.Change{}
	track := func(field string, from, to interface{}) {
		if fmt.Sprint(from) != fmt.Sprint(to) {
			changes = append(changes, FieldChange{Field: field, From: from, To: to})
			ruleChanges[field] = rules.Change{From: from, To: to}
		}
	}
	if in.Subject != nil {
		if v := strings.TrimSpace(*in.Subject); v == "" {
			errs["subject"] = "is required"
		} else {
			track("subject", t.Subject, v)
			t.Subject = v
		}
	}
	if in.Description != nil {
		track("description", "…", "…")
		t.Description = *in.Description
	}
	if in.Type != nil && *in.Type != t.Type {
		if !oneOf(*in.Type, "incident", "service_request") {
			errs["type"] = "is invalid"
		} else {
			track("type", t.Type, *in.Type)
			t.Type = *in.Type
		}
	}
	if in.Priority != nil && *in.Priority != t.Priority {
		if *in.Priority < 1 || *in.Priority > 4 {
			errs["priority"] = "must be between 1 and 4"
		} else {
			track("priority", t.Priority, *in.Priority)
			t.Priority = *in.Priority
		}
	}
	if in.Urgency != nil {
		track("urgency", t.Urgency, clampInt(*in.Urgency, 1, 3, t.Urgency))
		t.Urgency = clampInt(*in.Urgency, 1, 3, t.Urgency)
	}
	if in.Impact != nil {
		track("impact", t.Impact, clampInt(*in.Impact, 1, 3, t.Impact))
		t.Impact = clampInt(*in.Impact, 1, 3, t.Impact)
	}
	if in.Source != nil && *in.Source != t.Source {
		if !oneOf(*in.Source, ticketSources...) {
			errs["source"] = "is invalid"
		} else {
			track("source", t.Source, *in.Source)
			t.Source = *in.Source
		}
	}
	if in.ResponderID != nil {
		v := strPtr(*in.ResponderID)
		c.optionalRef(errs, "responder_id", v, c.agentInOrg)
		track("responder_id", deref(t.ResponderID), deref(v))
		t.ResponderID = v
	}
	if in.GroupID != nil {
		v := strPtr(*in.GroupID)
		c.optionalRef(errs, "group_id", v, func(id string) bool { return c.existsInOrg(&AgentGroup{}, id) })
		track("group_id", deref(t.GroupID), deref(v))
		t.GroupID = v
	}
	if in.DepartmentID != nil {
		v := strPtr(*in.DepartmentID)
		c.optionalRef(errs, "department_id", v, func(id string) bool { return c.existsInOrg(&Department{}, id) })
		track("department_id", deref(t.DepartmentID), deref(v))
		t.DepartmentID = v
	}
	if in.RequesterID != nil && *in.RequesterID != t.RequesterID {
		if !c.userInOrg(*in.RequesterID) {
			errs["requester_id"] = "is invalid"
		} else {
			track("requester_id", t.RequesterID, *in.RequesterID)
			t.RequesterID = *in.RequesterID
		}
	}
	if in.Category != nil {
		track("category", t.Category, *in.Category)
		t.Category = *in.Category
	}
	if in.SubCategory != nil {
		track("sub_category", t.SubCategory, *in.SubCategory)
		t.SubCategory = *in.SubCategory
	}
	if in.ItemCategory != nil {
		track("item_category", t.ItemCategory, *in.ItemCategory)
		t.ItemCategory = *in.ItemCategory
	}
	if in.Tags != nil {
		nt := normalizeTags(*in.Tags)
		track("tags", stringsFrom(t.Tags), nt)
		t.Tags = jsonOf(nt)
	}
	if in.CCEmails != nil {
		cc := []string{}
		for _, e := range *in.CCEmails {
			if e = strings.ToLower(strings.TrimSpace(e)); e != "" {
				if !validEmail(e) {
					errs["cc_emails"] = "contains an invalid address"
				}
				cc = append(cc, e)
			}
		}
		t.CCEmails = jsonOf(cc)
	}
	if in.CustomFields != nil {
		var existing map[string]interface{}
		_ = json.Unmarshal(t.CustomFields, &existing)
		if existing == nil {
			existing = map[string]interface{}{}
		}
		for k, v := range in.CustomFields {
			track("cf."+k, existing[k], v)
			existing[k] = v
		}
		t.CustomFields = jsonOf(existing)
	}
	if in.Resolution != nil {
		t.ResolutionNotes = *in.Resolution
	}
	statusChanged := false
	if in.Status != nil && *in.Status != t.Status {
		if !validTicketStatus(s, *in.Status) {
			errs["status"] = "is invalid"
		} else {
			statusChanged = true
		}
	}
	if len(errs) > 0 {
		return errValidation(errs)
	}
	if statusChanged {
		target := *in.Status
		if target == "resolved" || target == "closed" {
			if s.RequireCategoryOnResolve && t.Category == "" {
				return errValidation(map[string]string{"category": "is required to resolve the ticket"})
			}
			if err := c.checkClosureFields(t); err != nil {
				return err
			}
			if target == "closed" && s.RequireTimeOnClose {
				var n int64
				c.T(&TimeEntry{}).Where("entity_type = 'ticket' AND entity_id = ?", t.ID).Count(&n)
				if n == 0 {
					return errValidation(map[string]string{"time_entries": "log time before closing the ticket"})
				}
			}
			var openChildren int64
			c.T(&Ticket{}).Where("parent_id = ? AND status NOT IN ('resolved','closed') AND NOT is_deleted", t.ID).Count(&openChildren)
			if openChildren > 0 {
				return errBadRequest("resolve or close all child tickets first")
			}
		}
		track("status", t.Status, target)
		transitionStatus(c.DB(), s, t, t.Status, target)
		t.Status = target
	}
	if before.Priority != t.Priority || deref(before.GroupID) != deref(t.GroupID) {
		applySLA(c.DB(), t)
	}
	if in.DueBy != nil {
		if due, ok := parseTime(*in.DueBy); ok && due != nil {
			track("due_by", before.DueBy, due)
			t.DueBy = due
		}
	}
	if len(changes) == 0 {
		return c.JSON(http.StatusOK, c.ticketDTOs([]Ticket{*t})[0])
	}
	var res automationResult
	err = c.DB().Transaction(func(tx *gorm.DB) error {
		res = a.runWorkflows(c.R.Context(), tx, s, "ticket_updated", t, ruleChanges)
		if deref(before.GroupID) != deref(t.GroupID) {
			autoAssign(tx, t)
		}
		if err := tx.Save(t).Error; err != nil {
			return err
		}
		c.activity(tx, "ticket", t.ID, "updated", "updated the ticket", append(changes, res.changes...))
		a.finishAutomation(c.R.Context(), tx, t, res, s)
		return nil
	})
	if err != nil {
		return err
	}
	a.afterTicketUpdated(c, &before, t, s)
	return c.JSON(http.StatusOK, c.ticketDTOs([]Ticket{*t})[0])
}

// checkClosureFields enforces form fields marked "required for closure".
func (c *Ctx) checkClosureFields(t *Ticket) error {
	var fields []FormField
	c.T(&FormField{}).Where("entity = 'ticket' AND active AND required_for_closure").Find(&fields)
	if len(fields) == 0 {
		return nil
	}
	var custom map[string]interface{}
	_ = json.Unmarshal(t.CustomFields, &custom)
	errs := map[string]string{}
	for _, f := range fields {
		var v interface{}
		if f.Name == "category" {
			v = t.Category
		} else {
			v = custom[f.Name]
		}
		if strings.TrimSpace(rules.Stringify(v)) == "" {
			errs[f.Name] = f.Label + " is required to close the ticket"
		}
	}
	if len(errs) > 0 {
		return errValidation(errs)
	}
	return nil
}

func (a *App) afterTicketUpdated(c *Ctx, before, t *Ticket, s *Settings) {
	db := c.DB()
	vars := a.ticketVars(db, t, s)
	if deref(before.ResponderID) != deref(t.ResponderID) && t.ResponderID != nil {
		a.notifyAssignment(c, t, s, vars)
	}
	if before.Status != t.Status && (t.Status == "resolved" || (t.Status == "closed" && before.Status != "resolved")) {
		reqEmail, _ := a.userEmail(db, t.RequesterID)
		a.queueEmail(c.R.Context(), db, t.OrgID, "ticket_resolved_requester", reqEmail, vars, "ticket", t.ID)
		notify(db, t.RequesterID, "ticket_resolved", "Your ticket "+vars["ticket.id"]+" was resolved", t.Subject, map[string]string{"ticket_id": t.ID})
		a.sendSurvey(c, t, s, vars)
	}
	a.notifyWatchers(c, t, "Ticket "+vars["ticket.id"]+" was updated")
}

func (a *App) notifyWatchers(c *Ctx, t *Ticket, title string) {
	var ids []string
	c.DB().Model(&Watcher{}).Where("entity_type = 'ticket' AND entity_id = ? AND user_id <> ?", t.ID, c.P.UserID).Pluck("user_id", &ids)
	for _, id := range ids {
		notify(c.DB(), id, "ticket_watch", title, t.Subject, map[string]string{"ticket_id": t.ID})
	}
}

func (a *App) sendSurvey(c *Ctx, t *Ticket, s *Settings, vars map[string]string) {
	if !s.CSATEnabled {
		return
	}
	var sv Survey
	if c.T(&Survey{}).Where("active").Take(&sv).Error != nil {
		return
	}
	var n int64
	c.T(&SurveyResponse{}).Where("ticket_id = ?", t.ID).Count(&n)
	if n > 0 {
		return
	}
	vars["survey.url"] = vars["ticket.portal_url"] + "?rate=1"
	reqEmail, _ := a.userEmail(c.DB(), t.RequesterID)
	a.queueEmail(c.R.Context(), c.DB(), t.OrgID, "csat_survey", reqEmail, vars, "ticket", t.ID)
}

// requesterUpdate lets requesters close or reopen their own tickets.
func (a *App) requesterUpdate(c *Ctx, t *Ticket, s *Settings, in *ticketInput) error {
	if t.RequesterID != c.P.UserID {
		return errForbidden("only the requester can update this ticket")
	}
	if in.Status == nil {
		return errBadRequest("requesters can only change the ticket status")
	}
	target := *in.Status
	switch {
	case target == "closed" && isActiveStatus(t.Status) || target == "closed" && t.Status == "resolved":
		if !s.RequesterCanClose {
			return errForbidden("closing tickets from the portal is disabled")
		}
	case target == "open" && !isActiveStatus(t.Status):
		if !s.RequesterCanReopen {
			return errForbidden("reopening tickets from the portal is disabled")
		}
	default:
		return errBadRequest("unsupported status change")
	}
	from := t.Status
	transitionStatus(c.DB(), s, t, from, target)
	t.Status = target
	err := c.DB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(t).Error; err != nil {
			return err
		}
		verb := "closed the ticket"
		if target == "open" {
			verb = "reopened the ticket"
		}
		c.activity(tx, "ticket", t.ID, "status", verb, []FieldChange{{Field: "status", From: from, To: target}})
		return nil
	})
	if err != nil {
		return err
	}
	if t.ResponderID != nil {
		notify(c.DB(), *t.ResponderID, "ticket_update", "Requester changed "+ticketDisplayID(s, t)+" to "+target, t.Subject, map[string]string{"ticket_id": t.ID})
	}
	return c.JSON(http.StatusOK, c.ticketDTOs([]Ticket{*t})[0])
}

func (a *App) setTicketFlag(field string, value bool, verb string) handlerFunc {
	return func(c *Ctx) error {
		t, err := c.loadTicket(c.Param("id"))
		if err != nil {
			return err
		}
		err = c.DB().Transaction(func(tx *gorm.DB) error {
			if err := tx.Model(&Ticket{}).Where("id = ?", t.ID).Update(field, value).Error; err != nil {
				return err
			}
			c.activity(tx, "ticket", t.ID, field, verb, nil)
			return nil
		})
		if err != nil {
			return err
		}
		return c.JSON(http.StatusOK, map[string]string{"message": "ticket " + verb})
	}
}

// purgeTicket permanently removes a trashed ticket and its dependents.
func (a *App) purgeTicket(c *Ctx) error {
	t, err := c.loadTicket(c.Param("id"))
	if err != nil {
		return err
	}
	if !t.IsDeleted {
		return errBadRequest("only tickets in trash can be deleted permanently")
	}
	err = c.DB().Transaction(func(tx *gorm.DB) error {
		for _, m := range []interface{}{&Conversation{}, &WorkTask{}, &TimeEntry{}, &Activity{}, &Attachment{}} {
			tx.Where("org_id = ? AND entity_type = 'ticket' AND entity_id = ?", t.OrgID, t.ID).Delete(m)
		}
		tx.Where("org_id = ? AND ((source_type = 'ticket' AND source_id = ?) OR (target_type = 'ticket' AND target_id = ?))", t.OrgID, t.ID, t.ID).Delete(&Link{})
		tx.Where("entity_type = 'ticket' AND entity_id = ?", t.ID).Delete(&Watcher{})
		tx.Where("org_id = ? AND ticket_id = ?", t.OrgID, t.ID).Delete(&RequestedItem{})
		tx.Where("org_id = ? AND entity_type = 'ticket' AND entity_id = ?", t.OrgID, t.ID).Delete(&Approval{})
		return tx.Where("id = ?", t.ID).Delete(&Ticket{}).Error
	})
	if err != nil {
		return err
	}
	c.audit("ticket.purged", "ticket", t.ID, "Permanently deleted ticket "+ticketDisplayID(c.settings(), t), nil)
	return c.JSON(http.StatusOK, map[string]string{"message": "ticket permanently deleted"})
}

type bulkInput struct {
	IDs        []string    `json:"ids"`
	Action     string      `json:"action"`
	Properties ticketInput `json:"properties"`
}

func (a *App) bulkTickets(c *Ctx) error {
	var in bulkInput
	if err := c.Bind(&in); err != nil {
		return err
	}
	if len(in.IDs) == 0 || len(in.IDs) > 200 {
		return errBadRequest("select between 1 and 200 tickets")
	}
	if oneOf(in.Action, "delete", "spam") && !c.P.Can(PrivTicketsDelete) {
		return errForbidden("")
	}
	s := c.settings()
	var tickets []Ticket
	c.visibleTickets(c.T(&Ticket{}).Where("id IN ?", in.IDs)).Find(&tickets)
	updated := 0
	failed := map[string]string{}
	for i := range tickets {
		t := &tickets[i]
		before := *t
		switch in.Action {
		case "delete":
			c.DB().Model(&Ticket{}).Where("id = ?", t.ID).Update("is_deleted", true)
			c.activity(c.DB(), "ticket", t.ID, "is_deleted", "moved the ticket to trash", nil)
		case "spam":
			c.DB().Model(&Ticket{}).Where("id = ?", t.ID).Update("is_spam", true)
			c.activity(c.DB(), "ticket", t.ID, "is_spam", "marked the ticket as spam", nil)
		case "close", "resolve":
			target := "closed"
			if in.Action == "resolve" {
				target = "resolved"
			}
			if err := c.checkClosureFields(t); err != nil {
				failed[t.ID] = err.Error()
				continue
			}
			transitionStatus(c.DB(), s, t, t.Status, target)
			t.Status = target
			c.DB().Save(t)
			c.activity(c.DB(), "ticket", t.ID, "status", "set status to "+target, []FieldChange{{Field: "status", From: before.Status, To: target}})
			a.afterTicketUpdated(c, &before, t, s)
		case "update":
			p := in.Properties
			var changes []FieldChange
			if p.Priority != nil && *p.Priority >= 1 && *p.Priority <= 4 {
				changes = append(changes, FieldChange{Field: "priority", From: t.Priority, To: *p.Priority})
				t.Priority = *p.Priority
			}
			if p.GroupID != nil && (*p.GroupID == "" || c.existsInOrg(&AgentGroup{}, *p.GroupID)) {
				changes = append(changes, FieldChange{Field: "group_id", From: deref(t.GroupID), To: *p.GroupID})
				t.GroupID = strPtr(*p.GroupID)
			}
			if p.ResponderID != nil && (*p.ResponderID == "" || c.agentInOrg(*p.ResponderID)) {
				changes = append(changes, FieldChange{Field: "responder_id", From: deref(t.ResponderID), To: *p.ResponderID})
				t.ResponderID = strPtr(*p.ResponderID)
			}
			if p.Status != nil && validTicketStatus(s, *p.Status) && *p.Status != t.Status {
				changes = append(changes, FieldChange{Field: "status", From: t.Status, To: *p.Status})
				transitionStatus(c.DB(), s, t, t.Status, *p.Status)
				t.Status = *p.Status
			}
			if p.Type != nil && oneOf(*p.Type, "incident", "service_request") {
				t.Type = *p.Type
			}
			if p.Tags != nil {
				t.Tags = jsonOf(normalizeTags(append(stringsFrom(t.Tags), *p.Tags...)))
			}
			if before.Priority != t.Priority || deref(before.GroupID) != deref(t.GroupID) {
				applySLA(c.DB(), t)
			}
			c.DB().Save(t)
			c.activity(c.DB(), "ticket", t.ID, "updated", "bulk updated the ticket", changes)
			a.afterTicketUpdated(c, &before, t, s)
		default:
			return errBadRequest("action must be update, close, resolve, delete or spam")
		}
		updated++
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"updated": updated, "failed": failed})
}

func (a *App) mergeTickets(c *Ctx) error {
	primary, err := c.loadTicket(c.Param("id"))
	if err != nil {
		return err
	}
	var in struct {
		TicketIDs []string `json:"ticket_ids"`
		Note      string   `json:"note"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	ids := uniq(in.TicketIDs)
	if len(ids) == 0 {
		return errBadRequest("ticket_ids is required")
	}
	s := c.settings()
	var secondaries []Ticket
	c.visibleTickets(c.T(&Ticket{}).Where("id IN ? AND id <> ? AND NOT is_deleted", ids, primary.ID)).Find(&secondaries)
	if len(secondaries) == 0 {
		return errBadRequest("no mergeable tickets found")
	}
	err = c.DB().Transaction(func(tx *gorm.DB) error {
		names := []string{}
		for i := range secondaries {
			sec := &secondaries[i]
			names = append(names, ticketDisplayID(s, sec))
			tx.Model(&Conversation{}).Where("entity_type = 'ticket' AND entity_id = ?", sec.ID).Update("entity_id", primary.ID)
			tx.Model(&Attachment{}).Where("entity_type = 'ticket' AND entity_id = ?", sec.ID).Update("entity_id", primary.ID)
			tx.Create(&Conversation{Base: Base{OrgID: primary.OrgID}, EntityType: "ticket", EntityID: primary.ID, UserID: c.P.UserID, Private: true, Kind: "note",
				Body:     fmt.Sprintf("Merged from %s — %s\n\n%s", ticketDisplayID(s, sec), sec.Subject, sec.Description),
				ToEmails: jsonOf([]string{}), CCEmails: jsonOf([]string{}), AttachmentIDs: jsonOf([]string{})})
			mergedInto := primary.ID
			transitionStatus(tx, s, sec, sec.Status, "closed")
			sec.Status, sec.MergedIntoID = "closed", &mergedInto
			if err := tx.Save(sec).Error; err != nil {
				return err
			}
			c.activity(tx, "ticket", sec.ID, "merged", "merged this ticket into "+ticketDisplayID(s, primary), nil)
		}
		if in.Note != "" {
			tx.Create(&Conversation{Base: Base{OrgID: primary.OrgID}, EntityType: "ticket", EntityID: primary.ID, UserID: c.P.UserID, Private: true, Kind: "note",
				Body: in.Note, ToEmails: jsonOf([]string{}), CCEmails: jsonOf([]string{}), AttachmentIDs: jsonOf([]string{})})
		}
		c.activity(tx, "ticket", primary.ID, "merged", "merged "+strings.Join(names, ", ")+" into this ticket", nil)
		return nil
	})
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"merged": len(secondaries)})
}

func (a *App) exportTickets(c *Ctx) error {
	q := c.visibleTickets(c.T(&Ticket{})).Where("NOT is_deleted AND NOT is_spam")
	if v, ok := parseTime(c.Query("created_from")); ok && v != nil {
		q = q.Where("created_at >= ?", *v)
	}
	if v, ok := parseTime(c.Query("created_to")); ok && v != nil {
		q = q.Where("created_at <= ?", *v)
	}
	if v := c.Query("status"); v != "" {
		q = q.Where("status IN ?", strings.Split(v, ","))
	}
	var tickets []Ticket
	if err := q.Order("created_at DESC").Limit(10000).Find(&tickets).Error; err != nil {
		return err
	}
	dtos := c.ticketDTOs(tickets)
	c.W.Header().Set("Content-Type", "text/csv; charset=utf-8")
	c.W.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="tickets-%s.csv"`, now().Format("20060102")))
	w := csv.NewWriter(c.W)
	_ = w.Write([]string{"ID", "Subject", "Type", "Status", "Priority", "Source", "Requester", "Requester email", "Agent", "Group",
		"Department", "Category", "Sub category", "Tags", "Created", "Due by", "First responded", "Resolved", "Closed", "SLA"})
	ts := func(t *time.Time) string {
		if t == nil {
			return ""
		}
		return t.UTC().Format(time.RFC3339)
	}
	for _, d := range dtos {
		name := func(u *UserBrief) (string, string) {
			if u == nil {
				return "", ""
			}
			return u.Name, u.Email
		}
		rn, re := name(d.Requester)
		an, _ := name(d.Responder)
		gname, dname := "", ""
		if d.Group != nil {
			gname = d.Group.Name
		}
		if d.Department != nil {
			dname = d.Department.Name
		}
		_ = w.Write([]string{d.DisplayID, csvSafe(d.Subject), d.Type, d.Status, priorityName(d.Priority), d.Source, csvSafe(rn), re, csvSafe(an), gname, dname,
			d.Category, d.SubCategory, strings.Join(d.Tags, ";"), ts(&d.CreatedAt), ts(d.DueBy), ts(d.FirstRespondedAt), ts(d.ResolvedAt), ts(d.ClosedAt), d.SLAState})
	}
	w.Flush()
	return w.Error()
}

// csvSafe neutralizes spreadsheet formula injection.
func csvSafe(s string) string {
	if s != "" && strings.ContainsAny(s[:1], "=+-@\t\r") {
		return "'" + s
	}
	return s
}

func (a *App) rateTicket(c *Ctx) error {
	t, err := c.loadTicket(c.Param("id"))
	if err != nil {
		return err
	}
	if t.RequesterID != c.P.UserID {
		return errForbidden("only the requester can rate this ticket")
	}
	if isActiveStatus(t.Status) {
		return errBadRequest("tickets can be rated once resolved")
	}
	var in struct {
		Rating   int    `json:"rating"`
		Feedback string `json:"feedback"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	if in.Rating < 1 || in.Rating > 5 {
		return errValidation(map[string]string{"rating": "must be between 1 and 5"})
	}
	resp := SurveyResponse{Base: Base{OrgID: t.OrgID}, TicketID: t.ID, RequesterID: c.P.UserID, AgentID: t.ResponderID, GroupID: t.GroupID,
		Rating: in.Rating, Feedback: strings.TrimSpace(in.Feedback)}
	err = c.DB().Where(SurveyResponse{TicketID: t.ID}).Assign(map[string]interface{}{"rating": in.Rating, "feedback": resp.Feedback}).FirstOrCreate(&resp).Error
	if err != nil {
		return err
	}
	c.activity(c.DB(), "ticket", t.ID, "rated", fmt.Sprintf("rated the support %d/5", in.Rating), nil)
	if t.ResponderID != nil {
		notify(c.DB(), *t.ResponderID, "csat", fmt.Sprintf("New %d/5 rating on %s", in.Rating, ticketDisplayID(c.settings(), t)), resp.Feedback, map[string]string{"ticket_id": t.ID})
	}
	return c.JSON(http.StatusOK, resp)
}

func (a *App) toggleWatch(watch bool) handlerFunc {
	return func(c *Ctx) error {
		t, err := c.loadTicket(c.Param("id"))
		if err != nil {
			return err
		}
		if watch {
			c.DB().Where(Watcher{EntityType: "ticket", EntityID: t.ID, UserID: c.P.UserID}).
				FirstOrCreate(&Watcher{EntityType: "ticket", EntityID: t.ID, UserID: c.P.UserID, OrgID: t.OrgID})
		} else {
			c.DB().Where("entity_type = 'ticket' AND entity_id = ? AND user_id = ?", t.ID, c.P.UserID).Delete(&Watcher{})
		}
		return c.JSON(http.StatusOK, map[string]bool{"watching": watch})
	}
}

func (a *App) applyScenario(c *Ctx) error {
	t, err := c.loadTicket(c.Param("id"))
	if err != nil {
		return err
	}
	var sc Scenario
	if err := c.T(&Scenario{}).Where("id = ?", c.Param("scenario_id")).Take(&sc).Error; err != nil {
		return errNotFound("scenario")
	}
	if sc.Visibility == "me" && sc.CreatedByID != c.P.UserID {
		return errForbidden("")
	}
	if sc.Visibility == "groups" {
		allowed := false
		for _, g := range stringsFrom(sc.GroupIDs) {
			g := g
			if c.P.InGroup(&g) {
				allowed = true
			}
		}
		if !allowed && !c.P.IsAccountAdmin {
			return errForbidden("")
		}
	}
	var actions []Action
	_ = json.Unmarshal(sc.Actions, &actions)
	s := c.settings()
	before := *t
	res := applyActions(c.DB(), s, t, actions)
	err = c.DB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(t).Error; err != nil {
			return err
		}
		c.activity(tx, "ticket", t.ID, "scenario", "applied scenario \""+sc.Name+"\"", res.changes)
		a.finishAutomation(c.R.Context(), tx, t, res, s)
		return nil
	})
	if err != nil {
		return err
	}
	a.afterTicketUpdated(c, &before, t, s)
	return c.JSON(http.StatusOK, c.ticketDTOs([]Ticket{*t})[0])
}

// findOrCreateRequester returns the user id for email in org, creating a
// requester account (with a random password) if none exists.
func (a *App) findOrCreateRequester(db *gorm.DB, orgID, email, name string) (string, bool, error) {
	var row struct {
		ID    string
		OrgID *string
	}
	if err := db.Table("users").Select("id, org_id").Where("LOWER(email) = ?", strings.ToLower(email)).Take(&row).Error; err == nil {
		if row.OrgID == nil || *row.OrgID != orgID {
			return "", false, fmt.Errorf("belongs to a user outside this organization")
		}
		return row.ID, false, nil
	}
	u, _, err := a.createUser(db, orgID, email, name, "member", false)
	if err != nil {
		return "", false, err
	}
	return u, true, nil
}

func ptrJSON(j datatypes.JSON) datatypes.JSON { return j }

// ticketTextSearch matches tickets by number, text, category, tags, requester,
// agent, group or conversation content. Requesters never match private notes.
func (c *Ctx) ticketTextSearch(q *gorm.DB, v string) *gorm.DB {
	args := map[string]interface{}{"like": likeEscape(v), "org": c.P.OrgID, "agent": c.P.IsAgent, "num": int64(-1)}
	conds := []string{
		"itsm_tickets.subject ILIKE @like",
		"itsm_tickets.description ILIKE @like",
		"itsm_tickets.category ILIKE @like",
		"itsm_tickets.sub_category ILIKE @like",
		"itsm_tickets.item_category ILIKE @like",
		"itsm_tickets.tags::text ILIKE @like",
		"itsm_tickets.requester_id IN (SELECT id FROM users WHERE org_id = @org AND (full_name ILIKE @like OR email ILIKE @like))",
		"itsm_tickets.responder_id IN (SELECT id FROM users WHERE org_id = @org AND (full_name ILIKE @like OR email ILIKE @like))",
		"itsm_tickets.group_id IN (SELECT id FROM itsm_agent_groups WHERE org_id = @org AND name ILIKE @like)",
		`EXISTS (SELECT 1 FROM itsm_conversations cv WHERE cv.org_id = @org AND cv.entity_type = 'ticket'
			AND cv.entity_id = itsm_tickets.id AND cv.body ILIKE @like AND (@agent OR NOT cv.private))`,
	}
	if prefix, n, ok := refParts(v); ok {
		args["num"] = n
		s := c.settings()
		switch prefix {
		case "":
			conds = append(conds, "itsm_tickets.number = @num")
		case strings.ToUpper(s.PrefixIncident):
			conds = append(conds, "(itsm_tickets.number = @num AND itsm_tickets.type = 'incident')")
		case strings.ToUpper(s.PrefixServiceRequest):
			conds = append(conds, "(itsm_tickets.number = @num AND itsm_tickets.type = 'service_request')")
		}
	}
	return q.Where("("+strings.Join(conds, " OR ")+")", args)
}
