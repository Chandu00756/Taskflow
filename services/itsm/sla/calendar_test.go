package sla

import (
	"testing"
	"time"
)

func weekdayCal(t *testing.T, holidays ...Holiday) Calendar {
	t.Helper()
	days := map[string][]DaySpec{}
	for _, d := range []string{"monday", "tuesday", "wednesday", "thursday", "friday"} {
		days[d] = []DaySpec{{Start: "09:00", End: "17:00"}}
	}
	cal, err := NewCalendar("UTC", false, days, holidays)
	if err != nil {
		t.Fatal(err)
	}
	return cal
}

func ts(s string) time.Time {
	t, err := time.Parse("2006-01-02 15:04", s)
	if err != nil {
		panic(err)
	}
	return t
}

func TestAddWithinSameDay(t *testing.T) {
	cal := weekdayCal(t)
	got := cal.Add(ts("2026-10-12 10:00"), 2*time.Hour) // Monday
	if want := ts("2026-10-12 12:00"); !got.Equal(want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestAddRollsOverNightAndWeekend(t *testing.T) {
	cal := weekdayCal(t)
	// Friday 16:00 + 2h business => Monday 10:00
	got := cal.Add(ts("2026-10-16 16:00"), 2*time.Hour)
	if want := ts("2026-10-19 10:00"); !got.Equal(want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestAddStartsBeforeOpening(t *testing.T) {
	cal := weekdayCal(t)
	got := cal.Add(ts("2026-10-13 06:30"), 30*time.Minute)
	if want := ts("2026-10-13 09:30"); !got.Equal(want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestAddSkipsHolidays(t *testing.T) {
	cal := weekdayCal(t, Holiday{Date: "2026-10-13", Name: "Founders day"})
	got := cal.Add(ts("2026-10-12 16:00"), 2*time.Hour)
	if want := ts("2026-10-14 10:00"); !got.Equal(want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestBetween(t *testing.T) {
	cal := weekdayCal(t)
	got := cal.Between(ts("2026-10-16 16:00"), ts("2026-10-19 10:00"))
	if got != 2*time.Hour {
		t.Fatalf("got %v want 2h", got)
	}
	if cal.Between(ts("2026-10-19 10:00"), ts("2026-10-16 16:00")) != 0 {
		t.Fatal("reverse interval must be zero")
	}
}

func TestAlwaysOpen(t *testing.T) {
	cal := TwentyFourSeven()
	start := ts("2026-10-17 23:00")
	if got := cal.Add(start, 3*time.Hour); !got.Equal(start.Add(3 * time.Hour)) {
		t.Fatalf("got %v", got)
	}
	if !cal.IsOpen(start) {
		t.Fatal("24x7 calendar must be open")
	}
}

func TestIsOpen(t *testing.T) {
	cal := weekdayCal(t)
	if !cal.IsOpen(ts("2026-10-12 09:00")) || cal.IsOpen(ts("2026-10-12 17:00")) || cal.IsOpen(ts("2026-10-17 12:00")) {
		t.Fatal("unexpected open state")
	}
}

func TestInvalidCalendar(t *testing.T) {
	if _, err := NewCalendar("UTC", false, map[string][]DaySpec{"monday": {{Start: "17:00", End: "09:00"}}}, nil); err == nil {
		t.Fatal("expected error for inverted window")
	}
	if _, err := NewCalendar("UTC", false, nil, nil); err == nil {
		t.Fatal("expected error for empty calendar")
	}
	if _, err := ParseClock("25:00"); err == nil {
		t.Fatal("expected error for invalid clock")
	}
}

func TestTimeZone(t *testing.T) {
	days := map[string][]DaySpec{"monday": {{Start: "09:00", End: "17:00"}}}
	cal, err := NewCalendar("Asia/Kolkata", false, days, nil)
	if err != nil {
		t.Fatal(err)
	}
	// Monday 03:30 UTC == 09:00 IST
	got := cal.Add(ts("2026-10-12 03:30"), time.Hour)
	if want := ts("2026-10-12 04:30"); !got.Equal(want) {
		t.Fatalf("got %v want %v", got, want)
	}
}
