package mailer

import (
	"bufio"
	"net"
	"net/mail"
	"strings"
	"testing"
	"time"
)

// fakeSMTP accepts one plain-text SMTP session and records what it received.
type fakeSMTP struct {
	addr     string
	mailFrom string
	rcptTo   string
	data     string
	authed   bool
	done     chan struct{}
}

func startFakeSMTP(t *testing.T, rejectAuth bool) *fakeSMTP {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	f := &fakeSMTP{addr: ln.Addr().String(), done: make(chan struct{})}
	go func() {
		defer close(f.done)
		defer ln.Close()
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		r := bufio.NewReader(conn)
		write := func(s string) { _, _ = conn.Write([]byte(s + "\r\n")) }
		write("220 fake ESMTP")
		for {
			line, err := r.ReadString('\n')
			if err != nil {
				return
			}
			cmd := strings.TrimSpace(line)
			upper := strings.ToUpper(cmd)
			switch {
			case strings.HasPrefix(upper, "EHLO"), strings.HasPrefix(upper, "HELO"):
				write("250-fake")
				write("250 AUTH PLAIN")
			case strings.HasPrefix(upper, "AUTH"):
				if rejectAuth {
					write("535 5.7.8 Authentication failed")
					continue
				}
				f.authed = true
				write("235 2.7.0 ok")
			case strings.HasPrefix(upper, "MAIL FROM:"):
				f.mailFrom = cmd[len("MAIL FROM:"):]
				write("250 ok")
			case strings.HasPrefix(upper, "RCPT TO:"):
				f.rcptTo = cmd[len("RCPT TO:"):]
				write("250 ok")
			case upper == "DATA":
				write("354 go ahead")
				var b strings.Builder
				for {
					l, err := r.ReadString('\n')
					if err != nil {
						return
					}
					if l == ".\r\n" {
						break
					}
					b.WriteString(l)
				}
				f.data = b.String()
				write("250 queued")
			case upper == "QUIT":
				write("221 bye")
				return
			default:
				write("250 ok")
			}
		}
	}()
	return f
}

func cfgFor(f *fakeSMTP) Config {
	host, port, _ := net.SplitHostPort(f.addr)
	return Config{Host: host, Port: port, User: "support@example.com", Pass: "secret", From: "TaskFlow <support@example.com>", Timeout: 5 * time.Second}
}

func TestSendUsesBareEnvelopeAddressWithDisplayName(t *testing.T) {
	f := startFakeSMTP(t, false)
	err := cfgFor(f).Send(Message{To: "Ann Lee <ann@example.org>", Subject: "Verify your email ✓", Text: "Hello\nClick here"})
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	<-f.done
	if !f.authed {
		t.Fatal("expected AUTH")
	}
	if f.mailFrom != "<support@example.com>" {
		t.Fatalf("MAIL FROM = %q, want the bare address", f.mailFrom)
	}
	if f.rcptTo != "<ann@example.org>" {
		t.Fatalf("RCPT TO = %q", f.rcptTo)
	}
	for _, want := range []string{"From: \"TaskFlow\" <support@example.com>", "To: \"Ann Lee\" <ann@example.org>", "Subject: =?utf-8?q?", "Message-ID: <", "@example.com>", "Hello\r\nClick here"} {
		if !strings.Contains(f.data, want) {
			t.Fatalf("message missing %q:\n%s", want, f.data)
		}
	}
}

func TestSendReportsAuthFailure(t *testing.T) {
	f := startFakeSMTP(t, true)
	err := cfgFor(f).Send(Message{To: "ann@example.org", Subject: "x", Text: "y"})
	if err == nil || !strings.Contains(err.Error(), "sign-in to the mail server failed") || !strings.Contains(err.Error(), "535") {
		t.Fatalf("want auth failure with server text, got %v", err)
	}
}

func TestSendValidation(t *testing.T) {
	if err := (Config{}).Send(Message{To: "a@b.co"}); err == nil {
		t.Fatal("unconfigured mailer must refuse")
	}
	c := Config{Host: "127.0.0.1", Port: "1", From: "not an address"}
	if err := c.Send(Message{To: "a@b.co"}); err == nil || !strings.Contains(err.Error(), "SMTP_FROM") {
		t.Fatalf("want SMTP_FROM error, got %v", err)
	}
	c.From = "ok@example.com"
	if err := c.Send(Message{To: "nope"}); err == nil || !strings.Contains(err.Error(), "invalid recipient") {
		t.Fatalf("want recipient error, got %v", err)
	}
}

func TestBuildStripsHeaderInjection(t *testing.T) {
	from, _ := mail.ParseAddress("ops@example.com")
	msg := string(Build(from, Message{To: "a@b.co\r\nBcc: evil@x.io", Subject: "hi\nBcc: evil@x.io", Text: "x"}, time.Unix(0, 0)))
	head := msg[:strings.Index(msg, "\r\n\r\n")]
	for _, line := range strings.Split(head, "\r\n") {
		if strings.HasPrefix(strings.ToLower(line), "bcc:") {
			t.Fatalf("header injection: %q", line)
		}
	}
}

func TestVerificationRequired(t *testing.T) {
	on := Config{Host: "smtp.example.com"}
	t.Setenv("EMAIL_VERIFICATION", "")
	if !VerificationRequired(on) || VerificationRequired(Config{}) {
		t.Fatal("automatic mode must follow whether email is configured")
	}
	t.Setenv("EMAIL_VERIFICATION", "off")
	if VerificationRequired(on) {
		t.Fatal("off must disable")
	}
	t.Setenv("EMAIL_VERIFICATION", "required")
	if !VerificationRequired(Config{}) {
		t.Fatal("required must enable")
	}
}

// relaySMTP mimics Zoho: it accepts any login but rejects a message whose
// sender is not the signed-in mailbox, after the data is sent.
func startRelaySMTP(t *testing.T, allowed string) (addr string, got chan string) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	got = make(chan string, 4)
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func(conn net.Conn) {
				defer conn.Close()
				r := bufio.NewReader(conn)
				write := func(s string) { _, _ = conn.Write([]byte(s + "\r\n")) }
				write("220 fake")
				var from string
				for {
					line, err := r.ReadString('\n')
					if err != nil {
						return
					}
					cmd := strings.TrimSpace(line)
					up := strings.ToUpper(cmd)
					switch {
					case strings.HasPrefix(up, "EHLO"):
						write("250-fake")
						write("250 AUTH PLAIN")
					case strings.HasPrefix(up, "AUTH"):
						write("235 ok")
					case strings.HasPrefix(up, "MAIL FROM:"):
						from = cmd[len("MAIL FROM:"):]
						write("250 ok")
					case up == "DATA":
						write("354 go")
						var b strings.Builder
						for {
							l, err := r.ReadString('\n')
							if err != nil || l == ".\r\n" {
								break
							}
							b.WriteString(l)
						}
						if from != "<"+allowed+">" {
							write("550 5.7.1 Sender is not allowed to relay emails")
							continue
						}
						got <- b.String()
						write("250 queued")
					case up == "QUIT":
						write("221 bye")
						return
					default:
						write("250 ok")
					}
				}
			}(conn)
		}
	}()
	return ln.Addr().String(), got
}

func TestSendFallsBackToSignedInMailbox(t *testing.T) {
	addr, got := startRelaySMTP(t, "service@example.com")
	host, port, _ := net.SplitHostPort(addr)
	c := Config{Host: host, Port: port, User: "service@example.com", Pass: "x", From: "TaskFlow <no-reply@example.com>", Timeout: 5 * time.Second}
	res, err := c.SendWithResult(Message{To: "ann@example.org", Subject: "Hi", Text: "Body"})
	if err != nil {
		t.Fatalf("expected fallback delivery, got %v", err)
	}
	if !res.Fallback || !strings.Contains(res.From, "service@example.com") {
		t.Fatalf("result should report the fallback sender: %+v", res)
	}
	msg := <-got
	for _, want := range []string{"From: \"TaskFlow\" <service@example.com>", "Reply-To: \"TaskFlow\" <no-reply@example.com>"} {
		if !strings.Contains(msg, want) {
			t.Fatalf("message missing %q:\n%s", want, msg)
		}
	}
	// When the signed-in mailbox is the sender already, the error is returned as is.
	c.From = "TaskFlow <other@example.com>"
	c.User = "other@example.com"
	if _, err := c.SendWithResult(Message{To: "ann@example.org", Subject: "Hi", Text: "Body"}); err == nil || !strings.Contains(err.Error(), "relay") {
		t.Fatalf("expected the relay error to surface, got %v", err)
	}
}

func TestBuildMultipartAlternative(t *testing.T) {
	from, _ := mail.ParseAddress("TaskFlow <ops@example.com>")
	long := strings.Repeat("x", 3000)
	msg := string(Build(from, Message{To: "a@b.co", Subject: "Hi", Text: "Plain body", HTML: "<p>" + long + "</p>"}, time.Unix(0, 0)))
	if !strings.Contains(msg, "Content-Type: multipart/alternative; boundary=") {
		t.Fatalf("not multipart:\n%s", msg[:400])
	}
	if !strings.Contains(msg, "Content-Type: text/plain; charset=UTF-8") || !strings.Contains(msg, "Content-Type: text/html; charset=UTF-8") {
		t.Fatal("both parts must be present")
	}
	for _, line := range strings.Split(msg, "\r\n") {
		if len(line) > 998 {
			t.Fatalf("SMTP line limit exceeded: %d characters", len(line))
		}
	}
	if strings.Index(msg, "text/plain") > strings.Index(msg, "text/html") {
		t.Fatal("plain text must come first so clients prefer the HTML part")
	}
}

func TestRenderHTMLIsSafeAndComplete(t *testing.T) {
	out := RenderHTML(Layout{
		Brand: "Acme <Desk>", Accent: "red;background:url(x)", LogoURL: "javascript:alert(1)",
		Title: "<script>alert(1)</script>", Greeting: "Hi Ann,",
		Paragraphs: []string{"See https://example.com/t/1 and **bold** but not javascript:alert(2)"},
		Button:     &Button{Label: "Open", URL: "https://example.com/t/1"},
		Details:    []Detail{{Label: "Ticket", Value: "INC-1"}},
	})
	for _, bad := range []string{"<script>", "javascript:alert(1)", "red;background", `href="javascript`} {
		if strings.Contains(out, bad) {
			t.Fatalf("unsafe output contains %q", bad)
		}
	}
	for _, want := range []string{"&lt;script&gt;", "Acme &lt;Desk&gt;", `href="https://example.com/t/1"`, "<strong>bold</strong>", "INC-1", "#2563eb", "max-width:600px", "@media only screen and (max-width:620px)"} {
		if !strings.Contains(out, want) {
			t.Fatalf("output missing %q", want)
		}
	}
	text := LayoutText(Layout{Title: "T", Paragraphs: []string{"**B** body"}, Button: &Button{Label: "Open", URL: "https://x.io"}})
	if !strings.Contains(text, "B body") || !strings.Contains(text, "Open:\nhttps://x.io") || strings.Contains(text, "**") {
		t.Fatalf("plain text twin: %q", text)
	}
}
