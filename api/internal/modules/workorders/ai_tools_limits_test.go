package workorders

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
)

// --- rate limiter -----------------------------------------------------------

func TestAIRateLimiterSlidingWindow(t *testing.T) {
	l := newAIRateLimiter(3, time.Minute)
	t0 := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)

	for i := 0; i < 3; i++ {
		if !l.allow("u1", t0.Add(time.Duration(i)*time.Second)) {
			t.Fatalf("request %d should be allowed", i+1)
		}
	}
	if l.allow("u1", t0.Add(10*time.Second)) {
		t.Fatal("4th request inside the window must be rejected")
	}
	// Another user has an independent budget.
	if !l.allow("u2", t0.Add(10*time.Second)) {
		t.Fatal("other user should not be limited")
	}
	// Once the first request ages out of the window one slot frees up.
	if !l.allow("u1", t0.Add(time.Minute+time.Millisecond)) {
		t.Fatal("slot should free once the oldest request leaves the window")
	}
	if l.allow("u1", t0.Add(time.Minute+2*time.Millisecond)) {
		t.Fatal("only one slot should have freed")
	}
	// A rejected request does not consume budget: after the whole window passes
	// the user is fully reset.
	later := t0.Add(3 * time.Minute)
	for i := 0; i < 3; i++ {
		if !l.allow("u1", later) {
			t.Fatalf("after window reset request %d should be allowed", i+1)
		}
	}
}

func TestAIRateLimiterConcurrentSafe(t *testing.T) {
	l := newAIRateLimiter(20, time.Minute)
	now := time.Now()
	allowed := make(chan bool, 100)
	for i := 0; i < 100; i++ {
		go func() { allowed <- l.allow("u", now) }()
	}
	count := 0
	for i := 0; i < 100; i++ {
		if <-allowed {
			count++
		}
	}
	if count != 20 {
		t.Fatalf("expected exactly 20 allowed under concurrency, got %d", count)
	}
}

func TestAIToolsLLMEndpointsRateLimited(t *testing.T) {
	// The LLM is not configured, so each call stops early with a 400 — but it
	// still counts towards the per-user budget.
	t.Setenv("OPENROUTER_API_KEY", "")
	router := aiToolsRouter(t, massUpdateStub())
	for i := 0; i < aiToolsLLMRateLimit; i++ {
		resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/search/interpret",
			`{"question":""}`, []string{permUpdate})
		if resp.Code == http.StatusTooManyRequests {
			t.Fatalf("request %d unexpectedly rate limited", i+1)
		}
	}
	// The budget is shared across all LLM endpoints for the same user.
	for _, path := range []string{"/ai-tools/mass-update/preview", "/ai-tools/search/interpret", "/ai-tools/job-summary", "/ai-tools/email-draft"} {
		resp := partsAuditRequest(t, router, http.MethodPost, path, `{}`, []string{permUpdate})
		if resp.Code != http.StatusTooManyRequests {
			t.Fatalf("%s: got %d, want 429", path, resp.Code)
		}
		if resp.Header().Get("Retry-After") == "" {
			t.Fatalf("%s: missing Retry-After header", path)
		}
	}
	// Non-LLM endpoints are not rate limited.
	resp := partsAuditRequest(t, router, http.MethodGet, "/ai-tools/job-summary/stale", "", []string{permUpdate})
	if resp.Code == http.StatusTooManyRequests {
		t.Fatal("stale endpoint must not be rate limited")
	}
	resp = partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/apply",
		`{"operations":[{"reference_id":1,"op":"set_labour_total","labour_total":1}],"expected_updated_at":{"1":null}}`, []string{permUpdate})
	if resp.Code == http.StatusTooManyRequests {
		t.Fatal("apply must not be rate limited")
	}
}

// --- body size --------------------------------------------------------------

func TestAIToolsBodyTooLarge(t *testing.T) {
	big := `{"instruction":"` + strings.Repeat("a", aiToolsMaxBodyBytes+10) + `"}`
	router := aiToolsRouter(t, massUpdateStub())
	for _, path := range []string{
		"/ai-tools/mass-update/preview",
		"/ai-tools/mass-update/apply",
		"/ai-tools/search/interpret",
		"/ai-tools/search",
		"/ai-tools/email-draft",
	} {
		resp := partsAuditRequest(t, router, http.MethodPost, path, big, []string{permUpdate})
		if resp.Code != http.StatusRequestEntityTooLarge && resp.Code != http.StatusBadRequest {
			t.Fatalf("%s: got %d, want 413/400", path, resp.Code)
		}
	}
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/apply", big, []string{permUpdate})
	if resp.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("apply oversized body: got %d %s, want 413", resp.Code, resp.Body.String())
	}
}

// --- text length caps -------------------------------------------------------

func errorBody(t *testing.T, body []byte) string {
	t.Helper()
	var m map[string]string
	if err := json.Unmarshal(body, &m); err != nil {
		t.Fatalf("decode error body: %v (%s)", err, body)
	}
	return m["error"]
}

func TestMassUpdatePreviewInstructionTooLong(t *testing.T) {
	srv := mockLLMServer(t, `{"operations":[]}`)
	useMockLLM(t, srv)
	router := aiToolsRouter(t, massUpdateStub())

	// Exactly at the cap is fine (multi-byte runes count as one character).
	ok := strings.Repeat("é", aiToolsMaxTextChars)
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/preview",
		`{"instruction":"`+ok+`"}`, []string{permUpdate})
	if resp.Code != http.StatusOK {
		t.Fatalf("instruction at cap: got %d %s", resp.Code, resp.Body.String())
	}

	tooLong := strings.Repeat("a", aiToolsMaxTextChars+1)
	resp = partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/preview",
		`{"instruction":"`+tooLong+`"}`, []string{permUpdate})
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("long instruction: got %d, want 400", resp.Code)
	}
	if msg := errorBody(t, resp.Body.Bytes()); !strings.Contains(msg, "instruction") || !strings.Contains(msg, "2000") {
		t.Fatalf("unclear error: %q", msg)
	}
}

func TestEmailDraftNotesTooLong(t *testing.T) {
	router := aiToolsRouter(t, massUpdateStub())
	tooLong := strings.Repeat("a", aiToolsMaxTextChars+1)
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/email-draft",
		`{"work_order_id":1,"type":"custom","notes":"`+tooLong+`"}`, []string{permUpdate})
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("long notes: got %d, want 400", resp.Code)
	}
	if msg := errorBody(t, resp.Body.Bytes()); !strings.Contains(msg, "notes") || !strings.Contains(msg, "2000") {
		t.Fatalf("unclear error: %q", msg)
	}
}

func TestMassUpdateApplyFieldTooLong(t *testing.T) {
	tooLong := strings.Repeat("a", aiToolsMaxTextChars+1)
	for _, field := range []string{"item_name", "quantity_text"} {
		stub := massUpdateStub()
		router := aiToolsRouter(t, stub)
		op := fmt.Sprintf(`{"reference_id":1,"op":"add_line_item","item_name":"x","%s":"%s"}`, field, tooLong)
		if field == "item_name" {
			op = fmt.Sprintf(`{"reference_id":1,"op":"add_line_item","item_name":"%s"}`, tooLong)
		}
		resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/apply",
			`{"operations":[`+op+`],"expected_updated_at":{"1":null}}`, []string{permUpdate})
		if resp.Code != http.StatusBadRequest {
			t.Fatalf("%s too long: got %d, want 400", field, resp.Code)
		}
		if msg := errorBody(t, resp.Body.Bytes()); !strings.Contains(msg, field) {
			t.Fatalf("%s: unclear error %q", field, msg)
		}
		if len(stub.applyCalls) != 0 {
			t.Fatalf("%s: nothing should be applied", field)
		}
	}
}

// --- job / op caps ----------------------------------------------------------

// opsJSON builds n set_labour_total ops spread over the given job ids.
func opsJSON(jobs []int, perJob int) string {
	parts := make([]string, 0, len(jobs)*perJob)
	for _, j := range jobs {
		for k := 0; k < perJob; k++ {
			parts = append(parts, fmt.Sprintf(`{"reference_id":%d,"op":"set_labour_total","labour_total":%d}`, j, k+1))
		}
	}
	return "[" + strings.Join(parts, ",") + "]"
}

func seq(n int) []int {
	out := make([]int, n)
	for i := range out {
		out[i] = i + 1
	}
	return out
}

func TestValidateMassUpdateOpsCaps(t *testing.T) {
	mk := func(jobs, perJob int) []MassUpdateOp {
		var ops []MassUpdateOp
		for j := 1; j <= jobs; j++ {
			for k := 0; k < perJob; k++ {
				ops = append(ops, MassUpdateOp{ReferenceID: int32(j), Op: massOpSetLabourTotal, LabourTotal: ptrFloat(float64(k))})
			}
		}
		return ops
	}
	cases := []struct {
		name    string
		ops     []MassUpdateOp
		wantErr string
	}{
		{"50 jobs ok", mk(massUpdateJobCap, 1), ""},
		{"51 jobs", mk(massUpdateJobCap+1, 1), "51 jobs"},
		{"200 ops ok", mk(10, massUpdateOpsPerJobCap), ""},
		{"201 ops", append(mk(10, massUpdateOpsPerJobCap), MassUpdateOp{ReferenceID: 11, Op: massOpSetLabourTotal}), "201 changes"},
		{"20 per job ok", mk(1, massUpdateOpsPerJobCap), ""},
		{"21 per job", mk(1, massUpdateOpsPerJobCap+1), "job #1"},
	}
	for _, tc := range cases {
		err := validateMassUpdateOps(tc.ops)
		if tc.wantErr == "" {
			if err != nil {
				t.Fatalf("%s: unexpected error %v", tc.name, err)
			}
			continue
		}
		if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
			t.Fatalf("%s: got %v, want error containing %q", tc.name, err, tc.wantErr)
		}
	}
}

func TestMassUpdateApplyTooManyJobsRejected(t *testing.T) {
	stub := massUpdateStub()
	router := aiToolsRouter(t, stub)
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/apply",
		`{"operations":`+opsJSON(seq(massUpdateJobCap+1), 1)+`,"expected_updated_at":{}}`, []string{permUpdate})
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("51 jobs: got %d %s, want 400", resp.Code, resp.Body.String())
	}
	if msg := errorBody(t, resp.Body.Bytes()); !strings.Contains(msg, "50") {
		t.Fatalf("unclear error: %q", msg)
	}
	if len(stub.applyCalls) != 0 {
		t.Fatalf("no job may be applied when the request is over the cap, got %v", stub.applyCalls)
	}
}

func TestMassUpdateApplyTooManyOpsRejected(t *testing.T) {
	router := aiToolsRouter(t, massUpdateStub())
	// 11 jobs × 19 ops = 209 total (> 200) while each job stays under 20.
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/apply",
		`{"operations":`+opsJSON(seq(11), 19)+`,"expected_updated_at":{}}`, []string{permUpdate})
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("209 ops: got %d, want 400", resp.Code)
	}
	resp = partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/apply",
		`{"operations":`+opsJSON([]int{1}, massUpdateOpsPerJobCap+1)+`,"expected_updated_at":{"1":null}}`, []string{permUpdate})
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("21 ops on one job: got %d, want 400", resp.Code)
	}
}

func TestMassUpdatePreviewTooManyJobsRejectedNotTruncated(t *testing.T) {
	srv := mockLLMServer(t, `{"operations":`+opsJSON(seq(massUpdateJobCap+1), 1)+`}`)
	useMockLLM(t, srv)
	router := aiToolsRouter(t, massUpdateStub())
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/preview",
		`{"instruction":"set labour everywhere"}`, []string{permUpdate})
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("51 jobs from LLM: got %d %s, want 400", resp.Code, resp.Body.String())
	}
	if msg := errorBody(t, resp.Body.Bytes()); !strings.Contains(msg, "50") {
		t.Fatalf("unclear error: %q", msg)
	}
}

func TestMassUpdatePreviewAtJobCapReturnsAllJobs(t *testing.T) {
	srv := mockLLMServer(t, `{"operations":`+opsJSON(seq(massUpdateJobCap), 1)+`}`)
	useMockLLM(t, srv)
	router := aiToolsRouter(t, massUpdateStub())
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/preview",
		`{"instruction":"set labour everywhere"}`, []string{permUpdate})
	if resp.Code != http.StatusOK {
		t.Fatalf("50 jobs: got %d %s", resp.Code, resp.Body.String())
	}
	var body massUpdatePreviewResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Rows) != massUpdateJobCap {
		t.Fatalf("expected %d rows, got %d", massUpdateJobCap, len(body.Rows))
	}
}
