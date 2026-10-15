package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/chanduchitikam/task-management-system/services/itsm/rules"
	"github.com/chanduchitikam/task-management-system/services/itsm/sla"
	"gorm.io/gorm"
)

func hoursDuration(h int) time.Duration { return time.Duration(h) * time.Hour }

// ---------------------------------------------------------------------------
// Helpdesk settings & account
// ---------------------------------------------------------------------------

func (a *App) getSettings(c *Ctx) error {
	s := c.settings()
	var org struct {
		ID          string    `json:"id"`
		Name        string    `json:"name"`
		Domain      string    `json:"domain"`
		Description *string   `json:"description"`
		CreatedAt   time.Time `json:"created_at"`
	}
	c.DB().Table("organizations").Select("id, name, domain, description, created_at").Where("id = ?", c.P.OrgID).Scan(&org)
	var agents, requesters int64
	c.peopleQuery(true).Where("u.is_active").Count(&agents)
	c.peopleQuery(false).Where("u.is_active").Count(&requesters)
	inbound := strings.TrimRight(a.Cfg.PublicURL, "/") + "/api/v2/inbound/email?key=" + s.InboundEmailKey
	return c.JSON(http.StatusOK, map[string]interface{}{"settings": s, "organization": org, "custom_statuses": customStatuses(s),
		"usage": map[string]int64{"agents": agents, "requesters": requesters}, "inbound_email_url": inbound})
}

var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func (a *App) updateSettings(c *Ctx) error {
	s := c.settings()
	before := *s
	var in struct {
		Settings
		CustomStatuses    []CustomStatus `json:"custom_statuses"`
		OrgName           *string        `json:"organization_name"`
		OrgDescription    *string        `json:"organization_description"`
		RegenerateInbound bool           `json:"regenerate_inbound_key"`
	}
	in.Settings = *s
	in.CustomStatuses = customStatuses(s)
	if err := c.Bind(&in); err != nil {
		return err
	}
	n := in.Settings
	errs := map[string]string{}
	if strings.TrimSpace(n.HelpdeskName) == "" {
		errs["helpdesk_name"] = "is required"
	}
	if strings.TrimSpace(n.PortalName) == "" {
		errs["portal_name"] = "is required"
	}
	if n.SupportEmail != "" && !validEmail(n.SupportEmail) {
		errs["support_email"] = "is invalid"
	}
	if _, err := time.LoadLocation(n.TimeZone); err != nil || n.TimeZone == "" {
		errs["time_zone"] = "is not a valid IANA time zone"
	}
	if n.PrimaryColor != "" && !hexColor.MatchString(n.PrimaryColor) {
		errs["primary_color"] = "must be a hex color like #2563eb"
	}
	if n.LogoURL != "" && !strings.HasPrefix(n.LogoURL, "https://") && !strings.HasPrefix(n.LogoURL, "data:image/") {
		errs["logo_url"] = "must be an https URL or an uploaded image"
	}
	if len(n.LogoURL) > 500000 {
		errs["logo_url"] = "image is too large"
	}
	if n.AutoCloseResolvedHours < 0 || n.AutoCloseResolvedHours > 24*90 {
		errs["auto_close_resolved_hours"] = "must be between 0 and 2160"
	}
	if n.PasswordMinLength < 8 || n.PasswordMinLength > 64 {
		errs["password_min_length"] = "must be between 8 and 64"
	}
	if n.SessionTimeoutMinutes < 15 || n.SessionTimeoutMinutes > 60*24*30 {
		errs["session_timeout_minutes"] = "must be between 15 minutes and 30 days"
	}
	for _, p := range []struct{ k, v string }{{"prefix_incident", n.PrefixIncident}, {"prefix_service_request", n.PrefixServiceRequest},
		{"prefix_problem", n.PrefixProblem}, {"prefix_change", n.PrefixChange}, {"prefix_release", n.PrefixRelease}} {
		if !regexp.MustCompile(`^[A-Z]{2,5}$`).MatchString(p.v) {
			errs[p.k] = "must be 2-5 uppercase letters"
		}
	}
	keys := map[string]bool{"open": true, "pending": true, "resolved": true, "closed": true}
	for i, cs := range in.CustomStatuses {
		cs.Key = strings.ToLower(strings.TrimSpace(strings.ReplaceAll(cs.Key, " ", "_")))
		if cs.Key == "" || keys[cs.Key] || strings.TrimSpace(cs.Label) == "" {
			errs["custom_statuses"] = fmt.Sprintf("status %d needs a unique key and a label", i+1)
		}
		keys[cs.Key] = true
		in.CustomStatuses[i] = cs
	}
	if in.OrgName != nil && strings.TrimSpace(*in.OrgName) == "" {
		errs["organization_name"] = "is required"
	}
	if len(errs) > 0 {
		return errValidation(errs)
	}
	n.OrgID, n.Seeded, n.CreatedAt = before.OrgID, true, before.CreatedAt
	n.InboundEmailKey = before.InboundEmailKey
	if in.RegenerateInbound {
		n.InboundEmailKey = randomKey(24)
	}
	n.CustomStatuses = jsonOf(in.CustomStatuses)
	err := c.DB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&n).Error; err != nil {
			return err
		}
		upd := map[string]interface{}{}
		if in.OrgName != nil {
			upd["name"] = strings.TrimSpace(*in.OrgName)
		}
		if in.OrgDescription != nil {
			upd["description"] = *in.OrgDescription
		}
		if len(upd) > 0 {
			upd["updated_at"] = now()
			if err := tx.Table("organizations").Where("id = ?", c.P.OrgID).Updates(upd).Error; err != nil {
				if strings.Contains(err.Error(), "duplicate") {
					return errValidation(map[string]string{"organization_name": "is already taken"})
				}
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	c.audit("settings.updated", "settings", c.P.OrgID, "Updated helpdesk settings", diffFields(before, n,
		"helpdesk_name", "portal_name", "time_zone", "auto_close_resolved_hours", "csat_enabled", "password_min_length", "session_timeout_minutes"))
	return a.getSettings(c)
}

// ---------------------------------------------------------------------------
// Business hours
// ---------------------------------------------------------------------------

func (a *App) listBusinessHours(c *Ctx) error {
	var items []BusinessHours
	c.T(&BusinessHours{}).Order("is_default DESC, name").Find(&items)
	return c.JSON(http.StatusOK, map[string]interface{}{"items": items})
}

func (a *App) saveBusinessHours(create bool) handlerFunc {
	return func(c *Ctx) error {
		bh := BusinessHours{Base: Base{OrgID: c.P.OrgID}, TimeZone: "UTC"}
		if !create {
			if err := c.T(&BusinessHours{}).Where("id = ?", c.Param("id")).Take(&bh).Error; err != nil {
				return errNotFound("business hours")
			}
		}
		var in struct {
			Name         *string                   `json:"name"`
			Description  *string                   `json:"description"`
			IsDefault    *bool                     `json:"is_default"`
			TimeZone     *string                   `json:"time_zone"`
			AlwaysOpen   *bool                     `json:"always_open"`
			WorkingHours *map[string][]sla.DaySpec `json:"working_hours"`
			Holidays     *[]sla.Holiday            `json:"holidays"`
		}
		if err := c.Bind(&in); err != nil {
			return err
		}
		errs := map[string]string{}
		if in.Name != nil {
			bh.Name = strings.TrimSpace(*in.Name)
		}
		if bh.Name == "" {
			errs["name"] = "is required"
		}
		setText(&bh.Description, in.Description)
		setText(&bh.TimeZone, in.TimeZone)
		if in.AlwaysOpen != nil {
			bh.AlwaysOpen = *in.AlwaysOpen
		}
		if in.WorkingHours != nil {
			bh.WorkingHours = jsonOf(*in.WorkingHours)
		}
		if in.Holidays != nil {
			bh.Holidays = jsonOf(*in.Holidays)
		}
		if len(bh.WorkingHours) == 0 {
			bh.WorkingHours = jsonOf(map[string]interface{}{})
		}
		if len(bh.Holidays) == 0 {
			bh.Holidays = jsonOf([]interface{}{})
		}
		var days map[string][]sla.DaySpec
		var hols []sla.Holiday
		_ = json.Unmarshal(bh.WorkingHours, &days)
		_ = json.Unmarshal(bh.Holidays, &hols)
		if _, err := time.LoadLocation(bh.TimeZone); err != nil {
			errs["time_zone"] = "is not a valid IANA time zone"
		} else if _, err := sla.NewCalendar(bh.TimeZone, bh.AlwaysOpen, days, hols); err != nil {
			errs["working_hours"] = err.Error()
		}
		if len(errs) > 0 {
			return errValidation(errs)
		}
		err := c.DB().Transaction(func(tx *gorm.DB) error {
			if in.IsDefault != nil && *in.IsDefault {
				tx.Model(&BusinessHours{}).Where("org_id = ?", c.P.OrgID).Update("is_default", false)
				bh.IsDefault = true
			}
			if create {
				return tx.Create(&bh).Error
			}
			return tx.Save(&bh).Error
		})
		if err != nil {
			return err
		}
		c.audit("business_hours.saved", "business_hours", bh.ID, "Saved business hours "+bh.Name, nil)
		return c.JSON(map[bool]int{true: http.StatusCreated, false: http.StatusOK}[create], bh)
	}
}

func (a *App) deleteBusinessHours(c *Ctx) error {
	var bh BusinessHours
	if err := c.T(&BusinessHours{}).Where("id = ?", c.Param("id")).Take(&bh).Error; err != nil {
		return errNotFound("business hours")
	}
	if bh.IsDefault {
		return errBadRequest("the default business hours cannot be deleted")
	}
	c.T(&AgentGroup{}).Where("business_hours_id = ?", bh.ID).Update("business_hours_id", nil)
	c.DB().Delete(&bh)
	return c.JSON(http.StatusOK, map[string]string{"message": "deleted"})
}

// ---------------------------------------------------------------------------
// SLA policies
// ---------------------------------------------------------------------------

func (a *App) listSLAPolicies(c *Ctx) error {
	var items []SLAPolicy
	c.T(&SLAPolicy{}).Order("is_default ASC, position ASC").Find(&items)
	return c.JSON(http.StatusOK, map[string]interface{}{"items": items})
}

func (a *App) saveSLAPolicy(create bool) handlerFunc {
	return func(c *Ctx) error {
		p := SLAPolicy{Base: Base{OrgID: c.P.OrgID}, Active: true, Conditions: jsonOf(map[string]interface{}{}), Escalations: jsonOf(map[string]interface{}{})}
		if !create {
			if err := c.T(&SLAPolicy{}).Where("id = ?", c.Param("id")).Take(&p).Error; err != nil {
				return errNotFound("SLA policy")
			}
		}
		var in struct {
			Name        *string                `json:"name"`
			Description *string                `json:"description"`
			Active      *bool                  `json:"active"`
			Position    *int                   `json:"position"`
			Conditions  *slaConditions         `json:"conditions"`
			Targets     *[]slaTarget           `json:"targets"`
			Escalations map[string]interface{} `json:"escalations"`
		}
		if err := c.Bind(&in); err != nil {
			return err
		}
		errs := map[string]string{}
		if in.Name != nil {
			p.Name = strings.TrimSpace(*in.Name)
		}
		if p.Name == "" {
			errs["name"] = "is required"
		}
		setText(&p.Description, in.Description)
		if in.Active != nil {
			if p.IsDefault && !*in.Active {
				errs["active"] = "the default policy cannot be disabled"
			}
			p.Active = *in.Active
		}
		if in.Position != nil {
			p.Position = *in.Position
		}
		if in.Conditions != nil {
			for _, id := range append(in.Conditions.GroupIDs, in.Conditions.DepartmentIDs...) {
				if !isUUID(id) {
					errs["conditions"] = "contains an invalid id"
				}
			}
			p.Conditions = jsonOf(in.Conditions)
		}
		if in.Targets != nil {
			seen := map[int]bool{}
			for _, t := range *in.Targets {
				if t.Priority < 1 || t.Priority > 4 || seen[t.Priority] {
					errs["targets"] = "each priority (1-4) may appear once"
				}
				if t.RespondWithin <= 0 || t.ResolveWithin <= 0 || t.RespondWithin > t.ResolveWithin {
					errs["targets"] = "response time must be positive and not exceed resolution time"
				}
				seen[t.Priority] = true
			}
			if len(*in.Targets) == 0 {
				errs["targets"] = "at least one target is required"
			}
			p.Targets = jsonOf(*in.Targets)
		} else if create {
			p.Targets = jsonOf(defaultSLATargets())
		}
		if in.Escalations != nil {
			p.Escalations = jsonOf(in.Escalations)
		}
		if create && p.Position == 0 {
			var maxPos int
			c.T(&SLAPolicy{}).Select("COALESCE(MAX(position),0)").Where("NOT is_default").Scan(&maxPos)
			p.Position = maxPos + 1
		}
		if len(errs) > 0 {
			return errValidation(errs)
		}
		if err := saveOnly(c, &p, create); err != nil {
			return err
		}
		c.audit("sla.saved", "sla_policy", p.ID, "Saved SLA policy "+p.Name, nil)
		return c.JSON(map[bool]int{true: http.StatusCreated, false: http.StatusOK}[create], p)
	}
}

func saveOnly(c *Ctx, v interface{}, create bool) error {
	if create {
		return c.DB().Create(v).Error
	}
	return c.DB().Save(v).Error
}

func (a *App) deleteSLAPolicy(c *Ctx) error {
	var p SLAPolicy
	if err := c.T(&SLAPolicy{}).Where("id = ?", c.Param("id")).Take(&p).Error; err != nil {
		return errNotFound("SLA policy")
	}
	if p.IsDefault {
		return errBadRequest("the default SLA policy cannot be deleted")
	}
	c.DB().Delete(&p)
	c.audit("sla.deleted", "sla_policy", p.ID, "Deleted SLA policy "+p.Name, nil)
	return c.JSON(http.StatusOK, map[string]string{"message": "deleted"})
}

// ---------------------------------------------------------------------------
// Workflows, scenarios, canned responses
// ---------------------------------------------------------------------------

func (a *App) listWorkflows(c *Ctx) error {
	var items []Workflow
	c.T(&Workflow{}).Order("event, position, created_at").Find(&items)
	return c.JSON(http.StatusOK, map[string]interface{}{"items": items, "operators": rules.Operators, "action_types": ActionTypes,
		"events": []string{"ticket_created", "ticket_updated"}})
}

func (a *App) saveWorkflow(create bool) handlerFunc {
	return func(c *Ctx) error {
		w := Workflow{Base: Base{OrgID: c.P.OrgID}, Module: "ticket", Event: "ticket_created", Active: true}
		if !create {
			if err := c.T(&Workflow{}).Where("id = ?", c.Param("id")).Take(&w).Error; err != nil {
				return errNotFound("workflow")
			}
		}
		var in struct {
			Name           *string             `json:"name"`
			Description    *string             `json:"description"`
			Event          *string             `json:"event"`
			Active         *bool               `json:"active"`
			Position       *int                `json:"position"`
			Conditions     *rules.ConditionSet `json:"conditions"`
			Actions        *[]Action           `json:"actions"`
			StopProcessing *bool               `json:"stop_processing"`
		}
		if err := c.Bind(&in); err != nil {
			return err
		}
		errs := map[string]string{}
		if in.Name != nil {
			w.Name = strings.TrimSpace(*in.Name)
		}
		if w.Name == "" {
			errs["name"] = "is required"
		}
		setText(&w.Description, in.Description)
		if in.Event != nil {
			if !oneOf(*in.Event, "ticket_created", "ticket_updated") {
				errs["event"] = "must be ticket_created or ticket_updated"
			} else {
				w.Event = *in.Event
			}
		}
		if in.Active != nil {
			w.Active = *in.Active
		}
		if in.Position != nil {
			w.Position = *in.Position
		}
		if in.StopProcessing != nil {
			w.StopProcessing = *in.StopProcessing
		}
		if in.Conditions != nil {
			if err := in.Conditions.Validate(); err != nil {
				errs["conditions"] = err.Error()
			}
			w.Conditions = jsonOf(in.Conditions)
		} else if create {
			w.Conditions = jsonOf(rules.ConditionSet{Match: "all"})
		}
		if in.Actions != nil {
			if err := validateActions(*in.Actions); err != nil {
				errs["actions"] = err.Error()
			}
			w.Actions = jsonOf(*in.Actions)
		} else if create {
			errs["actions"] = "at least one action is required"
		}
		if len(errs) > 0 {
			return errValidation(errs)
		}
		if err := saveOnly(c, &w, create); err != nil {
			return err
		}
		c.audit("workflow.saved", "workflow", w.ID, "Saved workflow "+w.Name, nil)
		return c.JSON(map[bool]int{true: http.StatusCreated, false: http.StatusOK}[create], w)
	}
}

func (a *App) listScenarios(c *Ctx) error {
	var items []Scenario
	c.T(&Scenario{}).Order("name").Find(&items)
	out := []Scenario{}
	for _, s := range items {
		switch s.Visibility {
		case "me":
			if s.CreatedByID != c.P.UserID {
				continue
			}
		case "groups":
			ok := c.P.IsAccountAdmin
			for _, g := range stringsFrom(s.GroupIDs) {
				g := g
				if c.P.InGroup(&g) {
					ok = true
				}
			}
			if !ok {
				continue
			}
		}
		out = append(out, s)
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"items": out, "action_types": ActionTypes})
}

func (a *App) saveScenario(create bool) handlerFunc {
	return func(c *Ctx) error {
		s := Scenario{Base: Base{OrgID: c.P.OrgID}, Visibility: "all", GroupIDs: jsonOf([]string{}), CreatedByID: c.P.UserID}
		if !create {
			if err := c.T(&Scenario{}).Where("id = ?", c.Param("id")).Take(&s).Error; err != nil {
				return errNotFound("scenario")
			}
			if s.CreatedByID != c.P.UserID && !c.P.Can(PrivSettingsManage) {
				return errForbidden("")
			}
		}
		var in struct {
			Name        *string   `json:"name"`
			Description *string   `json:"description"`
			Actions     *[]Action `json:"actions"`
			Visibility  *string   `json:"visibility"`
			GroupIDs    *[]string `json:"group_ids"`
		}
		if err := c.Bind(&in); err != nil {
			return err
		}
		errs := map[string]string{}
		if in.Name != nil {
			s.Name = strings.TrimSpace(*in.Name)
		}
		if s.Name == "" {
			errs["name"] = "is required"
		}
		setText(&s.Description, in.Description)
		if in.Visibility != nil {
			if !oneOf(*in.Visibility, "all", "groups", "me") {
				errs["visibility"] = "is invalid"
			} else if *in.Visibility != "me" && !c.P.Can(PrivSettingsManage) {
				errs["visibility"] = "only admins can share scenarios"
			} else {
				s.Visibility = *in.Visibility
			}
		}
		if in.GroupIDs != nil {
			s.GroupIDs = jsonOf(uniq(*in.GroupIDs))
		}
		if in.Actions != nil {
			for _, ac := range *in.Actions {
				if ac.Type == "send_email" {
					errs["actions"] = "scenarios cannot send arbitrary email"
				}
			}
			if err := validateActions(*in.Actions); err != nil {
				errs["actions"] = err.Error()
			}
			s.Actions = jsonOf(*in.Actions)
		} else if create {
			errs["actions"] = "at least one action is required"
		}
		if len(errs) > 0 {
			return errValidation(errs)
		}
		return saveAndRespond(c, &s, create)
	}
}

func (a *App) deleteOwned(model interface{}, entity string) handlerFunc {
	return func(c *Ctx) error {
		var owner struct{ CreatedByID string }
		if err := c.T(model).Select("created_by_id").Where("id = ?", c.Param("id")).Take(&owner).Error; err != nil {
			return errNotFound(entity)
		}
		if owner.CreatedByID != c.P.UserID && !c.P.Can(PrivSettingsManage) {
			return errForbidden("")
		}
		c.T(model).Where("id = ?", c.Param("id")).Delete(model)
		return c.JSON(http.StatusOK, map[string]string{"message": "deleted"})
	}
}

func (a *App) listCanned(c *Ctx) error {
	var folders []CannedFolder
	c.T(&CannedFolder{}).Order("name").Find(&folders)
	var items []CannedResponse
	c.T(&CannedResponse{}).Order("title").Find(&items)
	out := []CannedResponse{}
	for _, r := range items {
		switch r.Visibility {
		case "me":
			if r.CreatedByID != c.P.UserID {
				continue
			}
		case "groups":
			ok := c.P.IsAccountAdmin
			for _, g := range stringsFrom(r.GroupIDs) {
				g := g
				if c.P.InGroup(&g) {
					ok = true
				}
			}
			if !ok {
				continue
			}
		}
		out = append(out, r)
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"folders": folders, "items": out})
}

func (a *App) saveCanned(create bool) handlerFunc {
	return func(c *Ctx) error {
		r := CannedResponse{Base: Base{OrgID: c.P.OrgID}, Visibility: "me", GroupIDs: jsonOf([]string{}), CreatedByID: c.P.UserID}
		if !create {
			if err := c.T(&CannedResponse{}).Where("id = ?", c.Param("id")).Take(&r).Error; err != nil {
				return errNotFound("canned response")
			}
			if r.CreatedByID != c.P.UserID && !c.P.Can(PrivSettingsManage) {
				return errForbidden("")
			}
		}
		var in struct {
			FolderID   *string   `json:"folder_id"`
			Title      *string   `json:"title"`
			Content    *string   `json:"content"`
			Visibility *string   `json:"visibility"`
			GroupIDs   *[]string `json:"group_ids"`
		}
		if err := c.Bind(&in); err != nil {
			return err
		}
		errs := map[string]string{}
		if in.Title != nil {
			r.Title = strings.TrimSpace(*in.Title)
		}
		if r.Title == "" {
			errs["title"] = "is required"
		}
		setText(&r.Content, in.Content)
		if strings.TrimSpace(r.Content) == "" {
			errs["content"] = "is required"
		}
		if in.FolderID != nil {
			r.FolderID = strPtr(*in.FolderID)
			c.optionalRef(errs, "folder_id", r.FolderID, func(id string) bool { return c.existsInOrg(&CannedFolder{}, id) })
		}
		if in.Visibility != nil {
			if !oneOf(*in.Visibility, "all", "groups", "me") {
				errs["visibility"] = "is invalid"
			} else if *in.Visibility != "me" && !c.P.Can(PrivSettingsManage) {
				errs["visibility"] = "only admins can share canned responses"
			} else {
				r.Visibility = *in.Visibility
			}
		}
		if in.GroupIDs != nil {
			r.GroupIDs = jsonOf(uniq(*in.GroupIDs))
		}
		if len(errs) > 0 {
			return errValidation(errs)
		}
		return saveAndRespond(c, &r, create)
	}
}

func (a *App) saveCannedFolder(c *Ctx) error {
	var in struct {
		Name string `json:"name"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	if strings.TrimSpace(in.Name) == "" {
		return errValidation(map[string]string{"name": "is required"})
	}
	f := CannedFolder{Base: Base{OrgID: c.P.OrgID}, Name: strings.TrimSpace(in.Name)}
	return saveAndRespond(c, &f, true)
}

// renderCanned expands placeholders for a specific ticket.
func (a *App) renderCanned(c *Ctx) error {
	var r CannedResponse
	if err := c.T(&CannedResponse{}).Where("id = ?", c.Param("id")).Take(&r).Error; err != nil {
		return errNotFound("canned response")
	}
	vars := map[string]string{"agent.name": c.P.Name, "agent.email": c.P.Email}
	if tid := c.Query("ticket_id"); tid != "" {
		if t, err := c.loadTicket(tid); err == nil {
			for k, v := range a.ticketVars(c.DB(), t, c.settings()) {
				vars[k] = v
			}
			vars["agent.name"] = c.P.Name
		}
	}
	return c.JSON(http.StatusOK, map[string]string{"content": renderTemplate(r.Content, vars)})
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

func (a *App) listFormFields(c *Ctx) error {
	entity := c.Query("entity")
	if entity == "" {
		entity = "ticket"
	}
	var items []FormField
	q := c.T(&FormField{}).Where("entity = ?", entity)
	if !c.P.IsAgent {
		q = q.Where("active AND displayed_to_requester")
	}
	q.Order("position, created_at").Find(&items)
	return c.JSON(http.StatusOK, map[string]interface{}{"items": items})
}

func (a *App) saveFormField(create bool) handlerFunc {
	return func(c *Ctx) error {
		f := FormField{Base: Base{OrgID: c.P.OrgID}, Entity: "ticket", FieldType: "text", Active: true, Choices: jsonOf([]interface{}{})}
		if !create {
			if err := c.T(&FormField{}).Where("id = ?", c.Param("id")).Take(&f).Error; err != nil {
				return errNotFound("field")
			}
		}
		before := f
		if err := c.Bind(&f); err != nil {
			return err
		}
		f.Base, f.IsDefault = before.Base, before.IsDefault
		if before.IsDefault {
			f.Name, f.FieldType, f.Entity = before.Name, before.FieldType, before.Entity
		}
		errs := map[string]string{}
		f.Name = strings.ToLower(strings.TrimSpace(strings.ReplaceAll(f.Name, " ", "_")))
		if !regexp.MustCompile(`^[a-z][a-z0-9_]{1,40}$`).MatchString(f.Name) {
			errs["name"] = "must start with a letter and contain only letters, numbers and underscores"
		}
		if strings.TrimSpace(f.Label) == "" {
			errs["label"] = "is required"
		}
		if !oneOf(f.Entity, "ticket", "problem", "change", "release", "asset", "requester") {
			errs["entity"] = "is invalid"
		}
		if !oneOf(f.FieldType, "text", "paragraph", "number", "decimal", "dropdown", "multi_select", "checkbox", "date", "nested") {
			errs["field_type"] = "is invalid"
		}
		var n int64
		excl := f.ID
		if excl == "" {
			excl = "00000000-0000-0000-0000-000000000000"
		}
		c.T(&FormField{}).Where("entity = ? AND name = ? AND id <> ?", f.Entity, f.Name, excl).Count(&n)
		if n > 0 {
			errs["name"] = "is already used on this form"
		}
		if len(f.Choices) == 0 || string(f.Choices) == "null" {
			f.Choices = jsonOf([]interface{}{})
		}
		if len(errs) > 0 {
			return errValidation(errs)
		}
		if err := saveOnly(c, &f, create); err != nil {
			return err
		}
		c.audit("form_field.saved", "form_field", f.ID, "Saved field "+f.Label, nil)
		return c.JSON(map[bool]int{true: http.StatusCreated, false: http.StatusOK}[create], f)
	}
}

func (a *App) deleteFormField(c *Ctx) error {
	var f FormField
	if err := c.T(&FormField{}).Where("id = ?", c.Param("id")).Take(&f).Error; err != nil {
		return errNotFound("field")
	}
	if f.IsDefault {
		return errBadRequest("default fields can be hidden but not deleted")
	}
	c.DB().Delete(&f)
	return c.JSON(http.StatusOK, map[string]string{"message": "deleted"})
}

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

func (a *App) listAnnouncements(c *Ctx) error {
	q := c.T(&Announcement{})
	manage := c.P.IsAgent && c.P.Can(PrivAnnouncementsManage) && c.Query("manage") == "1"
	if !manage {
		q = q.Where("visible_from <= ? AND (visible_till IS NULL OR visible_till > ?)", now(), now())
		if c.P.IsAgent {
			q = q.Where("visibility IN ('everyone','agents','groups')")
		} else {
			q = q.Where("visibility IN ('everyone','requesters')")
		}
	}
	var items []Announcement
	q.Order("visible_from DESC").Limit(100).Find(&items)
	out := []map[string]interface{}{}
	for _, an := range items {
		if !manage && an.Visibility == "groups" {
			ok := false
			for _, g := range stringsFrom(an.GroupIDs) {
				g := g
				if c.P.InGroup(&g) {
					ok = true
				}
			}
			if !ok {
				continue
			}
		}
		state := "active"
		if an.VisibleFrom.After(now()) {
			state = "scheduled"
		} else if an.VisibleTill != nil && an.VisibleTill.Before(now()) {
			state = "expired"
		}
		out = append(out, map[string]interface{}{"id": an.ID, "title": an.Title, "body": an.Body, "visibility": an.Visibility,
			"group_ids": stringsFrom(an.GroupIDs), "visible_from": an.VisibleFrom, "visible_till": an.VisibleTill, "state": state, "created_at": an.CreatedAt})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"items": out})
}

func (a *App) saveAnnouncement(create bool) handlerFunc {
	return func(c *Ctx) error {
		an := Announcement{Base: Base{OrgID: c.P.OrgID}, Visibility: "everyone", GroupIDs: jsonOf([]string{}), VisibleFrom: now(), CreatedByID: c.P.UserID}
		if !create {
			if err := c.T(&Announcement{}).Where("id = ?", c.Param("id")).Take(&an).Error; err != nil {
				return errNotFound("announcement")
			}
		}
		var in struct {
			Title       *string   `json:"title"`
			Body        *string   `json:"body"`
			Visibility  *string   `json:"visibility"`
			GroupIDs    *[]string `json:"group_ids"`
			VisibleFrom *string   `json:"visible_from"`
			VisibleTill *string   `json:"visible_till"`
		}
		if err := c.Bind(&in); err != nil {
			return err
		}
		errs := map[string]string{}
		if in.Title != nil {
			an.Title = strings.TrimSpace(*in.Title)
		}
		if an.Title == "" {
			errs["title"] = "is required"
		}
		setText(&an.Body, in.Body)
		if in.Visibility != nil {
			if !oneOf(*in.Visibility, "everyone", "agents", "requesters", "groups") {
				errs["visibility"] = "is invalid"
			} else {
				an.Visibility = *in.Visibility
			}
		}
		if in.GroupIDs != nil {
			an.GroupIDs = jsonOf(uniq(*in.GroupIDs))
		}
		if in.VisibleFrom != nil {
			if t, ok := parseTime(*in.VisibleFrom); ok && t != nil {
				an.VisibleFrom = *t
			}
		}
		setTime(errs, "visible_till", &an.VisibleTill, in.VisibleTill)
		if an.VisibleTill != nil && an.VisibleTill.Before(an.VisibleFrom) {
			errs["visible_till"] = "must be after the start"
		}
		if len(errs) > 0 {
			return errValidation(errs)
		}
		return saveAndRespond(c, &an, create)
	}
}

// ---------------------------------------------------------------------------
// Surveys / CSAT
// ---------------------------------------------------------------------------

func (a *App) getSurvey(c *Ctx) error {
	var s Survey
	if err := c.T(&Survey{}).Order("created_at").Take(&s).Error; err != nil {
		s = Survey{Base: Base{OrgID: c.P.OrgID}, Title: "Customer satisfaction", Question: "How would you rate the support you received?", ScaleType: 5, SendOn: "resolved", Active: true}
		c.DB().Create(&s)
	}
	var stats struct {
		Responses int64   `json:"responses"`
		Average   float64 `json:"average"`
		Positive  int64   `json:"positive"`
	}
	c.T(&SurveyResponse{}).Count(&stats.Responses)
	c.T(&SurveyResponse{}).Select("COALESCE(AVG(rating),0)").Scan(&stats.Average)
	c.T(&SurveyResponse{}).Where("rating >= 4").Count(&stats.Positive)
	var recent []SurveyResponse
	c.T(&SurveyResponse{}).Order("created_at DESC").Limit(25).Find(&recent)
	uids := []string{}
	for _, r := range recent {
		uids = append(uids, r.RequesterID, deref(r.AgentID))
	}
	l := c.lookup(uids, nil, nil)
	rows := []map[string]interface{}{}
	for _, r := range recent {
		rows = append(rows, map[string]interface{}{"id": r.ID, "ticket_id": r.TicketID, "rating": r.Rating, "feedback": r.Feedback,
			"requester": l.userS(r.RequesterID), "agent": l.user(r.AgentID), "created_at": r.CreatedAt})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"survey": s, "stats": stats, "recent": rows})
}

func (a *App) updateSurvey(c *Ctx) error {
	var s Survey
	if err := c.T(&Survey{}).Order("created_at").Take(&s).Error; err != nil {
		return errNotFound("survey")
	}
	base := s.Base
	if err := c.Bind(&s); err != nil {
		return err
	}
	s.Base = base
	errs := map[string]string{}
	if strings.TrimSpace(s.Question) == "" {
		errs["question"] = "is required"
	}
	if s.ScaleType != 3 && s.ScaleType != 5 {
		errs["scale_type"] = "must be 3 or 5"
	}
	if !oneOf(s.SendOn, "resolved", "closed") {
		errs["send_on"] = "must be resolved or closed"
	}
	if len(errs) > 0 {
		return errValidation(errs)
	}
	c.DB().Save(&s)
	return c.JSON(http.StatusOK, s)
}

// ---------------------------------------------------------------------------
// Email notifications, outbox, audit log
// ---------------------------------------------------------------------------

func (a *App) listEmailTemplates(c *Ctx) error {
	var items []EmailTemplate
	c.T(&EmailTemplate{}).Order("recipient, name").Find(&items)
	return c.JSON(http.StatusOK, map[string]interface{}{"items": items})
}

func (a *App) updateEmailTemplate(c *Ctx) error {
	var t EmailTemplate
	if err := c.T(&EmailTemplate{}).Where("id = ?", c.Param("id")).Take(&t).Error; err != nil {
		return errNotFound("template")
	}
	var in struct {
		Enabled *bool   `json:"enabled"`
		Subject *string `json:"subject"`
		Body    *string `json:"body"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	if in.Enabled != nil {
		t.Enabled = *in.Enabled
	}
	setText(&t.Subject, in.Subject)
	setText(&t.Body, in.Body)
	if strings.TrimSpace(t.Subject) == "" || strings.TrimSpace(t.Body) == "" {
		return errValidation(map[string]string{"subject": "subject and body are required"})
	}
	c.DB().Save(&t)
	c.audit("email_template.updated", "email_template", t.ID, "Updated email notification "+t.Name, nil)
	return c.JSON(http.StatusOK, t)
}

func (a *App) listOutbox(c *Ctx) error {
	pg := c.Paging()
	q := func() *gorm.DB {
		q := c.T(&EmailOutbox{})
		if v := c.Query("status"); v != "" {
			q = q.Where("status = ?", v)
		}
		return q
	}
	var total int64
	q().Count(&total)
	var items []EmailOutbox
	q().Order("created_at DESC").Offset(pg.Offset()).Limit(pg.PerPage).Find(&items)
	return c.JSON(http.StatusOK, ListResponse{Items: items, Total: total, Page: pg.Page, PerPage: pg.PerPage})
}

func (a *App) listAuditLogs(c *Ctx) error {
	pg := c.Paging()
	q := func() *gorm.DB {
		q := c.T(&AuditLog{})
		if v := c.Query("action"); v != "" {
			q = q.Where("action ILIKE ?", likeEscape(v))
		}
		if v := c.Query("actor_id"); isUUID(v) {
			q = q.Where("actor_id = ?", v)
		}
		if v, ok := parseTime(c.Query("from")); ok && v != nil {
			q = q.Where("created_at >= ?", *v)
		}
		return q
	}
	var total int64
	q().Count(&total)
	var items []AuditLog
	q().Order("created_at DESC").Offset(pg.Offset()).Limit(pg.PerPage).Find(&items)
	ids := []string{}
	for _, it := range items {
		ids = append(ids, deref(it.ActorID))
	}
	l := c.lookup(ids, nil, nil)
	rows := []map[string]interface{}{}
	for _, it := range items {
		rows = append(rows, map[string]interface{}{"id": it.ID, "action": it.Action, "entity_type": it.EntityType, "entity_id": it.EntityID,
			"summary": it.Summary, "details": it.Details, "ip": it.IP, "actor": l.user(it.ActorID), "created_at": it.CreatedAt})
	}
	return c.JSON(http.StatusOK, ListResponse{Items: rows, Total: total, Page: pg.Page, PerPage: pg.PerPage})
}

// ---------------------------------------------------------------------------
// On-call schedules
// ---------------------------------------------------------------------------

// onCallNow returns the member on call at t for a schedule.
func onCallNow(s *OnCallSchedule, t time.Time) (string, time.Time) {
	members := stringsFrom(s.MemberIDs)
	if len(members) == 0 {
		return "", time.Time{}
	}
	loc, err := time.LoadLocation(s.TimeZone)
	if err != nil {
		loc = time.UTC
	}
	period := 7 * 24 * time.Hour
	if s.RotationType == "daily" {
		period = 24 * time.Hour
	}
	start := s.RotationStart.In(loc)
	if handoff, err := sla.ParseClock(s.HandoffTime); err == nil {
		y, m, d := start.Date()
		start = time.Date(y, m, d, 0, 0, 0, 0, loc).Add(time.Duration(handoff) * time.Minute)
	}
	if t.Before(start) {
		return members[0], start
	}
	elapsed := t.Sub(start)
	idx := int(elapsed/period) % len(members)
	next := start.Add((elapsed/period + 1) * period)
	return members[idx], next
}

func (a *App) listOnCall(c *Ctx) error {
	var items []OnCallSchedule
	c.T(&OnCallSchedule{}).Order("name").Find(&items)
	uids, gids := []string{}, []string{}
	for _, s := range items {
		uids = append(uids, stringsFrom(s.MemberIDs)...)
		gids = append(gids, deref(s.GroupID))
	}
	l := c.lookup(uids, gids, nil)
	out := []map[string]interface{}{}
	for i := range items {
		s := &items[i]
		cur, next := onCallNow(s, now())
		members := []*UserBrief{}
		for _, m := range stringsFrom(s.MemberIDs) {
			if u := l.userS(m); u != nil {
				members = append(members, u)
			}
		}
		out = append(out, map[string]interface{}{"schedule": s, "group": l.group(s.GroupID), "members": members,
			"on_call": l.userS(cur), "next_handoff": next})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"items": out})
}

func (a *App) saveOnCall(create bool) handlerFunc {
	return func(c *Ctx) error {
		s := OnCallSchedule{Base: Base{OrgID: c.P.OrgID}, RotationType: "weekly", RotationStart: now(), HandoffTime: "09:00", TimeZone: "UTC", MemberIDs: jsonOf([]string{})}
		if !create {
			if err := c.T(&OnCallSchedule{}).Where("id = ?", c.Param("id")).Take(&s).Error; err != nil {
				return errNotFound("schedule")
			}
		}
		var in struct {
			Name          *string   `json:"name"`
			GroupID       *string   `json:"group_id"`
			MemberIDs     *[]string `json:"member_ids"`
			RotationType  *string   `json:"rotation_type"`
			RotationStart *string   `json:"rotation_start"`
			HandoffTime   *string   `json:"handoff_time"`
			TimeZone      *string   `json:"time_zone"`
		}
		if err := c.Bind(&in); err != nil {
			return err
		}
		errs := map[string]string{}
		if in.Name != nil {
			s.Name = strings.TrimSpace(*in.Name)
		}
		if s.Name == "" {
			errs["name"] = "is required"
		}
		if in.GroupID != nil {
			s.GroupID = strPtr(*in.GroupID)
			c.optionalRef(errs, "group_id", s.GroupID, func(id string) bool { return c.existsInOrg(&AgentGroup{}, id) })
		}
		if in.MemberIDs != nil {
			for _, id := range *in.MemberIDs {
				if !c.agentInOrg(id) {
					errs["member_ids"] = "must contain active agents"
				}
			}
			s.MemberIDs = jsonOf(*in.MemberIDs)
		}
		if in.RotationType != nil {
			if !oneOf(*in.RotationType, "daily", "weekly") {
				errs["rotation_type"] = "must be daily or weekly"
			} else {
				s.RotationType = *in.RotationType
			}
		}
		if in.RotationStart != nil {
			if t, ok := parseTime(*in.RotationStart); ok && t != nil {
				s.RotationStart = *t
			} else {
				errs["rotation_start"] = "is invalid"
			}
		}
		if in.HandoffTime != nil {
			if _, err := sla.ParseClock(*in.HandoffTime); err != nil {
				errs["handoff_time"] = "must be HH:MM"
			} else {
				s.HandoffTime = *in.HandoffTime
			}
		}
		if in.TimeZone != nil {
			if _, err := time.LoadLocation(*in.TimeZone); err != nil {
				errs["time_zone"] = "is invalid"
			} else {
				s.TimeZone = *in.TimeZone
			}
		}
		if len(errs) > 0 {
			return errValidation(errs)
		}
		return saveAndRespond(c, &s, create)
	}
}

func (a *App) deleteByID(model interface{}, entity string) handlerFunc {
	return func(c *Ctx) error {
		res := c.T(model).Where("id = ?", c.Param("id")).Delete(model)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return errNotFound(entity)
		}
		c.audit(strings.ReplaceAll(entity, " ", "_")+".deleted", entity, c.Param("id"), "Deleted "+entity, nil)
		return c.JSON(http.StatusOK, map[string]string{"message": "deleted"})
	}
}
