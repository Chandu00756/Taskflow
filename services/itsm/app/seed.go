package app

import (
	"context"
	"crypto/rand"
	"encoding/hex"

	"gorm.io/gorm"
)

// Privileges that can be granted to agent roles.
const (
	PrivTicketsManage       = "tickets.manage"
	PrivTicketsDelete       = "tickets.delete"
	PrivProblemsView        = "problems.view"
	PrivProblemsManage      = "problems.manage"
	PrivChangesView         = "changes.view"
	PrivChangesManage       = "changes.manage"
	PrivReleasesView        = "releases.view"
	PrivReleasesManage      = "releases.manage"
	PrivAssetsView          = "assets.view"
	PrivAssetsManage        = "assets.manage"
	PrivContractsManage     = "contracts.manage"
	PrivSolutionsManage     = "solutions.manage"
	PrivCatalogManage       = "catalog.manage"
	PrivReportsView         = "reports.view"
	PrivAnnouncementsManage = "announcements.manage"
	PrivUsersManage         = "users.manage"
	PrivSettingsManage      = "settings.manage"
	PrivProjectsManage      = "projects.manage"
)

// AllPrivileges is the catalog shown when editing roles.
var AllPrivileges = []map[string]string{
	{"key": PrivTicketsManage, "label": "Work on tickets", "group": "Service desk"},
	{"key": PrivTicketsDelete, "label": "Delete and mark tickets as spam", "group": "Service desk"},
	{"key": PrivProblemsView, "label": "View problems", "group": "Problem management"},
	{"key": PrivProblemsManage, "label": "Create and edit problems", "group": "Problem management"},
	{"key": PrivChangesView, "label": "View changes", "group": "Change management"},
	{"key": PrivChangesManage, "label": "Create and edit changes", "group": "Change management"},
	{"key": PrivReleasesView, "label": "View releases", "group": "Release management"},
	{"key": PrivReleasesManage, "label": "Create and edit releases", "group": "Release management"},
	{"key": PrivAssetsView, "label": "View assets", "group": "Asset management"},
	{"key": PrivAssetsManage, "label": "Manage assets and CMDB", "group": "Asset management"},
	{"key": PrivContractsManage, "label": "Manage contracts, vendors, software and purchase orders", "group": "Asset management"},
	{"key": PrivSolutionsManage, "label": "Publish knowledge base articles", "group": "Knowledge"},
	{"key": PrivCatalogManage, "label": "Manage service catalog", "group": "Knowledge"},
	{"key": PrivReportsView, "label": "View analytics and reports", "group": "Analytics"},
	{"key": PrivAnnouncementsManage, "label": "Manage announcements", "group": "Engagement"},
	{"key": PrivUsersManage, "label": "Manage agents, requesters, groups and departments", "group": "Administration"},
	{"key": PrivProjectsManage, "label": "Create projects and manage every project", "group": "Project management"},
	{"key": PrivSettingsManage, "label": "Configure helpdesk settings, SLAs and automations", "group": "Administration"},
}

func allPrivilegeKeys() []string {
	out := make([]string, 0, len(AllPrivileges))
	for _, p := range AllPrivileges {
		out = append(out, p["key"])
	}
	return out
}

func randomKey(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func defaultWeek() map[string][]map[string]string {
	day := []map[string]string{{"start": "09:00", "end": "18:00"}}
	return map[string][]map[string]string{
		"monday": day, "tuesday": day, "wednesday": day, "thursday": day, "friday": day,
	}
}

// DefaultSLATargets returns the out-of-the-box SLA targets in minutes.
func defaultSLATargets() []map[string]interface{} {
	return []map[string]interface{}{
		{"priority": 4, "respond_within_minutes": 15, "resolve_within_minutes": 240, "business_hours": false, "escalation_enabled": true},
		{"priority": 3, "respond_within_minutes": 60, "resolve_within_minutes": 480, "business_hours": true, "escalation_enabled": true},
		{"priority": 2, "respond_within_minutes": 240, "resolve_within_minutes": 1440, "business_hours": true, "escalation_enabled": true},
		{"priority": 1, "respond_within_minutes": 480, "resolve_within_minutes": 2880, "business_hours": true, "escalation_enabled": true},
	}
}

func defaultCategories() []map[string]interface{} {
	sub := func(names ...string) []map[string]interface{} {
		out := []map[string]interface{}{}
		for _, n := range names {
			out = append(out, map[string]interface{}{"value": n})
		}
		return out
	}
	return []map[string]interface{}{
		{"value": "Hardware", "children": sub("Laptop", "Desktop", "Monitor", "Printer", "Peripherals")},
		{"value": "Software", "children": sub("Operating system", "Productivity suite", "Business application", "Installation request")},
		{"value": "Network", "children": sub("VPN", "Wi-Fi", "Internet access", "Firewall")},
		{"value": "Access", "children": sub("Password reset", "Account unlock", "Permissions", "New account")},
		{"value": "Email & Collaboration", "children": sub("Mailbox", "Calendar", "Video conferencing", "Chat")},
		{"value": "Office Facilities", "children": sub("Desk", "Meeting room", "Badge access")},
		{"value": "Other"},
	}
}

// seedOrg installs default helpdesk configuration once per organization.
func (a *App) seedOrg(ctx context.Context, orgID string) error {
	return a.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?))", "itsm-seed-"+orgID).Error; err != nil {
			return err
		}
		var s Settings
		err := tx.Where("org_id = ?", orgID).Take(&s).Error
		if err == nil && s.Seeded {
			return nil
		}
		var orgName string
		tx.Table("organizations").Select("name").Where("id = ?", orgID).Scan(&orgName)
		if orgName == "" {
			orgName = "Service Desk"
		}
		s = Settings{
			OrgID: orgID, HelpdeskName: orgName + " Service Desk", PortalName: orgName + " Support",
			PortalWelcome: "How can we help you today?", TimeZone: "UTC", DateFormat: "MMM d, yyyy", Language: "en",
			PrimaryColor: "#2563eb", AutoCloseResolvedHours: 72, RequesterCanClose: true, RequesterCanReopen: true,
			DeptHeadSeesDeptTickets: true, CSATEnabled: true, CreateRequesterFromEmail: true,
			InboundEmailKey: randomKey(24), PasswordMinLength: 8, PasswordRequireNumber: true,
			SessionTimeoutMinutes: 1440, PrefixIncident: "INC", PrefixServiceRequest: "SR", PrefixProblem: "PRB",
			PrefixChange: "CHN", PrefixRelease: "REL", CustomStatuses: jsonOf([]interface{}{}), Seeded: true,
		}
		if err := tx.Save(&s).Error; err != nil {
			return err
		}
		base := func() Base { return Base{OrgID: orgID} }

		// Roles
		roles := []Role{
			{Base: base(), Name: "Account Admin", Description: "Full access to every module and account configuration.", Privileges: jsonOf(allPrivilegeKeys()), IsDefault: true},
			{Base: base(), Name: "Admin", Description: "Configure the helpdesk and manage people.", Privileges: jsonOf(allPrivilegeKeys()), IsDefault: true},
			{Base: base(), Name: "SD Supervisor", Description: "Lead the service desk, manage problems and knowledge.", IsDefault: true, Privileges: jsonOf([]string{
				PrivTicketsManage, PrivTicketsDelete, PrivProblemsView, PrivProblemsManage, PrivChangesView, PrivReleasesView,
				PrivAssetsView, PrivSolutionsManage, PrivReportsView, PrivAnnouncementsManage, PrivCatalogManage, PrivProjectsManage})},
			{Base: base(), Name: "SD Agent", Description: "Work on tickets and view related records.", IsDefault: true, Privileges: jsonOf([]string{
				PrivTicketsManage, PrivProblemsView, PrivChangesView, PrivReleasesView, PrivAssetsView, PrivReportsView})},
			{Base: base(), Name: "Problem Manager", Description: "Own problem investigations.", IsDefault: true, Privileges: jsonOf([]string{
				PrivTicketsManage, PrivProblemsView, PrivProblemsManage, PrivChangesView, PrivAssetsView, PrivReportsView})},
			{Base: base(), Name: "Change Manager", Description: "Plan changes and releases, run CAB approvals.", IsDefault: true, Privileges: jsonOf([]string{
				PrivTicketsManage, PrivProblemsView, PrivChangesView, PrivChangesManage, PrivReleasesView, PrivReleasesManage, PrivAssetsView, PrivReportsView})},
			{Base: base(), Name: "Asset Manager", Description: "Manage CMDB, contracts, software and procurement.", IsDefault: true, Privileges: jsonOf([]string{
				PrivTicketsManage, PrivAssetsView, PrivAssetsManage, PrivContractsManage, PrivReportsView})},
		}
		if err := tx.Create(&roles).Error; err != nil {
			return err
		}

		bh := BusinessHours{Base: base(), Name: "Default business hours", Description: "Monday to Friday, 9am to 6pm",
			IsDefault: true, TimeZone: "UTC", WorkingHours: jsonOf(defaultWeek()), Holidays: jsonOf([]interface{}{})}
		if err := tx.Create(&bh).Error; err != nil {
			return err
		}
		sla := SLAPolicy{Base: base(), Name: "Default SLA policy", Description: "Applies to every ticket that matches no other policy.",
			IsDefault: true, Active: true, Position: 1000, Conditions: jsonOf(map[string]interface{}{}),
			Targets: jsonOf(defaultSLATargets()),
			Escalations: jsonOf(map[string]interface{}{
				"response":   map[string]interface{}{"enabled": true, "notify": "group_escalation"},
				"resolution": map[string]interface{}{"enabled": true, "notify": "group_escalation"},
			})}
		if err := tx.Create(&sla).Error; err != nil {
			return err
		}

		groups := []AgentGroup{
			{Base: base(), Name: "Service Desk", Description: "First line support", UnassignedForMinutes: 30, BusinessHoursID: &bh.ID},
			{Base: base(), Name: "Network Team", Description: "Network and connectivity", UnassignedForMinutes: 60, BusinessHoursID: &bh.ID},
			{Base: base(), Name: "Hardware Team", Description: "Devices and peripherals", UnassignedForMinutes: 60, BusinessHoursID: &bh.ID},
			{Base: base(), Name: "Change Advisory Board", Description: "Reviews and approves changes", BusinessHoursID: &bh.ID},
		}
		if err := tx.Create(&groups).Error; err != nil {
			return err
		}

		fields := []FormField{
			{Base: base(), Entity: "ticket", Name: "category", Label: "Category", LabelForRequester: "Category", FieldType: "nested",
				Choices: jsonOf(defaultCategories()), DisplayedToRequester: true, EditableByRequester: true, Position: 1, IsDefault: true, Active: true},
			{Base: base(), Name: "impact_on_business", Entity: "ticket", Label: "Business impact", LabelForRequester: "How is this affecting your work?",
				FieldType: "dropdown", Choices: jsonOf([]map[string]string{{"value": "Blocking my work"}, {"value": "Slowing me down"}, {"value": "Minor inconvenience"}}),
				DisplayedToRequester: true, EditableByRequester: true, Position: 2, Active: true},
		}
		if err := tx.Create(&fields).Error; err != nil {
			return err
		}

		if err := seedAssetTypes(tx, orgID); err != nil {
			return err
		}

		catCats := []CatalogCategory{
			{Base: base(), Name: "Hardware", Description: "Laptops, monitors and accessories", Icon: "laptop", Position: 1},
			{Base: base(), Name: "Software", Description: "Applications and licenses", Icon: "app-window", Position: 2},
			{Base: base(), Name: "Access", Description: "Accounts and permissions", Icon: "key-round", Position: 3},
		}
		if err := tx.Create(&catCats).Error; err != nil {
			return err
		}
		items := []CatalogItem{
			{Base: base(), CategoryID: &catCats[0].ID, Name: "New laptop", ShortDescription: "Request a standard business laptop",
				Description: "Standard 14\" business laptop with docking station. Delivered within 3 business days after approval.",
				Cost:        1200, DeliveryHours: 72, Status: "published", Icon: "laptop", QuantityEnabled: true, ApprovalRequired: true, ApproverType: "reporting_manager",
				ApproverIDs: jsonOf([]string{}), DeliveryGroupID: &groups[2].ID, Visibility: "all", DepartmentIDs: jsonOf([]string{}), Position: 1,
				Fields: jsonOf([]map[string]interface{}{
					{"name": "os", "label": "Operating system", "type": "dropdown", "required": true, "choices": []string{"Windows 11", "macOS", "Ubuntu"}},
					{"name": "justification", "label": "Business justification", "type": "paragraph", "required": true},
				})},
			{Base: base(), CategoryID: &catCats[0].ID, Name: "External monitor", ShortDescription: "27\" 4K monitor", Cost: 350, DeliveryHours: 48,
				Status: "published", Icon: "monitor", QuantityEnabled: true, DeliveryGroupID: &groups[2].ID, Visibility: "all", Position: 2,
				ApproverIDs: jsonOf([]string{}), DepartmentIDs: jsonOf([]string{}), Fields: jsonOf([]interface{}{})},
			{Base: base(), CategoryID: &catCats[1].ID, Name: "Software installation", ShortDescription: "Install licensed software on your device",
				DeliveryHours: 24, Status: "published", Icon: "download", Visibility: "all", Position: 1, DeliveryGroupID: &groups[0].ID,
				ApproverIDs: jsonOf([]string{}), DepartmentIDs: jsonOf([]string{}), Fields: jsonOf([]map[string]interface{}{
					{"name": "software_name", "label": "Software name", "type": "text", "required": true},
					{"name": "version", "label": "Version (optional)", "type": "text"},
				})},
			{Base: base(), CategoryID: &catCats[2].ID, Name: "VPN access", ShortDescription: "Remote access to the corporate network",
				DeliveryHours: 8, Status: "published", Icon: "shield-check", Visibility: "all", Position: 1, DeliveryGroupID: &groups[1].ID,
				ApprovalRequired: true, ApproverType: "reporting_manager", ApproverIDs: jsonOf([]string{}), DepartmentIDs: jsonOf([]string{}),
				Fields: jsonOf([]map[string]interface{}{
					{"name": "duration", "label": "Access duration", "type": "dropdown", "required": true, "choices": []string{"1 month", "3 months", "Permanent"}},
				})},
			{Base: base(), CategoryID: &catCats[2].ID, Name: "Shared mailbox access", ShortDescription: "Get access to a team mailbox",
				DeliveryHours: 8, Status: "published", Icon: "mail", Visibility: "all", Position: 2, DeliveryGroupID: &groups[0].ID,
				ApproverIDs: jsonOf([]string{}), DepartmentIDs: jsonOf([]string{}), Fields: jsonOf([]map[string]interface{}{
					{"name": "mailbox", "label": "Mailbox address", "type": "text", "required": true},
				})},
		}
		if err := tx.Create(&items).Error; err != nil {
			return err
		}

		kbCat := KBCategory{Base: base(), Name: "General", Description: "Everyday IT help", Position: 1}
		if err := tx.Create(&kbCat).Error; err != nil {
			return err
		}
		folders := []KBFolder{
			{Base: base(), CategoryID: kbCat.ID, Name: "Getting started", Description: "Onboarding guides", Visibility: "all", DepartmentIDs: jsonOf([]string{}), Position: 1},
			{Base: base(), CategoryID: kbCat.ID, Name: "Troubleshooting", Description: "Fix common issues yourself", Visibility: "all", DepartmentIDs: jsonOf([]string{}), Position: 2},
			{Base: base(), CategoryID: kbCat.ID, Name: "Internal runbooks", Description: "Agent-only procedures", Visibility: "agents", DepartmentIDs: jsonOf([]string{}), Position: 3},
		}
		if err := tx.Create(&folders).Error; err != nil {
			return err
		}
		published := now()
		articles := []KBArticle{
			{Base: base(), FolderID: folders[0].ID, Title: "How to submit a ticket", Status: "published", ArticleType: "permanent", PublishedAt: &published,
				Tags: jsonOf([]string{"portal"}), Body: "## Submitting a ticket\n\n1. Open the **Support portal**.\n2. Choose **Report an issue** for something broken, or **Request a service** for something new.\n3. Describe the problem, attach screenshots and submit.\n\nYou will receive updates by email and can follow the ticket under **My tickets**."},
			{Base: base(), FolderID: folders[1].ID, Title: "Resetting your password", Status: "published", ArticleType: "permanent", PublishedAt: &published,
				Tags: jsonOf([]string{"password", "access"}), Body: "## Forgot your password?\n\nUse **Forgot password** on the sign-in page and answer your security questions.\n\nIf your account is locked after too many attempts, wait 15 minutes or contact the service desk."},
			{Base: base(), FolderID: folders[1].ID, Title: "VPN will not connect", Status: "published", ArticleType: "workaround", PublishedAt: &published,
				Tags: jsonOf([]string{"vpn", "network"}), Body: "## Quick checks\n\n- Confirm you are connected to the internet.\n- Restart the VPN client.\n- Make sure your password has not expired.\n\nStill stuck? Raise a ticket with the error message shown in the client."},
			{Base: base(), FolderID: folders[2].ID, Title: "Major incident runbook", Status: "published", ArticleType: "permanent", PublishedAt: &published,
				Tags: jsonOf([]string{"major-incident"}), Body: "## Major incident procedure\n\n1. Set priority to **Urgent** and tag `major-incident`.\n2. Notify the on-call engineer for the owning group.\n3. Post updates every 30 minutes as a public reply.\n4. After resolution, open a **Problem** to track the root cause."},
		}
		if err := tx.Create(&articles).Error; err != nil {
			return err
		}

		folder := CannedFolder{Base: base(), Name: "General"}
		if err := tx.Create(&folder).Error; err != nil {
			return err
		}
		canned := []CannedResponse{
			{Base: base(), FolderID: &folder.ID, Title: "Acknowledge", Visibility: "all", GroupIDs: jsonOf([]string{}),
				Content: "Hi {{ticket.requester_name}},\n\nThanks for reaching out. We have received your request {{ticket.id}} and an agent is looking into it.\n\nRegards,\n{{agent.name}}"},
			{Base: base(), FolderID: &folder.ID, Title: "Request more information", Visibility: "all", GroupIDs: jsonOf([]string{}),
				Content: "Hi {{ticket.requester_name}},\n\nCould you share a screenshot of the error and the time it occurred? That will help us resolve this faster.\n\nThanks,\n{{agent.name}}"},
			{Base: base(), FolderID: &folder.ID, Title: "Resolved - please confirm", Visibility: "all", GroupIDs: jsonOf([]string{}),
				Content: "Hi {{ticket.requester_name}},\n\nWe believe this issue is now resolved. If anything is still not working, simply reply to reopen the ticket.\n\nRegards,\n{{agent.name}}"},
		}
		if err := tx.Create(&canned).Error; err != nil {
			return err
		}

		scenario := Scenario{Base: base(), Name: "Escalate to network team", Description: "Route to Network Team with high priority",
			Visibility: "all", GroupIDs: jsonOf([]string{}), Actions: jsonOf([]map[string]interface{}{
				{"type": "set_group", "value": groups[1].ID}, {"type": "set_priority", "value": 3}, {"type": "add_tag", "value": "network"},
			})}
		if err := tx.Create(&scenario).Error; err != nil {
			return err
		}

		wf := Workflow{Base: base(), Name: "Route VPN issues to Network Team", Description: "Tickets mentioning VPN go straight to the network team.",
			Module: "ticket", Event: "ticket_created", Active: true, Position: 1,
			Conditions: jsonOf(map[string]interface{}{"match": "any", "rules": []map[string]interface{}{
				{"field": "subject", "operator": "contains", "value": "vpn"},
				{"field": "sub_category", "operator": "is", "value": "VPN"},
			}}),
			Actions: jsonOf([]map[string]interface{}{{"type": "set_group", "value": groups[1].ID}, {"type": "add_tag", "value": "vpn"}})}
		if err := tx.Create(&wf).Error; err != nil {
			return err
		}

		survey := Survey{Base: base(), Title: "Customer satisfaction", Question: "How would you rate the support you received?",
			ScaleType: 5, ThankYouMessage: "Thank you for your feedback!", SendOn: "resolved", Active: true}
		if err := tx.Create(&survey).Error; err != nil {
			return err
		}

		if err := tx.Create(defaultEmailTemplates(orgID)).Error; err != nil {
			return err
		}

		ann := Announcement{Base: base(), Title: "Welcome to the new service desk",
			Body:       "Raise incidents, request services and browse self-help articles from the support portal.",
			Visibility: "everyone", GroupIDs: jsonOf([]string{}), VisibleFrom: now()}
		return tx.Create(&ann).Error
	})
}

func seedAssetTypes(tx *gorm.DB, orgID string) error {
	type node struct {
		name, icon string
		fields     []map[string]string
		children   []node
	}
	hw := []map[string]string{{"name": "hostname", "label": "Hostname", "type": "text"}, {"name": "os", "label": "Operating system", "type": "text"},
		{"name": "cpu", "label": "CPU", "type": "text"}, {"name": "memory_gb", "label": "Memory (GB)", "type": "number"}, {"name": "disk_gb", "label": "Disk (GB)", "type": "number"},
		{"name": "ip_address", "label": "IP address", "type": "text"}, {"name": "mac_address", "label": "MAC address", "type": "text"}}
	net := []map[string]string{{"name": "ip_address", "label": "IP address", "type": "text"}, {"name": "firmware", "label": "Firmware", "type": "text"}, {"name": "ports", "label": "Ports", "type": "number"}}
	tree := []node{
		{name: "Hardware", icon: "cpu", children: []node{
			{name: "Computer", icon: "monitor", fields: hw, children: []node{{name: "Laptop", icon: "laptop"}, {name: "Desktop", icon: "monitor"}, {name: "Server", icon: "server"}}},
			{name: "Mobile Device", icon: "smartphone", fields: []map[string]string{{"name": "imei", "label": "IMEI", "type": "text"}, {"name": "phone_number", "label": "Phone number", "type": "text"}}},
			{name: "Monitor", icon: "monitor"}, {name: "Printer", icon: "printer", fields: net},
		}},
		{name: "Network", icon: "network", fields: net, children: []node{{name: "Router", icon: "router"}, {name: "Switch", icon: "network"}, {name: "Firewall", icon: "shield"}, {name: "Access Point", icon: "wifi"}}},
		{name: "Software", icon: "app-window", fields: []map[string]string{{"name": "version", "label": "Version", "type": "text"}, {"name": "license_key", "label": "License key", "type": "text"}}},
		{name: "Cloud", icon: "cloud", fields: []map[string]string{{"name": "provider", "label": "Provider", "type": "text"}, {"name": "region", "label": "Region", "type": "text"}, {"name": "resource_id", "label": "Resource ID", "type": "text"}},
			children: []node{{name: "Virtual Machine", icon: "server"}, {name: "Database", icon: "database"}, {name: "Storage", icon: "hard-drive"}}},
		{name: "Services", icon: "layers", children: []node{{name: "Business Service", icon: "briefcase"}, {name: "IT Service", icon: "layers"}}},
		{name: "Consumable", icon: "package"},
	}
	var create func(n node, parent *string) error
	create = func(n node, parent *string) error {
		fields := n.fields
		if fields == nil {
			fields = []map[string]string{}
		}
		t := AssetType{Base: Base{OrgID: orgID}, Name: n.name, ParentID: parent, Icon: n.icon, Visible: true, Fields: jsonOf(fields)}
		if err := tx.Create(&t).Error; err != nil {
			return err
		}
		for _, ch := range n.children {
			if err := create(ch, &t.ID); err != nil {
				return err
			}
		}
		return nil
	}
	for _, n := range tree {
		if err := create(n, nil); err != nil {
			return err
		}
	}
	return nil
}

func defaultEmailTemplates(orgID string) []EmailTemplate {
	b := func() Base { return Base{OrgID: orgID} }
	link := "\n\nView it here: {{ticket.url}}"
	return []EmailTemplate{
		{Base: b(), Event: "ticket_created_requester", Recipient: "requester", Name: "New ticket created", Enabled: true,
			Subject: "[{{ticket.id}}] We received your request: {{ticket.subject}}",
			Body:    "Hi {{ticket.requester_name}},\n\nYour request has been logged as {{ticket.id}}. Our team will get back to you shortly." + link},
		{Base: b(), Event: "ticket_assigned_agent", Recipient: "agent", Name: "Ticket assigned to agent", Enabled: true,
			Subject: "[{{ticket.id}}] Assigned to you: {{ticket.subject}}",
			Body:    "Hi {{agent.name}},\n\nTicket {{ticket.id}} ({{ticket.priority}}) has been assigned to you." + link},
		{Base: b(), Event: "ticket_assigned_group", Recipient: "group", Name: "Ticket assigned to group", Enabled: true,
			Subject: "[{{ticket.id}}] New ticket for {{ticket.group}}",
			Body:    "A new ticket {{ticket.id}} has been routed to {{ticket.group}}." + link},
		{Base: b(), Event: "agent_reply_requester", Recipient: "requester", Name: "Agent replied", Enabled: true,
			Subject: "Re: [{{ticket.id}}] {{ticket.subject}}",
			Body:    "{{reply.body}}\n\n— {{agent.name}}" + link},
		{Base: b(), Event: "requester_reply_agent", Recipient: "agent", Name: "Requester replied", Enabled: true,
			Subject: "[{{ticket.id}}] New reply from {{ticket.requester_name}}",
			Body:    "{{ticket.requester_name}} replied:\n\n{{reply.body}}" + link},
		{Base: b(), Event: "ticket_resolved_requester", Recipient: "requester", Name: "Ticket resolved", Enabled: true,
			Subject: "[{{ticket.id}}] Resolved: {{ticket.subject}}",
			Body:    "Hi {{ticket.requester_name}},\n\nYour ticket has been resolved. If the issue persists, reply to reopen it." + link},
		{Base: b(), Event: "approval_requested", Recipient: "approver", Name: "Approval requested", Enabled: true,
			Subject: "Approval needed: {{approval.subject}}",
			Body:    "Hi {{approver.name}},\n\n{{approval.requested_by}} needs your approval for {{approval.subject}}.\n\nReview it here: {{approval.url}}"},
		{Base: b(), Event: "sla_violation", Recipient: "escalation", Name: "SLA violation escalation", Enabled: true,
			Subject: "SLA breached on {{ticket.id}}: {{ticket.subject}}",
			Body:    "The {{sla.kind}} target for {{ticket.id}} was missed (due {{sla.due}})." + link},
		{Base: b(), Event: "contract_expiring", Recipient: "contract_owner", Name: "Contract expiring", Enabled: true,
			Subject: "Contract {{contract.name}} expires on {{contract.end_date}}",
			Body:    "The contract {{contract.name}} with {{contract.vendor}} expires on {{contract.end_date}}. Review renewal options."},
		{Base: b(), Event: "csat_survey", Recipient: "requester", Name: "Satisfaction survey", Enabled: true,
			Subject: "How did we do on {{ticket.id}}?",
			Body:    "Hi {{ticket.requester_name}},\n\nPlease take a moment to rate the support you received:\n{{survey.url}}"},
	}
}

// EnsureSchema migrates every ITSM table and the shared columns it relies on.
func EnsureSchema(db *gorm.DB) error {
	stmts := []string{
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until timestamptz`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean DEFAULT false`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at timestamptz`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS tokens_revoked_at timestamptz`,
		`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS is_suspended boolean NOT NULL DEFAULT false`,
	}
	for _, s := range stmts {
		if err := db.Exec(s).Error; err != nil {
			return err
		}
	}
	if err := db.AutoMigrate(AllModels()...); err != nil {
		return err
	}
	// Ticket numbers and per-entity uniqueness.
	idx := []string{
		`CREATE UNIQUE INDEX IF NOT EXISTS ux_itsm_tickets_number ON itsm_tickets (org_id, number)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS ux_itsm_problems_number ON itsm_problems (org_id, number)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS ux_itsm_changes_number ON itsm_changes (org_id, number)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS ux_itsm_releases_number ON itsm_releases (org_id, number)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS ux_itsm_assets_number ON itsm_assets (org_id, number)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS ux_itsm_projects_key ON itsm_projects (org_id, key)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS ux_itsm_work_items_number ON itsm_work_items (project_id, number)`,
		`CREATE INDEX IF NOT EXISTS ix_itsm_work_items_board ON itsm_work_items (project_id, state, sort_order)`,
		// Organizations seeded before projects existed get the new privilege on
		// their leadership roles.
		`UPDATE itsm_roles SET privileges = privileges || '["projects.manage"]'::jsonb
		   WHERE is_default AND name IN ('Admin', 'SD Supervisor') AND NOT privileges @> '["projects.manage"]'::jsonb`,
		`CREATE INDEX IF NOT EXISTS ix_itsm_tickets_search ON itsm_tickets USING gin (to_tsvector('simple', coalesce(subject,'') || ' ' || coalesce(description,'')))`,
		`CREATE INDEX IF NOT EXISTS ix_itsm_kb_search ON itsm_kb_articles USING gin (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(body,'') || ' ' || coalesce(keywords,'')))`,
		`CREATE INDEX IF NOT EXISTS ix_itsm_tickets_listing ON itsm_tickets (org_id, is_deleted, is_spam, created_at DESC)`,
	}
	for _, s := range idx {
		if err := db.Exec(s).Error; err != nil {
			return err
		}
	}
	return nil
}
