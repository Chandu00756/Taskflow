// Package sla implements business-hours arithmetic used to compute SLA due
// dates and elapsed business time.
package sla

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Window is an open interval of working time within a day, expressed in
// minutes after local midnight. End is exclusive and may be 1440.
type Window struct {
	Start int
	End   int
}

// Calendar describes when a support team is working.
type Calendar struct {
	Location   *time.Location
	AlwaysOpen bool
	Days       map[time.Weekday][]Window
	Holidays   map[string]bool // keyed by local date "2006-01-02"
}

// DaySpec is the serialized working window for one weekday.
type DaySpec struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

// Holiday is a non-working date.
type Holiday struct {
	Date string `json:"date"`
	Name string `json:"name"`
}

var dayNames = map[string]time.Weekday{
	"sunday": time.Sunday, "monday": time.Monday, "tuesday": time.Tuesday,
	"wednesday": time.Wednesday, "thursday": time.Thursday, "friday": time.Friday,
	"saturday": time.Saturday,
}

// ParseClock converts "HH:MM" into minutes after midnight. "24:00" is allowed.
func ParseClock(s string) (int, error) {
	parts := strings.Split(strings.TrimSpace(s), ":")
	if len(parts) != 2 {
		return 0, fmt.Errorf("invalid time %q", s)
	}
	h, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil || h < 0 || h > 24 || m < 0 || m > 59 || (h == 24 && m != 0) {
		return 0, fmt.Errorf("invalid time %q", s)
	}
	return h*60 + m, nil
}

// NewCalendar builds a calendar from serialized settings. Unknown time zones
// fall back to UTC; invalid windows are rejected.
func NewCalendar(tz string, alwaysOpen bool, days map[string][]DaySpec, holidays []Holiday) (Calendar, error) {
	loc, err := time.LoadLocation(tz)
	if err != nil || tz == "" {
		loc = time.UTC
	}
	cal := Calendar{Location: loc, AlwaysOpen: alwaysOpen, Days: map[time.Weekday][]Window{}, Holidays: map[string]bool{}}
	for name, specs := range days {
		wd, ok := dayNames[strings.ToLower(name)]
		if !ok {
			return cal, fmt.Errorf("unknown weekday %q", name)
		}
		for _, sp := range specs {
			start, err := ParseClock(sp.Start)
			if err != nil {
				return cal, err
			}
			end, err := ParseClock(sp.End)
			if err != nil {
				return cal, err
			}
			if end <= start {
				return cal, fmt.Errorf("%s: end %s must be after start %s", name, sp.End, sp.Start)
			}
			cal.Days[wd] = append(cal.Days[wd], Window{Start: start, End: end})
		}
		sort.Slice(cal.Days[wd], func(i, j int) bool { return cal.Days[wd][i].Start < cal.Days[wd][j].Start })
	}
	for _, h := range holidays {
		if _, err := time.Parse("2006-01-02", h.Date); err != nil {
			return cal, fmt.Errorf("invalid holiday date %q", h.Date)
		}
		cal.Holidays[h.Date] = true
	}
	if !alwaysOpen && len(cal.Days) == 0 {
		return cal, fmt.Errorf("at least one working day is required")
	}
	return cal, nil
}

// TwentyFourSeven is a calendar that never closes.
func TwentyFourSeven() Calendar {
	return Calendar{Location: time.UTC, AlwaysOpen: true}
}

func (c Calendar) loc() *time.Location {
	if c.Location == nil {
		return time.UTC
	}
	return c.Location
}

// windowsOn returns the working windows for the local date of t.
func (c Calendar) windowsOn(t time.Time) []Window {
	if c.Holidays[t.Format("2006-01-02")] {
		return nil
	}
	return c.Days[t.Weekday()]
}

func atMinute(day time.Time, minute int) time.Time {
	y, m, d := day.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, day.Location()).Add(time.Duration(minute) * time.Minute)
}

// maxDaysScan bounds the search so misconfigured calendars cannot loop forever.
const maxDaysScan = 3 * 366

// Add returns the instant reached after d of working time has elapsed from start.
func (c Calendar) Add(start time.Time, d time.Duration) time.Time {
	if d <= 0 {
		return start
	}
	if c.AlwaysOpen {
		return start.Add(d)
	}
	t := start.In(c.loc())
	remaining := d
	for i := 0; i < maxDaysScan; i++ {
		for _, w := range c.windowsOn(t) {
			ws, we := atMinute(t, w.Start), atMinute(t, w.End)
			if !t.Before(we) {
				continue
			}
			if t.Before(ws) {
				t = ws
			}
			avail := we.Sub(t)
			if remaining <= avail {
				return t.Add(remaining).In(start.Location())
			}
			remaining -= avail
			t = we
		}
		y, m, dd := t.Date()
		t = time.Date(y, m, dd+1, 0, 0, 0, 0, t.Location())
	}
	// Calendar has no reachable working time; fall back to wall-clock time.
	return start.Add(d)
}

// Between returns the working time elapsed between a and b (zero if b <= a).
func (c Calendar) Between(a, b time.Time) time.Duration {
	if !b.After(a) {
		return 0
	}
	if c.AlwaysOpen {
		return b.Sub(a)
	}
	t := a.In(c.loc())
	end := b.In(c.loc())
	var total time.Duration
	for i := 0; i < maxDaysScan && t.Before(end); i++ {
		for _, w := range c.windowsOn(t) {
			ws, we := atMinute(t, w.Start), atMinute(t, w.End)
			if we.After(end) {
				we = end
			}
			if t.After(ws) {
				ws = t
			}
			if we.After(ws) {
				total += we.Sub(ws)
			}
		}
		y, m, dd := t.Date()
		t = time.Date(y, m, dd+1, 0, 0, 0, 0, t.Location())
	}
	return total
}

// IsOpen reports whether t falls inside working hours.
func (c Calendar) IsOpen(t time.Time) bool {
	if c.AlwaysOpen {
		return true
	}
	lt := t.In(c.loc())
	minute := lt.Hour()*60 + lt.Minute()
	for _, w := range c.windowsOn(lt) {
		if minute >= w.Start && minute < w.End {
			return true
		}
	}
	return false
}
