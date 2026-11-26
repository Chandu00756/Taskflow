package app

import (
	"testing"
	"time"
)

func TestGibberish(t *testing.T) {
	for _, s := range []string{"xkqzvbnm", "user839201", "qwrtpsdfgh"} {
		if !gibberish(s) {
			t.Errorf("gibberish(%q) = false, want true", s)
		}
	}
	for _, s := range []string{"Chandu Chitikam", "Thirupathi", "anna.smith", "", "Ravi"} {
		if gibberish(s) {
			t.Errorf("gibberish(%q) = true, want false", s)
		}
	}
}

func hasFlag(u reviewUser, f string) bool {
	for _, x := range u.Flags {
		if x == f {
			return true
		}
	}
	return false
}

func TestScoreAccounts(t *testing.T) {
	at := time.Date(2026, 11, 26, 12, 0, 0, 0, time.UTC)
	ip := "198.51.100.9"
	org := "Buy cheap https://spam.example"
	rows := []reviewUser{
		// A real, verified person who signs in.
		{ID: "real", Email: "anna@acme.com", FullName: "Anna Smith", Username: "anna", Role: "org_admin", IsActive: true, HasLoggedIn: true, CreatedAt: at.Add(-30 * 24 * time.Hour)},
		// Classic bot: throwaway inbox, never verified, link in org name.
		{ID: "bot", Email: "xkqzvbnm@mailinator.com", FullName: "xkqzvbnm", Username: "xkqzvbnm", Role: "admin", IsActive: true, Pending: true, OrgName: &org, CreatedAt: at.Add(-5 * 24 * time.Hour), SignupIP: &ip},
		{ID: "b2", Email: "a1@corp.example", Pending: true, Role: "admin", IsActive: true, CreatedAt: at.Add(-2 * time.Hour), SignupIP: &ip},
		{ID: "b3", Email: "a2@corp.example", Pending: true, Role: "admin", IsActive: true, CreatedAt: at.Add(-2 * time.Hour), SignupIP: &ip},
		// The platform admin is never flagged.
		{ID: "root", Email: "root@x.example", Role: "super_admin", IsActive: true, Pending: true, CreatedAt: at.Add(-90 * 24 * time.Hour)},
	}
	scoreAccounts(rows, at)
	if rows[0].Score != 0 || len(rows[0].Flags) != 0 || rows[0].Status != "active" {
		t.Errorf("real account flagged: %+v", rows[0])
	}
	bot := rows[1]
	for _, f := range []string{"unverified_24h", "disposable_email", "never_signed_in", "link_in_name", "random_looking_name", "same_ip_burst"} {
		if !hasFlag(bot, f) {
			t.Errorf("bot missing flag %s: %v", f, bot.Flags)
		}
	}
	if bot.Score != 100 || bot.Status != "unverified" {
		t.Errorf("bot score %d status %s", bot.Score, bot.Status)
	}
	if !hasFlag(rows[2], "same_ip_burst") {
		t.Errorf("same-IP burst not flagged: %v", rows[2].Flags)
	}
	if len(rows[4].Flags) != 0 || rows[4].Score != 0 {
		t.Errorf("super admin flagged: %v", rows[4].Flags)
	}
}

func TestNormalizeRecoveryCode(t *testing.T) {
	for in, want := range map[string]string{"ABCDE12345": "abcde-12345", " abcde-12345 ": "abcde-12345", "abc de12345": "abcde-12345"} {
		if got := normalizeRecoveryCode(in); got != want {
			t.Errorf("normalizeRecoveryCode(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestPasskeyRequiredRole(t *testing.T) {
	t.Setenv("PASSKEY_ENFORCEMENT", "")
	for role, want := range map[string]bool{"super_admin": true, "org_admin": true, "admin": true, "member": false, "agent": false} {
		if got := passkeyRequiredRole(role); got != want {
			t.Errorf("passkeyRequiredRole(%q) = %v, want %v", role, got, want)
		}
	}
	t.Setenv("PASSKEY_ENFORCEMENT", "off")
	if passkeyRequiredRole("super_admin") {
		t.Error("enforcement off must not require passkeys")
	}
}
