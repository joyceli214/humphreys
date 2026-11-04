package workorders

import "time"

// aiToolsTimezone is the business timezone used for all AI Tools workday math.
const aiToolsTimezone = "America/Toronto"

// torontoLocation returns the America/Toronto location, falling back to a fixed
// Eastern offset if the zoneinfo database is unavailable.
func torontoLocation() *time.Location {
	loc, err := time.LoadLocation(aiToolsTimezone)
	if err != nil {
		return time.FixedZone("EST", -5*60*60)
	}
	return loc
}

// WorkdaysBetween counts the weekdays (Mon-Fri) that have elapsed from start to
// end, evaluated on calendar dates in loc. Weekends are skipped. The start date
// itself is never counted; every later weekday date up to and including the end
// date counts as one workday. If end is on or before start (by date), the result
// is 0. This is a pure function so it can be unit tested for weekend edges.
func WorkdaysBetween(start, end time.Time, loc *time.Location) int {
	if loc == nil {
		loc = time.UTC
	}
	// Reduce both instants to a date-only value in UTC so day arithmetic is
	// immune to DST transitions, while keeping the Toronto calendar date.
	s := utcDateOf(start, loc)
	e := utcDateOf(end, loc)
	if !e.After(s) {
		return 0
	}
	// Count weekdays in the inclusive range [s+1 day, e].
	return weekdaysInclusive(s.AddDate(0, 0, 1), e)
}

// utcDateOf returns midnight-UTC of the calendar date that the instant falls on
// in loc. Weekday() is stable for a midnight-UTC date regardless of zone.
func utcDateOf(t time.Time, loc *time.Location) time.Time {
	y, m, d := t.In(loc).Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// weekdaysInclusive counts the Mon-Fri days in the inclusive date range [a, b].
// Both arguments must be midnight-UTC date values. Returns 0 if b is before a.
func weekdaysInclusive(a, b time.Time) int {
	if b.Before(a) {
		return 0
	}
	days := int(b.Sub(a).Hours()/24) + 1
	fullWeeks := days / 7
	count := fullWeeks * 5
	remainder := days % 7
	weekday := int(a.Weekday()) // Sunday = 0 ... Saturday = 6
	for i := 0; i < remainder; i++ {
		switch (weekday + i) % 7 {
		case int(time.Saturday), int(time.Sunday):
		default:
			count++
		}
	}
	return count
}
