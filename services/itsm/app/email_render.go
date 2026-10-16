package app

import (
	"encoding/base64"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/chanduchitikam/task-management-system/pkg/mailer"
	"gorm.io/gorm"
)

// Branded HTML email: every message the service desk sends uses the
// organization's helpdesk name, colour and logo, with a plain-text twin.

var hexColorRe = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func (a *App) publicURL(path string) string {
	return strings.TrimRight(a.Cfg.PublicURL, "/") + path
}

// emailLayout is the branded starting point for an organization's email.
func (a *App) emailLayout(db *gorm.DB, orgID string) mailer.Layout {
	l := mailer.Layout{Brand: "TaskFlow", Accent: "#2563eb", LogoURL: a.publicURL("/icon-192.png")}
	if orgID == "" || orgID == systemOrgID {
		return l
	}
	var s Settings
	if db.Select("helpdesk_name, primary_color, logo_url").Where("org_id = ?", orgID).Take(&s).Error != nil {
		return l
	}
	if name := strings.TrimSpace(s.HelpdeskName); name != "" {
		l.Brand = name
	}
	if hexColorRe.MatchString(s.PrimaryColor) {
		l.Accent = s.PrimaryColor
	}
	switch {
	case strings.HasPrefix(s.LogoURL, "https://"):
		l.LogoURL = s.LogoURL
	case emailSafeLogo(s.LogoURL):
		// Uploaded logos are stored inline; email clients load them from this address.
		l.LogoURL = a.publicURL("/api/v2/branding/" + orgID + "/logo")
	}
	return l
}

// emailSafeLogo reports whether an uploaded logo is an image type email clients show.
func emailSafeLogo(dataURL string) bool {
	for _, t := range []string{"data:image/png;base64,", "data:image/jpeg;base64,", "data:image/jpg;base64,", "data:image/gif;base64,"} {
		if strings.HasPrefix(dataURL, t) {
			return true
		}
	}
	return false
}

// serveBrandingLogo serves an organization's uploaded logo publicly so it can
// appear in emails (GET /api/v2/branding/{org}/logo).
func (a *App) serveBrandingLogo(w http.ResponseWriter, r *http.Request) {
	orgID := r.PathValue("org")
	var logo string
	if isUUID(orgID) {
		a.DB.WithContext(r.Context()).Model(&Settings{}).Select("logo_url").Where("org_id = ?", orgID).Scan(&logo)
	}
	if !emailSafeLogo(logo) {
		http.NotFound(w, r)
		return
	}
	i := strings.Index(logo, ";base64,")
	data, err := base64.StdEncoding.DecodeString(logo[i+8:])
	if err != nil {
		http.NotFound(w, r)
		return
	}
	ctype := strings.TrimPrefix(logo[:i], "data:")
	if ctype == "image/jpg" {
		ctype = "image/jpeg"
	}
	w.Header().Set("Content-Type", ctype)
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(data)
}

// queueRich queues a branded email: the layout is completed with the
// organization's brand, then rendered as HTML and plain text.
func (a *App) queueRich(db *gorm.DB, orgID *string, to, subject string, l mailer.Layout, entityType, entityID string) {
	if to == "" || !validEmail(to) {
		return
	}
	org := systemOrgID
	if orgID != nil && *orgID != "" {
		org = *orgID
	}
	base := a.emailLayout(db, org)
	if l.Brand == "" {
		l.Brand = base.Brand
	}
	if l.Accent == "" {
		l.Accent = base.Accent
	}
	if l.LogoURL == "" {
		l.LogoURL = base.LogoURL
	}
	if l.Footer == "" {
		l.Footer = "You received this email from " + l.Brand + "."
	}
	db.Create(&EmailOutbox{Base: Base{OrgID: org}, ToAddr: to, Subject: subject, Body: mailer.LayoutText(l), HTMLBody: mailer.RenderHTML(l),
		Status: "queued", EntityType: entityType, EntityID: entityID})
	a.kickMail()
}

var templateTitles = map[string]string{
	"ticket_created_requester":  "We received your request",
	"ticket_assigned_agent":     "A ticket was assigned to you",
	"ticket_assigned_group":     "A new ticket for your group",
	"agent_reply_requester":     "There's a new reply on your ticket",
	"requester_reply_agent":     "The requester replied",
	"ticket_resolved_requester": "Your ticket was resolved",
	"approval_requested":        "Your approval is needed",
	"sla_violation":             "An SLA target was missed",
	"contract_expiring":         "A contract expires soon",
	"csat_survey":               "How did we do?",
}

var templateButtons = map[string]string{
	"ticket_created_requester":  "View your request",
	"ticket_assigned_agent":     "Open ticket",
	"ticket_assigned_group":     "Open ticket",
	"agent_reply_requester":     "Read the reply",
	"requester_reply_agent":     "Open ticket",
	"ticket_resolved_requester": "View ticket",
	"approval_requested":        "Review and decide",
	"sla_violation":             "Open ticket",
	"contract_expiring":         "View contract",
	"csat_survey":               "Rate your experience",
}

// linkLine matches a paragraph that is only a link, optionally with a label
// ("View it here: https://…").
var linkLine = regexp.MustCompile(`^(?:[^\n:]{1,60}:\s*)?(https?://\S+)$`)

// templateLayout turns a rendered plain-text template into a branded layout:
// the greeting line, paragraphs, a button for the link line and, for ticket
// events, a details table.
func templateLayout(event, subject, body string, vars map[string]string) mailer.Layout {
	l := mailer.Layout{Title: templateTitles[event]}
	if l.Title == "" {
		l.Title = subject
	}
	paras := mailer.SplitParagraphs(body)
	if len(paras) > 0 && strings.HasPrefix(paras[0], "Hi ") && !strings.Contains(paras[0], "\n") && len(paras[0]) <= 80 {
		l.Greeting = paras[0]
		paras = paras[1:]
	}
	for _, p := range paras {
		if m := linkLine.FindStringSubmatch(p); m != nil && l.Button == nil {
			label := templateButtons[event]
			if label == "" {
				label = "Open"
			}
			l.Button = &mailer.Button{Label: label, URL: strings.TrimRight(m[1], ".,;:!?")}
			continue
		}
		l.Paragraphs = append(l.Paragraphs, p)
	}
	if l.Button == nil {
		if u := mailer.FirstURL(body); u != "" {
			label := templateButtons[event]
			if label == "" {
				label = "Open"
			}
			l.Button = &mailer.Button{Label: label, URL: u}
		}
	}
	if vars["ticket.id"] != "" && (strings.HasPrefix(event, "ticket_") || oneOf(event, "agent_reply_requester", "requester_reply_agent", "sla_violation", "csat_survey")) {
		for _, d := range []mailer.Detail{
			{Label: "Ticket", Value: vars["ticket.id"]},
			{Label: "Subject", Value: vars["ticket.subject"]},
			{Label: "Status", Value: vars["ticket.status"]},
			{Label: "Priority", Value: vars["ticket.priority"]},
			{Label: "Group", Value: vars["ticket.group"]},
		} {
			if strings.TrimSpace(d.Value) != "" {
				l.Details = append(l.Details, d)
			}
		}
	}
	if len(l.Paragraphs) > 0 {
		l.Preheader = truncate(strings.ReplaceAll(l.Paragraphs[0], "\n", " "), 140)
	}
	return l
}
