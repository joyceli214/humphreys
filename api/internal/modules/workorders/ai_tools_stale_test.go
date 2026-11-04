package workorders

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// currentUpdatedAt reads a work order's updated_at as the preview would have.
func currentUpdatedAt(t *testing.T, pool *pgxpool.Pool, referenceID int) *time.Time {
	t.Helper()
	var ts *time.Time
	if err := pool.QueryRow(context.Background(), `SELECT updated_at FROM work_orders WHERE reference_id = $1`, referenceID).Scan(&ts); err != nil {
		t.Fatal(err)
	}
	return ts
}

func TestMassUpdatePreviewIncludesUpdatedAt(t *testing.T) {
	srv := mockLLMServer(t, `{"operations":[
		{"reference_id":123,"op":"set_labour_total","labour_total":150},
		{"reference_id":1,"op":"set_labour_total","labour_total":10}
	]}`)
	useMockLLM(t, srv)

	stub := massUpdateStub()
	ts := time.Date(2026, 10, 1, 9, 30, 15, 123456000, time.UTC)
	d := stub.details[123]
	d.UpdatedAt = &ts
	stub.details[123] = d

	router := aiToolsRouter(t, stub)
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/preview",
		`{"instruction":"x"}`, []string{permUpdate})
	if resp.Code != http.StatusOK {
		t.Fatalf("preview: got %d %s", resp.Code, resp.Body.String())
	}
	var raw struct {
		Rows []map[string]any `json:"rows"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &raw); err != nil {
		t.Fatal(err)
	}
	if got := raw.Rows[0]["updated_at"]; got != "2026-10-01T09:30:15.123456Z" {
		t.Fatalf("row updated_at = %#v", got)
	}
	// A job whose updated_at is NULL reports an explicit null, not an omitted key.
	if v, ok := raw.Rows[1]["updated_at"]; !ok || v != nil {
		t.Fatalf("null updated_at = %#v (present=%v), want explicit null", v, ok)
	}
}

func TestMassUpdateApplyPassesExpectedUpdatedAtAndReportsStale(t *testing.T) {
	stub := massUpdateStub()
	stub.applyErr = map[int]error{2: ErrMassUpdateStale}

	router := aiToolsRouter(t, stub)
	payload := `{"operations":[
		{"reference_id":1,"op":"set_labour_total","labour_total":100},
		{"reference_id":2,"op":"set_labour_total","labour_total":100},
		{"reference_id":123,"op":"set_labour_total","labour_total":100}
	],"expected_updated_at":{"1":"2026-10-01T09:30:15.123456Z","2":"2026-10-01T09:00:00Z","123":null}}`
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/apply", payload, []string{permUpdate})
	if resp.Code != http.StatusOK {
		t.Fatalf("apply: got %d %s", resp.Code, resp.Body.String())
	}
	var body massUpdateApplyResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	byRef := map[int32]MassUpdateApplyResult{}
	for _, r := range body.Results {
		byRef[r.ReferenceID] = r
	}
	if !byRef[1].Success || !byRef[123].Success {
		t.Fatalf("jobs 1 and 123 should succeed: %+v", body.Results)
	}
	if byRef[2].Success || byRef[2].Error != massUpdateStaleMessage {
		t.Fatalf("job 2 should fail as changed since preview: %+v", byRef[2])
	}

	want := time.Date(2026, 10, 1, 9, 30, 15, 123456000, time.UTC)
	if got := stub.appliedExpected[1]; got == nil || !got.Equal(want) {
		t.Fatalf("job 1 expected updated_at = %v, want %v", got, want)
	}
	if got, ok := stub.appliedExpected[123]; !ok || got != nil {
		t.Fatalf("job 123 expected updated_at = %v (called=%v), want nil (job had no updated_at)", got, ok)
	}
}

func TestMassUpdateApplyRejectsJobMissingExpectedUpdatedAt(t *testing.T) {
	stub := massUpdateStub()
	router := aiToolsRouter(t, stub)
	payload := `{"operations":[
		{"reference_id":1,"op":"set_labour_total","labour_total":100},
		{"reference_id":2,"op":"set_labour_total","labour_total":100}
	],"expected_updated_at":{"1":"2026-10-01T09:30:15Z"}}`
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/apply", payload, []string{permUpdate})
	if resp.Code != http.StatusOK {
		t.Fatalf("apply: got %d %s", resp.Code, resp.Body.String())
	}
	var body massUpdateApplyResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Results) != 2 || !body.Results[0].Success {
		t.Fatalf("job 1 should succeed: %+v", body.Results)
	}
	if r := body.Results[1]; r.ReferenceID != 2 || r.Success || r.Error != massUpdateMissingVersionMessage {
		t.Fatalf("job 2 should be rejected for missing updated_at: %+v", r)
	}
	if _, ok := stub.appliedOps[2]; ok {
		t.Fatalf("job 2 must not reach the repository")
	}
}

func TestApplyMassUpdateJobRejectsChangedSincePreviewPostgres(t *testing.T) {
	pool := partsAuditTestDB(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `
		ALTER TABLE work_orders ADD COLUMN updated_at timestamptz, ADD COLUMN labour_total numeric(12,2);
		INSERT INTO work_orders(reference_id, labour_total, updated_at) VALUES (1, 50, now() - interval '1 hour'), (2, 50, NULL);`); err != nil {
		t.Fatal(err)
	}
	repo := &storeRepository{db: pool}
	labour := func(ref int) float64 {
		t.Helper()
		var v float64
		if err := pool.QueryRow(ctx, `SELECT labour_total::double precision FROM work_orders WHERE reference_id = $1`, ref).Scan(&v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	op := []massUpdateResolvedOp{{Op: massOpSetLabourTotal, LabourTotal: ptrFloat(80)}}

	previewed := currentUpdatedAt(t, pool, 1)
	// Someone else edits the job after the preview.
	if _, err := pool.Exec(ctx, `UPDATE work_orders SET labour_total = 60, updated_at = now() WHERE reference_id = 1`); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.ApplyMassUpdateJob(ctx, 1, previewed, op, ""); !errors.Is(err, ErrMassUpdateStale) {
		t.Fatalf("stale apply err = %v, want ErrMassUpdateStale", err)
	}
	if got := labour(1); got != 60 {
		t.Fatalf("stale apply must not write: labour = %v", got)
	}

	// With the current value it applies.
	if _, err := repo.ApplyMassUpdateJob(ctx, 1, currentUpdatedAt(t, pool, 1), op, ""); err != nil {
		t.Fatal(err)
	}
	if got := labour(1); got != 80 {
		t.Fatalf("labour = %v, want 80", got)
	}

	// NULL updated_at matches only an explicit nil expectation.
	ts := time.Now()
	if _, err := repo.ApplyMassUpdateJob(ctx, 2, &ts, op, ""); !errors.Is(err, ErrMassUpdateStale) {
		t.Fatalf("NULL vs timestamp err = %v, want ErrMassUpdateStale", err)
	}
	if _, err := repo.ApplyMassUpdateJob(ctx, 2, nil, op, ""); err != nil {
		t.Fatal(err)
	}

	if _, err := repo.ApplyMassUpdateJob(ctx, 99, nil, op, ""); !errors.Is(err, ErrWorkOrderNotFound) {
		t.Fatalf("missing job err = %v, want ErrWorkOrderNotFound", err)
	}
}
