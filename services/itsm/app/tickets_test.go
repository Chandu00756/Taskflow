package app

import "testing"

// An edit is saved only when the tracker records a change, so an edit that touches only the
// description, the resolution notes or the CC list must still count as one.
func TestChangeTrackerCountsTextAndCCEdits(t *testing.T) {
	ct := newChangeTracker()
	ct.text("description", "Printer jams on tray 2", "Printer jams on tray 2")
	ct.text("resolution_notes", "", "")
	ct.field("cc_emails", stringsFrom(jsonOf([]string{})), []string{})
	ct.field("cc_emails", stringsFrom(nil), []string{})
	ct.field("cc_emails", stringsFrom(jsonOf([]string{"a@x.com"})), []string{"a@x.com"})
	if len(ct.changes) != 0 || len(ct.rules) != 0 {
		t.Fatalf("unchanged values were recorded as changes: %+v", ct.changes)
	}

	ct.text("description", "Printer jams on tray 2", "Printer jams on trays 2 and 3")
	ct.text("resolution_notes", "", "Replaced the pickup roller")
	ct.field("cc_emails", stringsFrom(jsonOf([]string{"a@x.com"})), []string{"a@x.com", "b@x.com"})
	if len(ct.changes) != 3 {
		t.Fatalf("want 3 changes (description, resolution notes, CC), got %+v", ct.changes)
	}

	// The activity log says the text changed without copying it.
	for _, ch := range ct.changes[:2] {
		if ch.From != "…" || ch.To != "…" {
			t.Errorf("%s: activity should show … for long text, got %v → %v", ch.Field, ch.From, ch.To)
		}
	}
	// The workflow rules see the real values.
	if got := ct.rules["description"]; got.From != "Printer jams on tray 2" || got.To != "Printer jams on trays 2 and 3" {
		t.Errorf("rules see description %v → %v", got.From, got.To)
	}
	if got := ct.rules["resolution_notes"]; got.To != "Replaced the pickup roller" {
		t.Errorf("rules see resolution notes → %v", got.To)
	}
	if ct.changes[2].Field != "cc_emails" {
		t.Errorf("third change is %q, want cc_emails", ct.changes[2].Field)
	}
}

func TestChangeTrackerFieldMatchesOldTracking(t *testing.T) {
	ct := newChangeTracker()
	ct.field("priority", 2, 2)
	ct.field("tags", []string{"vpn"}, []string{"vpn"})
	if len(ct.changes) != 0 {
		t.Fatalf("equal values recorded: %+v", ct.changes)
	}
	ct.field("priority", 2, 3)
	if len(ct.changes) != 1 || ct.changes[0].From != 2 || ct.changes[0].To != 3 || ct.rules["priority"].To != 3 {
		t.Fatalf("priority change not recorded as before: %+v", ct.changes)
	}
}
