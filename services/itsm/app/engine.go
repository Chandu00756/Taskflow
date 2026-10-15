package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/chanduchitikam/task-management-system/services/itsm/rules"
	"github.com/chanduchitikam/task-management-system/services/itsm/sla"
	"gorm.io/gorm"
)

// ---------------------------------------------------------------------------
// SLA
// ---------------------------------------------------------------------------

type slaTarget struct {
	Priority          int  `json:"priority"`
	RespondWithin     int  `json:"respond_within_minutes"`
	ResolveWithin     int  `json:"resolve_within_minutes"`
	BusinessHours     bool `json:"business_hours"`
	EscalationEnabled bool `json:"escalation_enabled"`
}

type slaConditions struct {
	TicketTypes   []string `json:"ticket_types"`
	Sources       []string `json:"sources"`
	GroupIDs      []string `json:"group_ids"`
	DepartmentIDs []string `json:"department_ids"`
	Categories    []string `json:"categories"`
}

func listMatch(list []string, v string) bool {
	if len(list) == 0 {
		return true
	}
	for _, x := range list {
		if strings.EqualFold(x, v) {
			return true
		}
	}
	return false
}

func (cnd slaConditions) matches(t *Ticket) bool {
	return listMatch(cnd.TicketTypes, t.Type) && listMatch(cnd.Sources, t.Source) &&
		listMatch(cnd.GroupIDs, deref(t.GroupID)) && listMatch(cnd.DepartmentIDs, deref(t.DepartmentID)) &&
		listMatch(cnd.Categories, t.Category)
}

func policyTarget(p *SLAPolicy, priority int) *slaTarget {
	var targets []slaTarget
	_ = json.Unmarshal(p.Targets, &targets)
	for i := range targets {
		if targets[i].Priority == priority {
			return &targets[i]
		}
	}
	return nil
}

// matchPolicy returns the first active policy (by position) matching t.
func matchPolicy(db *gorm.DB, t *Ticket) *SLAPolicy {
	var policies []SLAPolicy
	db.Where("org_id = ? AND active", t.OrgID).Order("position ASC, created_at ASC").Find(&policies)
	var fallback *SLAPolicy
	for i := range policies {
		var cnd slaConditions
		_ = json.Unmarshal(policies[i].Conditions, &cnd)
		if policies[i].IsDefault && fallback == nil {
			fallback = &policies[i]
			continue
		}
		if cnd.matches(t) {
			return &policies[i]
		}
	}
	return fallback
}

// calendarFor returns the business calendar for a ticket's group or the org default.
func calendarFor(db *gorm.DB, orgID string, groupID *string) sla.Calendar {
	var bh BusinessHours
	found := false
	if groupID != nil {
		var g AgentGroup
		if db.Where("org_id = ? AND id = ?", orgID, *groupID).Take(&g).Error == nil && g.BusinessHoursID != nil {
			found = db.Where("org_id = ? AND id = ?", orgID, *g.BusinessHoursID).Take(&bh).Error == nil
		}
	}
	if !found && db.Where("org_id = ? AND is_default", orgID).Take(&bh).Error != nil {
		return sla.TwentyFourSeven()
	}
	return calendarFromModel(&bh)
}

func calendarFromModel(bh *BusinessHours) sla.Calendar {
	var days map[string][]sla.DaySpec
	var holidays []sla.Holiday
	_ = json.Unmarshal(bh.WorkingHours, &days)
	_ = json.Unmarshal(bh.Holidays, &holidays)
	cal, err := sla.NewCalendar(bh.TimeZone, bh.AlwaysOpen, days, holidays)
	if err != nil {
		return sla.TwentyFourSeven()
	}
	return cal
}

// applySLA (re)computes the SLA due dates of a ticket from its creation time,
// honoring any time already spent paused in pending states.
func applySLA(db *gorm.DB, t *Ticket) {
	policy := matchPolicy(db, t)
	if policy == nil {
		t.SLAPolicyID, t.DueBy, t.FrDueBy = nil, nil, nil
		return
	}
	t.SLAPolicyID = &policy.ID
	target := policyTarget(policy, t.Priority)
	if target == nil {
		t.DueBy, t.FrDueBy = nil, nil
		return
	}
	cal := sla.TwentyFourSeven()
	if target.BusinessHours {
		cal = calendarFor(db, t.OrgID, t.GroupID)
	}
	start := t.CreatedAt
	if start.IsZero() {
		start = now()
	}
	paused := time.Duration(t.SLAPausedSeconds) * time.Second
	if t.FirstRespondedAt == nil {
		fr := cal.Add(start, time.Duration(target.RespondWithin)*time.Minute).UTC()
		t.FrDueBy = &fr
	}
	due := cal.Add(start, time.Duration(target.ResolveWithin)*time.Minute+paused).UTC()
	t.DueBy = &due
	if t.DueBy.After(now()) {
		t.IsEscalated = false
	}
	if t.FrDueBy != nil && t.FrDueBy.After(now()) {
		t.FrEscalated = false
	}
}

// statusPausesSLA reports whether time in this status is excluded from SLA.
func statusPausesSLA(settings *Settings, status string) bool {
	if status == "pending" {
		return true
	}
	for _, cs := range customStatuses(settings) {
		if cs.Key == status {
			return cs.PauseSLA
		}
	}
	return false
}

// CustomStatus is an admin-defined ticket status.
type CustomStatus struct {
	Key           string `json:"key"`
	Label         string `json:"label"`
	CustomerLabel string `json:"customer_label"`
	PauseSLA      bool   `json:"pause_sla"`
}

func customStatuses(s *Settings) []CustomStatus {
	var out []CustomStatus
	if s != nil {
		_ = json.Unmarshal(s.CustomStatuses, &out)
	}
	return out
}

func validTicketStatus(s *Settings, status string) bool {
	if oneOf(status, "open", "pending", "resolved", "closed") {
		return true
	}
	for _, cs := range customStatuses(s) {
		if cs.Key == status {
			return true
		}
	}
	return false
}

func isActiveStatus(status string) bool { return status != "resolved" && status != "closed" }

// transitionStatus updates lifecycle timestamps and SLA pause accounting.
func transitionStatus(db *gorm.DB, settings *Settings, t *Ticket, from, to string) {
	n := now()
	if statusPausesSLA(settings, from) && !statusPausesSLA(settings, to) && t.PendingSince != nil {
		cal := calendarFor(db, t.OrgID, t.GroupID)
		t.SLAPausedSeconds += int64(cal.Between(*t.PendingSince, n).Seconds())
		t.PendingSince = nil
		applySLA(db, t)
	}
	if !statusPausesSLA(settings, from) && statusPausesSLA(settings, to) {
		t.PendingSince = &n
	}
	switch to {
	case "resolved":
		if t.ResolvedAt == nil {
			t.ResolvedAt = &n
		}
		t.ClosedAt = nil
	case "closed":
		if t.ResolvedAt == nil {
			t.ResolvedAt = &n
		}
		t.ClosedAt = &n
	default:
		t.ResolvedAt, t.ClosedAt = nil, nil
	}
}

// ---------------------------------------------------------------------------
// Automation
// ---------------------------------------------------------------------------

// Action is one automation step.
type Action struct {
	Type    string      `json:"type"`
	Value   interface{} `json:"value"`
	To      string      `json:"to,omitempty"`
	Subject string      `json:"subject,omitempty"`
	Body    string      `json:"body,omitempty"`
}

// ActionTypes lists supported action types for validation and the UI.
var ActionTypes = []string{
	"set_status", "set_priority", "set_urgency", "set_impact", "set_type", "set_group", "set_agent",
	"set_department", "set_category", "set_sub_category", "set_item_category", "add_tag", "remove_tag",
	"add_note", "send_email", "notify_agent", "add_watcher",
}

func validateActions(actions []Action) error {
	if len(actions) == 0 {
		return fmt.Errorf("at least one action is required")
	}
	for i, a := range actions {
		if !oneOf(a.Type, ActionTypes...) {
			return fmt.Errorf("action %d: unsupported type %q", i+1, a.Type)
		}
		if a.Type == "send_email" && (a.Subject == "" || a.Body == "" || a.To == "") {
			return fmt.Errorf("action %d: send_email needs to, subject and body", i+1)
		}
	}
	return nil
}

func ticketFields(t *Ticket, requesterEmail string) map[string]interface{} {
	var tags []interface{}
	_ = json.Unmarshal(t.Tags, &tags)
	f := map[string]interface{}{
		"type": t.Type, "status": t.Status, "priority": t.Priority, "urgency": t.Urgency, "impact": t.Impact,
		"source": t.Source, "requester_id": t.RequesterID, "requester_email": requesterEmail,
		"responder_id": deref(t.ResponderID), "group_id": deref(t.GroupID), "department_id": deref(t.DepartmentID),
		"category": t.Category, "sub_category": t.SubCategory, "item_category": t.ItemCategory,
		"subject": t.Subject, "description": t.Description, "tags": tags,
	}
	var custom map[string]interface{}
	_ = json.Unmarshal(t.CustomFields, &custom)
	for k, v := range custom {
		f["cf."+k] = v
	}
	return f
}

func toInt(v interface{}) (int, bool) {
	switch t := v.(type) {
	case float64:
		return int(t), true
	case int:
		return t, true
	case string:
		n, err := strconv.Atoi(t)
		return n, err == nil
	}
	return 0, false
}

// automationResult collects side effects to perform after the ticket is saved.
type automationResult struct {
	notes     []string
	emails    []Action
	notifyIDs []string
	watchers  []string
	changes   []FieldChange
}

// applyActions mutates t according to actions. It validates referenced
// groups/agents within the org and ignores invalid values.
func applyActions(db *gorm.DB, settings *Settings, t *Ticket, actions []Action) automationResult {
	var res automationResult
	set := func(field string, from, to interface{}) {
		if fmt.Sprint(from) != fmt.Sprint(to) {
			res.changes = append(res.changes, FieldChange{Field: field, From: from, To: to})
		}
	}
	str := func(v interface{}) string { return strings.TrimSpace(rules.Stringify(v)) }
	for _, a := range actions {
		switch a.Type {
		case "set_status":
			if s := str(a.Value); validTicketStatus(settings, s) && s != t.Status {
				set("status", t.Status, s)
				transitionStatus(db, settings, t, t.Status, s)
				t.Status = s
			}
		case "set_priority":
			if n, ok := toInt(a.Value); ok && n >= 1 && n <= 4 && n != t.Priority {
				set("priority", t.Priority, n)
				t.Priority = n
				applySLA(db, t)
			}
		case "set_urgency":
			if n, ok := toInt(a.Value); ok && n >= 1 && n <= 3 {
				set("urgency", t.Urgency, n)
				t.Urgency = n
			}
		case "set_impact":
			if n, ok := toInt(a.Value); ok && n >= 1 && n <= 3 {
				set("impact", t.Impact, n)
				t.Impact = n
			}
		case "set_type":
			if s := str(a.Value); oneOf(s, "incident", "service_request") {
				set("type", t.Type, s)
				t.Type = s
			}
		case "set_group":
			id := str(a.Value)
			var n int64
			db.Model(&AgentGroup{}).Where("org_id = ? AND id = ?", t.OrgID, id).Count(&n)
			if n > 0 && id != deref(t.GroupID) {
				set("group_id", deref(t.GroupID), id)
				t.GroupID = &id
				applySLA(db, t)
			}
		case "set_agent":
			id := str(a.Value)
			if isUUID(id) && id != deref(t.ResponderID) {
				var n int64
				db.Table("users u").Joins("LEFT JOIN itsm_people p ON p.user_id = u.id").
					Where("u.id = ? AND u.org_id = ? AND u.is_active AND (p.is_agent OR u.role IN ('org_admin','admin'))", id, t.OrgID).Count(&n)
				if n > 0 {
					set("responder_id", deref(t.ResponderID), id)
					t.ResponderID = &id
				}
			}
		case "set_department":
			id := str(a.Value)
			var n int64
			db.Model(&Department{}).Where("org_id = ? AND id = ?", t.OrgID, id).Count(&n)
			if n > 0 {
				set("department_id", deref(t.DepartmentID), id)
				t.DepartmentID = &id
			}
		case "set_category":
			set("category", t.Category, str(a.Value))
			t.Category = str(a.Value)
		case "set_sub_category":
			set("sub_category", t.SubCategory, str(a.Value))
			t.SubCategory = str(a.Value)
		case "set_item_category":
			set("item_category", t.ItemCategory, str(a.Value))
			t.ItemCategory = str(a.Value)
		case "add_tag", "remove_tag":
			tags := stringsFrom(t.Tags)
			tag := strings.ToLower(str(a.Value))
			out := []string{}
			for _, x := range tags {
				if x != tag {
					out = append(out, x)
				}
			}
			if a.Type == "add_tag" {
				out = append(out, tag)
			}
			out = normalizeTags(out)
			set("tags", tags, out)
			t.Tags = jsonOf(out)
		case "add_note":
			if body := str(a.Value); body != "" {
				res.notes = append(res.notes, body)
			} else if a.Body != "" {
				res.notes = append(res.notes, a.Body)
			}
		case "send_email":
			res.emails = append(res.emails, a)
		case "notify_agent":
			if id := str(a.Value); isUUID(id) {
				res.notifyIDs = append(res.notifyIDs, id)
			}
		case "add_watcher":
			if id := str(a.Value); isUUID(id) {
				res.watchers = append(res.watchers, id)
			}
		}
	}
	return res
}

// runWorkflows evaluates active workflows for an event and applies matching
// actions to t. Workflows never trigger other workflows.
func (a *App) runWorkflows(ctx context.Context, db *gorm.DB, settings *Settings, event string, t *Ticket, changes map[string]rules.Change) automationResult {
	var flows []Workflow
	db.Where("org_id = ? AND event = ? AND active AND module = 'ticket'", t.OrgID, event).Order("position ASC, created_at ASC").Find(&flows)
	var total automationResult
	if len(flows) == 0 {
		return total
	}
	reqEmail, _ := a.userEmail(db, t.RequesterID)
	for _, wf := range flows {
		var cond rules.ConditionSet
		_ = json.Unmarshal(wf.Conditions, &cond)
		if !rules.Evaluate(cond, ticketFields(t, reqEmail), changes) {
			continue
		}
		var actions []Action
		_ = json.Unmarshal(wf.Actions, &actions)
		res := applyActions(db, settings, t, actions)
		total.notes = append(total.notes, res.notes...)
		total.emails = append(total.emails, res.emails...)
		total.notifyIDs = append(total.notifyIDs, res.notifyIDs...)
		total.watchers = append(total.watchers, res.watchers...)
		for _, ch := range res.changes {
			ch.Field = ch.Field + " (workflow: " + wf.Name + ")"
			total.changes = append(total.changes, ch)
		}
		n := now()
		db.Model(&Workflow{}).Where("id = ?", wf.ID).Updates(map[string]interface{}{
			"execution_count": gorm.Expr("execution_count + 1"), "last_executed_at": &n,
		})
		if wf.StopProcessing {
			break
		}
	}
	return total
}

// finishAutomation persists side effects collected from workflows/scenarios.
func (a *App) finishAutomation(ctx context.Context, db *gorm.DB, t *Ticket, res automationResult, settings *Settings) {
	for _, note := range res.notes {
		db.Create(&Conversation{Base: Base{OrgID: t.OrgID}, EntityType: "ticket", EntityID: t.ID, Body: note,
			Private: true, Kind: "note", UserID: t.CreatedByID, ToEmails: jsonOf([]string{}), CCEmails: jsonOf([]string{}), AttachmentIDs: jsonOf([]string{})})
	}
	vars := a.ticketVars(db, t, settings)
	for _, e := range res.emails {
		to := e.To
		switch e.To {
		case "requester":
			to, _ = a.userEmail(db, t.RequesterID)
		case "agent":
			if t.ResponderID != nil {
				to, _ = a.userEmail(db, *t.ResponderID)
			}
		}
		if validEmail(to) {
			db.Create(&EmailOutbox{Base: Base{OrgID: t.OrgID}, ToAddr: to, Subject: renderTemplate(e.Subject, vars),
				Body: renderTemplate(e.Body, vars), Status: "queued", EntityType: "ticket", EntityID: t.ID})
		}
	}
	for _, id := range res.notifyIDs {
		notify(db, id, "ticket_update", "Ticket "+vars["ticket.id"], t.Subject, map[string]string{"ticket_id": t.ID})
	}
	for _, id := range res.watchers {
		db.Where(Watcher{EntityType: "ticket", EntityID: t.ID, UserID: id}).
			FirstOrCreate(&Watcher{EntityType: "ticket", EntityID: t.ID, UserID: id, OrgID: t.OrgID})
	}
}

// autoAssign picks the next available agent in the ticket's group (round robin).
func autoAssign(db *gorm.DB, t *Ticket) bool {
	if t.ResponderID != nil || t.GroupID == nil {
		return false
	}
	var g AgentGroup
	if db.Where("org_id = ? AND id = ?", t.OrgID, *t.GroupID).Take(&g).Error != nil || !g.AutoAssign {
		return false
	}
	var ids []string
	db.Table("itsm_group_members gm").
		Joins("JOIN users u ON u.id = gm.user_id").
		Joins("LEFT JOIN itsm_people p ON p.user_id = gm.user_id").
		Where(`gm.group_id = ? AND u.is_active AND (p.available IS NULL OR p.available) AND COALESCE(gm.role, 'member') = 'member'
			AND NOT (p.ooo_start IS NOT NULL AND p.ooo_end IS NOT NULL AND p.ooo_start <= ? AND p.ooo_end > ?)`, g.ID, now(), now()).
		Order("gm.user_id").Pluck("gm.user_id", &ids)
	if len(ids) == 0 {
		return false
	}
	pick := ids[g.RoundRobinCursor%len(ids)]
	db.Model(&AgentGroup{}).Where("id = ?", g.ID).Update("round_robin_cursor", (g.RoundRobinCursor+1)%len(ids))
	t.ResponderID = &pick
	return true
}

// ticketVars builds template placeholders for a ticket.
func (a *App) ticketVars(db *gorm.DB, t *Ticket, settings *Settings) map[string]string {
	reqEmail, reqName := a.userEmail(db, t.RequesterID)
	vars := map[string]string{
		"ticket.id": ticketDisplayID(settings, t), "ticket.subject": t.Subject, "ticket.status": titleCase(t.Status),
		"ticket.priority": priorityName(t.Priority), "ticket.requester_name": reqName, "ticket.requester_email": reqEmail,
		"ticket.url":        strings.TrimRight(a.Cfg.PublicURL, "/") + "/tickets/" + t.ID,
		"ticket.portal_url": strings.TrimRight(a.Cfg.PublicURL, "/") + "/portal/tickets/" + t.ID,
		"helpdesk.name":     settings.HelpdeskName,
	}
	if t.ResponderID != nil {
		_, vars["agent.name"] = a.userEmail(db, *t.ResponderID)
	}
	if t.GroupID != nil {
		var g AgentGroup
		if db.Where("id = ?", *t.GroupID).Take(&g).Error == nil {
			vars["ticket.group"] = g.Name
		}
	}
	return vars
}

func ticketDisplayID(s *Settings, t *Ticket) string {
	prefix := "INC"
	if s != nil && s.PrefixIncident != "" {
		prefix = s.PrefixIncident
	}
	if t.Type == "service_request" {
		prefix = "SR"
		if s != nil && s.PrefixServiceRequest != "" {
			prefix = s.PrefixServiceRequest
		}
	}
	return displayID(prefix, t.Number)
}
