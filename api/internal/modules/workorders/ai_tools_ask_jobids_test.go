package workorders

import (
	"reflect"
	"strconv"
	"strings"
	"testing"
)

func TestParseAskJobIDs(t *testing.T) {
	for _, tc := range []struct {
		in   string
		want []int64
	}{
		// Required examples.
		{"jobs 275、15 and 27501", []int64{275, 15, 27501}},
		{"#275, 15, 27501", []int64{275, 15, 27501}},
		{"update 2 jobs", nil},
		{"set job 15 to Finished", []int64{15}},
		{"$80 labour on #31225", []int64{31225}},
		{"call 416-555-1234", nil},

		// Markers.
		{"#15", []int64{15}},
		{"job #7 set status", []int64{7}},
		{"Job 7", []int64{7}},
		{"JOBS 9 and 10", []int64{9, 10}},
		{"job no 15", []int64{15}},
		{"job no. 15", []int64{15}},
		{"job number 15 and 16", []int64{15, 16}},
		{"job: 15", []int64{15}},
		{"ref 31225", []int64{31225}},
		{"ref #5", []int64{5}},
		{"job15", []int64{15}},
		{"work order 42", []int64{42}},
		{"工單15改做完成", []int64{15}},
		{"單號 31225", []int64{31225}},
		{"＃15", []int64{15}},
		{"show job 1", []int64{1}},

		// Lists.
		{"275, 15 and 27501", []int64{275, 15, 27501}},
		{"275 & 15", []int64{275, 15}},
		{"275和15", []int64{275, 15}},
		{"275 同 15", []int64{275, 15}},
		{"jobs 275/15", []int64{275, 15}},
		{"#275, #15, and #27501", []int64{275, 15, 27501}},
		{"jobs 31225，31226", []int64{31225, 31226}},
		{"Jobs #275, #27501: update both to Finished", []int64{275, 27501}},
		{"set jobs 3, 4 or 5 to Finished", []int64{3, 4, 5}},

		// Dedupe, order.
		{"#15 #15 and #9", []int64{15, 9}},
		{"#20 then #10", []int64{20, 10}},

		// Not jobs: counts.
		{"3 items", nil},
		{"2 張", nil},
		{"2張單", nil},
		{"show me 5 jobs", nil},
		{"job 15 has 2 units", []int64{15}},
		{"in 3 days", nil},

		// Not jobs: money.
		{"labour $80", nil},
		{"80 dollars", nil},
		{"set labour to 80.50 on job 31225", []int64{31225}},
		{"$80, $90 on job 7", []int64{7}},
		{"80蚊", nil},
		{"10% off job 12", []int64{12}},

		// Not jobs: quantities.
		{"qty 2", nil},
		{"qty: 2 belt on job 12", []int64{12}},
		{"x2", nil},
		{"2x belt kit", nil},
		{"add belt × 2 to job 8", []int64{8}},

		// Not jobs: times and dates.
		{"at 10:30", nil},
		{"by 3pm", nil},
		{"by 3 pm", nil},
		{"on Nov 12", nil},
		{"on 12 November", nil},
		{"on 2026-11-12", nil},
		{"on 12/11/2026", nil},
		{"on 12/11", nil},
		{"12月3號", nil},
		{"in 2026", nil},

		// Not jobs: phones and model numbers.
		{"4165551234", nil},
		{"call (416) 555 1234", nil},
		{"RX-V671 on job 140", []int64{140}},
		{"PL-12D", nil},
		{"the 2nd one", nil},

		// No marker, single number.
		{"set 15 to Finished", nil},
		{"hello", nil},
		{"", nil},
		{"job #", nil},
	} {
		got := parseAskJobIDs(tc.in)
		if len(got) == 0 && len(tc.want) == 0 {
			if got == nil {
				t.Errorf("%q: result must be non-nil", tc.in)
			}
			continue
		}
		if !reflect.DeepEqual(got, tc.want) {
			t.Errorf("%q: got %v, want %v", tc.in, got, tc.want)
		}
	}
}

func TestParseAskJobIDsCap(t *testing.T) {
	parts := make([]string, 0, 80)
	for i := 1; i <= 80; i++ {
		parts = append(parts, "#"+strconv.Itoa(i))
	}
	got := parseAskJobIDs("jobs " + strings.Join(parts, ", "))
	if len(got) != askMaxReferenceIDs || got[0] != 1 || got[askMaxReferenceIDs-1] != askMaxReferenceIDs {
		t.Fatalf("got %d ids: %v", len(got), got)
	}
}

func TestIsAskFollowUp(t *testing.T) {
	yes := []string{
		"update both to Finished", "set those to Finished", "those jobs", "these jobs",
		"move them to shelf A", "the ones I just asked", "the ones you showed", "same jobs, labour $80",
		"that job", "set it to Finished", "sum up charges for them", "Update Both",
		"呢啲改做完成", "嗰啲", "兩張都改做完成", "啱啱嗰啲",
	}
	no := []string{
		"set job 15 to Finished", "show all jobs for Jane", "show parts requests", "what is it",
		"is it raining", "hello", "Sum up the charges on job #", "item", "bother",
	}
	for _, s := range yes {
		if !isAskFollowUp(s) {
			t.Errorf("%q: want follow-up", s)
		}
	}
	for _, s := range no {
		if isAskFollowUp(s) {
			t.Errorf("%q: want not follow-up", s)
		}
	}
}

func TestIsAskUpdateVerb(t *testing.T) {
	for _, s := range []string{"set those", "Update both", "change them", "move them", "add labour", "mark it done", "改做完成"} {
		if !isAskUpdateVerb(s) {
			t.Errorf("%q: want update verb", s)
		}
	}
	for _, s := range []string{"show them", "sum up charges for those", "settings", "reset"} {
		if isAskUpdateVerb(s) {
			t.Errorf("%q: want no update verb", s)
		}
	}
}

func TestAskNotice(t *testing.T) {
	for _, tc := range []struct {
		found, missing []int64
		want           string
	}{
		{[]int64{275, 27501}, []int64{15}, "Found #275 and #27501. No job #15."},
		{nil, []int64{15}, "No job #15."},
		{nil, []int64{15, 16}, "No jobs #15 or #16."},
		{[]int64{1}, []int64{15, 16, 17}, "Found #1. No jobs #15, #16 or #17."},
		{[]int64{1, 2, 3}, []int64{4}, "Found #1, #2 and #3. No job #4."},
		{[]int64{1, 2}, nil, ""},
	} {
		if got := askNotice(tc.found, tc.missing); got != tc.want {
			t.Errorf("askNotice(%v, %v) = %q, want %q", tc.found, tc.missing, got, tc.want)
		}
	}
}

func TestAskPreviewInstruction(t *testing.T) {
	if got := askPreviewInstruction([]int64{275, 27501}, "update both to Finished"); got != "Jobs #275, #27501: update both to Finished" {
		t.Fatalf("got %q", got)
	}
	if got := askPreviewInstruction([]int64{15}, "set it to Finished"); got != "Job #15: set it to Finished" {
		t.Fatalf("got %q", got)
	}
}
