package workorders

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

func staleStub() *aiToolsStub {
	now := time.Now()
	idle := now.AddDate(0, 0, -20) // ~14 workdays idle, well past 5
	recent := now                  // 0 workdays idle
	return &aiToolsStub{
		stale: []AIStaleCandidate{
			{ReferenceID: 1, CustomerName: "Jane Doe", ItemName: "Receiver", StatusName: "Received",
				StatusGroup: "to_do", LastActivity: &idle},
			{ReferenceID: 2, CustomerName: "John Roe", ItemName: "Turntable", StatusName: "Finished",
				StatusGroup: "completed", StatusChangeAt: &idle, LastActivity: &idle},
			{ReferenceID: 3, CustomerName: "Fresh Job", ItemName: "Amp", StatusName: "Received",
				StatusGroup: "to_do", LastActivity: &recent},
		},
	}
}

func TestJobSummaryStale(t *testing.T) {
	router := aiToolsRouter(t, staleStub())
	resp := partsAuditRequest(t, router, http.MethodGet, "/ai-tools/job-summary/stale", "", []string{permUpdate})
	if resp.Code != http.StatusOK {
		t.Fatalf("stale: got %d %s", resp.Code, resp.Body.String())
	}
	var body jobSummaryStaleResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.UnhandledCount != 1 || body.FinishedCount != 1 {
		t.Fatalf("counts wrong: unhandled=%d finished=%d", body.UnhandledCount, body.FinishedCount)
	}
	if len(body.Rows) != 2 {
		t.Fatalf("expected 2 idle rows (fresh job excluded), got %d: %+v", len(body.Rows), body.Rows)
	}
	if body.ThresholdWorkdays != 5 {
		t.Fatalf("default threshold = %d", body.ThresholdWorkdays)
	}
}

func TestJobSummaryStaleForbidden(t *testing.T) {
	router := aiToolsRouter(t, staleStub())
	if resp := partsAuditRequest(t, router, http.MethodGet, "/ai-tools/job-summary/stale", "", []string{permStatusUpdate}); resp.Code != http.StatusForbidden {
		t.Fatalf("staff stale: got %d, want 403", resp.Code)
	}
}

func TestJobSummary(t *testing.T) {
	srv := mockLLMServer(t, `{"summary":"2 jobs idle.","jobs":[
		{"reference_id":1,"suggested_next_step":"Call the customer for an update."},
		{"reference_id":2,"suggested_next_step":"Remind customer to pick up."}
	]}`)
	useMockLLM(t, srv)

	router := aiToolsRouter(t, staleStub())
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/job-summary", `{}`, []string{permUpdate})
	if resp.Code != http.StatusOK {
		t.Fatalf("summary: got %d %s", resp.Code, resp.Body.String())
	}
	var body jobSummaryResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Summary == "" || body.Model != "mock-model" {
		t.Fatalf("summary metadata wrong: %+v", body)
	}
	foundStep := false
	for _, row := range body.Rows {
		if row.ReferenceID == 1 && row.SuggestedNextStep == "Call the customer for an update." {
			foundStep = true
		}
	}
	if !foundStep {
		t.Fatalf("suggested next step not merged into rows: %+v", body.Rows)
	}
}

func TestJobSummaryForbidden(t *testing.T) {
	router := aiToolsRouter(t, staleStub())
	if resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/job-summary", `{}`, []string{permLocationUpdate}); resp.Code != http.StatusForbidden {
		t.Fatalf("staff summary: got %d, want 403", resp.Code)
	}
}

func TestClassifyStaleWeekendThreshold(t *testing.T) {
	loc := torontoLocation()
	// Friday reference "now"; a job last touched the previous Friday is exactly
	// 5 workdays idle (weekend skipped), so it meets the default threshold.
	now := time.Date(2024, 1, 12, 12, 0, 0, 0, loc) // Friday
	lastWeek := time.Date(2024, 1, 5, 12, 0, 0, 0, loc)
	cands := []AIStaleCandidate{
		{ReferenceID: 1, StatusGroup: "to_do", LastActivity: &lastWeek},
	}
	rows, unhandled, finished := classifyStaleCandidates(cands, now, 5, loc)
	if unhandled != 1 || finished != 0 || len(rows) != 1 || rows[0].DaysIdle != 5 {
		t.Fatalf("weekend workday bucketing wrong: rows=%+v unhandled=%d finished=%d", rows, unhandled, finished)
	}
}
