package workorders

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
)

// Job-number search. Job numbers are work_orders.reference_id. They are
// matched exactly (job_ids) or by trailing digits (job_suffix), never through
// the free-text "contains" filter, which would turn "31200" into a fuzzy
// substring match across every text column.

const (
	aiSearchMaxJobIDs    = 50
	aiSearchMaxJobSuffix = 10
)

// jobNumberQueryRe matches a question that consists only of one or more job
// numbers, optionally prefixed by "job"/"jobs"/"job number"/"job no." and/or
// "#", separated by commas, "&", "and" or whitespace.
var jobNumberQueryRe = regexp.MustCompile(
	`(?i)^(?:jobs?(?:\s+(?:numbers?|nos?\.?))?\s*)?#?\s*\d+(?:\s*(?:,|&|\band\b)?\s*#?\s*\d+)*$`)

var digitsRe = regexp.MustCompile(`\d+`)

// parseJobNumberQuery returns the deduplicated job numbers when the whole
// question is a job-number lookup ("31200", "#31200", "job 31200",
// "jobs 31200, 31201", "job number 31200"). It reports false for anything
// else, including numbers that cannot be job ids or more than
// aiSearchMaxJobIDs distinct numbers; those fall through to the LLM.
func parseJobNumberQuery(question string) ([]int, bool) {
	q := strings.TrimSpace(question)
	if !jobNumberQueryRe.MatchString(q) {
		return nil, false
	}
	ids, err := cleanJobIDs(nil, digitsRe.FindAllString(q, -1))
	if err != nil || len(ids) == 0 {
		return nil, false
	}
	out := make([]int, len(ids))
	for i, id := range ids {
		out[i] = int(id)
	}
	return out, true
}

// jobNumberInterpretFilters builds the interpret result for a job-number-only
// question: just job_ids, with the same defaults normalization would apply.
func jobNumberInterpretFilters(question string) (aiResolvedSearchFilters, bool) {
	ids, ok := parseJobNumberQuery(question)
	if !ok {
		return aiResolvedSearchFilters{}, false
	}
	f := aiResolvedSearchFilters{Warranty: aiWarrantyAny, GroupBy: aiGroupNone, Limit: aiSearchDefaultLimit}
	for _, id := range ids {
		f.JobIDs = append(f.JobIDs, int32(id))
	}
	return f, true
}

// cleanJobIDs validates and deduplicates job ids (order preserved). Values may
// come from the JSON filter (ints) or from parsed question text (strings).
func cleanJobIDs(ints []int, strs []string) ([]int32, error) {
	raw := make([]int64, 0, len(ints)+len(strs))
	for _, v := range ints {
		raw = append(raw, int64(v))
	}
	for _, s := range strs {
		v, err := strconv.ParseInt(s, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("job_ids must be positive job numbers")
		}
		raw = append(raw, v)
	}
	seen := make(map[int64]bool, len(raw))
	out := make([]int32, 0, len(raw))
	for _, v := range raw {
		if v <= 0 || v > math.MaxInt32 {
			return nil, fmt.Errorf("job_ids must be positive job numbers")
		}
		if seen[v] {
			continue
		}
		seen[v] = true
		if len(out) == aiSearchMaxJobIDs {
			return nil, fmt.Errorf("too many job_ids (max %d)", aiSearchMaxJobIDs)
		}
		out = append(out, int32(v))
	}
	if len(out) == 0 {
		return nil, nil
	}
	return out, nil
}

// cleanJobSuffix accepts only digits (so it is safe as a LIKE suffix without
// escaping) up to aiSearchMaxJobSuffix of them.
func cleanJobSuffix(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", nil
	}
	if len(s) > aiSearchMaxJobSuffix {
		return "", fmt.Errorf("job_suffix is too long (max %d digits)", aiSearchMaxJobSuffix)
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return "", fmt.Errorf("job_suffix must contain digits only")
		}
	}
	return s, nil
}

// jobIDsToInts converts resolved ids back to the public filter shape.
func jobIDsToInts(ids []int32) []int {
	if len(ids) == 0 {
		return nil
	}
	out := make([]int, len(ids))
	for i, id := range ids {
		out[i] = int(id)
	}
	return out
}

// describeJobFilters renders the job-number part of a filter explanation.
func describeJobFilters(f aiResolvedSearchFilters) []string {
	parts := make([]string, 0, 2)
	if len(f.JobIDs) > 0 {
		nums := make([]string, len(f.JobIDs))
		for i, id := range f.JobIDs {
			nums[i] = fmt.Sprintf("#%d", id)
		}
		parts = append(parts, strings.Join(nums, ", "))
	}
	if f.JobSuffix != "" {
		parts = append(parts, fmt.Sprintf("with job number ending in %s", f.JobSuffix))
	}
	return parts
}
