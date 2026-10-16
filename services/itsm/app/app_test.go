package app

import (
	"strings"
	"testing"
	"time"
)

func TestValidatePassword(t *testing.T) {
	strict := &Settings{PasswordMinLength: 10, PasswordRequireUpper: true, PasswordRequireNumber: true, PasswordRequireSpecial: true}
	cases := []struct {
		pw string
		s  *Settings
		ok bool
	}{
		{"short", nil, false},
		{"longenough", nil, true},
		{"Abcdefgh1!", strict, true},
		{"abcdefgh1!", strict, false}, // no upper
		{"Abcdefghi!", strict, false}, // no number
		{"Abcdefghi1", strict, false}, // no special
		{"Ab1!", strict, false},       // too short
		{strings.Repeat("a", 129), nil, false},
	}
	for _, c := range cases {
		if err := validatePassword(c.s, c.pw); (err == nil) != c.ok {
			t.Errorf("validatePassword(%q) err=%v want ok=%v", c.pw, err, c.ok)
		}
	}
}

func TestTempPasswordMeetsStrictPolicy(t *testing.T) {
	strict := &Settings{PasswordMinLength: 12, PasswordRequireUpper: true, PasswordRequireNumber: true, PasswordRequireSpecial: true}
	seen := map[string]bool{}
	for i := 0; i < 50; i++ {
		pw := tempPassword()
		if err := validatePassword(strict, pw); err != nil {
			t.Fatalf("temp password %q fails policy: %v", pw, err)
		}
		if seen[pw] {
			t.Fatalf("duplicate temp password generated")
		}
		seen[pw] = true
	}
}

func TestRenderTemplate(t *testing.T) {
	got := renderTemplate("Hi {{ ticket.requester_name }}, {{ticket.id}} {{unknown.key}}!", map[string]string{"ticket.requester_name": "Rita", "ticket.id": "INC-7"})
	if got != "Hi Rita, INC-7 !" {
		t.Fatalf("got %q", got)
	}
}

func TestCSVSafe(t *testing.T) {
	for _, in := range []string{"=cmd()", "+1", "-2", "@SUM(A1)"} {
		if out := csvSafe(in); !strings.HasPrefix(out, "'") {
			t.Errorf("csvSafe(%q) = %q, want quoted", in, out)
		}
	}
	if csvSafe("Printer jam") != "Printer jam" {
		t.Error("plain text must be unchanged")
	}
}

func TestLikeEscape(t *testing.T) {
	if got := likeEscape(`50%_off\`); got != `%50\%\_off\\%` {
		t.Fatalf("got %q", got)
	}
}

func TestNormalizeTagsAndCleanEmails(t *testing.T) {
	tags := normalizeTags([]string{" VPN", "vpn", "", "Network", strings.Repeat("x", 70)})
	if strings.Join(tags, ",") != "network,vpn" {
		t.Fatalf("tags = %v", tags)
	}
	if _, ok := cleanEmails([]string{"a@b.co", "not-an-email"}); ok {
		t.Fatal("invalid email must be rejected")
	}
	out, ok := cleanEmails([]string{" A@B.co ", ""})
	if !ok || len(out) != 1 || out[0] != "a@b.co" {
		t.Fatalf("cleanEmails = %v %v", out, ok)
	}
}

func TestSLAState(t *testing.T) {
	past := now().Add(-time.Hour)
	soon := now().Add(30 * time.Minute)
	later := now().Add(10 * time.Hour)
	resolvedLate := now()
	cases := []struct {
		t    Ticket
		want string
	}{
		{Ticket{Status: "open"}, "none"},
		{Ticket{Status: "open", DueBy: &past}, "overdue"},
		{Ticket{Status: "open", DueBy: &soon}, "due_soon"},
		{Ticket{Status: "open", DueBy: &later}, "on_track"},
		{Ticket{Status: "pending", DueBy: &past, PendingSince: &past}, "paused"},
		{Ticket{Status: "resolved", DueBy: &past, ResolvedAt: &resolvedLate}, "violated"},
		{Ticket{Status: "closed", DueBy: &later, ResolvedAt: &resolvedLate}, "met"},
	}
	for i, c := range cases {
		if got := slaState(&c.t); got != c.want {
			t.Errorf("case %d: got %s want %s", i, got, c.want)
		}
	}
}

func TestSLAConditionsMatch(t *testing.T) {
	g := "11111111-1111-1111-1111-111111111111"
	tk := &Ticket{Type: "incident", Source: "email", GroupID: &g, Category: "Network"}
	if !(slaConditions{}).matches(tk) {
		t.Fatal("empty conditions match everything")
	}
	if !(slaConditions{TicketTypes: []string{"incident"}, GroupIDs: []string{g}, Categories: []string{"network"}}).matches(tk) {
		t.Fatal("expected match")
	}
	if (slaConditions{Sources: []string{"portal"}}).matches(tk) {
		t.Fatal("source should not match")
	}
}

func TestPolicyTarget(t *testing.T) {
	p := &SLAPolicy{Targets: jsonOf(defaultSLATargets())}
	if tg := policyTarget(p, 4); tg == nil || tg.RespondWithin != 15 || tg.BusinessHours {
		t.Fatalf("urgent target = %+v", tg)
	}
	if policyTarget(p, 9) != nil {
		t.Fatal("unknown priority must have no target")
	}
}

func TestCustomStatuses(t *testing.T) {
	s := &Settings{CustomStatuses: jsonOf([]CustomStatus{{Key: "awaiting_vendor", Label: "Awaiting vendor", PauseSLA: true}, {Key: "in_progress", Label: "In progress"}})}
	if !validTicketStatus(s, "awaiting_vendor") || !validTicketStatus(s, "open") || validTicketStatus(s, "bogus") {
		t.Fatal("status validation")
	}
	if !statusPausesSLA(s, "pending") || !statusPausesSLA(s, "awaiting_vendor") || statusPausesSLA(s, "in_progress") {
		t.Fatal("pause semantics")
	}
}

func TestPOTotal(t *testing.T) {
	po := &PurchaseOrder{TaxPercent: 10, DiscountPercent: 5, ShippingCost: 20}
	total := poTotal(po, []POItem{{Cost: 100, Quantity: 2}, {Cost: 50, Quantity: 1}})
	// subtotal 250, minus 5% = 237.5, plus 10% tax = 261.25, plus 20 shipping
	if total != 281.25 {
		t.Fatalf("total = %v", total)
	}
}

func TestOnCallRotation(t *testing.T) {
	start := time.Date(2026, 10, 5, 9, 0, 0, 0, time.UTC) // Monday 09:00
	s := &OnCallSchedule{MemberIDs: jsonOf([]string{"a", "b", "c"}), RotationType: "weekly", RotationStart: start, HandoffTime: "09:00", TimeZone: "UTC"}
	if who, _ := onCallNow(s, start.Add(time.Hour)); who != "a" {
		t.Fatalf("week 1 = %s", who)
	}
	if who, next := onCallNow(s, start.Add(8*24*time.Hour)); who != "b" || !next.Equal(start.Add(14*24*time.Hour)) {
		t.Fatalf("week 2 = %s next %v", who, next)
	}
	if who, _ := onCallNow(s, start.Add(22*24*time.Hour)); who != "a" {
		t.Fatalf("week 4 wraps to a, got %s", who)
	}
	s.RotationType = "daily"
	if who, _ := onCallNow(s, start.Add(26*time.Hour)); who != "b" {
		t.Fatalf("daily day 2 = %s", who)
	}
}

func TestValidateActions(t *testing.T) {
	if validateActions(nil) == nil {
		t.Fatal("empty actions must fail")
	}
	if validateActions([]Action{{Type: "drop_table"}}) == nil {
		t.Fatal("unknown action must fail")
	}
	if validateActions([]Action{{Type: "send_email", To: "requester"}}) == nil {
		t.Fatal("email without subject/body must fail")
	}
	if err := validateActions([]Action{{Type: "set_priority", Value: 4}, {Type: "add_tag", Value: "vpn"}}); err != nil {
		t.Fatal(err)
	}
}

func TestTicketDisplayID(t *testing.T) {
	s := &Settings{PrefixIncident: "INC", PrefixServiceRequest: "REQ"}
	if got := ticketDisplayID(s, &Ticket{Type: "service_request", Number: 42}); got != "REQ-42" {
		t.Fatalf("got %s", got)
	}
	if got := ticketDisplayID(nil, &Ticket{Type: "incident", Number: 7}); got != "INC-7" {
		t.Fatalf("got %s", got)
	}
}

func TestParseTime(t *testing.T) {
	if v, ok := parseTime(""); !ok || v != nil {
		t.Fatal("empty is valid and nil")
	}
	if _, ok := parseTime("tomorrow"); ok {
		t.Fatal("garbage must be rejected")
	}
	for _, s := range []string{"2026-10-15", "2026-10-15T09:30", "2026-10-15T09:30:00Z"} {
		if v, ok := parseTime(s); !ok || v == nil {
			t.Fatalf("parseTime(%q) failed", s)
		}
	}
}

func TestTicketFieldsIncludesCustomFields(t *testing.T) {
	tk := &Ticket{Type: "incident", Status: "open", Priority: 3, Tags: jsonOf([]string{"vpn"}), CustomFields: jsonOf(map[string]interface{}{"impact_on_business": "Blocking my work"})}
	f := ticketFields(tk, "r@x.co")
	if f["cf.impact_on_business"] != "Blocking my work" || f["requester_email"] != "r@x.co" || f["priority"] != 3 {
		t.Fatalf("fields = %v", f)
	}
}

func TestPrefixQuery(t *testing.T) {
	if got := prefixQuery("VPN keeps disconnecting", "|"); got != "vpn:* | disconnect:*" {
		t.Fatalf("got %q", got)
	}
	if got := prefixQuery("reset my password", "&"); got != "reset:* & password:*" {
		t.Fatalf("got %q", got)
	}
	// Operators and quotes in user input never reach the tsquery syntax.
	if got := prefixQuery(`') | !x & (y:*`, "&"); strings.ContainsAny(got, "'()!") {
		t.Fatalf("unsafe query %q", got)
	}
	if prefixQuery("a !", "|") != "" {
		t.Fatal("no usable terms must produce an empty query")
	}
}

func TestDeriveProjectKey(t *testing.T) {
	cases := map[string]string{
		"Kairvo":              "KAIRV",
		"Service Desk Revamp": "SERVI",
		"HR":                  "HR",
		"2026 roadmap":        "P2026",
		"x":                   "PRJ",
		"  Δ ":                "PRJ",
	}
	for name, want := range cases {
		got := deriveProjectKey(name)
		if got != want {
			t.Errorf("deriveProjectKey(%q) = %q, want %q", name, got, want)
		}
		if !projectKeyRe.MatchString(got) {
			t.Errorf("derived key %q is not a valid key", got)
		}
	}
}

func TestCycleStatus(t *testing.T) {
	day := func(d int) *time.Time { v := time.Date(2026, 10, d, 0, 0, 0, 0, time.UTC); return &v }
	cy := &Cycle{StartDate: day(10), EndDate: day(20)}
	if s := cycleStatus(&Cycle{}, *day(1)); s != "draft" {
		t.Fatalf("undated cycle = %s", s)
	}
	if s := cycleStatus(cy, *day(5)); s != "upcoming" {
		t.Fatalf("before start = %s", s)
	}
	// The end date is inclusive: the whole last day still counts as current.
	if s := cycleStatus(cy, day(20).Add(23*time.Hour)); s != "current" {
		t.Fatalf("last day = %s", s)
	}
	if s := cycleStatus(cy, *day(22)); s != "completed" {
		t.Fatalf("after end = %s", s)
	}
}

func TestWorkItemRef(t *testing.T) {
	for in, want := range map[string]string{"KAIRV-11": "11", "11": "11", "kairv-7": "7"} {
		m := workItemRefRe.FindStringSubmatch(in)
		if m == nil || m[1] != want {
			t.Errorf("%q -> %v", in, m)
		}
	}
	if workItemRefRe.MatchString("login page") || workItemRefRe.MatchString("-11") {
		t.Error("free text must not parse as a work item reference")
	}
	if got := splitParam(" todo, ,done "); len(got) != 2 || got[0] != "todo" || got[1] != "done" {
		t.Errorf("splitParam = %v", got)
	}
}

func TestRefParts(t *testing.T) {
	s := &Settings{PrefixIncident: "INC", PrefixServiceRequest: "SR", PrefixProblem: "PRB", PrefixChange: "CHN", PrefixRelease: "REL"}
	cases := []struct {
		in, prefix, typ string
		n               int64
		ok              bool
	}{
		{"INC-12", "INC", "ticket", 12, true},
		{"#7", "", "", 7, true},
		{"42", "", "", 42, true},
		{"prb-3", "PRB", "problem", 3, true},
		{"CHN-9", "CHN", "change", 9, true},
		{"rel-1", "REL", "release", 1, true},
		{"ASSET-5", "ASSET", "asset", 5, true},
		{"KAIRV-11", "KAIRV", "work_item", 11, true},
		{"vpn down", "", "", 0, false},
		{"INC-0", "INC", "ticket", 0, false},
		{"-5", "", "", 0, false},
	}
	for _, tc := range cases {
		prefix, n, ok := refParts(tc.in)
		if ok != tc.ok || (ok && (prefix != tc.prefix || n != tc.n || refType(s, prefix) != tc.typ)) {
			t.Errorf("refParts(%q) = %q %d %v (type %q)", tc.in, prefix, n, ok, refType(s, prefix))
		}
	}
	if atoiDefault("x", 5) != 5 || atoiDefault(" 9 ", 5) != 9 {
		t.Error("atoiDefault")
	}
}

func TestUnitTree(t *testing.T) {
	id := func(s string) *string { return &s }
	tree := &unitTree{byID: map[string]*Department{}, children: map[string][]string{}}
	add := func(uid, name string, parent *string) {
		tree.byID[uid] = &Department{Base: Base{ID: uid}, Name: name, ParentID: parent}
		if parent != nil {
			tree.children[*parent] = append(tree.children[*parent], uid)
		} else {
			tree.roots = append(tree.roots, uid)
		}
	}
	add("co", "Globex", nil)
	add("fin", "Finance", id("co"))
	add("pay", "Payroll", id("fin"))
	add("it", "IT", id("co"))
	got := tree.descendants("fin")
	if len(got) != 2 || !containsString(got, "fin") || !containsString(got, "pay") {
		t.Fatalf("descendants(fin) = %v", got)
	}
	if len(tree.descendants("co")) != 4 {
		t.Fatalf("descendants(co) = %v", tree.descendants("co"))
	}
	path := tree.path("pay")
	if len(path) != 2 || path[0].Name != "Globex" || path[1].Name != "Finance" {
		t.Fatalf("path(pay) = %v", path)
	}
	// A corrupted cycle must not loop forever.
	tree.byID["co"].ParentID = id("pay")
	tree.children["pay"] = append(tree.children["pay"], "co")
	if n := len(tree.descendants("fin")); n != 4 {
		t.Fatalf("cycle descendants = %d", n)
	}
	_ = tree.path("pay")
}

func TestOutOfOfficeAndPrefs(t *testing.T) {
	at := time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)
	start, end := at.Add(-time.Hour), at.Add(time.Hour)
	p := &Person{OOOStart: &start, OOOEnd: &end}
	if !oooActive(p, at) || oooActive(p, end) || oooActive(&Person{}, at) {
		t.Fatal("oooActive window is wrong")
	}
	off, on := false, true
	prefs := map[string]channelPrefs{"mention": {InApp: &off}, "approval_requested": {Email: &off}, "ticket_assigned": {Email: &on}}
	if notificationAllowed(prefs, "mention") || !notificationAllowed(prefs, "ticket_update") {
		t.Fatal("in-app preference ignored")
	}
	if emailAllowed(prefs, "approval_requested") || !emailAllowed(prefs, "ticket_assigned_group") || !emailAllowed(prefs, "agent_reply_requester") {
		t.Fatal("email preference ignored")
	}
}

func TestTokenRevoked(t *testing.T) {
	cut := time.Date(2026, 10, 15, 12, 0, 0, 700_000_000, time.UTC)
	if !tokenRevoked(cut.Add(-2*time.Second), nil, &cut) {
		t.Fatal("older token must be revoked")
	}
	// iat has second precision: a token from the same second stays valid.
	if tokenRevoked(cut.Truncate(time.Second), &cut, nil) || tokenRevoked(cut.Add(time.Second), &cut) {
		t.Fatal("newer token must stay valid")
	}
}

func TestDefaultClassificationsAreValid(t *testing.T) {
	for _, sp := range classificationSpecs {
		sp := sp
		got, err := normalizeChoices(&sp, sp.Defaults())
		if err != nil {
			t.Fatalf("%s/%s defaults invalid: %v", sp.Entity, sp.Name, err)
		}
		if len(got) == 0 {
			t.Fatalf("%s/%s has no defaults", sp.Entity, sp.Name)
		}
	}
	// Category paths used by existing data, the demo seed and the smoke test stay valid.
	tree := defaultTicketCategories()
	for _, path := range [][2]string{{"Network", "VPN"}, {"Hardware", "Laptop"}, {"Hardware", "Printer"}, {"Hardware", "Monitor"}, {"Access", "Permissions"}, {"Email & Collaboration", "Mailbox"}} {
		l1 := findChoice(tree, path[0])
		if l1 == nil || findChoice(l1.Children, path[1]) == nil {
			t.Fatalf("default ticket categories lost %s > %s", path[0], path[1])
		}
	}
	for _, old := range legacyTicketCategories() {
		cur := findChoice(tree, old.Value)
		if cur == nil {
			t.Fatalf("upgrade would drop category %q", old.Value)
		}
		for _, sub := range old.Children {
			if findChoice(cur.Children, sub.Value) == nil {
				t.Fatalf("upgrade would drop %s > %s", old.Value, sub.Value)
			}
		}
	}
}

func TestNormalizeChoices(t *testing.T) {
	nested := findSpec("ticket", "category")
	if _, err := normalizeChoices(nested, []choice{node("A", node("B", node("C", leaves("D")...)))}); err == nil {
		t.Fatal("four levels must be rejected")
	}
	if _, err := normalizeChoices(nested, []choice{{Value: "Dup"}, {Value: "dup"}}); err == nil {
		t.Fatal("duplicate siblings must be rejected")
	}
	if _, err := normalizeChoices(nested, []choice{{Value: "  "}}); err == nil {
		t.Fatal("empty names must be rejected")
	}
	got, err := normalizeChoices(nested, []choice{node("  Hardware  ", leaves("Laptop", "laptop bag")...)})
	if err != nil || got[0].Value != "Hardware" || len(got[0].Children) != 2 {
		t.Fatalf("names are trimmed and children kept: %+v %v", got, err)
	}
	flat := findSpec("problem", "business_impact")
	got, _ = normalizeChoices(flat, []choice{node("High", leaves("x")...)})
	if len(got[0].Children) != 0 {
		t.Fatal("flat lists drop children")
	}
	types := findSpec("change", "change_type")
	yes := true
	got, err = normalizeChoices(types, []choice{{Label: "Cloud Migration", RequiresApproval: &yes}, {Value: "major", Label: "Big", RequiresApproval: boolPtr(false)}})
	if err != nil {
		t.Fatal(err)
	}
	custom := findChoice(got, "cloud_migration")
	if custom == nil || !*custom.RequiresApproval || custom.System {
		t.Fatalf("custom change type slugged from its label: %+v", got)
	}
	major := findChoice(got, "major")
	if major == nil || major.Label != "Big" || !*major.RequiresApproval || !major.System {
		t.Fatalf("built-in types keep their approval rule but can be relabelled: %+v", major)
	}
	for _, v := range []string{"minor", "standard", "emergency"} {
		if findChoice(got, v) == nil {
			t.Fatalf("built-in change type %s must be restored", v)
		}
	}
}

func TestDefaultJobRolesFormAHierarchy(t *testing.T) {
	levels := map[string]int{}
	for _, r := range defaultJobRoles() {
		if _, dup := levels[r.name]; dup {
			t.Fatalf("duplicate job role %q", r.name)
		}
		if r.parent != "" {
			pl, ok := levels[r.parent]
			if !ok {
				t.Fatalf("%q reports to %q, which is not defined before it", r.name, r.parent)
			}
			if pl >= r.level {
				t.Fatalf("%q (level %d) must sit below %q (level %d)", r.name, r.level, r.parent, pl)
			}
		}
		levels[r.name] = r.level
	}
	if levels["Senior Vice President"] >= levels["Vice President"] {
		t.Fatal("SVP must rank above VP")
	}
	names := map[string]bool{}
	for _, r := range moreDefaultRoles() {
		if names[r.Name] || r.Name == "" || !r.IsDefault {
			t.Fatalf("bad default role %+v", r)
		}
		names[r.Name] = true
	}
}

func TestNotificationEmails(t *testing.T) {
	if notificationPath(map[string]string{"ticket_id": "t1"}, true) != "/tickets/t1" || notificationPath(map[string]string{"ticket_id": "t1"}, false) != "/portal/tickets/t1" {
		t.Fatal("ticket links depend on agent or requester")
	}
	if got := notificationPath(map[string]string{"work_item_id": "w", "project_id": "p"}, true); got != "/projects/p?item=w" {
		t.Fatalf("work item link: %s", got)
	}
	if notificationPath(nil, false) != "/portal" {
		t.Fatal("fallback for requesters is the portal")
	}
	for _, k := range []string{"ticket_assigned", "ticket_reply", "approval_requested", "sla_violation"} {
		if !templateCovered[k] {
			t.Fatalf("%s already has a template email and must not be sent twice", k)
		}
	}
	for _, k := range []string{"work_item_assigned", "work_item_update", "work_item_comment", "mention", "ticket_status", "problem_assigned"} {
		if templateCovered[k] {
			t.Fatalf("%s needs the generic notification email", k)
		}
	}
	off := false
	if emailWanted(map[string]channelPrefs{"mention": {Email: &off}}, "mention") || !emailWanted(nil, "mention") {
		t.Fatal("email preference is respected and defaults to on")
	}
}

func TestWorkItemChangeSummaryAndRelations(t *testing.T) {
	due := time.Date(2026, 10, 17, 0, 0, 0, 0, time.UTC)
	before := &WorkItem{State: "todo", Priority: "medium", Title: "A"}
	after := &WorkItem{State: "in_progress", Priority: "high", Title: "B", DueDate: &due}
	got := describeWorkItemChanges(before, after)
	for _, want := range []string{"state → In Progress", "priority → High", "due Oct 17, 2026", "renamed"} {
		if !strings.Contains(got, want) {
			t.Fatalf("summary %q missing %q", got, want)
		}
	}
	if describeWorkItemChanges(before, before) != "" {
		t.Fatal("no changes, no notification")
	}
	for k, v := range relationInverse {
		if relationInverse[v] != k {
			t.Fatalf("relation %s/%s is not symmetric", k, v)
		}
	}
}

func TestTemplateLayout(t *testing.T) {
	vars := map[string]string{"ticket.id": "INC-7", "ticket.subject": "VPN down", "ticket.status": "Open", "ticket.priority": "High", "ticket.group": ""}
	l := templateLayout("ticket_created_requester", "[INC-7] We received your request",
		"Hi Ann,\n\nYour request has been logged as INC-7.\n\nView it here: https://desk.example.com/portal/tickets/1", vars)
	if l.Greeting != "Hi Ann," || l.Title != "We received your request" {
		t.Fatalf("greeting/title: %+v", l)
	}
	if l.Button == nil || l.Button.URL != "https://desk.example.com/portal/tickets/1" || l.Button.Label != "View your request" {
		t.Fatalf("link line becomes the button: %+v", l.Button)
	}
	if len(l.Paragraphs) != 1 || strings.Contains(l.Paragraphs[0], "View it here") {
		t.Fatalf("link paragraph removed from text: %+v", l.Paragraphs)
	}
	got := map[string]string{}
	for _, d := range l.Details {
		got[d.Label] = d.Value
	}
	if got["Ticket"] != "INC-7" || got["Priority"] != "High" {
		t.Fatalf("ticket details: %+v", l.Details)
	}
	if _, ok := got["Group"]; ok {
		t.Fatal("empty details are skipped")
	}
	c := templateLayout("contract_expiring", "Contract X expires", "Contract X ends soon.", map[string]string{})
	if c.Title != "A contract expires soon" || len(c.Details) != 0 {
		t.Fatalf("non-ticket events have no ticket table: %+v", c)
	}
}
