package workorders

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"humphreys/api/internal/domain"
	"humphreys/api/internal/modules/aisettings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// TestGenerateAIWorkDoneEndpointUnchanged covers the per-job endpoint after the
// generateWorkDoneText extraction: same JSON shape, same 404, repair logs in
// the prompt and no customer contact details.
func TestGenerateAIWorkDoneEndpointUnchanged(t *testing.T) {
	var prompt string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		prompt = string(raw)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"model":   "mock-model",
			"choices": []map[string]any{{"message": map[string]any{"content": "Replaced the belt."}}},
		})
	}))
	t.Cleanup(srv.Close)
	useMockLLM(t, srv)

	stub := &aiToolsStub{
		details: map[int]domain.WorkOrderDetail{7: {ReferenceID: 7, Customer: domain.WorkOrderCustomer{
			FirstName: ptrStr("Jane"), Email: ptrStr("jane@example.com"), HomePhone: ptrStr("555-0100")}}},
		repairLogs: map[int][]domain.RepairLog{7: {{ReferenceID: 7, Details: "belt worn, swapped"}}},
	}
	gin.SetMode(gin.TestMode)
	h := &Handler{service: NewService(stub), httpClient: &http.Client{}}
	router := gin.New()
	router.POST("/:reference_id/ai-work-done", h.GenerateAIWorkDoneFromRepairLogs)

	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, httptest.NewRequest(http.MethodPost, "/7/ai-work-done", nil))
	if resp.Code != http.StatusOK {
		t.Fatalf("got %d %s", resp.Code, resp.Body.String())
	}
	var body map[string]any
	_ = json.Unmarshal(resp.Body.Bytes(), &body)
	if body["work_done"] != "Replaced the belt." || body["model"] != "mock-model" || body["generated_at"] == nil {
		t.Fatalf("body = %v", body)
	}
	if !strings.Contains(prompt, "belt worn, swapped") || strings.Contains(prompt, "jane@example.com") || strings.Contains(prompt, "555-0100") {
		t.Fatalf("prompt = %s", prompt)
	}

	resp = httptest.NewRecorder()
	router.ServeHTTP(resp, httptest.NewRequest(http.MethodPost, "/8/ai-work-done", nil))
	if resp.Code != http.StatusNotFound {
		t.Fatalf("missing job: got %d", resp.Code)
	}
}

func TestMassUpdatePreviewWorkDoneConsumesRateLimit(t *testing.T) {
	srv := mockLLMServer(t, `{"operations":[{"reference_id":1,"op":"generate_work_done"},{"reference_id":2,"op":"generate_work_done"}]}`)
	useMockLLM(t, srv)
	stub := massUpdateStub()
	gen := func(context.Context, aisettings.Settings, int) (string, error) { return "ok", nil }
	router := workDoneRouter(t, stub, gen)
	// Each preview costs 1 (middleware) + 2 (generated jobs) of the 20/min budget.
	codes := []int{}
	for i := 0; i < 7; i++ {
		resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/preview", `{"instruction":"generate work done"}`, []string{permUpdate})
		codes = append(codes, resp.Code)
	}
	if codes[5] != http.StatusOK || codes[6] != http.StatusTooManyRequests {
		t.Fatalf("codes = %v, want 6x200 then 429", codes)
	}
}

func TestApplyMassUpdateJobWorkDonePostgres(t *testing.T) {
	pool := partsAuditTestDB(t)
	ctx := context.Background()
	actor := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO users(id,email,password_hash,full_name) VALUES ('`+actor+`','actor@test','test','Actor');
		ALTER TABLE work_orders ADD COLUMN updated_at timestamptz, ADD COLUMN work_done text;
		INSERT INTO work_orders(reference_id, work_done, updated_at) VALUES (1, 'Old notes', now() - interval '1 hour');`); err != nil {
		t.Fatal(err)
	}
	repo := &storeRepository{db: pool}
	workDone := func() string {
		t.Helper()
		var v string
		if err := pool.QueryRow(ctx, `SELECT work_done FROM work_orders WHERE reference_id = 1`).Scan(&v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	op := []massUpdateResolvedOp{{Op: massOpGenerateWorkDone, WorkDoneText: ptrStr("Replaced belt.")}}

	previewed := currentUpdatedAt(t, pool, 1)
	if _, err := pool.Exec(ctx, `UPDATE work_orders SET work_done = 'Edited', updated_at = now() WHERE reference_id = 1`); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.ApplyMassUpdateJob(ctx, 1, previewed, op, actor); !errors.Is(err, ErrMassUpdateStale) {
		t.Fatalf("stale err = %v", err)
	}
	if got := workDone(); got != "Edited" {
		t.Fatalf("stale apply wrote: %q", got)
	}

	applied, err := repo.ApplyMassUpdateJob(ctx, 1, currentUpdatedAt(t, pool, 1), op, actor)
	if err != nil {
		t.Fatal(err)
	}
	if len(applied) != 1 || applied[0] != "Work Done updated" || workDone() != "Replaced belt." {
		t.Fatalf("applied = %v work_done = %q", applied, workDone())
	}

	var action string
	var meta map[string]any
	if err := pool.QueryRow(ctx, `SELECT action, metadata_json FROM audit_logs WHERE actor_user_id = $1`, actor).Scan(&action, &meta); err != nil {
		t.Fatal(err)
	}
	before, _ := meta["before"].(map[string]any)
	after, _ := meta["after"].(map[string]any)
	if action != "work_order.ai_mass_update.generate_work_done" || before["work_done"] != "Edited" || after["work_done"] != "Replaced belt." {
		t.Fatalf("audit action=%s meta=%v", action, meta)
	}
}
