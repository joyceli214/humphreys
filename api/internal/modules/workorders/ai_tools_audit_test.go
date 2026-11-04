package workorders

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/google/uuid"
)

func TestMassUpdateAuditMetadata(t *testing.T) {
	raw, err := massUpdateAuditMetadata(massUpdateAuditEntry{
		ReferenceID: 42,
		Op:          massOpSetLineItemPrice,
		Before:      map[string]any{"line_item_id": int64(7), "unit_price": 10.0},
		After:       map[string]any{"line_item_id": int64(7), "unit_price": 12.5},
	})
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{
		"source":       "ai_mass_update",
		"reference_id": float64(42),
		"op":           "set_line_item_price",
		"before":       map[string]any{"line_item_id": float64(7), "unit_price": 10.0},
		"after":        map[string]any{"line_item_id": float64(7), "unit_price": 12.5},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("metadata = %v, want %v", got, want)
	}

	// Add/remove have no before/after side respectively; null must be explicit.
	raw, err = massUpdateAuditMetadata(massUpdateAuditEntry{ReferenceID: 1, Op: massOpAddLineItem, After: map[string]any{"item_name": "Belt"}})
	if err != nil {
		t.Fatal(err)
	}
	got = nil
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if v, ok := got["before"]; !ok || v != nil {
		t.Fatalf("before = %v (present=%v), want explicit null", v, ok)
	}
}

func TestMassUpdateAuditAction(t *testing.T) {
	if got := massUpdateAuditAction(massOpSetStatus); got != "work_order.ai_mass_update.set_status" {
		t.Fatalf("action = %q", got)
	}
}

func TestApplyMassUpdateJobWritesAuditForEveryOpPostgres(t *testing.T) {
	pool := partsAuditTestDB(t)
	ctx := context.Background()
	actor := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO users(id,email,password_hash,full_name) VALUES ('`+actor+`','actor@test','test','Actor');
		CREATE TABLE work_order_statuses(status_id bigint PRIMARY KEY, display_name text, status_group text);
		CREATE TABLE locations(location_id bigint PRIMARY KEY, shelf text, floor int, is_active boolean);
		INSERT INTO work_order_statuses VALUES (1,'New','to_do'),(2,'Done','done');
		INSERT INTO locations VALUES (1,'A',1,true),(2,'B',2,true);
		ALTER TABLE work_orders ADD COLUMN parts_total numeric(12,2), ADD COLUMN updated_at timestamptz,
			ADD COLUMN labour_total numeric(12,2), ADD COLUMN status_id bigint, ADD COLUMN status_updated_at timestamptz,
			ADD COLUMN location_id bigint, ADD COLUMN labour_discount_type text, ADD COLUMN labour_discount_value numeric(12,2);
		CREATE TABLE work_order_labour_discount_audit(id bigserial PRIMARY KEY, reference_id int, changed_by_user_id uuid,
			changed_at timestamptz DEFAULT now(), old_type text, old_value numeric(12,2), new_type text, new_value numeric(12,2));
		ALTER TABLE work_order_line_items ADD COLUMN line_item_id bigserial PRIMARY KEY,
			ADD COLUMN item_name text, ADD COLUMN unit_price numeric(12,2),
			ADD COLUMN quantity_text text, ADD COLUMN line_total_text text;
		INSERT INTO work_orders(reference_id, parts_total, labour_total, status_id, location_id) VALUES (1, 20, 50, 1, 1);
		INSERT INTO work_order_line_items(line_item_id, reference_id, item_name, unit_price, quantity_text, line_total_text)
		VALUES (1, 1, 'Belt', 10, '2', '20.00'), (2, 1, 'Screw', 1, '1', '1.00');
		-- Explicit IDs bypass the bigserial; advance it as migration 012 does in production.
		SELECT setval(pg_get_serial_sequence('work_order_line_items', 'line_item_id'), (SELECT MAX(line_item_id) FROM work_order_line_items));`); err != nil {
		t.Fatal(err)
	}
	repo := &storeRepository{db: pool}
	ops := []massUpdateResolvedOp{
		{Op: massOpSetLabourTotal, LabourTotal: ptrFloat(80)},
		{Op: massOpSetLabourDiscount, DiscountType: ptrStr("percent"), DiscountValue: ptrFloat(10)},
		{Op: massOpSetLineItemPrice, LineItemID: ptrInt64(1), UnitPrice: ptrFloat(12.5)},
		{Op: massOpAddLineItem, ItemName: ptrStr("Shipping"), UnitPrice: ptrFloat(15)},
		{Op: massOpRemoveLineItem, LineItemID: ptrInt64(2)},
		{Op: massOpSetStatus, StatusID: ptrInt64(2)},
		{Op: massOpSetLocation, LocationID: ptrInt64(2)},
	}
	if _, err := repo.ApplyMassUpdateJob(ctx, 1, nil, ops, actor); err != nil {
		t.Fatal(err)
	}

	rows, err := pool.Query(ctx, `SELECT actor_user_id::text, action, target_type, metadata_json FROM audit_logs ORDER BY created_at, action`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	got := map[string]map[string]any{}
	for rows.Next() {
		var gotActor, action, targetType string
		var meta map[string]any
		if err := rows.Scan(&gotActor, &action, &targetType, &meta); err != nil {
			t.Fatal(err)
		}
		if gotActor != actor || targetType != "work_order" || meta["reference_id"] != float64(1) {
			t.Fatalf("bad audit row: actor=%s target=%s meta=%v", gotActor, targetType, meta)
		}
		got[meta["op"].(string)] = meta
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(got) != len(ops) {
		t.Fatalf("audit rows for ops %v, want one per op (%d)", reflect.ValueOf(got).MapKeys(), len(ops))
	}
	check := func(op, side, key string, want any) {
		t.Helper()
		m, _ := got[op][side].(map[string]any)
		if !reflect.DeepEqual(m[key], want) {
			t.Errorf("%s %s.%s = %#v, want %#v", op, side, key, m[key], want)
		}
	}
	check(massOpSetLabourTotal, "before", "labour_total", 50.0)
	check(massOpSetLabourTotal, "after", "labour_total", 80.0)
	check(massOpSetLabourDiscount, "before", "type", nil)
	check(massOpSetLabourDiscount, "after", "type", "percent")
	check(massOpSetLabourDiscount, "after", "value", 10.0)
	check(massOpSetLineItemPrice, "before", "unit_price", 10.0)
	check(massOpSetLineItemPrice, "after", "unit_price", 12.5)
	check(massOpSetLineItemPrice, "after", "line_total_text", "25.00")
	check(massOpAddLineItem, "after", "item_name", "Shipping")
	check(massOpRemoveLineItem, "before", "item_name", "Screw")
	check(massOpSetStatus, "before", "status_id", 1.0)
	check(massOpSetStatus, "after", "status_id", 2.0)
	check(massOpSetLocation, "before", "location_id", 1.0)
	check(massOpSetLocation, "after", "location_id", 2.0)

	var discountAudits int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM work_order_labour_discount_audit WHERE reference_id = 1`).Scan(&discountAudits); err != nil {
		t.Fatal(err)
	}
	if discountAudits != 1 {
		t.Fatalf("labour discount audit rows = %d, want 1 (dedicated audit kept)", discountAudits)
	}
}
