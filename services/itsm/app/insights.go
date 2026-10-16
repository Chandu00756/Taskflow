package app

import (
	"fmt"
	"net/http"
	"net/mail"
	"regexp"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
)

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

func (c *Ctx) rangeParams() (time.Time, time.Time) {
	to := now()
	from := to.AddDate(0, 0, -30)
	switch c.Query("range") {
	case "7d":
		from = to.AddDate(0, 0, -7)
	case "90d":
		from = to.AddDate(0, 0, -90)
	case "365d":
		from = to.AddDate(-1, 0, 0)
	}
	if f, ok := parseTime(c.Query("from")); ok && f != nil {
		from = *f
	}
	if t, ok := parseTime(c.Query("to")); ok && t != nil {
		to = t.Add(24*time.Hour - time.Second)
	}
	return from, to
}

type kv struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Value int64  `json:"value"`
}

func (a *App) dashboard(c *Ctx) error {
	from, to := c.rangeParams()
	base := func() *gorm.DB {
		return c.visibleTickets(c.T(&Ticket{})).Where("NOT is_deleted AND NOT is_spam")
	}
	active := []string{"resolved", "closed"}
	counters := map[string]int64{}
	count := func(key string, q *gorm.DB) {
		var n int64
		q.Count(&n)
		counters[key] = n
	}
	count("unresolved", base().Where("status NOT IN ?", active))
	count("unassigned", base().Where("status NOT IN ? AND responder_id IS NULL", active))
	count("overdue", base().Where("status NOT IN ? AND due_by < ? AND pending_since IS NULL", active, now()))
	count("due_today", base().Where("status NOT IN ? AND due_by BETWEEN ? AND ?", active, now(), now().Truncate(24*time.Hour).Add(24*time.Hour)))
	count("open", base().Where("status = 'open'"))
	count("pending", base().Where("status = 'pending'"))
	count("my_open", base().Where("status NOT IN ? AND responder_id = ?", active, c.P.UserID))
	count("my_overdue", base().Where("status NOT IN ? AND responder_id = ? AND due_by < ?", active, c.P.UserID, now()))
	count("created", base().Where("created_at BETWEEN ? AND ?", from, to))
	count("resolved", base().Where("resolved_at BETWEEN ? AND ?", from, to))

	// Daily trend of created vs resolved.
	type point struct {
		Day      string `json:"day"`
		Created  int64  `json:"created"`
		Resolved int64  `json:"resolved"`
	}
	var created, resolved []struct {
		Day string
		N   int64
	}
	base().Select("to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*) AS n").Where("created_at BETWEEN ? AND ?", from, to).Group("day").Scan(&created)
	base().Select("to_char(date_trunc('day', resolved_at), 'YYYY-MM-DD') AS day, count(*) AS n").Where("resolved_at BETWEEN ? AND ?", from, to).Group("day").Scan(&resolved)
	cm, rm := map[string]int64{}, map[string]int64{}
	for _, x := range created {
		cm[x.Day] = x.N
	}
	for _, x := range resolved {
		rm[x.Day] = x.N
	}
	trend := []point{}
	for d := from.Truncate(24 * time.Hour); !d.After(to); d = d.AddDate(0, 0, 1) {
		k := d.Format("2006-01-02")
		trend = append(trend, point{Day: k, Created: cm[k], Resolved: rm[k]})
	}

	group := func(col string, q *gorm.DB, label func(string) string) []kv {
		var rows []struct {
			K string
			N int64
		}
		q.Select(fmt.Sprintf("COALESCE(%s::text, '') AS k, count(*) AS n", col)).Group("k").Order("n DESC").Scan(&rows)
		out := []kv{}
		for _, r := range rows {
			out = append(out, kv{Key: r.K, Label: label(r.K), Value: r.N})
		}
		return out
	}
	unresolved := func() *gorm.DB { return base().Where("status NOT IN ?", active) }
	inRange := func() *gorm.DB { return base().Where("created_at BETWEEN ? AND ?", from, to) }
	byPriority := group("priority", unresolved(), func(k string) string { n, _ := strconv.Atoi(k); return priorityName(n) })
	byStatus := group("status", inRange(), titleCase)
	bySource := group("source", inRange(), titleCase)
	byType := group("type", inRange(), titleCase)
	byCategory := group("category", inRange(), func(k string) string {
		if k == "" {
			return "Uncategorized"
		}
		return k
	})

	var groups []AgentGroup
	c.T(&AgentGroup{}).Find(&groups)
	gnames := map[string]string{}
	for _, g := range groups {
		gnames[g.ID] = g.Name
	}
	byGroup := group("group_id", unresolved(), func(k string) string {
		if k == "" {
			return "Unassigned"
		}
		return gnames[k]
	})

	// SLA compliance & timings within the range.
	var sla struct {
		FrTotal  int64
		FrMet    int64
		ResTotal int64
		ResMet   int64
		AvgFrMin float64
		AvgResHr float64
	}
	base().Where("created_at BETWEEN ? AND ? AND fr_due_by IS NOT NULL AND (first_responded_at IS NOT NULL OR fr_due_by < ?)", from, to, now()).Count(&sla.FrTotal)
	base().Where("created_at BETWEEN ? AND ? AND first_responded_at IS NOT NULL AND first_responded_at <= fr_due_by", from, to).Count(&sla.FrMet)
	base().Where("resolved_at BETWEEN ? AND ? AND due_by IS NOT NULL", from, to).Count(&sla.ResTotal)
	base().Where("resolved_at BETWEEN ? AND ? AND due_by IS NOT NULL AND resolved_at <= due_by", from, to).Count(&sla.ResMet)
	base().Select("COALESCE(AVG(EXTRACT(EPOCH FROM first_responded_at - created_at))/60, 0)").Where("first_responded_at BETWEEN ? AND ?", from, to).Scan(&sla.AvgFrMin)
	base().Select("COALESCE(AVG(EXTRACT(EPOCH FROM resolved_at - created_at))/3600, 0)").Where("resolved_at BETWEEN ? AND ?", from, to).Scan(&sla.AvgResHr)
	pct := func(met, total int64) *float64 {
		if total == 0 {
			return nil
		}
		v := float64(met) * 100 / float64(total)
		return &v
	}

	var csat struct {
		Responses int64
		Avg       float64
		Positive  int64
	}
	csq := func() *gorm.DB { return c.T(&SurveyResponse{}).Where("created_at BETWEEN ? AND ?", from, to) }
	csq().Count(&csat.Responses)
	csq().Select("COALESCE(AVG(rating), 0)").Scan(&csat.Avg)
	csq().Where("rating >= 4").Count(&csat.Positive)

	// Agent leaderboard.
	var agents []struct {
		ID       string
		Resolved int64
		AvgHours float64
	}
	base().Select("responder_id AS id, count(*) AS resolved, COALESCE(AVG(EXTRACT(EPOCH FROM resolved_at - created_at))/3600, 0) AS avg_hours").
		Where("responder_id IS NOT NULL AND resolved_at BETWEEN ? AND ?", from, to).Group("responder_id").Order("resolved DESC").Limit(10).Scan(&agents)
	ids := []string{}
	for _, ag := range agents {
		ids = append(ids, ag.ID)
	}
	l := c.lookup(ids, nil, nil)
	leaderboard := []map[string]interface{}{}
	for _, ag := range agents {
		var rating float64
		c.T(&SurveyResponse{}).Select("COALESCE(AVG(rating),0)").Where("agent_id = ? AND created_at BETWEEN ? AND ?", ag.ID, from, to).Scan(&rating)
		leaderboard = append(leaderboard, map[string]interface{}{"agent": l.userS(ag.ID), "resolved": ag.Resolved, "avg_resolution_hours": ag.AvgHours, "csat": rating})
	}

	out := map[string]interface{}{
		"range": map[string]time.Time{"from": from, "to": to}, "counters": counters, "trend": trend,
		"by_priority": byPriority, "by_status": byStatus, "by_source": bySource, "by_type": byType, "by_group": byGroup, "by_category": byCategory,
		"sla": map[string]interface{}{"first_response_pct": pct(sla.FrMet, sla.FrTotal), "resolution_pct": pct(sla.ResMet, sla.ResTotal),
			"avg_first_response_minutes": sla.AvgFrMin, "avg_resolution_hours": sla.AvgResHr},
		"csat":        map[string]interface{}{"responses": csat.Responses, "average": csat.Avg, "positive_pct": pct(csat.Positive, csat.Responses)},
		"leaderboard": leaderboard,
	}

	var pendingApprovals int64
	c.T(&Approval{}).Where("approver_id = ? AND status = 'requested'", c.P.UserID).Count(&pendingApprovals)
	out["pending_approvals"] = pendingApprovals
	if c.P.Can(PrivProblemsView) {
		var openProblems, knownErrors int64
		c.T(&Problem{}).Where("NOT is_deleted AND status <> 'closed'").Count(&openProblems)
		c.T(&Problem{}).Where("NOT is_deleted AND known_error AND status <> 'closed'").Count(&knownErrors)
		out["problems"] = map[string]int64{"open": openProblems, "known_errors": knownErrors}
	}
	if c.P.Can(PrivChangesView) {
		var upcoming []Change
		c.T(&Change{}).Where("NOT is_deleted AND status <> 'closed' AND planned_start BETWEEN ? AND ?", now(), now().AddDate(0, 0, 14)).Order("planned_start").Limit(8).Find(&upcoming)
		out["upcoming_changes"] = c.changeDTOs(upcoming)
	}
	if c.P.Can(PrivAssetsView) {
		out["assets_by_state"] = group("state", c.T(&Asset{}).Where("NOT is_deleted"), titleCase)
		var expiring int64
		c.T(&Contract{}).Where("status = 'active' AND end_date BETWEEN ? AND ?", now(), now().AddDate(0, 0, 30)).Count(&expiring)
		out["contracts_expiring"] = expiring
	}
	return c.JSON(http.StatusOK, out)
}

// report returns tabular data for the reports module.
func (a *App) report(c *Ctx) error {
	from, to := c.rangeParams()
	base := func() *gorm.DB {
		return c.visibleTickets(c.T(&Ticket{})).Where("NOT is_deleted AND NOT is_spam")
	}
	bucket := "day"
	if oneOf(c.Query("interval"), "week", "month") {
		bucket = c.Query("interval")
	}
	switch c.Param("kind") {
	case "ticket-volume":
		rows := []struct {
			Period   string `json:"period"`
			Created  int64  `json:"created"`
			Resolved int64  `json:"resolved"`
			Incident int64  `json:"incidents"`
			Request  int64  `json:"service_requests"`
		}{}
		base().Select(fmt.Sprintf(`to_char(date_trunc('%s', created_at), 'YYYY-MM-DD') AS period, count(*) AS created,
			count(*) FILTER (WHERE resolved_at IS NOT NULL) AS resolved,
			count(*) FILTER (WHERE type = 'incident') AS incident, count(*) FILTER (WHERE type = 'service_request') AS request`, bucket)).
			Where("created_at BETWEEN ? AND ?", from, to).Group("period").Order("period").Scan(&rows)
		return c.JSON(http.StatusOK, map[string]interface{}{"rows": rows})
	case "agent-performance":
		rows := []struct {
			ID         string
			Assigned   int64
			Resolved   int64
			Reopened   int64
			FrMet      int64
			FrTotal    int64
			AvgResHour float64
			AvgFrMin   float64
		}{}
		base().Select(`responder_id AS id, count(*) AS assigned,
			count(*) FILTER (WHERE resolved_at IS NOT NULL) AS resolved,
			count(*) FILTER (WHERE fr_due_by IS NOT NULL AND first_responded_at IS NOT NULL AND first_responded_at <= fr_due_by) AS fr_met,
			count(*) FILTER (WHERE fr_due_by IS NOT NULL AND first_responded_at IS NOT NULL) AS fr_total,
			COALESCE(AVG(EXTRACT(EPOCH FROM resolved_at - created_at))/3600, 0) AS avg_res_hour,
			COALESCE(AVG(EXTRACT(EPOCH FROM first_responded_at - created_at))/60, 0) AS avg_fr_min`).
			Where("responder_id IS NOT NULL AND created_at BETWEEN ? AND ?", from, to).Group("responder_id").Order("resolved DESC").Scan(&rows)
		ids := []string{}
		for _, r := range rows {
			ids = append(ids, r.ID)
		}
		l := c.lookup(ids, nil, nil)
		out := []map[string]interface{}{}
		for _, r := range rows {
			var minutes int64
			c.T(&TimeEntry{}).Select("COALESCE(SUM(minutes),0)").Where("agent_id = ? AND executed_at BETWEEN ? AND ?", r.ID, from, to).Scan(&minutes)
			var csat float64
			c.T(&SurveyResponse{}).Select("COALESCE(AVG(rating),0)").Where("agent_id = ? AND created_at BETWEEN ? AND ?", r.ID, from, to).Scan(&csat)
			var frPct *float64
			if r.FrTotal > 0 {
				v := float64(r.FrMet) * 100 / float64(r.FrTotal)
				frPct = &v
			}
			out = append(out, map[string]interface{}{"agent": l.userS(r.ID), "assigned": r.Assigned, "resolved": r.Resolved,
				"first_response_sla_pct": frPct, "avg_resolution_hours": r.AvgResHour, "avg_first_response_minutes": r.AvgFrMin,
				"time_logged_minutes": minutes, "csat": csat})
		}
		return c.JSON(http.StatusOK, map[string]interface{}{"rows": out})
	case "group-performance":
		rows := []struct {
			ID        string
			Created   int64
			Resolved  int64
			Violated  int64
			AvgResHrs float64
		}{}
		base().Select(`group_id AS id, count(*) AS created, count(*) FILTER (WHERE resolved_at IS NOT NULL) AS resolved,
			count(*) FILTER (WHERE due_by IS NOT NULL AND COALESCE(resolved_at, now()) > due_by) AS violated,
			COALESCE(AVG(EXTRACT(EPOCH FROM resolved_at - created_at))/3600, 0) AS avg_res_hrs`).
			Where("group_id IS NOT NULL AND created_at BETWEEN ? AND ?", from, to).Group("group_id").Scan(&rows)
		ids := []string{}
		for _, r := range rows {
			ids = append(ids, r.ID)
		}
		l := c.lookup(nil, ids, nil)
		out := []map[string]interface{}{}
		for _, r := range rows {
			id := r.ID
			out = append(out, map[string]interface{}{"group": l.group(&id), "created": r.Created, "resolved": r.Resolved, "sla_violations": r.Violated, "avg_resolution_hours": r.AvgResHrs})
		}
		return c.JSON(http.StatusOK, map[string]interface{}{"rows": out})
	case "sla":
		rows := []struct {
			Priority int   `json:"priority"`
			Total    int64 `json:"total"`
			FrMet    int64 `json:"first_response_met"`
			FrMissed int64 `json:"first_response_missed"`
			ResMet   int64 `json:"resolution_met"`
			ResMiss  int64 `json:"resolution_missed"`
		}{}
		base().Select(`priority, count(*) AS total,
			count(*) FILTER (WHERE fr_due_by IS NOT NULL AND first_responded_at <= fr_due_by) AS fr_met,
			count(*) FILTER (WHERE fr_due_by IS NOT NULL AND COALESCE(first_responded_at, now()) > fr_due_by) AS fr_missed,
			count(*) FILTER (WHERE due_by IS NOT NULL AND resolved_at <= due_by) AS res_met,
			count(*) FILTER (WHERE due_by IS NOT NULL AND COALESCE(resolved_at, now()) > due_by) AS res_miss`).
			Where("created_at BETWEEN ? AND ?", from, to).Group("priority").Order("priority DESC").Scan(&rows)
		return c.JSON(http.StatusOK, map[string]interface{}{"rows": rows})
	case "csat":
		rows := []struct {
			Period  string  `json:"period"`
			Count   int64   `json:"responses"`
			Average float64 `json:"average"`
		}{}
		c.T(&SurveyResponse{}).Select(fmt.Sprintf("to_char(date_trunc('%s', created_at), 'YYYY-MM-DD') AS period, count(*) AS count, AVG(rating) AS average", bucket)).
			Where("created_at BETWEEN ? AND ?", from, to).Group("period").Order("period").Scan(&rows)
		dist := []struct {
			Rating int   `json:"rating"`
			N      int64 `json:"count"`
		}{}
		c.T(&SurveyResponse{}).Select("rating, count(*) AS n").Where("created_at BETWEEN ? AND ?", from, to).Group("rating").Order("rating").Scan(&dist)
		return c.JSON(http.StatusOK, map[string]interface{}{"rows": rows, "distribution": dist})
	case "assets":
		if !c.P.Can(PrivAssetsView) {
			return errForbidden("")
		}
		rows := []struct {
			Type  string  `json:"type"`
			State string  `json:"state"`
			N     int64   `json:"count"`
			Cost  float64 `json:"total_cost"`
		}{}
		c.DB().Table("itsm_assets a").Select("t.name AS type, a.state, count(*) AS n, COALESCE(SUM(a.cost),0) AS cost").
			Joins("JOIN itsm_asset_types t ON t.id = a.asset_type_id").Where("a.org_id = ? AND NOT a.is_deleted", c.P.OrgID).
			Group("t.name, a.state").Order("t.name").Scan(&rows)
		return c.JSON(http.StatusOK, map[string]interface{}{"rows": rows})
	}
	return errNotFound("report")
}

// ---------------------------------------------------------------------------
// Global search
// ---------------------------------------------------------------------------

func (a *App) search(c *Ctx) error {
	q := strings.TrimSpace(c.Query("q"))
	if len(q) < 2 {
		if _, isRef := refNumber(q); !isRef || q == "" {
			return c.JSON(http.StatusOK, map[string]interface{}{"results": []interface{}{}})
		}
	}
	pattern := likeEscape(q)
	// The header dropdown shows a few results per type; the results page asks for more.
	limit := clampInt(atoiDefault(c.Query("limit"), 5), 1, 25, 5)
	prefix, num, isRef := refParts(q)
	only := refType(c.settings(), prefix)
	// numFor reports whether a typed reference should match records of type t by number.
	numFor := func(t string) bool { return isRef && (only == "" || only == t) }
	s := c.settings()
	results := []map[string]interface{}{}
	add := func(typ, id, display, title, subtitle, url string) {
		results = append(results, map[string]interface{}{"type": typ, "id": id, "display_id": display, "title": title, "subtitle": subtitle, "url": url})
	}
	var tickets []Ticket
	tq := c.ticketTextSearch(c.visibleTickets(c.T(&Ticket{})).Where("NOT is_deleted"), q)
	// An exact ID match ranks above text matches.
	tq.Order(gorm.Expr("CASE WHEN itsm_tickets.number = ? THEN 0 ELSE 1 END, itsm_tickets.updated_at DESC", num)).Limit(limit + 3).Find(&tickets)
	ticketURL := "/tickets/"
	if !c.P.IsAgent {
		ticketURL = "/portal/tickets/"
	}
	for i := range tickets {
		t := &tickets[i]
		add("ticket", t.ID, ticketDisplayID(s, t), t.Subject, titleCase(t.Status), ticketURL+t.ID)
	}
	folders := c.visibleFolderIDs()
	var arts []KBArticle
	aq := c.T(&KBArticle{}).Where("folder_id IN ? AND (title ILIKE ? OR keywords ILIKE ?)", append(folders, "00000000-0000-0000-0000-000000000000"), pattern, pattern)
	if !c.P.IsAgent {
		aq = aq.Where("status = 'published'")
	}
	aq.Limit(limit).Find(&arts)
	for _, ar := range arts {
		url := "/solutions/" + ar.ID
		if !c.P.IsAgent {
			url = "/portal/solutions/" + ar.ID
		}
		add("article", ar.ID, "KB", ar.Title, titleCase(ar.Status), url)
	}
	if !c.P.IsAgent {
		var items []CatalogItem
		c.T(&CatalogItem{}).Where("status = 'published' AND (name ILIKE ? OR short_description ILIKE ?)", pattern, pattern).Limit(limit).Find(&items)
		for _, it := range items {
			add("catalog", it.ID, "SVC", it.Name, it.ShortDescription, "/portal/catalog/"+it.ID)
		}
		return c.JSON(http.StatusOK, map[string]interface{}{"results": results})
	}
	if c.P.Can(PrivProblemsView) {
		var ps []Problem
		c.T(&Problem{}).Where("NOT is_deleted AND (subject ILIKE ? OR (? AND number = ?))", pattern, numFor("problem"), num).Limit(limit).Find(&ps)
		for _, p := range ps {
			add("problem", p.ID, displayID(s.PrefixProblem, p.Number), p.Subject, titleCase(p.Status), "/problems/"+p.ID)
		}
	}
	if c.P.Can(PrivChangesView) {
		var cs []Change
		c.T(&Change{}).Where("NOT is_deleted AND (subject ILIKE ? OR (? AND number = ?))", pattern, numFor("change"), num).Limit(limit).Find(&cs)
		for _, ch := range cs {
			add("change", ch.ID, displayID(s.PrefixChange, ch.Number), ch.Subject, titleCase(ch.Status), "/changes/"+ch.ID)
		}
	}
	if c.P.Can(PrivReleasesView) {
		var rs []Release
		c.T(&Release{}).Where("NOT is_deleted AND (subject ILIKE ? OR (? AND number = ?))", pattern, numFor("release"), num).Limit(limit).Find(&rs)
		for _, r := range rs {
			add("release", r.ID, displayID(s.PrefixRelease, r.Number), r.Subject, titleCase(r.Status), "/releases/"+r.ID)
		}
	}
	{
		var ws []WorkItem
		wq := c.T(&WorkItem{}).Where("title ILIKE ?", pattern)
		if m := workItemRefRe.FindStringSubmatch(strings.TrimSpace(q)); m != nil && strings.Contains(q, "-") {
			n, _ := strconv.ParseInt(m[1], 10, 64)
			key := strings.ToUpper(strings.SplitN(strings.TrimSpace(q), "-", 2)[0])
			wq = c.T(&WorkItem{}).Where("(title ILIKE ? OR (number = ? AND project_id IN (?)))", pattern, n,
				c.T(&Project{}).Select("id").Where("key = ?", key))
		}
		wq.Order("updated_at DESC").Limit(10).Find(&ws)
		shown := 0
		for _, d := range c.workItemDTOs(ws) {
			var p Project
			if shown >= limit || d.Project == nil || c.T(&Project{}).Where("id = ?", d.ProjectID).Take(&p).Error != nil || !c.projectPerms(&p).view {
				continue
			}
			shown++
			add("work_item", d.ID, d.DisplayID, d.Title, d.Project.Name+" · "+workItemLabels[d.State], "/projects/"+d.ProjectID+"?item="+d.ID)
		}
	}
	if c.P.Can(PrivAssetsView) {
		var as []Asset
		c.T(&Asset{}).Where("NOT is_deleted AND (name ILIKE ? OR asset_tag ILIKE ? OR serial_number ILIKE ? OR (? AND number = ?))", pattern, pattern, pattern, numFor("asset"), num).Limit(limit).Find(&as)
		for _, x := range as {
			add("asset", x.ID, "ASSET-"+strconv.FormatInt(x.Number, 10), x.Name, titleCase(x.State), "/assets/"+x.ID)
		}
	}
	var people []personRow
	c.DB().Table("users u").Select("u.id, u.email, u.full_name, u.username").
		Joins("LEFT JOIN itsm_people p ON p.user_id = u.id").
		Where("u.org_id = ? AND (u.full_name ILIKE ? OR u.email ILIKE ? OR p.job_title ILIKE ?)", c.P.OrgID, pattern, pattern, pattern).Limit(limit).Scan(&people)
	for _, p := range people {
		name := p.FullName
		if name == "" {
			name = p.Username
		}
		add("person", p.ID, "", name, p.Email, "/people/"+p.ID)
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"results": results})
}

// ---------------------------------------------------------------------------
// Inbound email
// ---------------------------------------------------------------------------

var ticketRefRe = regexp.MustCompile(`\[#?([A-Z]{2,5})-(\d+)\]`)

// inboundEmail converts a parsed email (from an email provider webhook)
// into a new ticket or a reply on an existing one.
func (a *App) inboundEmail(c *Ctx) error {
	key := c.Query("key")
	if len(key) < 16 {
		return &APIError{Status: http.StatusUnauthorized, Message: "invalid key"}
	}
	var s Settings
	if err := c.DB().Where("inbound_email_key = ?", key).Take(&s).Error; err != nil {
		return &APIError{Status: http.StatusUnauthorized, Message: "invalid key"}
	}
	var in struct {
		From    string   `json:"from"`
		Subject string   `json:"subject"`
		Text    string   `json:"text"`
		CC      []string `json:"cc"`
	}
	if err := c.Bind(&in); err != nil {
		return err
	}
	addr, err := mail.ParseAddress(in.From)
	if err != nil {
		return errValidation(map[string]string{"from": "is invalid"})
	}
	email := strings.ToLower(addr.Address)
	var userID string
	var row struct {
		ID    string
		OrgID *string
	}
	if c.DB().Table("users").Select("id, org_id").Where("LOWER(email) = ?", email).Take(&row).Error == nil {
		if row.OrgID == nil || *row.OrgID != s.OrgID {
			return errForbidden("sender belongs to another organization")
		}
		userID = row.ID
	} else {
		if !s.CreateRequesterFromEmail {
			return errForbidden("unknown sender")
		}
		id, _, err := a.createUser(c.DB(), s.OrgID, email, addr.Name, "member", false)
		if err != nil {
			return err
		}
		userID = id
	}
	// Run the rest of the request as the sender.
	p, err := a.loadPrincipal(c.R.Context(), userID)
	if err != nil {
		return err
	}
	c.P = p
	body := strings.TrimSpace(in.Text)
	if body == "" {
		body = "(no content)"
	}
	if m := ticketRefRe.FindStringSubmatch(in.Subject); m != nil {
		n, _ := strconv.ParseInt(m[2], 10, 64)
		var t Ticket
		if c.T(&Ticket{}).Where("number = ? AND NOT is_deleted", n).Take(&t).Error == nil &&
			(t.RequesterID == userID || p.IsAgent) {
			conv := Conversation{Base: Base{OrgID: s.OrgID}, EntityType: "ticket", EntityID: t.ID, UserID: userID, Body: body,
				Kind: "reply", Incoming: !p.IsAgent, ToEmails: jsonOf([]string{}), CCEmails: jsonOf(in.CC), AttachmentIDs: jsonOf([]string{})}
			before := t
			err := c.DB().Transaction(func(tx *gorm.DB) error {
				if err := tx.Create(&conv).Error; err != nil {
					return err
				}
				if !p.IsAgent && t.Status != "open" {
					transitionStatus(tx, &s, &t, t.Status, "open")
					t.Status = "open"
				}
				if p.IsAgent && t.FirstRespondedAt == nil {
					t.FirstRespondedAt = ptrTime(now())
				}
				c.activity(tx, "ticket", t.ID, "reply", "replied by email", nil)
				return tx.Save(&t).Error
			})
			if err != nil {
				return err
			}
			a.afterConversation(c, &t, &before, &conv, conversationInput{}, &s)
			return c.JSON(http.StatusAccepted, map[string]string{"ticket_id": t.ID, "action": "reply"})
		}
	}
	subject := strings.TrimSpace(in.Subject)
	if subject == "" {
		subject = "(no subject)"
	}
	if len(subject) > 255 {
		subject = subject[:255]
	}
	t := Ticket{Base: Base{OrgID: s.OrgID}, Type: "incident", Subject: subject, Description: body, Status: "open", Priority: 2, Urgency: 1, Impact: 1,
		Source: "email", RequesterID: userID, Tags: jsonOf([]string{}), CCEmails: jsonOf(in.CC), CustomFields: jsonOf(map[string]interface{}{}), CreatedByID: userID}
	var res automationResult
	err = c.DB().Transaction(func(tx *gorm.DB) error {
		n, err := nextNumber(tx, s.OrgID, "ticket")
		if err != nil {
			return err
		}
		t.Number, t.CreatedAt = n, now()
		res = a.runWorkflows(c.R.Context(), tx, &s, "ticket_created", &t, nil)
		autoAssign(tx, &t)
		applySLA(tx, &t)
		if err := tx.Create(&t).Error; err != nil {
			return err
		}
		c.activity(tx, "ticket", t.ID, "created", "created the ticket by email", res.changes)
		a.finishAutomation(c.R.Context(), tx, &t, res, &s)
		return nil
	})
	if err != nil {
		return err
	}
	a.afterTicketCreated(c, &t, &s)
	return c.JSON(http.StatusAccepted, map[string]string{"ticket_id": t.ID, "action": "created"})
}
