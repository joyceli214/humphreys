package workorders

import (
	"context"
	"testing"
)

func TestMassUpdateLineTotalText(t *testing.T) {
	for _, tc := range []struct {
		price float64
		qty   *string
		want  *string
	}{
		{15, nil, ptrStr("15.00")},
		{15, ptrStr(""), ptrStr("15.00")},
		{12.5, ptrStr("2"), ptrStr("25.00")},
		{10, ptrStr(" 1,5 "), ptrStr("15.00")},
		{9.99, ptrStr(".5"), ptrStr("5.00")}, // 4.995 in float64 rounds like JS toFixed
		{10, ptrStr("2 pcs"), nil},
	} {
		got := massUpdateLineTotalText(tc.price, tc.qty)
		if (got == nil) != (tc.want == nil) || (got != nil && *got != *tc.want) {
			t.Errorf("massUpdateLineTotalText(%v, %v) = %v, want %v", tc.price, stringOrEmpty(tc.qty), stringOrEmpty(got), stringOrEmpty(tc.want))
		}
	}
}

func TestApplyMassUpdateJobRecalculatesPartsTotalPostgres(t *testing.T) {
	pool := partsAuditTestDB(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `
		ALTER TABLE work_orders ADD COLUMN parts_total numeric(12,2), ADD COLUMN updated_at timestamptz;
		ALTER TABLE work_order_line_items ADD COLUMN line_item_id bigserial PRIMARY KEY,
			ADD COLUMN item_name text, ADD COLUMN unit_price numeric(12,2),
			ADD COLUMN quantity_text text, ADD COLUMN line_total_text text;
		INSERT INTO work_orders(reference_id, parts_total) VALUES (1, 20);
		INSERT INTO work_order_line_items(line_item_id, reference_id, item_name, unit_price, quantity_text, line_total_text)
		VALUES (1, 1, 'Belt', 10, '2', '20.00');
		-- Explicit IDs bypass the bigserial; advance it as migration 012 does in production.
		SELECT setval(pg_get_serial_sequence('work_order_line_items', 'line_item_id'), (SELECT MAX(line_item_id) FROM work_order_line_items));`); err != nil {
		t.Fatal(err)
	}
	repo := &storeRepository{db: pool}
	partsTotal := func() float64 {
		t.Helper()
		var total float64
		if err := pool.QueryRow(ctx, `SELECT parts_total::double precision FROM work_orders WHERE reference_id = 1`).Scan(&total); err != nil {
			t.Fatal(err)
		}
		return total
	}

	id := int64(1)
	if _, err := repo.ApplyMassUpdateJob(ctx, 1, currentUpdatedAt(t, pool, 1), []massUpdateResolvedOp{{Op: massOpSetLineItemPrice, LineItemID: &id, UnitPrice: ptrFloat(12.5)}}, ""); err != nil {
		t.Fatal(err)
	}
	if got := partsTotal(); got != 25 {
		t.Fatalf("parts total after price change = %v, want 25", got)
	}

	if _, err := repo.ApplyMassUpdateJob(ctx, 1, currentUpdatedAt(t, pool, 1), []massUpdateResolvedOp{{Op: massOpAddLineItem, ItemName: ptrStr("Shipping"), UnitPrice: ptrFloat(15)}}, ""); err != nil {
		t.Fatal(err)
	}
	if got := partsTotal(); got != 40 {
		t.Fatalf("parts total after adding Shipping = %v, want 40", got)
	}
	var lineTotal string
	if err := pool.QueryRow(ctx, `SELECT line_total_text FROM work_order_line_items WHERE item_name = 'Shipping'`).Scan(&lineTotal); err != nil || lineTotal != "15.00" {
		t.Fatalf("Shipping line_total_text = %q, %v", lineTotal, err)
	}

	if _, err := repo.ApplyMassUpdateJob(ctx, 1, currentUpdatedAt(t, pool, 1), []massUpdateResolvedOp{{Op: massOpRemoveLineItem, LineItemID: &id}}, ""); err != nil {
		t.Fatal(err)
	}
	if got := partsTotal(); got != 15 {
		t.Fatalf("parts total after remove = %v, want 15", got)
	}
}
