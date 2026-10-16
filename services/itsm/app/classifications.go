package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"regexp"
	"strings"

	"gorm.io/gorm"
)

// Classifications are the admin-managed choice lists of each module: the
// category → sub-category → item tree, business impact and change types.
// They are stored as default form fields, so the form-field API, the ticket
// forms and automation conditions keep reading them as before.

// choice is one entry of a classification list.
type choice struct {
	Value            string   `json:"value"`
	Label            string   `json:"label,omitempty"`
	Description      string   `json:"description,omitempty"`
	RequiresApproval *bool    `json:"requires_approval,omitempty"`
	System           bool     `json:"system,omitempty"`
	Children         []choice `json:"children,omitempty"`
}

func node(value string, children ...choice) choice { return choice{Value: value, Children: children} }

func leaves(values ...string) []choice {
	out := make([]choice, len(values))
	for i, v := range values {
		out[i] = choice{Value: v}
	}
	return out
}

func defaultTicketCategories() []choice {
	return []choice{
		node("Hardware",
			node("Laptop", leaves("Battery", "Screen", "Keyboard or trackpad", "Charger", "Performance", "Physical damage")...),
			node("Desktop", leaves("Will not start", "Performance", "Physical damage")...),
			node("Monitor", leaves("No display", "Flickering", "Additional monitor")...),
			node("Printer", leaves("Paper jam", "Print quality", "Toner or ink", "Cannot connect")...),
			node("Peripherals", leaves("Mouse", "Keyboard", "Headset", "Webcam", "Docking station")...),
			node("Mobile device", leaves("Smartphone", "Tablet")...),
		),
		node("Software",
			node("Operating system", leaves("Windows", "macOS", "Linux", "Updates")...),
			node("Productivity suite", leaves("Microsoft 365", "Google Workspace", "Adobe Acrobat")...),
			node("Business application", leaves("ERP", "CRM", "HR system", "Finance system")...),
			node("Installation request", leaves("New software", "License", "Upgrade")...),
			node("Web browser", leaves("Chrome", "Edge", "Safari", "Firefox")...),
		),
		node("Network",
			node("VPN", leaves("Cannot connect", "Slow", "Keeps disconnecting")...),
			node("Wi-Fi", leaves("No signal", "Slow", "Guest access")...),
			node("Internet access", leaves("No connectivity", "Slow")...),
			node("Firewall", leaves("Rule request", "Blocked website")...),
			node("Wired network", leaves("Network port", "Cabling")...),
		),
		node("Access",
			node("Password reset"),
			node("Account unlock"),
			node("Permissions", leaves("Shared drive", "Application role", "Distribution list", "Admin rights")...),
			node("New account"),
			node("Multi-factor authentication", leaves("Enrollment", "Lost device")...),
			node("Account removal"),
		),
		node("Email & Collaboration",
			node("Mailbox", leaves("Cannot send or receive", "Storage full", "Shared mailbox", "Delegation")...),
			node("Calendar"),
			node("Video conferencing", leaves("Zoom", "Microsoft Teams", "Google Meet")...),
			node("Chat", leaves("Slack", "Microsoft Teams")...),
			node("File sharing", leaves("OneDrive", "SharePoint", "Google Drive")...),
		),
		node("Security",
			node("Phishing or suspicious email"),
			node("Malware or virus"),
			node("Lost or stolen device"),
			node("Data leak"),
			node("Policy exception"),
		),
		node("Telephony", leaves("Desk phone", "Mobile plan", "Softphone", "Voicemail")...),
		node("Office Facilities", leaves("Desk", "Meeting room", "Badge access", "Building maintenance", "Office supplies", "Parking")...),
		node("Onboarding & Offboarding", leaves("New hire setup", "Role change", "Equipment return", "Access removal")...),
		node("Human Resources", leaves("Payroll", "Benefits", "Leave and attendance", "Employee records", "Policies")...),
		node("Finance", leaves("Reimbursement", "Purchase request", "Vendor payment", "Invoice question", "Corporate card")...),
		node("Legal", leaves("Contract review", "NDA request", "Compliance question")...),
		node("Other"),
	}
}

// legacyTicketCategories is the first default list; organizations that never
// edited it are upgraded to defaultTicketCategories.
func legacyTicketCategories() []choice {
	return []choice{
		node("Hardware", leaves("Laptop", "Desktop", "Monitor", "Printer", "Peripherals")...),
		node("Software", leaves("Operating system", "Productivity suite", "Business application", "Installation request")...),
		node("Network", leaves("VPN", "Wi-Fi", "Internet access", "Firewall")...),
		node("Access", leaves("Password reset", "Account unlock", "Permissions", "New account")...),
		node("Email & Collaboration", leaves("Mailbox", "Calendar", "Video conferencing", "Chat")...),
		node("Office Facilities", leaves("Desk", "Meeting room", "Badge access")...),
		node("Other"),
	}
}

func defaultProblemCategories() []choice {
	return []choice{
		node("Hardware", leaves("Server", "Storage", "End-user device", "Network device")...),
		node("Software", leaves("Application defect", "Operating system", "Third-party software", "Integration")...),
		node("Network", leaves("Connectivity", "Performance", "DNS or DHCP", "Firewall")...),
		node("Database", leaves("Performance", "Availability", "Data integrity")...),
		node("Infrastructure", leaves("Cloud platform", "Data center", "Virtualization", "Backup and recovery")...),
		node("Security", leaves("Vulnerability", "Access control", "Incident follow-up")...),
		node("Service", leaves("Capacity", "Availability", "Configuration")...),
		node("Process", leaves("Change-induced", "Documentation", "Vendor")...),
		node("Other"),
	}
}

func defaultChangeCategories() []choice {
	return []choice{
		node("Hardware", leaves("Server", "Storage", "End-user device", "Network device")...),
		node("Software", leaves("Application release", "Patch or update", "Configuration", "New software")...),
		node("Network", leaves("Routing", "Firewall rule", "VPN", "Wi-Fi")...),
		node("Database", leaves("Schema change", "Upgrade", "Maintenance")...),
		node("Infrastructure", leaves("Cloud resource", "Virtualization", "Data center", "Backup")...),
		node("Security", leaves("Certificate", "Access policy", "Security patch")...),
		node("Facilities", leaves("Office move", "Power", "Cooling")...),
		node("Process & Policy"),
		node("Other"),
	}
}

func defaultTicketImpact() []choice {
	return leaves("Affects customers or revenue", "Blocks my whole team", "Blocking my work", "Slowing me down", "Minor inconvenience")
}

func legacyTicketImpact() []choice {
	return leaves("Blocking my work", "Slowing me down", "Minor inconvenience")
}

func defaultProblemImpact() []choice {
	return leaves("Critical: business stopped", "High: major services degraded", "Medium: some users affected", "Low: minimal effect")
}

func defaultChangeImpact() []choice {
	return leaves("Service outage required", "Degraded service during the window", "No user impact")
}

func boolPtr(b bool) *bool { return &b }

// systemChangeTypes are built in; their approval rule cannot be changed.
func systemChangeTypes() []choice {
	return []choice{
		{Value: "minor", Label: "Minor", Description: "Low-risk change that needs no review", RequiresApproval: boolPtr(false), System: true},
		{Value: "standard", Label: "Standard", Description: "Pre-approved, routine change that follows a known procedure", RequiresApproval: boolPtr(false), System: true},
		{Value: "major", Label: "Major", Description: "Significant change that the change advisory board must approve", RequiresApproval: boolPtr(true), System: true},
		{Value: "emergency", Label: "Emergency", Description: "Urgent change to restore service; approved by the emergency CAB", RequiresApproval: boolPtr(true), System: true},
	}
}

// classificationSpec describes one managed list.
type classificationSpec struct {
	Entity, Name, Label, RequesterLabel, FieldType string
	Defaults                                       func() []choice
	Legacy                                         func() []choice
	// System lists are default fields (cannot be deleted, not rendered as
	// custom fields); the ticket business impact is a regular custom field.
	System    bool
	Requester bool
	Position  int
}

var classificationSpecs = []classificationSpec{
	{Entity: "ticket", Name: "category", Label: "Category", RequesterLabel: "Category", FieldType: "nested", Defaults: defaultTicketCategories, Legacy: legacyTicketCategories, System: true, Requester: true, Position: 1},
	{Entity: "ticket", Name: "impact_on_business", Label: "Business impact", RequesterLabel: "How is this affecting your work?", FieldType: "dropdown", Defaults: defaultTicketImpact, Legacy: legacyTicketImpact, Requester: true, Position: 2},
	{Entity: "problem", Name: "category", Label: "Category", FieldType: "nested", Defaults: defaultProblemCategories, System: true, Position: 1},
	{Entity: "problem", Name: "business_impact", Label: "Business impact", FieldType: "dropdown", Defaults: defaultProblemImpact, System: true, Position: 2},
	{Entity: "change", Name: "change_type", Label: "Change type", FieldType: "dropdown", Defaults: systemChangeTypes, System: true, Position: 1},
	{Entity: "change", Name: "category", Label: "Category", FieldType: "nested", Defaults: defaultChangeCategories, System: true, Position: 2},
	{Entity: "change", Name: "business_impact", Label: "Business impact", FieldType: "dropdown", Defaults: defaultChangeImpact, System: true, Position: 3},
}

func findSpec(entity, name string) *classificationSpec {
	for i := range classificationSpecs {
		if classificationSpecs[i].Entity == entity && classificationSpecs[i].Name == name {
			return &classificationSpecs[i]
		}
	}
	return nil
}

func (sp classificationSpec) newField(orgID string) FormField {
	return FormField{Base: Base{OrgID: orgID}, Entity: sp.Entity, Name: sp.Name, Label: sp.Label, LabelForRequester: sp.RequesterLabel,
		FieldType: sp.FieldType, Choices: jsonOf(sp.Defaults()), DisplayedToRequester: sp.Requester, EditableByRequester: sp.Requester,
		Position: sp.Position, IsDefault: sp.System, Active: true}
}

func sameChoices(raw []byte, want []choice) bool {
	var a, b interface{}
	if json.Unmarshal(raw, &a) != nil {
		return false
	}
	_ = json.Unmarshal(jsonOf(want), &b)
	return reflect.DeepEqual(a, b)
}

// ensureClassifications adds missing system lists and upgrades lists that
// still hold the first default values. Lists an admin edited are kept, and a
// deleted ticket business-impact field stays deleted.
func ensureClassifications(tx *gorm.DB, orgID string) error {
	for _, sp := range classificationSpecs {
		var f FormField
		err := tx.Where("org_id = ? AND entity = ? AND name = ?", orgID, sp.Entity, sp.Name).Take(&f).Error
		if err == gorm.ErrRecordNotFound {
			if !sp.System {
				continue
			}
			nf := sp.newField(orgID)
			if err := tx.Create(&nf).Error; err != nil {
				return err
			}
			continue
		}
		if err != nil {
			return err
		}
		if sp.Legacy != nil && sameChoices(f.Choices, sp.Legacy()) {
			if err := tx.Model(&FormField{}).Where("id = ?", f.ID).Update("choices", jsonOf(sp.Defaults())).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

// classificationChoices returns the active list for entity/name; ok is false
// when the list does not exist or is switched off (anything is accepted then).
func (c *Ctx) classificationChoices(entity, name string) ([]choice, bool) {
	var f FormField
	if c.T(&FormField{}).Where("entity = ? AND name = ? AND active", entity, name).Take(&f).Error != nil {
		return nil, false
	}
	var list []choice
	if json.Unmarshal(f.Choices, &list) != nil {
		return nil, false
	}
	return list, true
}

func findChoice(list []choice, value string) *choice {
	for i := range list {
		if list[i].Value == value {
			return &list[i]
		}
	}
	return nil
}

// checkCategory validates a category / sub-category / item path against the
// module's category tree.
func (c *Ctx) checkCategory(errs map[string]string, entity, cat, sub, item string) {
	tree, ok := c.classificationChoices(entity, "category")
	if !ok {
		return
	}
	if cat == "" {
		if sub != "" || item != "" {
			errs["category"] = "is required when a sub-category is chosen"
		}
		return
	}
	l1 := findChoice(tree, cat)
	if l1 == nil {
		errs["category"] = "is not one of the configured categories"
		return
	}
	if sub == "" {
		if item != "" {
			errs["sub_category"] = "is required when an item is chosen"
		}
		return
	}
	l2 := findChoice(l1.Children, sub)
	if l2 == nil {
		errs["sub_category"] = fmt.Sprintf("is not a sub-category of %s", cat)
		return
	}
	if item != "" && findChoice(l2.Children, item) == nil {
		errs["item_category"] = fmt.Sprintf("is not an item of %s", sub)
	}
}

// checkChoice validates a flat list value such as business impact.
func (c *Ctx) checkChoice(errs map[string]string, entity, name, field, value string) {
	if value == "" {
		return
	}
	list, ok := c.classificationChoices(entity, name)
	if ok && findChoice(list, value) == nil {
		errs[field] = "is not one of the configured options"
	}
}

// changeTypes returns the organization's change types (built-in ones when the
// list is missing).
func (c *Ctx) changeTypes() []choice {
	if list, ok := c.classificationChoices("change", "change_type"); ok && len(list) > 0 {
		return list
	}
	return systemChangeTypes()
}

func (c *Ctx) changeTypeNeedsApproval(value string) bool {
	if t := findChoice(c.changeTypes(), value); t != nil && t.RequiresApproval != nil {
		return *t.RequiresApproval
	}
	return value == "major" || value == "emergency"
}

// ---------------------------------------------------------------------------
// Admin API
// ---------------------------------------------------------------------------

type classificationDTO struct {
	Entity    string   `json:"entity"`
	Name      string   `json:"name"`
	Label     string   `json:"label"`
	FieldType string   `json:"field_type"`
	FieldID   *string  `json:"field_id"`
	Active    bool     `json:"active"`
	Choices   []choice `json:"choices"`
}

// GET /classifications?entity=ticket
func (a *App) listClassifications(c *Ctx) error {
	entity := c.Query("entity")
	out := []classificationDTO{}
	for _, sp := range classificationSpecs {
		if entity != "" && sp.Entity != entity {
			continue
		}
		d := classificationDTO{Entity: sp.Entity, Name: sp.Name, Label: sp.Label, FieldType: sp.FieldType, Choices: []choice{}}
		var f FormField
		if c.T(&FormField{}).Where("entity = ? AND name = ?", sp.Entity, sp.Name).Take(&f).Error == nil {
			id := f.ID
			d.FieldID, d.Active, d.Label = &id, f.Active, f.Label
			_ = json.Unmarshal(f.Choices, &d.Choices)
		}
		out = append(out, d)
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"items": out})
}

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(s string) string {
	return strings.Trim(slugRe.ReplaceAllString(strings.ToLower(s), "_"), "_")
}

// normalizeChoices validates and cleans a submitted list.
func normalizeChoices(sp *classificationSpec, in []choice) ([]choice, error) {
	count := 0
	var walk func(list []choice, depth int, path string) ([]choice, error)
	walk = func(list []choice, depth int, path string) ([]choice, error) {
		seen := map[string]bool{}
		out := []choice{}
		for _, ch := range list {
			ch.Value = strings.Join(strings.Fields(ch.Value), " ")
			if sp.Name == "change_type" {
				ch.Label = strings.Join(strings.Fields(ch.Label), " ")
				if ch.Label == "" {
					ch.Label = ch.Value
				}
				if ch.Value == "" {
					ch.Value = slugify(ch.Label)
				}
			}
			if ch.Value == "" {
				return nil, fmt.Errorf("%snames cannot be empty", path)
			}
			if len(ch.Value) > 80 {
				return nil, fmt.Errorf("%s%q is longer than 80 characters", path, ch.Value)
			}
			key := strings.ToLower(ch.Value)
			if seen[key] {
				return nil, fmt.Errorf("%s%q appears twice", path, ch.Value)
			}
			seen[key] = true
			if count++; count > 2000 {
				return nil, fmt.Errorf("lists are limited to 2000 entries")
			}
			ch.Description = strings.TrimSpace(ch.Description)
			if len(ch.Description) > 300 {
				ch.Description = ch.Description[:300]
			}
			if sp.FieldType != "nested" || depth >= 3 {
				if len(ch.Children) > 0 && sp.FieldType == "nested" {
					return nil, fmt.Errorf("categories can be at most three levels deep (category, sub-category, item)")
				}
				ch.Children = nil
			} else if len(ch.Children) > 0 {
				kids, err := walk(ch.Children, depth+1, path+ch.Value+" › ")
				if err != nil {
					return nil, err
				}
				ch.Children = kids
			}
			if sp.Name != "change_type" {
				ch.Label, ch.RequiresApproval, ch.System = "", nil, false
			} else {
				ch.System = false
				if ch.RequiresApproval == nil {
					ch.RequiresApproval = boolPtr(false)
				}
			}
			out = append(out, ch)
		}
		return out, nil
	}
	list, err := walk(in, 1, "")
	if err != nil {
		return nil, err
	}
	if sp.Name == "change_type" {
		// Built-in change types always exist and keep their approval rule.
		for _, sys := range systemChangeTypes() {
			if cur := findChoice(list, sys.Value); cur != nil {
				cur.System, cur.RequiresApproval = true, sys.RequiresApproval
			} else {
				list = append(list, sys)
			}
		}
	}
	if len(list) == 0 && sp.FieldType == "nested" {
		return nil, fmt.Errorf("add at least one category")
	}
	return list, nil
}

// PUT /classifications/{entity}/{name} {choices, active?}
func (a *App) saveClassification(c *Ctx) error {
	sp := findSpec(c.Param("entity"), c.Param("name"))
	if sp == nil {
		return errNotFound("list")
	}
	var in struct {
		Choices []choice `json:"choices"`
		Active  *bool    `json:"active"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	list, err := normalizeChoices(sp, in.Choices)
	if err != nil {
		return errValidation(map[string]string{"choices": err.Error()})
	}
	var f FormField
	if c.T(&FormField{}).Where("entity = ? AND name = ?", sp.Entity, sp.Name).Take(&f).Error != nil {
		f = sp.newField(c.P.OrgID)
		f.Choices = jsonOf(list)
		if err := c.DB().Create(&f).Error; err != nil {
			return err
		}
	} else {
		updates := map[string]interface{}{"choices": jsonOf(list), "updated_at": now()}
		if in.Active != nil && sp.Name != "change_type" {
			updates["active"] = *in.Active
		}
		if err := c.DB().Model(&FormField{}).Where("id = ?", f.ID).Updates(updates).Error; err != nil {
			return err
		}
	}
	c.audit("classification.saved", "form_field", f.ID, fmt.Sprintf("Updated %s %s", sp.Entity, strings.ToLower(sp.Label)), nil)
	return a.listClassificationsFor(c, sp.Entity)
}

// POST /classifications/{entity}/{name}/reset restores the default list.
func (a *App) resetClassification(c *Ctx) error {
	sp := findSpec(c.Param("entity"), c.Param("name"))
	if sp == nil {
		return errNotFound("list")
	}
	var f FormField
	if c.T(&FormField{}).Where("entity = ? AND name = ?", sp.Entity, sp.Name).Take(&f).Error != nil {
		nf := sp.newField(c.P.OrgID)
		if err := c.DB().Create(&nf).Error; err != nil {
			return err
		}
		f = nf
	} else if err := c.DB().Model(&FormField{}).Where("id = ?", f.ID).Updates(map[string]interface{}{"choices": jsonOf(sp.Defaults()), "updated_at": now()}).Error; err != nil {
		return err
	}
	c.audit("classification.reset", "form_field", f.ID, fmt.Sprintf("Restored default %s %s", sp.Entity, strings.ToLower(sp.Label)), nil)
	return a.listClassificationsFor(c, sp.Entity)
}

func (a *App) listClassificationsFor(c *Ctx, entity string) error {
	c.R.URL.RawQuery = "entity=" + entity
	return a.listClassifications(c)
}
