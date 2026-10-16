package app

import (
	"fmt"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
)

// moduleEntity maps URL module names to entity types and view privileges.
var moduleEntity = map[string]struct {
	entity     string
	viewPriv   string
	managePriv string
}{
	"tickets":  {"ticket", "", PrivTicketsManage},
	"problems": {"problem", PrivProblemsView, PrivProblemsManage},
	"changes":  {"change", PrivChangesView, PrivChangesManage},
	"releases": {"release", PrivReleasesView, PrivReleasesManage},
	// Work item access follows project membership instead of a privilege.
	"work-items": {"work_item", "", ""},
}

// entityRef identifies a record a collaboration item belongs to.
type entityRef struct {
	Type       string
	ID         string
	ticket     *Ticket
	workItem   *WorkItem
	project    *Project
	canEdit    bool
	managePriv string
}

// resolveEntity loads the parent record from the URL and checks visibility.
func (c *Ctx) resolveEntity(module, id string) (*entityRef, error) {
	m, ok := moduleEntity[module]
	if !ok {
		return nil, errNotFound("module")
	}
	ref := &entityRef{Type: m.entity, ID: id, managePriv: m.managePriv}
	switch m.entity {
	case "ticket":
		t, err := c.loadTicket(id)
		if err != nil {
			return nil, err
		}
		ref.ticket = t
	case "work_item":
		w, p, perms, err := c.loadWorkItem(id)
		if err != nil {
			return nil, err
		}
		ref.workItem, ref.project, ref.canEdit = w, p, perms.edit
	default:
		if !c.P.IsAgent || !c.P.Can(m.viewPriv) {
			return nil, errForbidden("")
		}
		var model interface{}
		switch m.entity {
		case "problem":
			model = &Problem{}
		case "change":
			model = &Change{}
		case "release":
			model = &Release{}
		}
		if !c.existsInOrg(model, id) {
			return nil, errNotFound(m.entity)
		}
	}
	return ref, nil
}

func (c *Ctx) requireManage(ref *entityRef) error {
	if ref.workItem != nil {
		if !ref.canEdit {
			return errForbidden("only project members can change this work item")
		}
		return nil
	}
	if !c.P.IsAgent || !c.P.Can(ref.managePriv) {
		return errForbidden("")
	}
	return nil
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

// ConversationDTO adds author details.
type ConversationDTO struct {
	*Conversation
	Author      *UserBrief   `json:"author"`
	Attachments []Attachment `json:"attachments"`
	ToEmails    []string     `json:"to_emails"`
	CCEmails    []string     `json:"cc_emails"`
}

func (a *App) listConversations(module string) handlerFunc {
	return func(c *Ctx) error {
		ref, err := c.resolveEntity(module, c.Param("id"))
		if err != nil {
			return err
		}
		q := c.T(&Conversation{}).Where("entity_type = ? AND entity_id = ?", ref.Type, ref.ID)
		if !c.P.IsAgent {
			q = q.Where("NOT private")
		}
		var convs []Conversation
		if err := q.Order("created_at ASC").Find(&convs).Error; err != nil {
			return err
		}
		uids := []string{}
		cids := []string{}
		for _, cv := range convs {
			uids = append(uids, cv.UserID)
			cids = append(cids, cv.ID)
		}
		l := c.lookup(uids, nil, nil)
		attByConv := map[string][]Attachment{}
		if len(cids) > 0 {
			var atts []Attachment
			c.T(&Attachment{}).Select("id, org_id, entity_type, entity_id, name, content_type, size, uploaded_by, created_at, updated_at").
				Where("entity_type = 'conversation' AND entity_id IN ?", cids).Find(&atts)
			for _, at := range atts {
				attByConv[at.EntityID] = append(attByConv[at.EntityID], at)
			}
		}
		out := make([]ConversationDTO, len(convs))
		for i := range convs {
			atts := attByConv[convs[i].ID]
			if atts == nil {
				atts = []Attachment{}
			}
			out[i] = ConversationDTO{Conversation: &convs[i], Author: l.userS(convs[i].UserID), Attachments: atts,
				ToEmails: stringsFrom(convs[i].ToEmails), CCEmails: stringsFrom(convs[i].CCEmails)}
		}
		return c.JSON(http.StatusOK, map[string]interface{}{"items": out})
	}
}

type conversationInput struct {
	Body          string   `json:"body"`
	Private       *bool    `json:"private"`
	CCEmails      []string `json:"cc_emails"`
	ToEmails      []string `json:"to_emails"`
	AttachmentIDs []string `json:"attachment_ids"`
	NotifyIDs     []string `json:"notify_ids"`
	Status        string   `json:"status"`
}

func cleanEmails(list []string) ([]string, bool) {
	out := []string{}
	for _, e := range list {
		e = strings.ToLower(strings.TrimSpace(e))
		if e == "" {
			continue
		}
		if !validEmail(e) {
			return nil, false
		}
		out = append(out, e)
	}
	return out, true
}

// addConversation handles replies, notes and forwards. kind is reply|note|forward.
func (a *App) addConversation(module, kind string) handlerFunc {
	return func(c *Ctx) error {
		ref, err := c.resolveEntity(module, c.Param("id"))
		if err != nil {
			return err
		}
		var in conversationInput
		if err := c.Bind(&in); err != nil {
			return err
		}
		in.Body = strings.TrimSpace(in.Body)
		if in.Body == "" {
			return errValidation(map[string]string{"body": "is required"})
		}
		if len(in.Body) > 100000 {
			return errValidation(map[string]string{"body": "is too long"})
		}
		cc, ok := cleanEmails(in.CCEmails)
		if !ok {
			return errValidation(map[string]string{"cc_emails": "contains an invalid address"})
		}
		to, ok := cleanEmails(in.ToEmails)
		if !ok {
			return errValidation(map[string]string{"to_emails": "contains an invalid address"})
		}
		conv := Conversation{Base: Base{OrgID: c.P.OrgID}, EntityType: ref.Type, EntityID: ref.ID, UserID: c.P.UserID,
			Body: in.Body, Kind: kind, CCEmails: jsonOf(cc), ToEmails: jsonOf(to), AttachmentIDs: jsonOf([]string{})}
		switch kind {
		case "note":
			if !c.P.IsAgent {
				return errForbidden("only agents can add notes")
			}
			conv.Private = in.Private == nil || *in.Private
		case "forward":
			if !c.P.IsAgent || ref.ticket == nil {
				return errForbidden("")
			}
			if len(to) == 0 {
				return errValidation(map[string]string{"to_emails": "is required"})
			}
			conv.Private = true
		case "reply":
			if ref.ticket == nil {
				return errBadRequest("replies are only supported on tickets")
			}
			if c.P.IsAgent && !c.P.Can(PrivTicketsManage) {
				return errForbidden("")
			}
			conv.Incoming = !c.P.IsAgent
		}
		s := c.settings()
		t := ref.ticket
		var before Ticket
		if t != nil {
			before = *t
		}
		err = c.DB().Transaction(func(tx *gorm.DB) error {
			if err := tx.Create(&conv).Error; err != nil {
				return err
			}
			ids := c.attachFiles(tx, "conversation", conv.ID, in.AttachmentIDs)
			if len(ids) > 0 {
				conv.AttachmentIDs = jsonOf(ids)
				tx.Model(&Conversation{}).Where("id = ?", conv.ID).Update("attachment_ids", conv.AttachmentIDs)
			}
			if t == nil {
				summary := "added a note"
				if ref.workItem != nil {
					summary = "commented"
				}
				c.activity(tx, ref.Type, ref.ID, "note", summary, nil)
				return nil
			}
			changed := false
			switch {
			case kind == "reply" && c.P.IsAgent:
				if t.FirstRespondedAt == nil {
					n := now()
					t.FirstRespondedAt = &n
					changed = true
				}
				if in.Status != "" && in.Status != t.Status && validTicketStatus(s, in.Status) {
					transitionStatus(tx, s, t, t.Status, in.Status)
					t.Status = in.Status
					changed = true
				}
			case kind == "reply" && !c.P.IsAgent:
				if t.Status != "open" {
					transitionStatus(tx, s, t, t.Status, "open")
					t.Status = "open"
					changed = true
				}
			}
			if changed {
				if err := tx.Save(t).Error; err != nil {
					return err
				}
			} else {
				tx.Model(&Ticket{}).Where("id = ?", t.ID).Update("updated_at", now())
			}
			verb := map[string]string{"reply": "replied", "note": "added a private note", "forward": "forwarded the ticket"}[kind]
			if kind == "note" && !conv.Private {
				verb = "added a public note"
			}
			var changes []FieldChange
			if before.Status != t.Status {
				changes = append(changes, FieldChange{Field: "status", From: before.Status, To: t.Status})
			}
			c.activity(tx, "ticket", t.ID, kind, verb, changes)
			return nil
		})
		if err != nil {
			return err
		}
		if t != nil {
			a.afterConversation(c, t, &before, &conv, in, s)
		} else if w := ref.workItem; w != nil {
			// Comments reach the assignee, the reporter and anyone mentioned.
			disp := displayID(ref.project.Key, w.Number)
			meta := map[string]string{"work_item_id": w.ID, "project_id": ref.project.ID}
			notified := map[string]bool{c.P.UserID: true}
			for _, id := range uniq(in.NotifyIDs) {
				if !notified[id] && c.userInOrg(id) {
					notified[id] = true
					notify(c.DB(), id, "mention", c.P.Name+" mentioned you on "+disp, truncate(in.Body, 140), meta)
				}
			}
			subscribeWorkItem(c.DB(), c.P.OrgID, w.ID, c.P.UserID)
			for _, id := range c.workItemAudience(w) {
				if id != "" && !notified[id] {
					notified[id] = true
					notify(c.DB(), id, "work_item_comment", c.P.Name+" commented on "+disp, truncate(in.Body, 140), meta)
				}
			}
		} else {
			for _, id := range uniq(in.NotifyIDs) {
				notify(c.DB(), id, "mention", c.P.Name+" mentioned you on a "+ref.Type, truncate(in.Body, 140), map[string]string{ref.Type + "_id": ref.ID})
			}
		}
		l := c.lookup([]string{conv.UserID}, nil, nil)
		return c.JSON(http.StatusCreated, ConversationDTO{Conversation: &conv, Author: l.userS(conv.UserID), Attachments: []Attachment{},
			ToEmails: stringsFrom(conv.ToEmails), CCEmails: stringsFrom(conv.CCEmails)})
	}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

func (a *App) afterConversation(c *Ctx, t, before *Ticket, conv *Conversation, in conversationInput, s *Settings) {
	db := c.DB()
	vars := a.ticketVars(db, t, s)
	vars["reply.body"] = conv.Body
	vars["agent.name"] = c.P.Name
	disp := vars["ticket.id"]
	switch conv.Kind {
	case "reply":
		if c.P.IsAgent {
			reqEmail, _ := a.userEmail(db, t.RequesterID)
			a.queueEmail(c.R.Context(), db, t.OrgID, "agent_reply_requester", reqEmail, vars, "ticket", t.ID)
			for _, e := range append(stringsFrom(t.CCEmails), stringsFrom(conv.CCEmails)...) {
				a.queueEmail(c.R.Context(), db, t.OrgID, "agent_reply_requester", e, vars, "ticket", t.ID)
			}
			notify(db, t.RequesterID, "ticket_reply", "New reply on "+disp, truncate(conv.Body, 140), map[string]string{"ticket_id": t.ID})
		} else {
			if t.ResponderID != nil {
				notify(db, *t.ResponderID, "ticket_reply", "Requester replied on "+disp, truncate(conv.Body, 140), map[string]string{"ticket_id": t.ID})
				if email, _ := a.userEmail(db, *t.ResponderID); email != "" {
					a.queueEmail(c.R.Context(), db, t.OrgID, "requester_reply_agent", email, vars, "ticket", t.ID)
				}
			}
		}
	case "forward":
		for _, to := range stringsFrom(conv.ToEmails) {
			db.Create(&EmailOutbox{Base: Base{OrgID: t.OrgID}, ToAddr: to, Subject: "Fwd: [" + disp + "] " + t.Subject,
				Body: conv.Body + "\n\n---------- Forwarded ticket ----------\n" + t.Description, Status: "queued", EntityType: "ticket", EntityID: t.ID})
		}
	case "note":
		for _, id := range uniq(in.NotifyIDs) {
			notify(db, id, "mention", c.P.Name+" mentioned you on "+disp, truncate(conv.Body, 140), map[string]string{"ticket_id": t.ID})
		}
	}
	a.notifyWatchers(c, t, c.P.Name+" updated "+disp)
	if before.Status != t.Status && (t.Status == "resolved" || t.Status == "closed") {
		a.sendSurvey(c, t, s, vars)
	}
}

func (a *App) updateConversation(c *Ctx) error {
	var conv Conversation
	if err := c.T(&Conversation{}).Where("id = ?", c.Param("id")).Take(&conv).Error; err != nil {
		return errNotFound("conversation")
	}
	if conv.UserID != c.P.UserID && !c.P.IsAccountAdmin {
		return errForbidden("you can only edit your own messages")
	}
	if conv.Kind != "note" {
		return errBadRequest("only notes can be edited")
	}
	var in struct {
		Body string `json:"body"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	if strings.TrimSpace(in.Body) == "" {
		return errValidation(map[string]string{"body": "is required"})
	}
	conv.Body = strings.TrimSpace(in.Body)
	if err := c.DB().Save(&conv).Error; err != nil {
		return err
	}
	return c.JSON(http.StatusOK, conv)
}

func (a *App) deleteConversation(c *Ctx) error {
	var conv Conversation
	if err := c.T(&Conversation{}).Where("id = ?", c.Param("id")).Take(&conv).Error; err != nil {
		return errNotFound("conversation")
	}
	if !c.P.IsAgent || (conv.UserID != c.P.UserID && !c.P.IsAccountAdmin) {
		return errForbidden("you can only delete your own messages")
	}
	err := c.DB().Transaction(func(tx *gorm.DB) error {
		tx.Where("org_id = ? AND entity_type = 'conversation' AND entity_id = ?", c.P.OrgID, conv.ID).Delete(&Attachment{})
		if err := tx.Delete(&conv).Error; err != nil {
			return err
		}
		c.activity(tx, conv.EntityType, conv.EntityID, "conversation_deleted", "deleted a "+conv.Kind, nil)
		return nil
	})
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "deleted"})
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

type taskInput struct {
	Title       *string `json:"title"`
	Description *string `json:"description"`
	Status      *string `json:"status"`
	DueDate     *string `json:"due_date"`
	AgentID     *string `json:"agent_id"`
	GroupID     *string `json:"group_id"`
}

// TaskDTO enriches a task with assignee details.
type TaskDTO struct {
	*WorkTask
	Agent *UserBrief `json:"agent"`
	Group *Ref       `json:"group"`
}

func (c *Ctx) taskDTOs(tasks []WorkTask) []TaskDTO {
	var uids, gids []string
	for _, t := range tasks {
		uids = append(uids, deref(t.AgentID))
		gids = append(gids, deref(t.GroupID))
	}
	l := c.lookup(uids, gids, nil)
	out := make([]TaskDTO, len(tasks))
	for i := range tasks {
		out[i] = TaskDTO{WorkTask: &tasks[i], Agent: l.user(tasks[i].AgentID), Group: l.group(tasks[i].GroupID)}
	}
	return out
}

func (a *App) listTasks(module string) handlerFunc {
	return func(c *Ctx) error {
		ref, err := c.resolveEntity(module, c.Param("id"))
		if err != nil {
			return err
		}
		if !c.P.IsAgent {
			return errForbidden("")
		}
		var tasks []WorkTask
		c.T(&WorkTask{}).Where("entity_type = ? AND entity_id = ?", ref.Type, ref.ID).Order("created_at ASC").Find(&tasks)
		return c.JSON(http.StatusOK, map[string]interface{}{"items": c.taskDTOs(tasks)})
	}
}

func (c *Ctx) applyTaskInput(t *WorkTask, in *taskInput) error {
	errs := map[string]string{}
	if in.Title != nil {
		t.Title = strings.TrimSpace(*in.Title)
	}
	if t.Title == "" {
		errs["title"] = "is required"
	}
	if in.Description != nil {
		t.Description = *in.Description
	}
	if in.Status != nil {
		if !oneOf(*in.Status, "open", "in_progress", "completed") {
			errs["status"] = "must be open, in_progress or completed"
		} else {
			if *in.Status == "completed" && t.Status != "completed" {
				n := now()
				t.CompletedAt = &n
			} else if *in.Status != "completed" {
				t.CompletedAt = nil
			}
			t.Status = *in.Status
		}
	}
	if in.DueDate != nil {
		d, ok := parseTime(*in.DueDate)
		if !ok {
			errs["due_date"] = "is invalid"
		}
		t.DueDate = d
	}
	if in.AgentID != nil {
		t.AgentID = strPtr(*in.AgentID)
		c.optionalRef(errs, "agent_id", t.AgentID, c.agentInOrg)
	}
	if in.GroupID != nil {
		t.GroupID = strPtr(*in.GroupID)
		c.optionalRef(errs, "group_id", t.GroupID, func(id string) bool { return c.existsInOrg(&AgentGroup{}, id) })
	}
	if len(errs) > 0 {
		return errValidation(errs)
	}
	return nil
}

func (a *App) createTask(module string) handlerFunc {
	return func(c *Ctx) error {
		ref, err := c.resolveEntity(module, c.Param("id"))
		if err != nil {
			return err
		}
		if err := c.requireManage(ref); err != nil {
			return err
		}
		var in taskInput
		if err := c.Bind(&in); err != nil {
			return err
		}
		t := WorkTask{Base: Base{OrgID: c.P.OrgID}, EntityType: ref.Type, EntityID: ref.ID, Status: "open", CreatedByID: c.P.UserID}
		if err := c.applyTaskInput(&t, &in); err != nil {
			return err
		}
		if err := c.DB().Create(&t).Error; err != nil {
			return err
		}
		c.activity(c.DB(), ref.Type, ref.ID, "task", "added task \""+t.Title+"\"", nil)
		if t.AgentID != nil && *t.AgentID != c.P.UserID {
			notify(c.DB(), *t.AgentID, "task_assigned", "Task assigned: "+t.Title, "", map[string]string{ref.Type + "_id": ref.ID})
		}
		return c.JSON(http.StatusCreated, c.taskDTOs([]WorkTask{t})[0])
	}
}

func (c *Ctx) loadTaskForEdit(id string) (*WorkTask, error) {
	var t WorkTask
	if err := c.T(&WorkTask{}).Where("id = ?", id).Take(&t).Error; err != nil {
		return nil, errNotFound("task")
	}
	module := map[string]string{"ticket": "tickets", "problem": "problems", "change": "changes", "release": "releases"}[t.EntityType]
	ref, err := c.resolveEntity(module, t.EntityID)
	if err != nil {
		return nil, err
	}
	if !c.P.IsAgent {
		return nil, errForbidden("")
	}
	if !c.P.Can(ref.managePriv) && deref(t.AgentID) != c.P.UserID {
		return nil, errForbidden("")
	}
	return &t, nil
}

func (a *App) updateTask(c *Ctx) error {
	t, err := c.loadTaskForEdit(c.Param("id"))
	if err != nil {
		return err
	}
	var in taskInput
	if err := c.Bind(&in); err != nil {
		return err
	}
	before := t.Status
	if err := c.applyTaskInput(t, &in); err != nil {
		return err
	}
	if err := c.DB().Save(t).Error; err != nil {
		return err
	}
	if before != t.Status {
		c.activity(c.DB(), t.EntityType, t.EntityID, "task", "marked task \""+t.Title+"\" as "+strings.ReplaceAll(t.Status, "_", " "), nil)
	}
	return c.JSON(http.StatusOK, c.taskDTOs([]WorkTask{*t})[0])
}

func (a *App) deleteTask(c *Ctx) error {
	t, err := c.loadTaskForEdit(c.Param("id"))
	if err != nil {
		return err
	}
	if err := c.DB().Delete(t).Error; err != nil {
		return err
	}
	c.activity(c.DB(), t.EntityType, t.EntityID, "task", "deleted task \""+t.Title+"\"", nil)
	return c.JSON(http.StatusOK, map[string]string{"message": "deleted"})
}

// myTasks lists open tasks assigned to the caller across all modules.
func (a *App) myTasks(c *Ctx) error {
	var tasks []WorkTask
	q := c.T(&WorkTask{}).Where("agent_id = ?", c.P.UserID)
	if c.Query("include_completed") != "true" {
		q = q.Where("status <> 'completed'")
	}
	q.Order("due_date ASC NULLS LAST, created_at DESC").Limit(200).Find(&tasks)
	return c.JSON(http.StatusOK, map[string]interface{}{"items": c.taskDTOs(tasks)})
}

// ---------------------------------------------------------------------------
// Time entries
// ---------------------------------------------------------------------------

type timeInput struct {
	Minutes    *int    `json:"minutes"`
	Note       *string `json:"note"`
	Billable   *bool   `json:"billable"`
	ExecutedAt *string `json:"executed_at"`
	AgentID    *string `json:"agent_id"`
	StartTimer bool    `json:"start_timer"`
}

// TimeEntryDTO enriches a time entry with the agent.
type TimeEntryDTO struct {
	*TimeEntry
	Agent *UserBrief `json:"agent"`
}

func (a *App) listTimeEntries(module string) handlerFunc {
	return func(c *Ctx) error {
		ref, err := c.resolveEntity(module, c.Param("id"))
		if err != nil {
			return err
		}
		if !c.P.IsAgent {
			return errForbidden("")
		}
		var entries []TimeEntry
		c.T(&TimeEntry{}).Where("entity_type = ? AND entity_id = ?", ref.Type, ref.ID).Order("executed_at DESC").Find(&entries)
		ids := []string{}
		total := 0
		for _, e := range entries {
			ids = append(ids, e.AgentID)
			total += e.Minutes
			if e.TimerRunning && e.StartedAt != nil {
				total += int(time.Since(*e.StartedAt).Minutes())
			}
		}
		l := c.lookup(ids, nil, nil)
		out := make([]TimeEntryDTO, len(entries))
		for i := range entries {
			out[i] = TimeEntryDTO{TimeEntry: &entries[i], Agent: l.userS(entries[i].AgentID)}
		}
		return c.JSON(http.StatusOK, map[string]interface{}{"items": out, "total_minutes": total})
	}
}

func (a *App) createTimeEntry(module string) handlerFunc {
	return func(c *Ctx) error {
		ref, err := c.resolveEntity(module, c.Param("id"))
		if err != nil {
			return err
		}
		if !c.P.IsAgent {
			return errForbidden("")
		}
		var in timeInput
		if err := c.Bind(&in); err != nil {
			return err
		}
		e := TimeEntry{Base: Base{OrgID: c.P.OrgID}, EntityType: ref.Type, EntityID: ref.ID, AgentID: c.P.UserID, ExecutedAt: now(), Billable: true}
		if in.AgentID != nil && *in.AgentID != "" {
			if !c.agentInOrg(*in.AgentID) {
				return errValidation(map[string]string{"agent_id": "is invalid"})
			}
			e.AgentID = *in.AgentID
		}
		if in.Note != nil {
			e.Note = *in.Note
		}
		if in.Billable != nil {
			e.Billable = *in.Billable
		}
		if in.ExecutedAt != nil {
			if t, ok := parseTime(*in.ExecutedAt); ok && t != nil {
				e.ExecutedAt = *t
			}
		}
		if in.StartTimer {
			n := now()
			e.TimerRunning, e.StartedAt = true, &n
			c.T(&TimeEntry{}).Where("agent_id = ? AND timer_running", e.AgentID).Updates(map[string]interface{}{"timer_running": false})
		} else {
			if in.Minutes == nil || *in.Minutes <= 0 || *in.Minutes > 24*60 {
				return errValidation(map[string]string{"minutes": "must be between 1 and 1440"})
			}
			e.Minutes = *in.Minutes
		}
		if err := c.DB().Create(&e).Error; err != nil {
			return err
		}
		c.activity(c.DB(), ref.Type, ref.ID, "time", fmt.Sprintf("logged %s", formatMinutes(e.Minutes)), nil)
		return c.JSON(http.StatusCreated, e)
	}
}

func formatMinutes(m int) string {
	if m < 60 {
		return fmt.Sprintf("%dm", m)
	}
	return fmt.Sprintf("%dh %02dm", m/60, m%60)
}

func (a *App) loadTimeEntry(c *Ctx) (*TimeEntry, error) {
	var e TimeEntry
	if err := c.T(&TimeEntry{}).Where("id = ?", c.Param("id")).Take(&e).Error; err != nil {
		return nil, errNotFound("time entry")
	}
	if e.AgentID != c.P.UserID && !c.P.IsAccountAdmin {
		return nil, errForbidden("you can only change your own time entries")
	}
	return &e, nil
}

func (a *App) updateTimeEntry(c *Ctx) error {
	e, err := a.loadTimeEntry(c)
	if err != nil {
		return err
	}
	var in timeInput
	if err := c.Bind(&in); err != nil {
		return err
	}
	if in.Minutes != nil {
		if *in.Minutes < 0 || *in.Minutes > 24*60 {
			return errValidation(map[string]string{"minutes": "must be between 0 and 1440"})
		}
		e.Minutes = *in.Minutes
	}
	if in.Note != nil {
		e.Note = *in.Note
	}
	if in.Billable != nil {
		e.Billable = *in.Billable
	}
	if err := c.DB().Save(e).Error; err != nil {
		return err
	}
	return c.JSON(http.StatusOK, e)
}

func (a *App) toggleTimer(c *Ctx) error {
	e, err := a.loadTimeEntry(c)
	if err != nil {
		return err
	}
	n := now()
	if e.TimerRunning && e.StartedAt != nil {
		e.Minutes += int(n.Sub(*e.StartedAt).Minutes())
		e.TimerRunning, e.StartedAt = false, nil
	} else {
		c.T(&TimeEntry{}).Where("agent_id = ? AND timer_running", e.AgentID).Update("timer_running", false)
		e.TimerRunning, e.StartedAt = true, &n
	}
	if err := c.DB().Save(e).Error; err != nil {
		return err
	}
	return c.JSON(http.StatusOK, e)
}

func (a *App) deleteTimeEntry(c *Ctx) error {
	e, err := a.loadTimeEntry(c)
	if err != nil {
		return err
	}
	if err := c.DB().Delete(e).Error; err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "deleted"})
}

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

func (a *App) listActivities(module string) handlerFunc {
	return func(c *Ctx) error {
		ref, err := c.resolveEntity(module, c.Param("id"))
		if err != nil {
			return err
		}
		var acts []Activity
		c.T(&Activity{}).Where("entity_type = ? AND entity_id = ?", ref.Type, ref.ID).Order("created_at DESC").Limit(500).Find(&acts)
		ids := []string{}
		for _, ac := range acts {
			ids = append(ids, deref(ac.ActorID))
		}
		l := c.lookup(ids, nil, nil)
		out := []map[string]interface{}{}
		for _, ac := range acts {
			if !c.P.IsAgent && strings.Contains(ac.Summary, "private note") {
				continue
			}
			var ch interface{}
			if c.P.IsAgent {
				ch = ac.Changes
			}
			out = append(out, map[string]interface{}{"id": ac.ID, "action": ac.Action, "summary": ac.Summary, "changes": ch,
				"actor": l.user(ac.ActorID), "created_at": ac.CreatedAt})
		}
		return c.JSON(http.StatusOK, map[string]interface{}{"items": out})
	}
}

// ---------------------------------------------------------------------------
// Associations
// ---------------------------------------------------------------------------

var linkableTypes = []string{"ticket", "problem", "change", "release", "asset", "work_item"}

func (c *Ctx) entitySummary(typ, id string) map[string]interface{} {
	s := c.settings()
	switch typ {
	case "ticket":
		var t Ticket
		if c.T(&Ticket{}).Where("id = ?", id).Take(&t).Error == nil {
			return map[string]interface{}{"id": t.ID, "type": "ticket", "display_id": ticketDisplayID(s, &t), "title": t.Subject, "status": t.Status, "priority": t.Priority}
		}
	case "problem":
		var p Problem
		if c.T(&Problem{}).Where("id = ?", id).Take(&p).Error == nil {
			return map[string]interface{}{"id": p.ID, "type": "problem", "display_id": displayID(s.PrefixProblem, p.Number), "title": p.Subject, "status": p.Status, "priority": p.Priority}
		}
	case "change":
		var ch Change
		if c.T(&Change{}).Where("id = ?", id).Take(&ch).Error == nil {
			return map[string]interface{}{"id": ch.ID, "type": "change", "display_id": displayID(s.PrefixChange, ch.Number), "title": ch.Subject, "status": ch.Status, "priority": ch.Priority}
		}
	case "release":
		var r Release
		if c.T(&Release{}).Where("id = ?", id).Take(&r).Error == nil {
			return map[string]interface{}{"id": r.ID, "type": "release", "display_id": displayID(s.PrefixRelease, r.Number), "title": r.Subject, "status": r.Status, "priority": r.Priority}
		}
	case "asset":
		var as Asset
		if c.T(&Asset{}).Where("id = ?", id).Take(&as).Error == nil {
			return map[string]interface{}{"id": as.ID, "type": "asset", "display_id": "ASSET-" + strconv.FormatInt(as.Number, 10), "title": as.Name, "status": as.State}
		}
	case "work_item":
		if w, p, _, err := c.loadWorkItem(id); err == nil {
			return map[string]interface{}{"id": w.ID, "type": "work_item", "display_id": displayID(p.Key, w.Number), "title": w.Title,
				"status": w.State, "project_id": p.ID}
		}
	}
	return nil
}

func (a *App) listAssociations(module string) handlerFunc {
	return func(c *Ctx) error {
		var typ, id string
		if module == "assets" {
			if !c.P.IsAgent || !c.P.Can(PrivAssetsView) {
				return errForbidden("")
			}
			typ, id = "asset", c.Param("id")
			if !c.existsInOrg(&Asset{}, id) {
				return errNotFound("asset")
			}
		} else {
			ref, err := c.resolveEntity(module, c.Param("id"))
			if err != nil {
				return err
			}
			typ, id = ref.Type, ref.ID
		}
		if !c.P.IsAgent {
			return c.JSON(http.StatusOK, map[string]interface{}{"items": []interface{}{}})
		}
		var links []Link
		c.T(&Link{}).Where("(source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?)", typ, id, typ, id).Find(&links)
		out := []map[string]interface{}{}
		for _, l := range links {
			otherType, otherID, direction := l.TargetType, l.TargetID, "outgoing"
			if l.TargetID == id && l.TargetType == typ {
				otherType, otherID, direction = l.SourceType, l.SourceID, "incoming"
			}
			if sum := c.entitySummary(otherType, otherID); sum != nil {
				sum["link_id"] = l.ID
				sum["link_type"] = l.LinkType
				sum["direction"] = direction
				out = append(out, sum)
			}
		}
		return c.JSON(http.StatusOK, map[string]interface{}{"items": out})
	}
}

func (a *App) createAssociation(module string) handlerFunc {
	return func(c *Ctx) error {
		var srcType, srcID string
		if module == "assets" {
			if !c.P.Can(PrivAssetsManage) {
				return errForbidden("")
			}
			srcType, srcID = "asset", c.Param("id")
			if !c.existsInOrg(&Asset{}, srcID) {
				return errNotFound("asset")
			}
		} else {
			ref, err := c.resolveEntity(module, c.Param("id"))
			if err != nil {
				return err
			}
			if err := c.requireManage(ref); err != nil {
				return err
			}
			srcType, srcID = ref.Type, ref.ID
		}
		var in struct {
			TargetType string `json:"target_type"`
			TargetID   string `json:"target_id"`
			LinkType   string `json:"link_type"`
		}
		if err := c.Bind(&in); err != nil {
			return err
		}
		if !oneOf(in.TargetType, linkableTypes...) || c.entitySummary(in.TargetType, in.TargetID) == nil {
			return errValidation(map[string]string{"target_id": "is invalid"})
		}
		if in.TargetType == srcType && in.TargetID == srcID {
			return errBadRequest("a record cannot be linked to itself")
		}
		if in.LinkType == "" {
			in.LinkType = "related"
		}
		var existing int64
		c.T(&Link{}).Where("((source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?))", srcID, in.TargetID, in.TargetID, srcID).Count(&existing)
		if existing > 0 {
			return errConflict("these records are already linked")
		}
		link := Link{Base: Base{OrgID: c.P.OrgID}, SourceType: srcType, SourceID: srcID, TargetType: in.TargetType, TargetID: in.TargetID, LinkType: in.LinkType}
		if err := c.DB().Create(&link).Error; err != nil {
			return err
		}
		sum := c.entitySummary(in.TargetType, in.TargetID)
		c.activity(c.DB(), srcType, srcID, "linked", fmt.Sprintf("linked %s %v", in.TargetType, sum["display_id"]), nil)
		return c.JSON(http.StatusCreated, link)
	}
}

func (a *App) deleteAssociation(c *Ctx) error {
	if !c.P.IsAgent {
		return errForbidden("")
	}
	var l Link
	if err := c.T(&Link{}).Where("id = ?", c.Param("id")).Take(&l).Error; err != nil {
		return errNotFound("association")
	}
	if err := c.DB().Delete(&l).Error; err != nil {
		return err
	}
	c.activity(c.DB(), l.SourceType, l.SourceID, "unlinked", "removed a link to "+l.TargetType, nil)
	return c.JSON(http.StatusOK, map[string]string{"message": "deleted"})
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

func (a *App) uploadAttachment(c *Ctx) error {
	c.R.Body = http.MaxBytesReader(c.W, c.R.Body, a.Cfg.MaxUploadBytes+1<<20)
	if err := c.R.ParseMultipartForm(8 << 20); err != nil {
		return errBadRequest("file is too large or the upload is malformed")
	}
	file, header, err := c.R.FormFile("file")
	if err != nil {
		return errBadRequest("file is required")
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, a.Cfg.MaxUploadBytes+1))
	if err != nil {
		return err
	}
	if int64(len(data)) > a.Cfg.MaxUploadBytes {
		return errBadRequest(fmt.Sprintf("files must be smaller than %d MB", a.Cfg.MaxUploadBytes>>20))
	}
	name := filepath.Base(strings.ReplaceAll(header.Filename, "\\", "/"))
	if name == "" || name == "." || name == "/" {
		name = "attachment"
	}
	ctype := http.DetectContentType(data)
	if ext := mime.TypeByExtension(filepath.Ext(name)); ext != "" && !strings.HasPrefix(ctype, "image/") {
		ctype = ext
	}
	att := Attachment{Base: Base{OrgID: c.P.OrgID}, EntityType: "pending", EntityID: c.P.UserID, Name: name, ContentType: ctype,
		Size: int64(len(data)), Data: data, UploadedBy: c.P.UserID}
	if err := c.DB().Create(&att).Error; err != nil {
		return err
	}
	att.Data = nil
	return c.JSON(http.StatusCreated, att)
}

// attachFiles binds the caller's pending uploads to an entity.
func (c *Ctx) attachFiles(tx *gorm.DB, entityType, entityID string, ids []string) []string {
	ids = uniq(ids)
	if len(ids) == 0 {
		return nil
	}
	var owned []string
	tx.Model(&Attachment{}).Where("org_id = ? AND id IN ? AND entity_type = 'pending' AND uploaded_by = ?", c.P.OrgID, ids, c.P.UserID).Pluck("id", &owned)
	if len(owned) > 0 {
		tx.Model(&Attachment{}).Where("id IN ?", owned).Updates(map[string]interface{}{"entity_type": entityType, "entity_id": entityID})
	}
	return owned
}

func (a *App) canSeeAttachment(c *Ctx, att *Attachment) bool {
	switch att.EntityType {
	case "pending":
		return att.UploadedBy == c.P.UserID
	case "ticket":
		_, err := c.loadTicket(att.EntityID)
		return err == nil
	case "conversation":
		var conv Conversation
		if c.T(&Conversation{}).Where("id = ?", att.EntityID).Take(&conv).Error != nil {
			return false
		}
		if conv.Private && !c.P.IsAgent {
			return false
		}
		module := map[string]string{"ticket": "tickets", "problem": "problems", "change": "changes", "release": "releases", "work_item": "work-items"}[conv.EntityType]
		_, err := c.resolveEntity(module, conv.EntityID)
		return err == nil
	case "problem", "change", "release":
		module := att.EntityType + "s"
		_, err := c.resolveEntity(module, att.EntityID)
		return err == nil
	case "kb_article":
		return c.canSeeArticle(att.EntityID)
	case "work_item":
		_, err := c.resolveEntity("work-items", att.EntityID)
		return err == nil
	default:
		return c.P.IsAgent
	}
}

func (a *App) downloadAttachment(c *Ctx) error {
	var att Attachment
	if err := c.T(&Attachment{}).Where("id = ?", c.Param("id")).Take(&att).Error; err != nil {
		return errNotFound("attachment")
	}
	if !a.canSeeAttachment(c, &att) {
		return errNotFound("attachment")
	}
	disposition := "attachment"
	if strings.HasPrefix(att.ContentType, "image/") && !strings.Contains(att.ContentType, "svg") && c.Query("inline") == "1" {
		disposition = "inline"
	}
	c.W.Header().Set("Content-Type", att.ContentType)
	c.W.Header().Set("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": att.Name}))
	c.W.Header().Set("Content-Length", strconv.FormatInt(att.Size, 10))
	c.W.Header().Set("X-Content-Type-Options", "nosniff")
	c.W.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	c.W.WriteHeader(http.StatusOK)
	_, err := c.W.Write(att.Data)
	return err
}

func (a *App) listEntityAttachments(module string) handlerFunc {
	return func(c *Ctx) error {
		ref, err := c.resolveEntity(module, c.Param("id"))
		if err != nil {
			return err
		}
		var atts []Attachment
		c.T(&Attachment{}).Select("id, org_id, entity_type, entity_id, name, content_type, size, uploaded_by, created_at, updated_at").
			Where("entity_type = ? AND entity_id = ?", ref.Type, ref.ID).Find(&atts)
		return c.JSON(http.StatusOK, map[string]interface{}{"items": atts})
	}
}

func (a *App) deleteAttachment(c *Ctx) error {
	var att Attachment
	if err := c.T(&Attachment{}).Select("id, org_id, entity_type, entity_id, uploaded_by").Where("id = ?", c.Param("id")).Take(&att).Error; err != nil {
		return errNotFound("attachment")
	}
	if att.UploadedBy != c.P.UserID && !c.P.IsAccountAdmin {
		return errForbidden("")
	}
	if err := c.DB().Where("id = ?", att.ID).Delete(&Attachment{}).Error; err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "deleted"})
}
