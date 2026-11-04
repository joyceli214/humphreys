package workorders

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"testing"

	"humphreys/api/internal/domain"
	"humphreys/api/internal/middleware"
	"humphreys/api/internal/modules/aisettings"

	"github.com/gin-gonic/gin"
)

func workDoneOp(ref int32, text *string) MassUpdateOp {
	return MassUpdateOp{ReferenceID: ref, Op: massOpGenerateWorkDone, WorkDoneText: text}
}

func TestWorkDoneOpKeyAndDedupe(t *testing.T) {
	a := massUpdateOpKey(workDoneOp(1, ptrStr("Replaced belt")))
	b := massUpdateOpKey(workDoneOp(1, ptrStr("Cleaned heads")))
	if a == b {
		t.Fatal("different work_done_text must produce different keys")
	}
	ops := dedupeMassUpdateOps([]MassUpdateOp{workDoneOp(1, nil), workDoneOp(1, nil), workDoneOp(2, nil)})
	if len(ops) != 2 {
		t.Fatalf("dedupe kept %d ops, want 2", len(ops))
	}
	if got := massOpField(massOpGenerateWorkDone); got != "Work done" {
		t.Fatalf("field = %q", got)
	}
}

func TestWorkDoneJobCap(t *testing.T) {
	ops := make([]MassUpdateOp, 0, 11)
	for i := int32(1); i <= 10; i++ {
		ops = append(ops, workDoneOp(i, nil))
	}
	if err := validateMassUpdateOps(ops); err != nil {
		t.Fatalf("10 jobs should pass: %v", err)
	}
	// Two ops on one job still count as one job.
	if err := validateMassUpdateOps(append(ops, workDoneOp(10, ptrStr("x")))); err != nil {
		t.Fatalf("repeat job should not count twice: %v", err)
	}
	ops = append(ops, workDoneOp(11, nil))
	err := validateMassUpdateOps(ops)
	if err == nil || err.Error() != "Generate Work Done is limited to 10 jobs per request." {
		t.Fatalf("11 jobs err = %v", err)
	}
}

func TestWorkDoneTextLengthCap(t *testing.T) {
	ok := strings.Repeat("é", massUpdateWorkDoneMaxChars)
	if err := validateMassUpdateOps([]MassUpdateOp{workDoneOp(1, &ok)}); err != nil {
		t.Fatalf("text at cap should pass: %v", err)
	}
	long := ok + "x"
	if err := validateMassUpdateOps([]MassUpdateOp{workDoneOp(1, &long)}); err == nil {
		t.Fatal("text over cap should fail")
	}
	row := MassUpdatePreviewRow{}
	if _, valid := applyOpToRow(&row, workDoneOp(1, &long), &domain.WorkOrderDetail{}, nil, locationLookup{}, nil); valid {
		t.Fatal("applyOpToRow must reject over-long text")
	}
}

func TestWorkDoneApplyOpToRow(t *testing.T) {
	detail := &domain.WorkOrderDetail{ReferenceID: 1, WorkDone: ptrStr("Old notes")}
	row := MassUpdatePreviewRow{}
	resolved, ok := applyOpToRow(&row, workDoneOp(1, ptrStr("  Replaced belt.  ")), detail, nil, locationLookup{}, nil)
	if !ok || row.Before != "Old notes" || row.After != "Replaced belt." || row.AmountDelta != 0 || row.Field != "Work done" {
		t.Fatalf("row = %+v ok=%v", row, ok)
	}
	if resolved.WorkDoneText == nil || *resolved.WorkDoneText != "Replaced belt." {
		t.Fatalf("resolved = %+v", resolved)
	}

	row = MassUpdatePreviewRow{}
	if _, ok := applyOpToRow(&row, workDoneOp(1, ptrStr("New")), &domain.WorkOrderDetail{}, nil, locationLookup{}, nil); !ok || row.Before != "—" {
		t.Fatalf("empty before row = %+v", row)
	}

	for _, text := range []*string{nil, ptrStr("   ")} {
		row = MassUpdatePreviewRow{}
		if _, ok := applyOpToRow(&row, workDoneOp(1, text), detail, nil, locationLookup{}, nil); ok || row.Error != "There is no generated Work Done text to save. Preview again." {
			t.Fatalf("empty text row = %+v ok=%v", row, ok)
		}
	}
}

func TestMassUpdatePromptMentionsGenerateWorkDone(t *testing.T) {
	p := buildMassUpdatePrompt("x", nil, nil)
	if !strings.Contains(p, "- generate_work_done:") || !strings.Contains(p, "generate work done for jobs 90001 and 90002") {
		t.Fatalf("prompt missing generate_work_done: %s", p)
	}
}

// workDoneRouter is aiToolsRouter with a stub Work Done generator.
func workDoneRouter(t *testing.T, repo Repository, gen func(context.Context, aisettings.Settings, int) (string, error)) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	group := router.Group("", middleware.Auth("test-secret"))
	h := &Handler{service: NewService(repo), httpClient: &http.Client{}, workDoneGenerator: gen}
	RegisterAIToolsRoutes(group, h)
	return router
}

func TestMassUpdatePreviewGeneratesWorkDone(t *testing.T) {
	// The LLM tries to supply its own text; the server must ignore it and use
	// the repair-log generator instead.
	srv := mockLLMServer(t, `{"operations":[
		{"reference_id":123,"op":"generate_work_done","work_done_text":"made up"},
		{"reference_id":1,"op":"generate_work_done"},
		{"reference_id":2,"op":"generate_work_done"},
		{"reference_id":404,"op":"generate_work_done"}
	]}`)
	useMockLLM(t, srv)
	stub := massUpdateStub()
	stub.details[123] = domain.WorkOrderDetail{ReferenceID: 123, WorkDone: ptrStr("Old")}
	var mu sync.Mutex
	calls := map[int]int{}
	gen := func(_ context.Context, _ aisettings.Settings, ref int) (string, error) {
		mu.Lock()
		calls[ref]++
		mu.Unlock()
		switch ref {
		case 2:
			return "", errors.New("boom")
		case 404:
			return "", ErrWorkOrderNotFound
		}
		return "Generated for job", nil
	}
	router := workDoneRouter(t, stub, gen)
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/preview", `{"instruction":"generate work done"}`, []string{permUpdate})
	if resp.Code != http.StatusOK {
		t.Fatalf("preview: %d %s", resp.Code, resp.Body.String())
	}
	var body massUpdatePreviewResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Rows) != 4 {
		t.Fatalf("rows = %+v", body.Rows)
	}
	r := body.Rows[0]
	if !r.Valid || r.Before != "Old" || r.After != "Generated for job" || r.Operation.WorkDoneText == nil || *r.Operation.WorkDoneText != "Generated for job" {
		t.Fatalf("row 123 = %+v", r)
	}
	if !body.Rows[1].Valid {
		t.Fatalf("row 1 = %+v", body.Rows[1])
	}
	if r := body.Rows[2]; r.Valid || !strings.HasPrefix(r.Error, "Work Done could not be generated: ") || r.Operation.WorkDoneText != nil {
		t.Fatalf("row 2 = %+v", r)
	}
	if r := body.Rows[3]; r.Valid || r.Error != "Job #404 was not found." {
		t.Fatalf("row 404 = %+v", r)
	}
	for _, ref := range []int{123, 1, 2, 404} {
		if calls[ref] != 1 {
			t.Fatalf("generator calls = %v", calls)
		}
	}
}

func TestMassUpdatePreviewWorkDoneCapSkipsGeneration(t *testing.T) {
	var ops []string
	for i := 1; i <= 11; i++ {
		ops = append(ops, `{"reference_id":`+strconv.Itoa(i)+`,"op":"generate_work_done"}`)
	}
	srv := mockLLMServer(t, `{"operations":[`+strings.Join(ops, ",")+`]}`)
	useMockLLM(t, srv)
	called := false
	router := workDoneRouter(t, massUpdateStub(), func(context.Context, aisettings.Settings, int) (string, error) {
		called = true
		return "x", nil
	})
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/preview", `{"instruction":"generate work done"}`, []string{permUpdate})
	if resp.Code != http.StatusBadRequest || !strings.Contains(resp.Body.String(), "Generate Work Done is limited to 10 jobs per request.") {
		t.Fatalf("got %d %s", resp.Code, resp.Body.String())
	}
	if called {
		t.Fatal("generator must not run over the cap")
	}
}

func TestMassUpdateApplySavesEchoedWorkDoneWithoutLLM(t *testing.T) {
	stub := massUpdateStub()
	router := workDoneRouter(t, stub, func(context.Context, aisettings.Settings, int) (string, error) {
		t.Fatal("apply must not generate")
		return "", nil
	})
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/apply",
		`{"operations":[{"reference_id":1,"op":"generate_work_done","work_done_text":"Saved text"},
		{"reference_id":2,"op":"generate_work_done"}],
		"expected_updated_at":{"1":null,"2":null}}`, []string{permUpdate})
	if resp.Code != http.StatusOK {
		t.Fatalf("apply: %d %s", resp.Code, resp.Body.String())
	}
	got := stub.appliedOps[1]
	if len(got) != 1 || got[0].WorkDoneText == nil || *got[0].WorkDoneText != "Saved text" {
		t.Fatalf("applied = %+v", got)
	}
	if _, ok := stub.appliedOps[2]; ok {
		t.Fatal("job with no text must not be applied")
	}
}
