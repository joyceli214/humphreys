package workorders

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"

	"humphreys/api/internal/config"
	"humphreys/api/internal/domain"
	"humphreys/api/internal/middleware"
	"humphreys/api/internal/modules/aisettings"
	"humphreys/api/internal/modules/uploads"

	"github.com/gin-gonic/gin"
)

// testUploadsStore returns an enabled uploads handler whose S3 endpoint is a
// local recorder, plus the list of DELETE paths it received.
func testUploadsStore(t *testing.T) (*uploads.Handler, string, func() []string) {
	t.Helper()
	var mu sync.Mutex
	var deleted []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			mu.Lock()
			deleted = append(deleted, r.URL.Path)
			mu.Unlock()
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(srv.Close)
	store := uploads.New(config.Config{
		S3Endpoint:        srv.URL,
		S3AccessKeyID:     "test",
		S3SecretAccessKey: "test",
		S3Bucket:          "bucket",
	})
	base := srv.URL + "/bucket/"
	return store, base, func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), deleted...)
	}
}

const testActorID = "00000000-0000-0000-0000-000000000001"

func TestPrepareWorkDoneForApplyImages(t *testing.T) {
	store, base, _ := testUploadsStore(t)
	ctx := context.Background()

	for name, text := range map[string]string{
		"other job":        "Done ![p](" + base + "markdown/2/a.png)",
		"other user temp":  "Done ![p](" + base + "markdown-temp/someone-else/a.png)",
		"other job in img": `Done <img src="` + base + `markdown/99/a.png">`,
	} {
		if _, err := prepareWorkDoneForApply(ctx, store, text, 1, testActorID); !errors.Is(err, errWorkDoneForeignImage) {
			t.Fatalf("%s: err = %v, want errWorkDoneForeignImage", name, err)
		}
	}

	// This job's own image (signed URL) is normalized to the storage URL;
	// external images are left alone.
	text := "  Replaced belt ![p](" + base + "markdown/1/a.png?X-Amz-Signature=abc) ![e](https://example.com/x.png)  "
	got, err := prepareWorkDoneForApply(ctx, store, text, 1, testActorID)
	if err != nil {
		t.Fatal(err)
	}
	want := "Replaced belt ![p](" + base + "markdown/1/a.png) ![e](https://example.com/x.png)"
	if got != want {
		t.Fatalf("got %q\nwant %q", got, want)
	}

	// No store (uploads not configured): text is only trimmed.
	got, err = prepareWorkDoneForApply(ctx, nil, "  plain  ", 1, testActorID)
	if err != nil || got != "plain" {
		t.Fatalf("nil store: %q %v", got, err)
	}
}

func workDoneImageRouter(t *testing.T, repo Repository, store *uploads.Handler) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	group := router.Group("", middleware.Auth("test-secret"))
	h := &Handler{service: NewService(repo), httpClient: &http.Client{}, uploads: store}
	RegisterAIToolsRoutes(group, h)
	return router
}

func TestMassUpdateApplyWorkDoneImageHandling(t *testing.T) {
	store, base, deleted := testUploadsStore(t)
	stub := massUpdateStub()
	stub.details[2] = domain.WorkOrderDetail{ReferenceID: 2, WorkDone: ptrStr("Old ![o](" + base + "markdown/2/old.png)")}
	router := workDoneImageRouter(t, stub, store)

	body, _ := json.Marshal(map[string]any{
		"operations": []map[string]any{
			{"reference_id": 1, "op": "generate_work_done", "work_done_text": "Stolen ![p](" + base + "markdown/2/old.png)"},
			{"reference_id": 2, "op": "generate_work_done", "work_done_text": "New ![p](" + base + "markdown/2/new.png?sig=1)"},
		},
		"expected_updated_at": map[string]any{"1": nil, "2": nil},
	})
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/apply", string(body), []string{permUpdate})
	if resp.Code != http.StatusOK {
		t.Fatalf("apply: %d %s", resp.Code, resp.Body.String())
	}
	var out massUpdateApplyResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Results) != 2 || out.Results[0].Success || out.Results[0].Error != workDoneForeignImageMessage || !out.Results[1].Success {
		t.Fatalf("results = %+v", out.Results)
	}
	if _, ok := stub.appliedOps[1]; ok {
		t.Fatal("job with another job's image must not be applied")
	}
	got := stub.appliedOps[2]
	if len(got) != 1 || got[0].WorkDoneText == nil || *got[0].WorkDoneText != "New ![p]("+base+"markdown/2/new.png)" {
		t.Fatalf("applied = %+v", got)
	}
	if d := deleted(); len(d) != 1 || !strings.HasSuffix(d[0], "/bucket/markdown/2/old.png") {
		t.Fatalf("deleted = %v, want old.png removed", d)
	}
}

func TestMassUpdatePreviewWorkDoneExistingFlags(t *testing.T) {
	srv := mockLLMServer(t, `{"operations":[
		{"reference_id":1,"op":"generate_work_done"},
		{"reference_id":2,"op":"generate_work_done"},
		{"reference_id":123,"op":"generate_work_done"},
		{"reference_id":123,"op":"set_status","status_name":"Finished"}
	]}`)
	useMockLLM(t, srv)
	stub := massUpdateStub()
	stub.details[1] = domain.WorkOrderDetail{ReferenceID: 1, WorkDone: ptrStr("   ")}
	stub.details[2] = domain.WorkOrderDetail{ReferenceID: 2, WorkDone: ptrStr("Old notes")}
	d := stub.details[123]
	d.WorkDone = ptrStr("See ![p](https://cdn.example/bucket/markdown/123/a.png)")
	stub.details[123] = d
	router := workDoneRouter(t, stub, func(context.Context, aisettings.Settings, int) (string, error) { return "Generated", nil })

	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/preview", `{"instruction":"generate work done"}`, []string{permUpdate})
	if resp.Code != http.StatusOK {
		t.Fatalf("preview: %d %s", resp.Code, resp.Body.String())
	}
	var body struct {
		Rows []map[string]any `json:"rows"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Rows) != 4 {
		t.Fatalf("rows = %v", body.Rows)
	}
	check := func(i int, existing, images, selected bool, warning string) {
		t.Helper()
		r := body.Rows[i]
		if r["has_existing_work_done"] != existing || r["existing_work_done_has_images"] != images || r["default_selected"] != selected {
			t.Fatalf("row %d = %v", i, r)
		}
		got, _ := r["warning"].(string)
		if got != warning {
			t.Fatalf("row %d warning = %q, want %q", i, got, warning)
		}
	}
	check(0, false, false, true, "")
	check(1, true, false, false, "Has existing Work Done; applying replaces it")
	check(2, true, true, false, "Has existing Work Done; applying replaces it (contains images)")
	// Non-work-done rows stay selected by default.
	if body.Rows[3]["default_selected"] != true {
		t.Fatalf("status row = %v", body.Rows[3])
	}
}

func TestAIRateLimiterAllowNAllOrNothing(t *testing.T) {
	l := newAIRateLimiter(5, time.Minute)
	now := time.Now()
	if ok, _ := l.allowNAt("u", 3, now); !ok {
		t.Fatal("3 of 5 should pass")
	}
	if ok, wait := l.allowNAt("u", 3, now); ok || wait <= 0 {
		t.Fatalf("3 more must fail with a wait, got ok=%v wait=%v", ok, wait)
	}
	// The rejected request charged nothing: 2 slots are still free.
	if ok, _ := l.allowNAt("u", 2, now); !ok {
		t.Fatal("remaining 2 slots should be free")
	}
	if l.allow("u", now) {
		t.Fatal("limit must now be reached")
	}
	if ok, _ := l.allowNAt("u", 0, now); !ok {
		t.Fatal("n=0 always passes")
	}
}

func TestMassUpdatePreviewWorkDoneRateLimitChargesNothingWhenShort(t *testing.T) {
	srv := mockLLMServer(t, `{"operations":[{"reference_id":1,"op":"generate_work_done"},{"reference_id":2,"op":"generate_work_done"}]}`)
	useMockLLM(t, srv)
	gin.SetMode(gin.TestMode)
	router := gin.New()
	group := router.Group("", middleware.Auth("test-secret"))
	limiter := newAIRateLimiter(4, time.Minute)
	h := &Handler{service: NewService(massUpdateStub()), httpClient: &http.Client{}, aiLimiter: limiter,
		workDoneGenerator: func(context.Context, aisettings.Settings, int) (string, error) { return "ok", nil }}
	RegisterAIToolsRoutes(group, h)
	// First preview: 1 + 2 = 3 of 4.
	if resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/preview", `{"instruction":"x"}`, []string{permUpdate}); resp.Code != http.StatusOK {
		t.Fatalf("first: %d %s", resp.Code, resp.Body.String())
	}
	// Second: middleware takes the 4th slot, then 2 more are needed -> 429.
	if resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/preview", `{"instruction":"x"}`, []string{permUpdate}); resp.Code != http.StatusTooManyRequests {
		t.Fatalf("second: %d %s", resp.Code, resp.Body.String())
	}
	if n := len(limiter.hits[testActorID]); n != 4 {
		t.Fatalf("recorded hits = %d, want 4 (rejected batch must charge nothing)", n)
	}
}

func TestMassUpdatePreviewWorkDonePartialFailureMessage(t *testing.T) {
	srv := mockLLMServer(t, `{"operations":[{"reference_id":1,"op":"generate_work_done"},{"reference_id":2,"op":"generate_work_done"}]}`)
	useMockLLM(t, srv)
	gen := func(ctx context.Context, _ aisettings.Settings, ref int) (string, error) {
		if ref == 2 {
			<-ctx.Done() // only returns once the preview deadline fires
			return "", ctx.Err()
		}
		return "Generated", nil
	}
	old := massUpdatePreviewTimeout
	massUpdatePreviewTimeout = 100 * time.Millisecond
	t.Cleanup(func() { massUpdatePreviewTimeout = old })

	router := workDoneRouter(t, massUpdateStub(), gen)
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/preview", `{"instruction":"x"}`, []string{permUpdate})
	if resp.Code != http.StatusOK {
		t.Fatalf("preview: %d %s", resp.Code, resp.Body.String())
	}
	var body massUpdatePreviewResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Rows) != 2 || !body.Rows[0].Valid || body.Rows[1].Valid {
		t.Fatalf("rows = %+v", body.Rows)
	}
	if body.Rows[1].Error != "Work Done could not be generated: AI took too long to respond. Please try again." {
		t.Fatalf("row 2 error = %q", body.Rows[1].Error)
	}
	if !strings.Contains(body.Message, "1 of 2") {
		t.Fatalf("message = %q", body.Message)
	}
}

// TestMassUpdatePreviewWorkDoneBatchSingleAttempt checks the real batch
// generator: one HTTP attempt per job, no retries, no fallback model and a
// smaller token budget.
func TestMassUpdatePreviewWorkDoneBatchSingleAttempt(t *testing.T) {
	var mu sync.Mutex
	workDoneCalls := 0
	var workDonePayload map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		if strings.Contains(string(raw), "UNIQUE-LOG-MARKER") {
			mu.Lock()
			workDoneCalls++
			_ = json.Unmarshal(raw, &workDonePayload)
			mu.Unlock()
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"model": "mock-model", "choices": []map[string]any{
			{"message": map[string]any{"content": `{"operations":[{"reference_id":1,"op":"generate_work_done"}]}`}}}})
	}))
	t.Cleanup(srv.Close)
	useMockLLM(t, srv)
	t.Setenv("OPENROUTER_FALLBACK_MODEL", "some/fallback")
	stub := massUpdateStub()
	stub.repairLogs = map[int][]domain.RepairLog{1: {{ReferenceID: 1, Details: "UNIQUE-LOG-MARKER"}}}
	router := aiToolsRouter(t, stub)

	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/preview", `{"instruction":"x"}`, []string{permUpdate})
	if resp.Code != http.StatusOK {
		t.Fatalf("preview: %d %s", resp.Code, resp.Body.String())
	}
	if workDoneCalls != 1 {
		t.Fatalf("work done attempts = %d, want 1", workDoneCalls)
	}
	if _, ok := workDonePayload["models"]; ok {
		t.Fatalf("batch request must not use a fallback model: %v", workDonePayload)
	}
	if mt, _ := workDonePayload["max_tokens"].(float64); mt <= 0 || mt >= 2000 {
		t.Fatalf("max_tokens = %v", workDonePayload["max_tokens"])
	}
}

func TestSummarizeRepairLogsTrimsDetails(t *testing.T) {
	logs := make([]domain.RepairLog, 4)
	for i := range logs {
		logs[i] = domain.RepairLog{CreatedByName: ptrStr("Tech"), Details: strings.Repeat("é", 5000)}
	}
	got := summarizeRepairLogs(logs)
	if n := utf8.RuneCountInString(got); n > repairLogsSummaryMaxChars {
		t.Fatalf("summary is %d chars, max %d", n, repairLogsSummaryMaxChars)
	}
	first := strings.SplitN(got, " | ", 2)[0]
	// max-1 kept characters plus the "…" marker.
	if n := strings.Count(first, "é"); n != repairLogDetailsMaxChars-1 {
		t.Fatalf("first entry kept %d chars, want %d", n, repairLogDetailsMaxChars-1)
	}
	if !strings.Contains(first, "…") {
		t.Fatal("trimmed details should be marked")
	}

	short := summarizeRepairLogs([]domain.RepairLog{{Details: "swapped belt"}})
	if short != "Unknown tech did: swapped belt" {
		t.Fatalf("short = %q", short)
	}
}
