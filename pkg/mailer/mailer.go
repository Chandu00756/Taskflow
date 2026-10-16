// Package mailer sends plain-text email over SMTP. It is shared by the
// services so every outgoing message is built and delivered the same way.
//
// Port 465 uses implicit TLS; any other port (587, 25, 2525) upgrades with
// STARTTLS when the server offers it. SMTP_FROM may include a display name,
// e.g. "TaskFlow <support@example.com>".
package mailer

import (
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"os"
	"strings"
	"time"
)

// Config holds the SMTP connection settings.
type Config struct {
	Host string
	Port string
	User string
	Pass string
	From string
	// Timeout bounds connecting and the whole SMTP conversation.
	Timeout time.Duration
}

// FromEnv reads SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS and SMTP_FROM.
func FromEnv() Config {
	port := strings.TrimSpace(os.Getenv("SMTP_PORT"))
	if port == "" {
		port = "587"
	}
	return Config{
		Host: strings.TrimSpace(os.Getenv("SMTP_HOST")),
		Port: port,
		User: strings.TrimSpace(os.Getenv("SMTP_USER")),
		Pass: os.Getenv("SMTP_PASS"),
		From: strings.TrimSpace(os.Getenv("SMTP_FROM")),
	}
}

// Enabled reports whether a mail server is configured.
func (c Config) Enabled() bool { return c.Host != "" }

// Sender returns the parsed From address: SMTP_FROM, falling back to SMTP_USER.
func (c Config) Sender() (*mail.Address, error) {
	from := c.From
	if from == "" {
		from = c.User
	}
	if from == "" {
		return nil, errors.New("SMTP_FROM (or SMTP_USER) is not set")
	}
	addr, err := mail.ParseAddress(from)
	if err != nil {
		return nil, fmt.Errorf("SMTP_FROM %q is not a valid address: %w", from, err)
	}
	return addr, nil
}

// Message is one outgoing email.
type Message struct {
	To      string
	Subject string
	Text    string
	// ReplyTo is optional.
	ReplyTo string
	// HTML is the optional rich version; Text is always sent alongside it.
	HTML string
}

// sanitizeHeader strips characters that could inject extra headers.
func sanitizeHeader(s string) string {
	return strings.NewReplacer("\r", " ", "\n", " ").Replace(s)
}

func messageID(domain string) string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return "<" + hex.EncodeToString(b) + "@" + domain + ">"
}

// Build renders the RFC 5322 message for m sent from from: plain text, or
// multipart/alternative (text and HTML) when m.HTML is set.
func Build(from *mail.Address, m Message, at time.Time) []byte {
	domain := "localhost"
	if i := strings.LastIndex(from.Address, "@"); i >= 0 {
		domain = from.Address[i+1:]
	}
	head := []string{"From: " + from.String()}
	if m.ReplyTo != "" {
		head = append(head, "Reply-To: "+sanitizeHeader(m.ReplyTo))
	}
	head = append(head,
		"To: "+sanitizeHeader(m.To),
		"Subject: "+mime.QEncoding.Encode("utf-8", sanitizeHeader(m.Subject)),
		"Date: "+at.Format(time.RFC1123Z),
		"Message-ID: "+messageID(domain),
		"MIME-Version: 1.0",
		"Auto-Submitted: auto-generated",
	)
	if m.HTML == "" {
		body := strings.ReplaceAll(strings.ReplaceAll(m.Text, "\r\n", "\n"), "\n", "\r\n")
		head = append(head, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit")
		return []byte(strings.Join(append(head, "", body), "\r\n"))
	}
	boundary := "tf-" + messageID("alt")[1:33]
	head = append(head, `Content-Type: multipart/alternative; boundary="`+boundary+`"`)
	var b strings.Builder
	b.WriteString(strings.Join(head, "\r\n"))
	b.WriteString("\r\n\r\nThis is a multi-part message in MIME format.\r\n")
	for _, part := range []struct{ ctype, body string }{{"text/plain", m.Text}, {"text/html", m.HTML}} {
		b.WriteString("\r\n--" + boundary + "\r\n")
		b.WriteString("Content-Type: " + part.ctype + "; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n")
		var qp strings.Builder
		w := quotedprintable.NewWriter(&qp)
		_, _ = w.Write([]byte(strings.ReplaceAll(part.body, "\r\n", "\n")))
		_ = w.Close()
		b.WriteString(qp.String())
	}
	b.WriteString("\r\n--" + boundary + "--\r\n")
	return []byte(b.String())
}

// senderRefused reports whether the server rejected the From address because
// the signed-in mailbox may not send as it (Zoho "Sender is not allowed to
// relay", Microsoft "SendAsDenied", Gmail "sender address rejected"…).
func senderRefused(err error) bool {
	if err == nil {
		return false
	}
	e := strings.ToLower(err.Error())
	for _, s := range []string{"relay", "sendasdenied", "send as", "sender address rejected", "not allowed to send", "not owned by", "553"} {
		if strings.Contains(e, s) {
			return true
		}
	}
	return false
}

// Result describes a successful delivery.
type Result struct {
	// From is the sender actually used.
	From string
	// Fallback is set when the configured SMTP_FROM was refused and the
	// message went out from the signed-in mailbox instead.
	Fallback bool
}

// Send delivers m. It returns the server's error text when delivery fails so
// administrators can see why (wrong password, sender not allowed, …).
func (c Config) Send(m Message) error {
	_, err := c.SendWithResult(m)
	return err
}

// SendWithResult delivers m. When the mail server refuses SMTP_FROM because
// the signed-in mailbox (SMTP_USER) may not send as that address, it resends
// from SMTP_USER, keeping the display name and setting Reply-To to SMTP_FROM,
// so mail still arrives while the alias is being set up.
func (c Config) SendWithResult(m Message) (Result, error) {
	if !c.Enabled() {
		return Result{}, errors.New("email is not configured (SMTP_HOST is empty)")
	}
	from, err := c.Sender()
	if err != nil {
		return Result{}, err
	}
	err = c.send(from, m)
	if err == nil {
		return Result{From: from.String()}, nil
	}
	user, uerr := mail.ParseAddress(c.User)
	if !senderRefused(err) || uerr != nil || strings.EqualFold(user.Address, from.Address) {
		return Result{}, err
	}
	alt := &mail.Address{Name: from.Name, Address: user.Address}
	if m.ReplyTo == "" {
		m.ReplyTo = from.String()
	}
	if err2 := c.send(alt, m); err2 != nil {
		return Result{}, fmt.Errorf("%v (also failed from %s: %v)", err, user.Address, err2)
	}
	return Result{From: alt.String(), Fallback: true}, nil
}

func (c Config) send(from *mail.Address, m Message) error {
	to, err := mail.ParseAddress(m.To)
	if err != nil {
		return fmt.Errorf("invalid recipient %q", m.To)
	}
	timeout := c.Timeout
	if timeout <= 0 {
		timeout = 20 * time.Second
	}
	addr := net.JoinHostPort(c.Host, c.Port)
	tlsCfg := &tls.Config{ServerName: c.Host, MinVersion: tls.VersionTLS12}

	var conn net.Conn
	dialer := &net.Dialer{Timeout: timeout}
	if c.Port == "465" {
		conn, err = tls.DialWithDialer(dialer, "tcp", addr, tlsCfg)
	} else {
		conn, err = dialer.Dial("tcp", addr)
	}
	if err != nil {
		return fmt.Errorf("connect to %s: %w", addr, err)
	}
	_ = conn.SetDeadline(time.Now().Add(timeout))
	client, err := smtp.NewClient(conn, c.Host)
	if err != nil {
		conn.Close()
		return fmt.Errorf("smtp greeting from %s: %w", addr, err)
	}
	defer client.Close()
	if c.Port != "465" {
		if ok, _ := client.Extension("STARTTLS"); ok {
			if err := client.StartTLS(tlsCfg); err != nil {
				return fmt.Errorf("starttls: %w", err)
			}
		}
	}
	if c.User != "" {
		if ok, _ := client.Extension("AUTH"); !ok {
			return errors.New("the mail server does not offer authentication on this port")
		}
		if err := client.Auth(smtp.PlainAuth("", c.User, c.Pass, c.Host)); err != nil {
			return fmt.Errorf("sign-in to the mail server failed: %w", err)
		}
	}
	if err := client.Mail(from.Address); err != nil {
		return fmt.Errorf("sender %s rejected: %w", from.Address, err)
	}
	if err := client.Rcpt(to.Address); err != nil {
		return fmt.Errorf("recipient %s rejected: %w", to.Address, err)
	}
	w, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(Build(from, Message{To: to.String(), Subject: m.Subject, Text: m.Text, ReplyTo: m.ReplyTo, HTML: m.HTML}, time.Now())); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("message rejected: %w", err)
	}
	return client.Quit()
}

// publicDomains are shared mail providers that never identify an organization.
var publicDomains = map[string]bool{
	"gmail.com": true, "googlemail.com": true, "yahoo.com": true, "outlook.com": true, "hotmail.com": true,
	"live.com": true, "msn.com": true, "icloud.com": true, "me.com": true, "aol.com": true, "proton.me": true,
	"protonmail.com": true, "yandex.com": true, "zoho.com": true, "zohomail.com": true, "gmx.com": true, "mail.com": true,
}

// IsPublicDomain reports whether domain belongs to a public mail provider.
func IsPublicDomain(domain string) bool {
	return publicDomains[strings.ToLower(strings.TrimSpace(domain))]
}

// Domain returns the lower-cased domain part of an email address.
func Domain(email string) string {
	if i := strings.LastIndex(email, "@"); i >= 0 {
		return strings.ToLower(strings.TrimSpace(email[i+1:]))
	}
	return ""
}

// VerificationRequired reports whether new self-service sign-ups must confirm
// their email: EMAIL_VERIFICATION=required|off, or automatic (required only
// when email can actually be sent) when unset.
func VerificationRequired(c Config) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("EMAIL_VERIFICATION"))) {
	case "required", "on", "true":
		return true
	case "off", "false", "disabled":
		return false
	default:
		return c.Enabled()
	}
}
