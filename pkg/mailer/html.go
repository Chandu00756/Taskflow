package mailer

import (
	"fmt"
	"html"
	"regexp"
	"strings"
)

// Layout describes a branded HTML email. Every text field is plain text and
// is escaped when rendered; only URLs become links.
type Layout struct {
	// Brand is shown in the header, e.g. "Acme Service Desk".
	Brand string
	// LogoURL is an absolute http(s) URL of a PNG or JPEG (email clients do
	// not show SVG or data: images). Empty shows the brand initial.
	LogoURL string
	// Accent is the brand colour for the header and button (#rrggbb).
	Accent string
	// Preheader is the grey preview line inboxes show after the subject.
	Preheader  string
	Title      string
	Greeting   string
	Paragraphs []string
	Button     *Button
	Details    []Detail
	// Note is small print under the button, e.g. "The link expires in 1 hour."
	Note string
	// Footer explains why the person got the email.
	Footer      string
	FooterLinks []Link
}

// Button is the main call to action.
type Button struct {
	Label string
	URL   string
}

// Detail is one row of the key / value table.
type Detail struct {
	Label string
	Value string
}

// Link is a footer link.
type Link struct {
	Label string
	URL   string
}

var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// urlRe finds http(s) links in plain text.
var urlRe = regexp.MustCompile(`https?://[^\s<>"')\]]+`)

func safeURL(u string) string {
	u = strings.TrimSpace(u)
	if strings.HasPrefix(u, "http://") || strings.HasPrefix(u, "https://") {
		return u
	}
	return ""
}

// linkify escapes text and turns http(s) URLs into links.
func linkify(text, accent string) string {
	var b strings.Builder
	last := 0
	for _, m := range urlRe.FindAllStringIndex(text, -1) {
		b.WriteString(html.EscapeString(text[last:m[0]]))
		u := strings.TrimRight(text[m[0]:m[1]], ".,;:!?")
		fmt.Fprintf(&b, `<a href="%s" style="color:%s;text-decoration:underline;word-break:break-all;">%s</a>`, html.EscapeString(u), accent, html.EscapeString(u))
		b.WriteString(html.EscapeString(text[m[0]+len(u) : m[1]]))
		last = m[1]
	}
	b.WriteString(html.EscapeString(text[last:]))
	return b.String()
}

var boldRe = regexp.MustCompile(`\*\*([^*\n]+)\*\*`)

// paragraphHTML renders one plain-text paragraph: line breaks kept, links
// clickable and **bold** markdown honoured (templates are written in it).
func paragraphHTML(p, accent string) string {
	out := linkify(p, accent)
	out = boldRe.ReplaceAllString(out, "<strong>$1</strong>")
	return strings.ReplaceAll(out, "\n", "<br>")
}

// SplitParagraphs splits plain text on blank lines.
func SplitParagraphs(text string) []string {
	text = strings.ReplaceAll(strings.TrimSpace(text), "\r\n", "\n")
	var out []string
	for _, p := range regexp.MustCompile(`\n\s*\n`).Split(text, -1) {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// RenderHTML renders a responsive, table-based HTML email.
func RenderHTML(l Layout) string {
	accent := l.Accent
	if !hexColor.MatchString(accent) {
		accent = "#2563eb"
	}
	brand := strings.TrimSpace(l.Brand)
	if brand == "" {
		brand = "TaskFlow"
	}
	esc := html.EscapeString
	var b strings.Builder
	b.WriteString(`<!DOCTYPE html><html lang="en" xmlns="http://www.w3.org/1999/xhtml"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>`)
	b.WriteString(esc(l.Title))
	b.WriteString(`</title>
<style>
body{margin:0;padding:0;background:#f1f5f9;-webkit-text-size-adjust:100%;}
table{border-collapse:collapse;}
img{border:0;outline:none;text-decoration:none;}
a{color:` + accent + `;}
@media only screen and (max-width:620px){
 .tf-container{width:100%!important;}
 .tf-pad{padding-left:20px!important;padding-right:20px!important;}
 .tf-title{font-size:22px!important;line-height:30px!important;}
 .tf-btn a{display:block!important;}
 .tf-detail-label{width:40%!important;}
}
</style></head>
<body style="margin:0;padding:0;background:#f1f5f9;">`)
	if pre := strings.TrimSpace(l.Preheader); pre != "" {
		fmt.Fprintf(&b, `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f1f5f9;font-size:1px;line-height:1px;">%s&#8202;&#8203;&#8202;&#8203;&#8202;&#8203;</div>`, esc(pre))
	}
	b.WriteString(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" class="tf-container" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 12px 32px rgba(15,23,42,0.08);">`)

	// Header: accent band with logo and brand.
	// The TaskFlow gradient for the default colour; a custom brand colour stays solid.
	headerBG := "background:" + accent + ";"
	if strings.EqualFold(accent, "#2563eb") {
		headerBG += "background-image:linear-gradient(135deg,#4f46e5 0%,#0ea5e9 60%,#10b981 100%);"
	}
	fmt.Fprintf(&b, `<tr><td class="tf-pad" bgcolor="%s" style="%spadding:22px 36px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>`, accent, headerBG)
	if logo := safeURL(l.LogoURL); logo != "" {
		fmt.Fprintf(&b, `<td style="padding-right:12px;vertical-align:middle;"><img src="%s" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border-radius:10px;background:#ffffff;"></td>`, esc(logo))
	} else {
		initial := strings.ToUpper(string([]rune(brand)[0]))
		fmt.Fprintf(&b, `<td style="padding-right:12px;vertical-align:middle;"><div style="width:40px;height:40px;border-radius:10px;background:#ffffff;color:%s;font:700 20px/40px -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;text-align:center;">%s</div></td>`, accent, esc(initial))
	}
	fmt.Fprintf(&b, `<td style="vertical-align:middle;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:17px;font-weight:700;color:#ffffff;letter-spacing:-0.2px;">%s</td></tr></table></td></tr>`, esc(brand))

	// Body.
	b.WriteString(`<tr><td class="tf-pad" style="padding:34px 36px 8px 36px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">`)
	if t := strings.TrimSpace(l.Title); t != "" {
		fmt.Fprintf(&b, `<h1 class="tf-title" style="margin:0 0 18px 0;font-size:24px;line-height:32px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">%s</h1>`, esc(t))
	}
	if g := strings.TrimSpace(l.Greeting); g != "" {
		fmt.Fprintf(&b, `<p style="margin:0 0 14px 0;font-size:15px;line-height:24px;color:#334155;">%s</p>`, esc(g))
	}
	for _, p := range l.Paragraphs {
		if strings.TrimSpace(p) == "" {
			continue
		}
		fmt.Fprintf(&b, `<p style="margin:0 0 14px 0;font-size:15px;line-height:24px;color:#334155;">%s</p>`, paragraphHTML(p, accent))
	}
	if len(l.Details) > 0 {
		b.WriteString(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 18px 0;border:1px solid #e2e8f0;border-radius:12px;border-collapse:separate;overflow:hidden;">`)
		for i, d := range l.Details {
			bg := "#ffffff"
			if i%2 == 0 {
				bg = "#f8fafc"
			}
			fmt.Fprintf(&b, `<tr><td class="tf-detail-label" width="35%%" style="background:%s;padding:10px 14px;font-size:13px;line-height:20px;color:#64748b;vertical-align:top;">%s</td><td style="background:%s;padding:10px 14px;font-size:14px;line-height:20px;color:#0f172a;font-weight:600;vertical-align:top;">%s</td></tr>`,
				bg, esc(d.Label), bg, paragraphHTML(d.Value, accent))
		}
		b.WriteString(`</table>`)
	}
	if l.Button != nil {
		if u := safeURL(l.Button.URL); u != "" {
			fmt.Fprintf(&b, `<table role="presentation" cellpadding="0" cellspacing="0" class="tf-btn" style="margin:22px 0 10px 0;"><tr><td align="center" bgcolor="%s" style="border-radius:10px;background:%s;">
<a href="%s" target="_blank" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:700;line-height:20px;color:#ffffff;text-decoration:none;border-radius:10px;">%s</a></td></tr></table>`,
				accent, accent, esc(u), esc(l.Button.Label))
			fmt.Fprintf(&b, `<p style="margin:6px 0 16px 0;font-size:12px;line-height:18px;color:#94a3b8;">Button not working? Paste this link into your browser:<br><a href="%s" style="color:%s;word-break:break-all;">%s</a></p>`, esc(u), accent, esc(u))
		}
	}
	if n := strings.TrimSpace(l.Note); n != "" {
		fmt.Fprintf(&b, `<p style="margin:0 0 14px 0;font-size:13px;line-height:20px;color:#64748b;">%s</p>`, paragraphHTML(n, accent))
	}
	b.WriteString(`</td></tr>`)

	// Footer.
	b.WriteString(`<tr><td class="tf-pad" style="padding:18px 36px 30px 36px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #e2e8f0;padding-top:18px;font-size:12px;line-height:19px;color:#94a3b8;">`)
	if f := strings.TrimSpace(l.Footer); f != "" {
		fmt.Fprintf(&b, `%s<br>`, paragraphHTML(f, accent))
	}
	for i, fl := range l.FooterLinks {
		if u := safeURL(fl.URL); u != "" {
			if i > 0 {
				b.WriteString(` &nbsp;·&nbsp; `)
			}
			fmt.Fprintf(&b, `<a href="%s" style="color:#64748b;text-decoration:underline;">%s</a>`, esc(u), esc(fl.Label))
		}
	}
	b.WriteString(`<br><span style="color:#cbd5e1;">Sent by ` + esc(brand) + ` · Powered by TaskFlow</span></td></tr></table></td></tr>`)
	b.WriteString(`</table></td></tr></table></body></html>`)
	return b.String()
}

// LayoutText renders the plain-text alternative of a layout.
func LayoutText(l Layout) string {
	var parts []string
	if t := strings.TrimSpace(l.Title); t != "" {
		parts = append(parts, t)
	}
	if g := strings.TrimSpace(l.Greeting); g != "" {
		parts = append(parts, g)
	}
	for _, p := range l.Paragraphs {
		if p = strings.TrimSpace(boldRe.ReplaceAllString(p, "$1")); p != "" {
			parts = append(parts, p)
		}
	}
	if len(l.Details) > 0 {
		var rows []string
		for _, d := range l.Details {
			rows = append(rows, d.Label+": "+d.Value)
		}
		parts = append(parts, strings.Join(rows, "\n"))
	}
	if l.Button != nil && safeURL(l.Button.URL) != "" {
		parts = append(parts, l.Button.Label+":\n"+l.Button.URL)
	}
	if n := strings.TrimSpace(l.Note); n != "" {
		parts = append(parts, n)
	}
	brand := strings.TrimSpace(l.Brand)
	if brand == "" {
		brand = "TaskFlow"
	}
	footer := "— " + brand
	if f := strings.TrimSpace(l.Footer); f != "" {
		footer += "\n\n" + f
	}
	for _, fl := range l.FooterLinks {
		if safeURL(fl.URL) != "" {
			footer += "\n" + fl.Label + ": " + fl.URL
		}
	}
	parts = append(parts, footer)
	return strings.Join(parts, "\n\n")
}

// FirstURL returns the first http(s) link in text, if any.
func FirstURL(text string) string {
	return strings.TrimRight(urlRe.FindString(text), ".,;:!?")
}
