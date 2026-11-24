package workorders

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"
	"testing"

	"humphreys/api/internal/domain"

	"github.com/google/uuid"
)

func f64(v float64) *float64 { return &v }

// ---- G2 / G3 / actual paid (PostgreSQL) ----

func TestPartsGuardsAndActualPaidPostgres(t *testing.T) {
	db := partsAuditTestDB(t)
	ctx := context.Background()
	service := NewService(&storeRepository{db: db})
	user := uuid.NewString()
	if _, err := db.Exec(ctx, `INSERT INTO users(id,email,password_hash,full_name) VALUES ($1,'u@test','test','U')`, user); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO work_orders VALUES (1)`); err != nil {
		t.Fatal(err)
	}
	create := func(status string, canApprove bool, paid *float64) (domain.PartsPurchaseRequest, error) {
		return service.CreatePartsPurchaseRequest(ctx, 1, CreatePartsPurchaseRequestInput{Source: "supplier", Status: &status, ItemName: "Part", Quantity: 2, TotalPrice: 10, ActualPaidTotal: paid, CanApprove: canApprove, CreatedByUserID: user})
	}
	// G2: only draft / waiting_approval without approve permission.
	for _, status := range []string{"approved", "ordered", "arrived", "used", "cancelled"} {
		if _, err := create(status, false, nil); !errors.Is(err, ErrPartsApprovalPermission) {
			t.Fatalf("%s without approve: %v", status, err)
		}
	}
	for _, status := range []string{"draft", "waiting_approval"} {
		if _, err := create(status, false, nil); err != nil {
			t.Fatalf("%s: %v", status, err)
		}
	}
	item, err := create("approved", true, f64(7.5))
	if err != nil || item.ActualPaidTotal == nil || *item.ActualPaidTotal != 7.5 {
		t.Fatalf("create with approve: %+v %v", item, err)
	}
	update := func(item domain.PartsPurchaseRequest, price float64, qty int32, paid OptionalFloat, canApprove bool) (domain.PartsPurchaseRequest, error) {
		return service.UpdatePartsPurchaseRequest(ctx, 1, item.PartsPurchaseRequestID, UpdatePartsPurchaseRequestInput{
			UpdatedAt: *item.UpdatedAt, Source: item.Source, Status: item.Status, ItemName: item.ItemName, Quantity: qty, TotalPrice: price, ActualPaid: paid, ActorUserID: user, CanApprove: canApprove})
	}
	// G3: price / quantity locked after approval without approve permission.
	if _, err := update(item, 11, 2, OptionalFloat{}, false); !errors.Is(err, ErrPartsCostLocked) {
		t.Fatalf("price change: %v", err)
	}
	if _, err := update(item, 10, 3, OptionalFloat{}, false); !errors.Is(err, ErrPartsCostLocked) {
		t.Fatalf("quantity change: %v", err)
	}
	// Actual paid is allowed after approval; omitted keeps it, null clears it.
	item, err = update(item, 10, 2, OptionalFloat{Set: true, Value: f64(9.25)}, false)
	if err != nil || *item.ActualPaidTotal != 9.25 {
		t.Fatalf("actual paid after approval: %+v %v", item, err)
	}
	item, err = update(item, 10, 2, OptionalFloat{}, false)
	if err != nil || item.ActualPaidTotal == nil || *item.ActualPaidTotal != 9.25 {
		t.Fatalf("omitted must keep: %+v %v", item, err)
	}
	if _, err := update(item, 10, 2, OptionalFloat{Set: true, Value: f64(-1)}, false); !errors.Is(err, ErrInvalidPartsTotalPrice) {
		t.Fatalf("negative paid: %v", err)
	}
	// With approve permission the estimate may change.
	item, err = update(item, 12, 2, OptionalFloat{}, true)
	if err != nil || item.TotalPrice != 12 {
		t.Fatalf("approver price change: %v", err)
	}
	item, err = update(item, 12, 2, OptionalFloat{Set: true}, false)
	if err != nil || item.ActualPaidTotal != nil {
		t.Fatalf("null must clear: %+v %v", item, err)
	}
	// Audit: actual_paid_total changes are recorded (9.25 set, then cleared) and not flagged.
	id := item.PartsPurchaseRequestID
	entries, err := service.PartsPurchaseRequestHistory(ctx, 1, &id)
	if err != nil {
		t.Fatal(err)
	}
	var paid []string
	for _, e := range entries {
		if e.Field != nil && *e.Field == "actual_paid_total" && e.Action == "update" {
			paid = append(paid, strings.Join([]string{valueOr(e.OldValue), valueOr(e.NewValue)}, ">"))
		}
	}
	if strings.Join(paid, ",") != "7.50>9.25,9.25>" {
		t.Fatalf("actual paid audit: %v", paid)
	}
	list, err := service.ListPartsPurchaseRequests(ctx, 1)
	if err != nil || len(list) != 3 {
		t.Fatalf("list: %v %d", err, len(list))
	}
	// Migration: audit constraint accepts the new field and rejects negatives.
	if _, err := db.Exec(ctx, `UPDATE parts_purchase_requests SET actual_paid_total = -1`); err == nil {
		t.Fatal("negative actual_paid_total accepted")
	}
}

func valueOr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func TestPartsCreateStatusGuardRoute(t *testing.T) {
	repo := &partsAuditStub{}
	router := partsAuditRouter(t, repo)
	path := "/work-orders/1/parts-purchase-requests"
	body := func(status string) string {
		return `{"source":"supplier","status":"` + status + `","total_price":5,"item_name":"X","quantity":1}`
	}
	for _, tc := range []struct {
		status      string
		permissions []string
		want        int
	}{
		{"approved", []string{permPartsCreate}, http.StatusForbidden},
		{"approved", []string{permPartsCreate, permPartsApprove}, http.StatusCreated},
		{"draft", []string{permPartsCreate}, http.StatusCreated},
		{"waiting_approval", []string{permPartsCreate}, http.StatusCreated},
	} {
		got := partsAuditRequest(t, router, http.MethodPost, path, body(tc.status), tc.permissions)
		if got.Code != tc.want {
			t.Fatalf("%s %v: %d %s", tc.status, tc.permissions, got.Code, got.Body.String())
		}
	}
	got := partsAuditRequest(t, router, http.MethodPost, path, `{"source":"supplier","total_price":5,"item_name":"X","quantity":1}`, []string{permPartsCreate})
	if got.Code != http.StatusCreated || repo.status != "draft" {
		t.Fatalf("default status: %d %s", got.Code, repo.status)
	}
}

// ---- G5 / G7 ----

type totalsStub struct {
	Repository
	detail               domain.WorkOrderDetail
	updates, lineUpdates int
	lastTotals           TotalsUpdateInput
}

func (r *totalsStub) GetWorkOrderDetail(context.Context, int) (domain.WorkOrderDetail, error) {
	return r.detail, nil
}
func (r *totalsStub) UpdateTotals(_ context.Context, _ int, in TotalsUpdateInput) error {
	r.updates++
	r.lastTotals = in
	return nil
}
func (r *totalsStub) UpdateLineItems(context.Context, int, []LineItemUpsertInput) error {
	r.lineUpdates++
	return nil
}
func (r *totalsStub) PreviewLineItems(context.Context, int, []LineItemUpsertInput) (*float64, []domain.WorkOrderLineItem, error) {
	return f64(100), []domain.WorkOrderLineItem{{LineItemID: 1}}, nil
}

func newTotalsStub() *totalsStub {
	return &totalsStub{detail: domain.WorkOrderDetail{PartsTotal: f64(50), DeliveryTotal: f64(10), LabourTotal: f64(100), Deposit: 20}}
}

func TestOptionalFloatAndPartialTotals(t *testing.T) {
	var req updateTotalsRequest
	if err := json.Unmarshal([]byte(`{"delivery_total":null,"labour_total":5}`), &req); err != nil {
		t.Fatal(err)
	}
	if !req.DeliveryTotal.Set || req.DeliveryTotal.Value != nil || !req.LabourTotal.Set || *req.LabourTotal.Value != 5 || req.Deposit.Set {
		t.Fatalf("%+v", req)
	}
	repo := newTotalsStub()
	router := partsAuditRouter(t, repo)
	got := partsAuditRequest(t, router, http.MethodPatch, "/work-orders/1/totals", `{"labour_total":5}`, []string{permUpdate})
	if got.Code != http.StatusOK || repo.updates != 1 || repo.lastTotals.Deposit.Set || repo.lastTotals.DeliveryTotal.Set {
		t.Fatalf("partial totals: %d %+v", got.Code, repo.lastTotals)
	}
	// null deposit means 0 (deposit is not nullable).
	partsAuditRequest(t, router, http.MethodPatch, "/work-orders/1/totals", `{"deposit":null}`, []string{permUpdate})
	if !repo.lastTotals.Deposit.Set || *repo.lastTotals.Deposit.Value != 0 {
		t.Fatalf("null deposit: %+v", repo.lastTotals.Deposit)
	}
}

func TestWorkOrderTotalsByPermission(t *testing.T) {
	router := partsAuditRouter(t, newTotalsStub())
	for _, tc := range []struct {
		permissions []string
		want        bool
	}{{[]string{permRead, permSensitiveRead}, true}, {[]string{permRead}, false}} {
		got := partsAuditRequest(t, router, http.MethodGet, "/work-orders/1", "", tc.permissions)
		var body map[string]json.RawMessage
		if got.Code != http.StatusOK || json.Unmarshal(got.Body.Bytes(), &body) != nil {
			t.Fatalf("%d %s", got.Code, got.Body.String())
		}
		raw, has := body["totals"]
		if has != tc.want {
			t.Fatalf("%v: totals present=%v", tc.permissions, has)
		}
		if has {
			var totals Totals
			_ = json.Unmarshal(raw, &totals)
			// subtotal 50+10+100=160, hst 20.80, total 180.80, payable 160.80
			if totals.Subtotal != 160 || totals.HST != 20.8 || totals.Total != 180.8 || totals.Payable != 160.8 || totals.NetLabour != 100 {
				t.Fatalf("totals: %+v", totals)
			}
		}
	}
}

func TestDryRunWritesNothing(t *testing.T) {
	repo := newTotalsStub()
	router := partsAuditRouter(t, repo)
	var out struct {
		DryRun bool   `json:"dry_run"`
		Totals Totals `json:"totals"`
		WO     struct {
			PartsTotal  *float64 `json:"parts_total"`
			LabourTotal *float64 `json:"labour_total"`
			Deposit     float64  `json:"deposit"`
		} `json:"work_order"`
	}
	got := partsAuditRequest(t, router, http.MethodPatch, "/work-orders/1/totals?dry_run=1", `{"labour_total":200,"deposit":0}`, []string{permUpdate})
	if got.Code != http.StatusOK || json.Unmarshal(got.Body.Bytes(), &out) != nil || !out.DryRun {
		t.Fatalf("%d %s", got.Code, got.Body.String())
	}
	// delivery kept (10): subtotal 50+10+200 = 260; payable 260*1.13 = 293.80
	if repo.updates != 0 || out.Totals.Subtotal != 260 || out.Totals.Payable != 293.8 || *out.WO.LabourTotal != 200 {
		t.Fatalf("totals dry run: updates=%d %+v", repo.updates, out)
	}
	got = partsAuditRequest(t, router, http.MethodPatch, "/work-orders/1/line-items?dry_run=true", `{"line_items":[]}`, []string{permUpdate})
	out.Totals = Totals{}
	if got.Code != http.StatusOK || json.Unmarshal(got.Body.Bytes(), &out) != nil || repo.lineUpdates != 0 || *out.WO.PartsTotal != 100 || out.Totals.Subtotal != 210 {
		t.Fatalf("line items dry run: %d updates=%d %s", got.Code, repo.lineUpdates, got.Body.String())
	}
	partsAuditRequest(t, router, http.MethodPatch, "/work-orders/1/line-items", `{"line_items":[]}`, []string{permUpdate})
	if repo.lineUpdates != 1 {
		t.Fatal("real update must still write")
	}
	// Same permissions as the real call.
	if got := partsAuditRequest(t, router, http.MethodPatch, "/work-orders/1/totals?dry_run=1", `{}`, []string{permRead}); got.Code != http.StatusForbidden {
		t.Fatalf("dry run without update permission: %d", got.Code)
	}
}

// Real repository: partial update keeps omitted fields and a dry run rolls back.
func TestTotalsAndPreviewPostgres(t *testing.T) {
	db := partsAuditTestDB(t)
	ctx := context.Background()
	if _, err := db.Exec(ctx, `ALTER TABLE work_orders ADD COLUMN parts_total numeric(12,2), ADD COLUMN delivery_total numeric(12,2),
		ADD COLUMN labour_total numeric(12,2), ADD COLUMN deposit numeric(12,2) NOT NULL DEFAULT 0, ADD COLUMN updated_at timestamptz;
		ALTER TABLE work_order_line_items ADD COLUMN line_item_id bigserial, ADD COLUMN item_name text, ADD COLUMN unit_price numeric, ADD COLUMN quantity_text text, ADD COLUMN line_total_text text;
		INSERT INTO work_orders(reference_id, delivery_total, labour_total, deposit) VALUES (1, 10, 100, 20);`); err != nil {
		t.Fatal(err)
	}
	repo := &storeRepository{db: db}
	read := func() (d, l, dep float64) {
		if err := db.QueryRow(ctx, `SELECT delivery_total, labour_total, deposit FROM work_orders WHERE reference_id=1`).Scan(&d, &l, &dep); err != nil {
			t.Fatal(err)
		}
		return
	}
	if err := repo.UpdateTotals(ctx, 1, TotalsUpdateInput{LabourTotal: OptionalFloat{Set: true, Value: f64(150)}}); err != nil {
		t.Fatal(err)
	}
	if d, l, dep := read(); d != 10 || l != 150 || dep != 20 {
		t.Fatalf("omitted fields changed: %v %v %v", d, l, dep)
	}
	if err := repo.UpdateTotals(ctx, 1, TotalsUpdateInput{DeliveryTotal: OptionalFloat{Set: true}}); err != nil {
		t.Fatal(err)
	}
	var delivery *float64
	_ = db.QueryRow(ctx, `SELECT delivery_total FROM work_orders WHERE reference_id=1`).Scan(&delivery)
	if delivery != nil {
		t.Fatal("explicit null must clear delivery_total")
	}
	total, lines, err := repo.PreviewLineItems(ctx, 1, []LineItemUpsertInput{{ItemName: strPtr("Belt"), LineTotalText: strPtr("$12.50")}})
	if err != nil || total == nil || *total != 12.5 || len(lines) != 1 {
		t.Fatalf("preview: %v %v %v", total, lines, err)
	}
	var n int
	var parts *float64
	_ = db.QueryRow(ctx, `SELECT (SELECT count(*) FROM work_order_line_items), (SELECT parts_total FROM work_orders WHERE reference_id=1)`).Scan(&n, &parts)
	if n != 0 || parts != nil {
		t.Fatalf("preview wrote data: %d %v", n, parts)
	}
}

// ---- Repair log search ----

func TestRepairLogSnippetAndEscape(t *testing.T) {
	if escapeLike(`50%_a\b`) != `50\%\_a\\b` {
		t.Fatal(escapeLike(`50%_a\b`))
	}
	text := "Replaced belt ![photo](https://x.test/a.png) see https://x.test/doc?id=1 then tested motor " + strings.Repeat("filler ", 60) + "MOTOR noise gone " + strings.Repeat("tail ", 80)
	got := repairLogSnippet(text, "motor")
	if strings.Contains(got, "http") || strings.Contains(got, "![") || !strings.Contains(strings.ToLower(got), "motor") {
		t.Fatalf("snippet: %q", got)
	}
	if n := len([]rune(got)); n > 205 {
		t.Fatalf("snippet too long: %d", n)
	}
	if got := repairLogSnippet("short text", "zzz"); got != "short text" {
		t.Fatal(got)
	}
}

func TestRepairLogSearchRoutePermissions(t *testing.T) {
	router := partsAuditRouter(t, &partsAuditStub{})
	for _, tc := range []struct {
		path        string
		permissions []string
		want        int
	}{
		{"/repair-logs/search?q=belt", nil, http.StatusUnauthorized},
		{"/repair-logs/search?q=belt", []string{permRepairLogsRead}, http.StatusForbidden},
		{"/repair-logs/search?q=belt", []string{permRead}, http.StatusForbidden},
		{"/repair-logs/search?q=b", []string{permRead, permRepairLogsRead}, http.StatusBadRequest},
		{"/repair-logs/search", []string{permRead, permRepairLogsRead}, http.StatusBadRequest},
		{"/repair-logs/search?q=belt&from=2026-13-01", []string{permRead, permRepairLogsRead}, http.StatusBadRequest},
		{"/repair-logs/search?job=abc", []string{permRead, permRepairLogsRead}, http.StatusBadRequest},
	} {
		if got := partsAuditRequest(t, router, http.MethodGet, tc.path, "", tc.permissions); got.Code != tc.want {
			t.Fatalf("%s %v: %d %s", tc.path, tc.permissions, got.Code, got.Body.String())
		}
	}
}

func TestRepairLogSearchPostgres(t *testing.T) {
	db := partsAuditTestDB(t)
	ctx := context.Background()
	user := uuid.NewString()
	if _, err := db.Exec(ctx, `INSERT INTO users(id,email,password_hash,full_name) VALUES ($1,'u@test','test','Una Tech')`, user); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO work_orders VALUES (1),(2)`); err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile("../../../migrations/008_repair_logs_hours_used.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	add := func(ref int, date, details string) {
		if _, err := db.Exec(ctx, `INSERT INTO repair_logs(reference_id, repair_date, hours_used, details, created_by_user_id) VALUES ($1,$2::date,1.5,$3,$4::uuid)`, ref, date, details, user); err != nil {
			t.Fatal(err)
		}
	}
	add(1, "2026-01-10", "Replaced belt, 50% worn")
	add(1, "2026-02-10", "Cleaned carb ![pic](https://img.test/p.png)")
	add(2, "2026-03-10", "Belt tension 50x check")
	add(2, "2026-03-10", "snake_case and a\\b path")
	for i := 0; i < 25; i++ {
		add(2, "2026-04-01", "bulk entry")
	}
	service := NewService(&storeRepository{db: db})
	run := func(p RepairLogSearchParams) ([]RepairLogSearchItem, int) {
		t.Helper()
		if p.Page == 0 {
			p.Page = 1
		}
		if p.PageSize == 0 {
			p.PageSize = 20
		}
		items, total, err := service.SearchRepairLogs(ctx, p)
		if err != nil {
			t.Fatal(err)
		}
		return items, total
	}
	if items, total := run(RepairLogSearchParams{Query: "50%"}); total != 1 || items[0].ReferenceID != 1 || items[0].CreatedByName == nil || *items[0].CreatedByName != "Una Tech" {
		t.Fatalf("percent must be literal: %d %+v", total, items)
	}
	if _, total := run(RepairLogSearchParams{Query: "e_c"}); total != 1 { // snake_case only; "_" is not a wildcard
		t.Fatalf("underscore: %d", total)
	}
	if _, total := run(RepairLogSearchParams{Query: `a\b`}); total != 1 {
		t.Fatalf("backslash: %d", total)
	}
	if _, total := run(RepairLogSearchParams{Query: "BELT"}); total != 2 {
		t.Fatalf("case-insensitive: %d", total)
	}
	from, to := "2026-02-10", "2026-03-10"
	if items, total := run(RepairLogSearchParams{Query: "belt", From: &from}); total != 1 || items[0].ReferenceID != 2 {
		t.Fatalf("from: %d", total)
	}
	if _, total := run(RepairLogSearchParams{From: &from, To: &to, Job: intPtr(1)}); total != 1 {
		t.Fatalf("job + inclusive range: %d", total)
	}
	items, total := run(RepairLogSearchParams{Job: intPtr(2), PageSize: 10, Page: 3})
	if total != 27 || len(items) != 7 {
		t.Fatalf("paging: total=%d len=%d", total, len(items))
	}
	items, _ = run(RepairLogSearchParams{Job: intPtr(2), PageSize: 10, Page: 1})
	if items[0].RepairLogID < items[1].RepairLogID && items[0].RepairDate.Equal(*items[1].RepairDate) {
		t.Fatal("tie-break must be repair_log_id DESC")
	}
	if items, _ := run(RepairLogSearchParams{Query: "carb"}); strings.Contains(items[0].Snippet, "http") || strings.Contains(items[0].Snippet, "![") {
		t.Fatalf("snippet: %q", items[0].Snippet)
	}
}

func intPtr(v int) *int { return &v }
