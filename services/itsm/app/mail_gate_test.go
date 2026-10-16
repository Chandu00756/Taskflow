package app

import (
	"testing"
	"time"
)

func TestMailGateCapsPerMinute(t *testing.T) {
	var g mailGate
	t0 := time.Date(2026, 1, 1, 10, 0, 0, 0, time.UTC)
	for i := 0; i < 3; i++ {
		if w := g.take(t0.Add(time.Duration(i)*time.Second), 3); w != 0 {
			t.Fatalf("send %d should go out, got wait %v", i+1, w)
		}
	}
	if w := g.take(t0.Add(10*time.Second), 3); w != 50*time.Second {
		t.Fatalf("4th send in the same minute should wait for the window, got %v", w)
	}
	if w := g.take(t0.Add(time.Minute), 3); w != 0 {
		t.Fatalf("a new minute allows sending again, got %v", w)
	}
	for i := 0; i < 100; i++ {
		if w := g.take(t0.Add(2*time.Minute), 0); w != 0 {
			t.Fatal("0 means no cap")
		}
	}
}

func TestMailGatePausesWithGrowingBackoff(t *testing.T) {
	var g mailGate
	t0 := time.Date(2026, 1, 1, 10, 0, 0, 0, time.UTC)
	until := g.throttled(t0, "550 5.4.6 Unusual sending activity detected")
	if until != t0.Add(15*time.Minute) {
		t.Fatalf("first pause is 15 minutes, got %v", until.Sub(t0))
	}
	if w := g.take(t0.Add(time.Minute), 0); w != 14*time.Minute {
		t.Fatalf("paused sends wait for the pause to end, got %v", w)
	}
	if u, reason, ok := g.paused(t0.Add(time.Minute)); !ok || u != until || reason == "" {
		t.Fatalf("status should report the pause: %v %q %v", u, reason, ok)
	}
	want := []time.Duration{30 * time.Minute, time.Hour, 2 * time.Hour, 2 * time.Hour}
	at := until
	for i, d := range want {
		if got := g.throttled(at, "again").Sub(at); got != d {
			t.Fatalf("pause %d: want %v, got %v", i+2, d, got)
		}
		at = at.Add(d)
	}
	if _, _, ok := g.paused(at.Add(time.Second)); ok {
		t.Fatal("the pause ends on time")
	}
	g.delivered()
	if got := g.throttled(at, "later").Sub(at); got != 15*time.Minute {
		t.Fatalf("a successful send resets the back-off, got %v", got)
	}
	g.clear()
	if _, _, ok := g.paused(at); ok || g.take(at, 0) != 0 {
		t.Fatal("clear lifts the pause")
	}
}
