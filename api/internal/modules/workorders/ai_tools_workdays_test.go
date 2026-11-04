package workorders

import (
	"testing"
	"time"
)

func TestWorkdaysBetween(t *testing.T) {
	loc := torontoLocation()
	// 2024-01-01 is a Monday.
	day := func(y int, m time.Month, d int) time.Time {
		return time.Date(y, m, d, 12, 0, 0, 0, loc)
	}

	cases := []struct {
		name  string
		start time.Time
		end   time.Time
		want  int
	}{
		{"same day", day(2024, 1, 1), day(2024, 1, 1), 0},
		{"mon to tue", day(2024, 1, 1), day(2024, 1, 2), 1},
		{"mon to fri", day(2024, 1, 1), day(2024, 1, 5), 4},
		{"fri to mon skips weekend", day(2024, 1, 5), day(2024, 1, 8), 1},
		{"fri to sat skips weekend", day(2024, 1, 5), day(2024, 1, 6), 0},
		{"fri to sun skips weekend", day(2024, 1, 5), day(2024, 1, 7), 0},
		{"sat to mon", day(2024, 1, 6), day(2024, 1, 8), 1},
		{"full week mon to next mon", day(2024, 1, 1), day(2024, 1, 8), 5},
		{"two weeks", day(2024, 1, 1), day(2024, 1, 15), 10},
		{"end before start", day(2024, 1, 5), day(2024, 1, 1), 0},
		{"across dst spring forward", day(2024, 3, 8), day(2024, 3, 11), 1}, // Fri -> Mon, DST starts Sun Mar 10
		{"wed to next wed", day(2024, 1, 3), day(2024, 1, 10), 5},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := WorkdaysBetween(tc.start, tc.end, loc); got != tc.want {
				t.Fatalf("WorkdaysBetween(%s) = %d; want %d", tc.name, got, tc.want)
			}
		})
	}
}

func TestWorkdaysBetweenUsesTorontoCalendarDate(t *testing.T) {
	loc := torontoLocation()
	// 2024-01-01T23:30 Toronto is still Monday locally even though it is
	// 2024-01-02 in UTC. End at Wednesday noon Toronto => Tue + Wed = 2 workdays.
	start := time.Date(2024, 1, 1, 23, 30, 0, 0, loc)
	end := time.Date(2024, 1, 3, 12, 0, 0, 0, loc)
	if got := WorkdaysBetween(start, end, loc); got != 2 {
		t.Fatalf("got %d; want 2", got)
	}
}

func TestWorkdaysBetweenNilLocation(t *testing.T) {
	start := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2024, 1, 5, 0, 0, 0, 0, time.UTC)
	if got := WorkdaysBetween(start, end, nil); got != 4 {
		t.Fatalf("got %d; want 4", got)
	}
}
