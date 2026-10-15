package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
)

// ---------------------------------------------------------------------------
// Problems
// ---------------------------------------------------------------------------

// ProblemDTO enriches a problem.
type ProblemDTO struct {
	*Problem
	DisplayID     string     `json:"display_id"`
	Agent         *UserBrief `json:"agent"`
	Requester     *UserBrief `json:"requester"`
	Group         *Ref       `json:"group"`
	Department    *Ref       `json:"department"`
	Tags          []string   `json:"tags"`
	IncidentCount int64      `json:"incident_count"`
}

func (c *Ctx) problemDTOs(items []Problem) []ProblemDTO {
	var uids, gids, dids, ids []string
	for _, p := range items {
		uids = append(uids, deref(p.AgentID), deref(p.RequesterID))
		gids = append(gids, deref(p.GroupID))
		dids = append(dids, deref(p.DepartmentID))
		ids = append(ids, p.ID)
	}
	l := c.lookup(uids, gids, dids)
	counts := map[string]int64{}
	if len(ids) > 0 {
		var rows []struct {
			ID string
			N  int64
		}
		c.DB().Raw(`SELECT x.id, count(*) AS n FROM (
			SELECT source_id AS id FROM itsm_links WHERE org_id = ? AND source_type = 'problem' AND target_type = 'ticket' AND source_id IN ?
			UNION ALL SELECT target_id AS id FROM itsm_links WHERE org_id = ? AND target_type = 'problem' AND source_type = 'ticket' AND target_id IN ?
		) x GROUP BY x.id`, c.P.OrgID, ids, c.P.OrgID, ids).Scan(&rows)
		for _, r := range rows {
			counts[r.ID] = r.N
		}
	}
	s := c.settings()
	out := make([]ProblemDTO, len(items))
	for i := range items {
		p := &items[i]
		out[i] = ProblemDTO{Problem: p, DisplayID: displayID(s.PrefixProblem, p.Number), Agent: l.user(p.AgentID), Requester: l.user(p.RequesterID),
			Group: l.group(p.GroupID), Department: l.dept(p.DepartmentID), Tags: stringsFrom(p.Tags), IncidentCount: counts[p.ID]}
	}
	return out
}

func applyCommonFilters(c *Ctx, q *gorm.DB, agentCol string) *gorm.DB {
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
	if v := c.Query("agent_id"); v == "me" {
		q = q.Where(agentCol+" = ?", c.P.UserID)
	} else if isUUID(v) {
		q = q.Where(agentCol+" = ?", v)
	}
	if v := c.Query("group_id"); isUUID(v) {
		q = q.Where("group_id = ?", v)
	}
	if v := strings.TrimSpace(c.Query("q")); v != "" {
		if prefix, n, ok := refParts(v); ok && (prefix == "" || refType(c.settings(), prefix) != "ticket") {
			q = q.Where("(number = ? OR subject ILIKE ? OR description ILIKE ?)", n, likeEscape(v), likeEscape(v))
		} else {
			q = q.Where("(subject ILIKE ? OR description ILIKE ? OR category ILIKE ?)", likeEscape(v), likeEscape(v), likeEscape(v))
		}
	}
	if c.Query("view") == "trash" {
		q = q.Where("is_deleted")
	} else {
		q = q.Where("NOT is_deleted")
	}
	return q
}

func listOrder(c *Ctx, allowed ...string) string {
	dir := "DESC"
	if strings.EqualFold(c.Query("order"), "asc") {
		dir = "ASC"
	}
	sortKey := c.Query("sort")
	for _, a := range allowed {
		if a == sortKey {
			return sortKey + " " + dir + " NULLS LAST"
		}
	}
	return "created_at DESC"
}

func (a *App) listProblems(c *Ctx) error {
	pg := c.Paging()
	build := func() *gorm.DB {
		q := applyCommonFilters(c, c.T(&Problem{}), "agent_id")
		if c.Query("known_error") == "true" {
			q = q.Where("known_error")
		}
		return q
	}
	var total int64
	build().Count(&total)
	var items []Problem
	if err := build().Order(listOrder(c, "created_at", "updated_at", "priority", "due_by", "number")).Offset(pg.Offset()).Limit(pg.PerPage).Find(&items).Error; err != nil {
		return err
	}
	return c.JSON(http.StatusOK, ListResponse{Items: c.problemDTOs(items), Total: total, Page: pg.Page, PerPage: pg.PerPage})
}

type itilInput struct {
	Subject        *string   `json:"subject"`
	Description    *string   `json:"description"`
	Status         *string   `json:"status"`
	Priority       *int      `json:"priority"`
	Impact         *int      `json:"impact"`
	Risk           *int      `json:"risk"`
	ChangeType     *string   `json:"change_type"`
	ReleaseType    *string   `json:"release_type"`
	RequesterID    *string   `json:"requester_id"`
	AgentID        *string   `json:"agent_id"`
	GroupID        *string   `json:"group_id"`
	DepartmentID   *string   `json:"department_id"`
	Category       *string   `json:"category"`
	DueBy          *string   `json:"due_by"`
	KnownError     *bool     `json:"known_error"`
	RootCause      *string   `json:"root_cause"`
	ImpactAnalysis *string   `json:"impact_analysis"`
	Symptoms       *string   `json:"symptoms"`
	Workaround     *string   `json:"workaround"`
	PlannedStart   *string   `json:"planned_start"`
	PlannedEnd     *string   `json:"planned_end"`
	WorkStart      *string   `json:"work_start"`
	WorkEnd        *string   `json:"work_end"`
	Reason         *string   `json:"reason"`
	ImpactPlan     *string   `json:"impact_plan"`
	RolloutPlan    *string   `json:"rollout_plan"`
	BackoutPlan    *string   `json:"backout_plan"`
	BuildPlan      *string   `json:"build_plan"`
	TestPlan       *string   `json:"test_plan"`
	ReleaseID      *string   `json:"release_id"`
	Tags           *[]string `json:"tags"`
	TicketIDs      []string  `json:"ticket_ids"`
	AssetIDs       []string  `json:"asset_ids"`
	ChangeIDs      []string  `json:"change_ids"`
}

// commonRefs validates and applies shared ownership fields.
type ownership struct {
	agent, group, dept, requester **string
}

func (c *Ctx) applyOwnership(errs map[string]string, in *itilInput, o ownership) {
	if in.AgentID != nil && o.agent != nil {
		*o.agent = strPtr(*in.AgentID)
		c.optionalRef(errs, "agent_id", *o.agent, c.agentInOrg)
	}
	if in.GroupID != nil && o.group != nil {
		*o.group = strPtr(*in.GroupID)
		c.optionalRef(errs, "group_id", *o.group, func(id string) bool { return c.existsInOrg(&AgentGroup{}, id) })
	}
	if in.DepartmentID != nil && o.dept != nil {
		*o.dept = strPtr(*in.DepartmentID)
		c.optionalRef(errs, "department_id", *o.dept, func(id string) bool { return c.existsInOrg(&Department{}, id) })
	}
	if in.RequesterID != nil && o.requester != nil {
		*o.requester = strPtr(*in.RequesterID)
		c.optionalRef(errs, "requester_id", *o.requester, c.userInOrg)
	}
}

func setText(dst *string, v *string) {
	if v != nil {
		*dst = *v
	}
}

func setTime(errs map[string]string, field string, dst **time.Time, v *string) {
	if v == nil {
		return
	}
	t, ok := parseTime(*v)
	if !ok {
		errs[field] = "is not a valid date"
		return
	}
	*dst = t
}

func (c *Ctx) applyProblemInput(p *Problem, in *itilInput) map[string]string {
	errs := map[string]string{}
	if in.Subject != nil {
		p.Subject = strings.TrimSpace(*in.Subject)
	}
	if p.Subject == "" {
		errs["subject"] = "is required"
	}
	setText(&p.Description, in.Description)
	if in.Status != nil {
		if !oneOf(*in.Status, "open", "change_requested", "closed") {
			errs["status"] = "must be open, change_requested or closed"
		} else {
			if *in.Status == "closed" && p.Status != "closed" {
				n := now()
				p.ClosedAt = &n
			} else if *in.Status != "closed" {
				p.ClosedAt = nil
			}
			p.Status = *in.Status
		}
	}
	if in.Priority != nil {
		p.Priority = clampInt(*in.Priority, 1, 4, p.Priority)
	}
	if in.Impact != nil {
		p.Impact = clampInt(*in.Impact, 1, 3, p.Impact)
	}
	c.applyOwnership(errs, in, ownership{agent: &p.AgentID, group: &p.GroupID, dept: &p.DepartmentID, requester: &p.RequesterID})
	setText(&p.Category, in.Category)
	setTime(errs, "due_by", &p.DueBy, in.DueBy)
	if in.KnownError != nil {
		p.KnownError = *in.KnownError
	}
	setText(&p.RootCause, in.RootCause)
	setText(&p.ImpactAnalysis, in.ImpactAnalysis)
	setText(&p.Symptoms, in.Symptoms)
	setText(&p.Workaround, in.Workaround)
	if in.Tags != nil {
		p.Tags = jsonOf(normalizeTags(*in.Tags))
	}
	return errs
}

func (c *Ctx) linkMany(tx *gorm.DB, srcType, srcID, targetType string, ids []string, linkType string) {
	var model interface{}
	switch targetType {
	case "ticket":
		model = &Ticket{}
	case "asset":
		model = &Asset{}
	case "change":
		model = &Change{}
	case "problem":
		model = &Problem{}
	default:
		return
	}
	for _, id := range uniq(ids) {
		if !c.existsInOrg(model, id) {
			continue
		}
		var n int64
		tx.Model(&Link{}).Where("org_id = ? AND ((source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?))", c.P.OrgID, srcID, id, id, srcID).Count(&n)
		if n == 0 {
			tx.Create(&Link{Base: Base{OrgID: c.P.OrgID}, SourceType: srcType, SourceID: srcID, TargetType: targetType, TargetID: id, LinkType: linkType})
		}
	}
}

func (a *App) createProblem(c *Ctx) error {
	var in itilInput
	if err := c.Bind(&in); err != nil {
		return err
	}
	p := Problem{Base: Base{OrgID: c.P.OrgID}, Status: "open", Priority: 2, Impact: 2, Tags: jsonOf([]string{}), CustomFields: jsonOf(map[string]interface{}{}), CreatedByID: c.P.UserID}
	// Seed from a ticket when creating a problem from an incident.
	if len(in.TicketIDs) == 1 && in.Subject == nil {
		if t, err := c.loadTicket(in.TicketIDs[0]); err == nil {
			in.Subject = &t.Subject
			in.Description = &t.Description
			if in.Priority == nil {
				in.Priority = &t.Priority
			}
		}
	}
	if errs := c.applyProblemInput(&p, &in); len(errs) > 0 {
		return errValidation(errs)
	}
	err := c.DB().Transaction(func(tx *gorm.DB) error {
		n, err := nextNumber(tx, c.P.OrgID, "problem")
		if err != nil {
			return err
		}
		p.Number = n
		if err := tx.Create(&p).Error; err != nil {
			return err
		}
		c.linkMany(tx, "problem", p.ID, "ticket", in.TicketIDs, "caused_by")
		c.linkMany(tx, "problem", p.ID, "asset", in.AssetIDs, "affected")
		c.activity(tx, "problem", p.ID, "created", "created the problem", nil)
		return nil
	})
	if err != nil {
		return err
	}
	if p.AgentID != nil && *p.AgentID != c.P.UserID {
		notify(c.DB(), *p.AgentID, "problem_assigned", "Problem "+displayID(c.settings().PrefixProblem, p.Number)+" assigned to you", p.Subject, map[string]string{"problem_id": p.ID})
	}
	return c.JSON(http.StatusCreated, c.problemDTOs([]Problem{p})[0])
}

func (a *App) getProblem(c *Ctx) error {
	var p Problem
	if err := c.T(&Problem{}).Where("id = ?", c.Param("id")).Take(&p).Error; err != nil {
		return errNotFound("problem")
	}
	return c.JSON(http.StatusOK, c.problemDTOs([]Problem{p})[0])
}

func (a *App) updateProblem(c *Ctx) error {
	var p Problem
	if err := c.T(&Problem{}).Where("id = ?", c.Param("id")).Take(&p).Error; err != nil {
		return errNotFound("problem")
	}
	before := p
	var in itilInput
	if err := c.Bind(&in); err != nil {
		return err
	}
	if errs := c.applyProblemInput(&p, &in); len(errs) > 0 {
		return errValidation(errs)
	}
	changes := diffFields(before, p, "status", "priority", "impact", "agent_id", "group_id", "known_error", "category")
	err := c.DB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&p).Error; err != nil {
			return err
		}
		c.activity(tx, "problem", p.ID, "updated", "updated the problem", changes)
		// Closing a problem resolves its linked incidents' known-error state.
		if before.Status != "closed" && p.Status == "closed" {
			c.activity(tx, "problem", p.ID, "closed", "closed the problem", nil)
		}
		return nil
	})
	if err != nil {
		return err
	}
	if deref(before.AgentID) != deref(p.AgentID) && p.AgentID != nil && *p.AgentID != c.P.UserID {
		notify(c.DB(), *p.AgentID, "problem_assigned", "Problem "+displayID(c.settings().PrefixProblem, p.Number)+" assigned to you", p.Subject, map[string]string{"problem_id": p.ID})
	}
	return c.JSON(http.StatusOK, c.problemDTOs([]Problem{p})[0])
}

// diffFields compares selected JSON fields of two structs.
func diffFields(before, after interface{}, fields ...string) []FieldChange {
	var b, a map[string]interface{}
	bj, _ := json.Marshal(before)
	aj, _ := json.Marshal(after)
	_ = json.Unmarshal(bj, &b)
	_ = json.Unmarshal(aj, &a)
	out := []FieldChange{}
	for _, f := range fields {
		if fmt.Sprint(b[f]) != fmt.Sprint(a[f]) {
			out = append(out, FieldChange{Field: f, From: b[f], To: a[f]})
		}
	}
	return out
}

func (a *App) softDelete(model interface{}, entity string, deleted bool) handlerFunc {
	return func(c *Ctx) error {
		id := c.Param("id")
		if !c.existsInOrg(model, id) {
			return errNotFound(entity)
		}
		if err := c.T(model).Where("id = ?", id).Update("is_deleted", deleted).Error; err != nil {
			return err
		}
		verb := "restored the " + entity
		if deleted {
			verb = "deleted the " + entity
		}
		c.activity(c.DB(), entity, id, "is_deleted", verb, nil)
		return c.JSON(http.StatusOK, map[string]string{"message": verb})
	}
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

var changeStatuses = []string{"open", "planning", "awaiting_approval", "pending_release", "pending_review", "closed"}

// ChangeDTO enriches a change.
type ChangeDTO struct {
	*Change
	DisplayID  string     `json:"display_id"`
	Agent      *UserBrief `json:"agent"`
	Requester  *UserBrief `json:"requester"`
	Group      *Ref       `json:"group"`
	Department *Ref       `json:"department"`
	Tags       []string   `json:"tags"`
	Release    *Ref       `json:"release"`
}

func (c *Ctx) changeDTOs(items []Change) []ChangeDTO {
	var uids, gids, dids, rids []string
	for _, ch := range items {
		uids = append(uids, deref(ch.AgentID), deref(ch.RequesterID))
		gids = append(gids, deref(ch.GroupID))
		dids = append(dids, deref(ch.DepartmentID))
		rids = append(rids, deref(ch.ReleaseID))
	}
	l := c.lookup(uids, gids, dids)
	s := c.settings()
	rels := map[string]*Ref{}
	if ids := uniq(rids); len(ids) > 0 {
		var rs []Release
		c.T(&Release{}).Where("id IN ?", ids).Find(&rs)
		for _, r := range rs {
			rels[r.ID] = &Ref{ID: r.ID, Name: displayID(s.PrefixRelease, r.Number) + " " + r.Subject}
		}
	}
	out := make([]ChangeDTO, len(items))
	for i := range items {
		ch := &items[i]
		out[i] = ChangeDTO{Change: ch, DisplayID: displayID(s.PrefixChange, ch.Number), Agent: l.user(ch.AgentID), Requester: l.user(ch.RequesterID),
			Group: l.group(ch.GroupID), Department: l.dept(ch.DepartmentID), Tags: stringsFrom(ch.Tags)}
		if ch.ReleaseID != nil {
			out[i].Release = rels[*ch.ReleaseID]
		}
	}
	return out
}

func (a *App) listChanges(c *Ctx) error {
	pg := c.Paging()
	build := func() *gorm.DB {
		q := applyCommonFilters(c, c.T(&Change{}), "agent_id")
		if v := c.Query("change_type"); v != "" {
			q = q.Where("change_type IN ?", strings.Split(v, ","))
		}
		if v := c.Query("approval_status"); v != "" {
			q = q.Where("approval_status = ?", v)
		}
		return q
	}
	var total int64
	build().Count(&total)
	var items []Change
	if err := build().Order(listOrder(c, "created_at", "updated_at", "priority", "planned_start", "number")).Offset(pg.Offset()).Limit(pg.PerPage).Find(&items).Error; err != nil {
		return err
	}
	return c.JSON(http.StatusOK, ListResponse{Items: c.changeDTOs(items), Total: total, Page: pg.Page, PerPage: pg.PerPage})
}

func (c *Ctx) applyChangeInput(ch *Change, in *itilInput) map[string]string {
	errs := map[string]string{}
	if in.Subject != nil {
		ch.Subject = strings.TrimSpace(*in.Subject)
	}
	if ch.Subject == "" {
		errs["subject"] = "is required"
	}
	setText(&ch.Description, in.Description)
	if in.Status != nil {
		if !oneOf(*in.Status, changeStatuses...) {
			errs["status"] = "is invalid"
		} else {
			if *in.Status == "closed" && ch.Status != "closed" {
				n := now()
				ch.ClosedAt = &n
			} else if *in.Status != "closed" {
				ch.ClosedAt = nil
			}
			ch.Status = *in.Status
		}
	}
	if in.ChangeType != nil {
		if !oneOf(*in.ChangeType, "minor", "standard", "major", "emergency") {
			errs["change_type"] = "must be minor, standard, major or emergency"
		} else {
			ch.ChangeType = *in.ChangeType
		}
	}
	if in.Priority != nil {
		ch.Priority = clampInt(*in.Priority, 1, 4, ch.Priority)
	}
	if in.Impact != nil {
		ch.Impact = clampInt(*in.Impact, 1, 3, ch.Impact)
	}
	if in.Risk != nil {
		ch.Risk = clampInt(*in.Risk, 1, 4, ch.Risk)
	}
	c.applyOwnership(errs, in, ownership{agent: &ch.AgentID, group: &ch.GroupID, dept: &ch.DepartmentID, requester: &ch.RequesterID})
	setText(&ch.Category, in.Category)
	setTime(errs, "planned_start", &ch.PlannedStart, in.PlannedStart)
	setTime(errs, "planned_end", &ch.PlannedEnd, in.PlannedEnd)
	if ch.PlannedStart != nil && ch.PlannedEnd != nil && !ch.PlannedEnd.After(*ch.PlannedStart) {
		errs["planned_end"] = "must be after the planned start"
	}
	setText(&ch.Reason, in.Reason)
	setText(&ch.ImpactPlan, in.ImpactPlan)
	setText(&ch.RolloutPlan, in.RolloutPlan)
	setText(&ch.BackoutPlan, in.BackoutPlan)
	if in.ReleaseID != nil {
		ch.ReleaseID = strPtr(*in.ReleaseID)
		c.optionalRef(errs, "release_id", ch.ReleaseID, func(id string) bool { return c.existsInOrg(&Release{}, id) })
	}
	if in.Tags != nil {
		ch.Tags = jsonOf(normalizeTags(*in.Tags))
	}
	return errs
}

func (a *App) createChange(c *Ctx) error {
	var in itilInput
	if err := c.Bind(&in); err != nil {
		return err
	}
	ch := Change{Base: Base{OrgID: c.P.OrgID}, Status: "open", ChangeType: "standard", Priority: 2, Impact: 2, Risk: 1,
		ApprovalStatus: "not_requested", Tags: jsonOf([]string{}), CustomFields: jsonOf(map[string]interface{}{}), CreatedByID: c.P.UserID}
	reqID := c.P.UserID
	ch.RequesterID = &reqID
	if errs := c.applyChangeInput(&ch, &in); len(errs) > 0 {
		return errValidation(errs)
	}
	err := c.DB().Transaction(func(tx *gorm.DB) error {
		n, err := nextNumber(tx, c.P.OrgID, "change")
		if err != nil {
			return err
		}
		ch.Number = n
		if err := tx.Create(&ch).Error; err != nil {
			return err
		}
		c.linkMany(tx, "change", ch.ID, "ticket", in.TicketIDs, "initiated_by")
		c.linkMany(tx, "change", ch.ID, "asset", in.AssetIDs, "affected")
		c.activity(tx, "change", ch.ID, "created", "created the change", nil)
		return nil
	})
	if err != nil {
		return err
	}
	if ch.AgentID != nil && *ch.AgentID != c.P.UserID {
		notify(c.DB(), *ch.AgentID, "change_assigned", "Change "+displayID(c.settings().PrefixChange, ch.Number)+" assigned to you", ch.Subject, map[string]string{"change_id": ch.ID})
	}
	return c.JSON(http.StatusCreated, c.changeDTOs([]Change{ch})[0])
}

func (a *App) getChange(c *Ctx) error {
	var ch Change
	if err := c.T(&Change{}).Where("id = ?", c.Param("id")).Take(&ch).Error; err != nil {
		return errNotFound("change")
	}
	var approvals []Approval
	c.T(&Approval{}).Where("entity_type = 'change' AND entity_id = ?", ch.ID).Order("created_at").Find(&approvals)
	return c.JSON(http.StatusOK, map[string]interface{}{"change": c.changeDTOs([]Change{ch})[0], "approvals": c.approvalDTOs(approvals), "conflicts": c.changeConflicts(&ch)})
}

func (a *App) updateChange(c *Ctx) error {
	var ch Change
	if err := c.T(&Change{}).Where("id = ?", c.Param("id")).Take(&ch).Error; err != nil {
		return errNotFound("change")
	}
	before := ch
	var in itilInput
	if err := c.Bind(&in); err != nil {
		return err
	}
	if errs := c.applyChangeInput(&ch, &in); len(errs) > 0 {
		return errValidation(errs)
	}
	if before.Status != ch.Status && (ch.Status == "pending_release" || ch.Status == "closed") &&
		(ch.ChangeType == "major" || ch.ChangeType == "emergency") && ch.ApprovalStatus != "approved" {
		return errBadRequest("major and emergency changes must be approved before release")
	}
	changes := diffFields(before, ch, "status", "change_type", "priority", "impact", "risk", "agent_id", "group_id", "planned_start", "planned_end", "release_id")
	err := c.DB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&ch).Error; err != nil {
			return err
		}
		c.activity(tx, "change", ch.ID, "updated", "updated the change", changes)
		return nil
	})
	if err != nil {
		return err
	}
	if deref(before.AgentID) != deref(ch.AgentID) && ch.AgentID != nil && *ch.AgentID != c.P.UserID {
		notify(c.DB(), *ch.AgentID, "change_assigned", "Change "+displayID(c.settings().PrefixChange, ch.Number)+" assigned to you", ch.Subject, map[string]string{"change_id": ch.ID})
	}
	return c.JSON(http.StatusOK, c.changeDTOs([]Change{ch})[0])
}

// changeConflicts finds other active changes whose planned window overlaps
// and that touch at least one of the same assets.
func (c *Ctx) changeConflicts(ch *Change) []map[string]interface{} {
	out := []map[string]interface{}{}
	if ch.PlannedStart == nil || ch.PlannedEnd == nil {
		return out
	}
	var overlapping []Change
	c.T(&Change{}).Where("id <> ? AND NOT is_deleted AND status <> 'closed' AND planned_start < ? AND planned_end > ?", ch.ID, *ch.PlannedEnd, *ch.PlannedStart).Find(&overlapping)
	if len(overlapping) == 0 {
		return out
	}
	assetsOf := func(id string) map[string]bool {
		var ids []string
		c.DB().Model(&Link{}).Where("org_id = ? AND source_type = 'change' AND source_id = ? AND target_type = 'asset'", c.P.OrgID, id).Pluck("target_id", &ids)
		m := map[string]bool{}
		for _, x := range ids {
			m[x] = true
		}
		return m
	}
	mine := assetsOf(ch.ID)
	s := c.settings()
	for _, o := range overlapping {
		shared := 0
		for id := range assetsOf(o.ID) {
			if mine[id] {
				shared++
			}
		}
		out = append(out, map[string]interface{}{"id": o.ID, "display_id": displayID(s.PrefixChange, o.Number), "subject": o.Subject,
			"planned_start": o.PlannedStart, "planned_end": o.PlannedEnd, "shared_assets": shared})
	}
	return out
}

func (a *App) changeCalendar(c *Ctx) error {
	from, ok1 := parseTime(c.Query("from"))
	to, ok2 := parseTime(c.Query("to"))
	if !ok1 || !ok2 || from == nil || to == nil {
		f := now().AddDate(0, 0, -7)
		t := now().AddDate(0, 1, 0)
		from, to = &f, &t
	}
	var changes []Change
	c.T(&Change{}).Where("NOT is_deleted AND planned_start IS NOT NULL AND planned_start < ? AND COALESCE(planned_end, planned_start) > ?", *to, *from).
		Order("planned_start").Find(&changes)
	var releases []Release
	c.T(&Release{}).Where("NOT is_deleted AND planned_start IS NOT NULL AND planned_start < ? AND COALESCE(planned_end, planned_start) > ?", *to, *from).
		Order("planned_start").Find(&releases)
	return c.JSON(http.StatusOK, map[string]interface{}{"changes": c.changeDTOs(changes), "releases": c.releaseDTOs(releases)})
}

// ---------------------------------------------------------------------------
// Releases
// ---------------------------------------------------------------------------

// ReleaseDTO enriches a release.
type ReleaseDTO struct {
	*Release
	DisplayID   string     `json:"display_id"`
	Agent       *UserBrief `json:"agent"`
	Group       *Ref       `json:"group"`
	Tags        []string   `json:"tags"`
	ChangeCount int64      `json:"change_count"`
}

func (c *Ctx) releaseDTOs(items []Release) []ReleaseDTO {
	var uids, gids []string
	for _, r := range items {
		uids = append(uids, deref(r.AgentID))
		gids = append(gids, deref(r.GroupID))
	}
	l := c.lookup(uids, gids, nil)
	s := c.settings()
	out := make([]ReleaseDTO, len(items))
	for i := range items {
		r := &items[i]
		var n int64
		c.T(&Change{}).Where("release_id = ? AND NOT is_deleted", r.ID).Count(&n)
		out[i] = ReleaseDTO{Release: r, DisplayID: displayID(s.PrefixRelease, r.Number), Agent: l.user(r.AgentID), Group: l.group(r.GroupID),
			Tags: stringsFrom(r.Tags), ChangeCount: n}
	}
	return out
}

func (a *App) listReleases(c *Ctx) error {
	pg := c.Paging()
	build := func() *gorm.DB {
		q := applyCommonFilters(c, c.T(&Release{}), "agent_id")
		if v := c.Query("release_type"); v != "" {
			q = q.Where("release_type IN ?", strings.Split(v, ","))
		}
		return q
	}
	var total int64
	build().Count(&total)
	var items []Release
	if err := build().Order(listOrder(c, "created_at", "updated_at", "priority", "planned_start", "number")).Offset(pg.Offset()).Limit(pg.PerPage).Find(&items).Error; err != nil {
		return err
	}
	return c.JSON(http.StatusOK, ListResponse{Items: c.releaseDTOs(items), Total: total, Page: pg.Page, PerPage: pg.PerPage})
}

func (c *Ctx) applyReleaseInput(r *Release, in *itilInput) map[string]string {
	errs := map[string]string{}
	if in.Subject != nil {
		r.Subject = strings.TrimSpace(*in.Subject)
	}
	if r.Subject == "" {
		errs["subject"] = "is required"
	}
	setText(&r.Description, in.Description)
	if in.Status != nil {
		if !oneOf(*in.Status, "open", "on_hold", "in_progress", "incomplete", "completed") {
			errs["status"] = "is invalid"
		} else {
			r.Status = *in.Status
		}
	}
	if in.ReleaseType != nil {
		if !oneOf(*in.ReleaseType, "minor", "standard", "major", "emergency") {
			errs["release_type"] = "is invalid"
		} else {
			r.ReleaseType = *in.ReleaseType
		}
	}
	if in.Priority != nil {
		r.Priority = clampInt(*in.Priority, 1, 4, r.Priority)
	}
	c.applyOwnership(errs, in, ownership{agent: &r.AgentID, group: &r.GroupID, dept: &r.DepartmentID})
	setText(&r.Category, in.Category)
	setTime(errs, "planned_start", &r.PlannedStart, in.PlannedStart)
	setTime(errs, "planned_end", &r.PlannedEnd, in.PlannedEnd)
	setTime(errs, "work_start", &r.WorkStart, in.WorkStart)
	setTime(errs, "work_end", &r.WorkEnd, in.WorkEnd)
	if r.PlannedStart != nil && r.PlannedEnd != nil && !r.PlannedEnd.After(*r.PlannedStart) {
		errs["planned_end"] = "must be after the planned start"
	}
	setText(&r.BuildPlan, in.BuildPlan)
	setText(&r.TestPlan, in.TestPlan)
	if in.Tags != nil {
		r.Tags = jsonOf(normalizeTags(*in.Tags))
	}
	return errs
}

func (a *App) createRelease(c *Ctx) error {
	var in itilInput
	if err := c.Bind(&in); err != nil {
		return err
	}
	r := Release{Base: Base{OrgID: c.P.OrgID}, Status: "open", ReleaseType: "standard", Priority: 2, Tags: jsonOf([]string{}), CreatedByID: c.P.UserID}
	if errs := c.applyReleaseInput(&r, &in); len(errs) > 0 {
		return errValidation(errs)
	}
	err := c.DB().Transaction(func(tx *gorm.DB) error {
		n, err := nextNumber(tx, c.P.OrgID, "release")
		if err != nil {
			return err
		}
		r.Number = n
		if err := tx.Create(&r).Error; err != nil {
			return err
		}
		for _, id := range uniq(in.ChangeIDs) {
			tx.Model(&Change{}).Where("org_id = ? AND id = ?", c.P.OrgID, id).Update("release_id", r.ID)
		}
		c.activity(tx, "release", r.ID, "created", "created the release", nil)
		return nil
	})
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, c.releaseDTOs([]Release{r})[0])
}

func (a *App) getRelease(c *Ctx) error {
	var r Release
	if err := c.T(&Release{}).Where("id = ?", c.Param("id")).Take(&r).Error; err != nil {
		return errNotFound("release")
	}
	var changes []Change
	c.T(&Change{}).Where("release_id = ? AND NOT is_deleted", r.ID).Order("planned_start NULLS LAST").Find(&changes)
	return c.JSON(http.StatusOK, map[string]interface{}{"release": c.releaseDTOs([]Release{r})[0], "changes": c.changeDTOs(changes)})
}

func (a *App) updateRelease(c *Ctx) error {
	var r Release
	if err := c.T(&Release{}).Where("id = ?", c.Param("id")).Take(&r).Error; err != nil {
		return errNotFound("release")
	}
	before := r
	var in itilInput
	if err := c.Bind(&in); err != nil {
		return err
	}
	if errs := c.applyReleaseInput(&r, &in); len(errs) > 0 {
		return errValidation(errs)
	}
	if r.Status == "completed" && before.Status != "completed" {
		var open int64
		c.T(&Change{}).Where("release_id = ? AND NOT is_deleted AND status NOT IN ('pending_review','closed')", r.ID).Count(&open)
		if open > 0 {
			return errBadRequest(fmt.Sprintf("%d linked change(s) are not yet implemented", open))
		}
	}
	err := c.DB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&r).Error; err != nil {
			return err
		}
		if in.ChangeIDs != nil {
			tx.Model(&Change{}).Where("org_id = ? AND release_id = ?", c.P.OrgID, r.ID).Update("release_id", nil)
			for _, id := range uniq(in.ChangeIDs) {
				tx.Model(&Change{}).Where("org_id = ? AND id = ?", c.P.OrgID, id).Update("release_id", r.ID)
			}
		}
		c.activity(tx, "release", r.ID, "updated", "updated the release", diffFields(before, r, "status", "release_type", "priority", "agent_id", "group_id", "planned_start", "planned_end"))
		return nil
	})
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, c.releaseDTOs([]Release{r})[0])
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

// ApprovalDTO adds approver and record details.
type ApprovalDTO struct {
	*Approval
	Approver    *UserBrief             `json:"approver"`
	RequestedBy *UserBrief             `json:"requested_by"`
	Record      map[string]interface{} `json:"record"`
}

func (c *Ctx) approvalDTOs(items []Approval) []ApprovalDTO {
	var uids []string
	for _, ap := range items {
		uids = append(uids, ap.ApproverID, ap.RequestedByID)
	}
	l := c.lookup(uids, nil, nil)
	out := make([]ApprovalDTO, len(items))
	for i := range items {
		out[i] = ApprovalDTO{Approval: &items[i], Approver: l.userS(items[i].ApproverID), RequestedBy: l.userS(items[i].RequestedByID),
			Record: c.entitySummary(items[i].EntityType, items[i].EntityID)}
	}
	return out
}

// requestApprovals creates approval requests and notifies approvers.
func (a *App) requestApprovals(c *Ctx, tx *gorm.DB, entityType, entityID, subject string, approverIDs []string) (int, error) {
	created := 0
	for _, requested := range uniq(approverIDs) {
		if !c.userInOrg(requested) {
			return 0, errValidation(map[string]string{"approver_ids": "contains an unknown user"})
		}
		id, delegated := delegateFor(c, requested)
		onBehalf := ""
		if delegated {
			_, name := a.userEmail(tx, requested)
			onBehalf = " (on behalf of " + name + ", who is out of office)"
		}
		var n int64
		tx.Model(&Approval{}).Where("org_id = ? AND entity_type = ? AND entity_id = ? AND approver_id = ? AND status = 'requested'", c.P.OrgID, entityType, entityID, id).Count(&n)
		if n > 0 {
			continue
		}
		ap := Approval{Base: Base{OrgID: c.P.OrgID}, EntityType: entityType, EntityID: entityID, ApproverID: id, RequestedByID: c.P.UserID, Status: "requested"}
		if err := tx.Create(&ap).Error; err != nil {
			return 0, err
		}
		created++
		notify(tx, id, "approval_requested", "Approval requested: "+subject, "Requested by "+c.P.Name+onBehalf, map[string]string{"approval_id": ap.ID, entityType + "_id": entityID})
		email, name := a.userEmail(tx, id)
		a.queueEmail(c.R.Context(), tx, c.P.OrgID, "approval_requested", email, map[string]string{
			"approval.subject": subject, "approval.requested_by": c.P.Name, "approver.name": name,
			"approval.url": strings.TrimRight(a.Cfg.PublicURL, "/") + "/approvals",
		}, entityType, entityID)
	}
	return created, nil
}

func (a *App) requestChangeApproval(c *Ctx) error {
	var ch Change
	if err := c.T(&Change{}).Where("id = ?", c.Param("id")).Take(&ch).Error; err != nil {
		return errNotFound("change")
	}
	var in struct {
		ApproverIDs []string `json:"approver_ids"`
		GroupID     string   `json:"group_id"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	ids := in.ApproverIDs
	if isUUID(in.GroupID) {
		var members []string
		c.DB().Model(&GroupMember{}).Where("org_id = ? AND group_id = ?", c.P.OrgID, in.GroupID).Pluck("user_id", &members)
		ids = append(ids, members...)
	}
	if len(uniq(ids)) == 0 {
		return errValidation(map[string]string{"approver_ids": "select at least one approver"})
	}
	s := c.settings()
	err := c.DB().Transaction(func(tx *gorm.DB) error {
		n, err := a.requestApprovals(c, tx, "change", ch.ID, displayID(s.PrefixChange, ch.Number)+" "+ch.Subject, ids)
		if err != nil {
			return err
		}
		if n == 0 {
			return nil
		}
		ch.ApprovalStatus, ch.Status = "requested", "awaiting_approval"
		if err := tx.Save(&ch).Error; err != nil {
			return err
		}
		c.activity(tx, "change", ch.ID, "approval", fmt.Sprintf("requested approval from %d approver(s)", n), nil)
		return nil
	})
	if err != nil {
		return err
	}
	return a.getChange(c)
}

func (a *App) listApprovals(c *Ctx) error {
	q := c.T(&Approval{})
	if c.Query("scope") == "all" && c.P.IsAgent && c.P.Can(PrivChangesManage) {
		// all approvals in the org
	} else {
		q = q.Where("approver_id = ?", c.P.UserID)
	}
	if v := c.Query("status"); v != "" {
		q = q.Where("status = ?", v)
	}
	var items []Approval
	q.Order("created_at DESC").Limit(200).Find(&items)
	return c.JSON(http.StatusOK, map[string]interface{}{"items": c.approvalDTOs(items)})
}

func (a *App) respondApproval(c *Ctx) error {
	var ap Approval
	if err := c.T(&Approval{}).Where("id = ?", c.Param("id")).Take(&ap).Error; err != nil {
		return errNotFound("approval")
	}
	if ap.ApproverID != c.P.UserID {
		return errForbidden("this approval is assigned to someone else")
	}
	if ap.Status != "requested" {
		return errConflict("this approval has already been " + ap.Status)
	}
	var in struct {
		Status string `json:"status"`
		Remark string `json:"remark"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	if !oneOf(in.Status, "approved", "rejected") {
		return errValidation(map[string]string{"status": "must be approved or rejected"})
	}
	n := now()
	ap.Status, ap.Remark, ap.RespondedAt = in.Status, strings.TrimSpace(in.Remark), &n
	err := c.DB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&ap).Error; err != nil {
			return err
		}
		summary := fmt.Sprintf("%s the request", in.Status)
		if ap.Remark != "" {
			summary += ": " + ap.Remark
		}
		c.activity(tx, ap.EntityType, ap.EntityID, "approval", summary, nil)
		return a.resolveApprovalOutcome(c, tx, ap.EntityType, ap.EntityID)
	})
	if err != nil {
		return err
	}
	notify(c.DB(), ap.RequestedByID, "approval_"+ap.Status, c.P.Name+" "+ap.Status+" your request", ap.Remark, map[string]string{ap.EntityType + "_id": ap.EntityID})
	return c.JSON(http.StatusOK, c.approvalDTOs([]Approval{ap})[0])
}

// resolveApprovalOutcome updates the parent record once approvals settle:
// any rejection rejects, all approvals approve.
func (a *App) resolveApprovalOutcome(c *Ctx, tx *gorm.DB, entityType, entityID string) error {
	var pending, rejected, approved int64
	base := func() *gorm.DB {
		return tx.Model(&Approval{}).Where("org_id = ? AND entity_type = ? AND entity_id = ?", c.P.OrgID, entityType, entityID)
	}
	base().Where("status = 'requested'").Count(&pending)
	base().Where("status = 'rejected'").Count(&rejected)
	base().Where("status = 'approved'").Count(&approved)
	outcome := ""
	switch {
	case rejected > 0:
		outcome = "rejected"
		base().Where("status = 'requested'").Update("status", "cancelled")
	case pending == 0 && approved > 0:
		outcome = "approved"
	default:
		return nil
	}
	switch entityType {
	case "change":
		updates := map[string]interface{}{"approval_status": outcome}
		if outcome == "approved" {
			updates["status"] = "pending_release"
		} else {
			updates["status"] = "planning"
		}
		tx.Model(&Change{}).Where("org_id = ? AND id = ?", c.P.OrgID, entityID).Updates(updates)
		recordActivity(tx, c.P.OrgID, "change", entityID, nil, "approval", "change "+outcome+" by approvers", nil)
	case "ticket":
		var t Ticket
		if tx.Where("org_id = ? AND id = ?", c.P.OrgID, entityID).Take(&t).Error != nil {
			return nil
		}
		if outcome == "rejected" {
			s := c.settings()
			transitionStatus(tx, s, &t, t.Status, "closed")
			t.Status = "closed"
			t.ResolutionNotes = "Request rejected during approval."
			tx.Save(&t)
			tx.Model(&RequestedItem{}).Where("org_id = ? AND ticket_id = ?", c.P.OrgID, t.ID).Update("stage", "cancelled")
			notify(tx, t.RequesterID, "request_rejected", "Your request "+ticketDisplayID(s, &t)+" was rejected", t.Subject, map[string]string{"ticket_id": t.ID})
		} else {
			tx.Model(&RequestedItem{}).Where("org_id = ? AND ticket_id = ? AND stage = 'requested'", c.P.OrgID, t.ID).Update("stage", "in_progress")
			if t.GroupID != nil {
				var members []string
				tx.Model(&GroupMember{}).Where("group_id = ?", *t.GroupID).Pluck("user_id", &members)
				for _, m := range members {
					notify(tx, m, "request_approved", "Request "+ticketDisplayID(c.settings(), &t)+" approved and ready for fulfilment", t.Subject, map[string]string{"ticket_id": t.ID})
				}
			}
		}
		recordActivity(tx, c.P.OrgID, "ticket", entityID, nil, "approval", "request "+outcome+" by approvers", nil)
	}
	return nil
}
