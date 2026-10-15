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
