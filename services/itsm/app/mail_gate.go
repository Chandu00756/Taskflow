package app

import (
	"sync"
	"time"
)

// mailGate paces outgoing email so the mail provider does not hold the
// account: it caps messages per minute and, when the provider signals
// throttling, pauses all sending with a growing back-off.
type mailGate struct {
	mu          sync.Mutex
	windowStart time.Time
	sent        int
	pausedUntil time.Time
	backoff     time.Duration
	reason      string
}

const (
	mailPauseMin = 15 * time.Minute
	mailPauseMax = 2 * time.Hour
)

// take reserves one send at t. It returns how long to wait instead when
// sending is paused or the per-minute cap (max, 0 = no cap) is used up.
func (g *mailGate) take(t time.Time, max int) time.Duration {
	g.mu.Lock()
	defer g.mu.Unlock()
	if t.Before(g.pausedUntil) {
		return g.pausedUntil.Sub(t)
	}
	if max <= 0 {
		return 0
	}
	if t.Sub(g.windowStart) >= time.Minute {
		g.windowStart, g.sent = t, 0
	}
	if g.sent >= max {
		return g.windowStart.Add(time.Minute).Sub(t)
	}
	g.sent++
	return 0
}

// throttled pauses sending after the provider limited it. Each pause in a
// row doubles, from 15 minutes up to 2 hours.
func (g *mailGate) throttled(t time.Time, reason string) time.Time {
	g.mu.Lock()
	defer g.mu.Unlock()
	switch {
	case g.backoff == 0:
		g.backoff = mailPauseMin
	case g.backoff < mailPauseMax:
		g.backoff *= 2
		if g.backoff > mailPauseMax {
			g.backoff = mailPauseMax
		}
	}
	g.pausedUntil = t.Add(g.backoff)
	g.reason = reason
	return g.pausedUntil
}

// delivered records a successful send; the next throttle starts over at 15 minutes.
func (g *mailGate) delivered() {
	g.mu.Lock()
	g.backoff = 0
	g.mu.Unlock()
}

// clear lifts a pause, e.g. when a platform admin retries after fixing the settings.
func (g *mailGate) clear() {
	g.mu.Lock()
	g.pausedUntil, g.backoff, g.reason = time.Time{}, 0, ""
	g.mu.Unlock()
}

// paused returns the end of the current pause and its reason, if any.
func (g *mailGate) paused(t time.Time) (until time.Time, reason string, ok bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if t.Before(g.pausedUntil) {
		return g.pausedUntil, g.reason, true
	}
	return time.Time{}, "", false
}
