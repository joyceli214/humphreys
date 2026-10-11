package workorders

import (
	"context"
	"humphreys/api/internal/db"
	"os"
	"path/filepath"
	"testing"
)

func TestLabourDiscountMigrationAfterPartsAuditPostgres(t *testing.T) {
	pool := partsAuditTestDB(t) // The real 036 and 038 migrations are already applied.
	ctx := context.Background()
	_, err := pool.Exec(ctx, `ALTER TABLE work_orders
		ADD COLUMN labour_total numeric(12,2), ADD COLUMN updated_at timestamptz;
		INSERT INTO work_orders(reference_id, labour_total) VALUES (1, 200);
		INSERT INTO users(id,email,password_hash,full_name)
		VALUES ('00000000-0000-0000-0000-000000000001','owner@test','test','Owner');
		CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
		INSERT INTO schema_migrations(version) VALUES
		('036_parts_request_status_workflow.sql'), ('038_parts_purchase_request_audit.sql');`)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	for _, file := range []string{"036_parts_request_status_workflow.sql", "037_work_orders_labour_discount.sql", "038_parts_purchase_request_audit.sql"} {
		migration, err := os.ReadFile("../../../migrations/" + file)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, file), migration, 0600); err != nil {
			t.Fatal(err)
		}
	}
	// The runner must apply the missing 037 despite the higher recorded version,
	// and must skip all three migrations on the next startup.
	for range 2 {
		if err := db.RunMigrations(ctx, pool, dir); err != nil {
			t.Fatal(err)
		}
	}
	var appliedAfterParts bool
	if err := pool.QueryRow(ctx, `SELECT discount.applied_at > parts.applied_at
		FROM schema_migrations discount, schema_migrations parts
		WHERE discount.version='037_work_orders_labour_discount.sql'
		AND parts.version='038_parts_purchase_request_audit.sql'`).Scan(&appliedAfterParts); err != nil || !appliedAfterParts {
		t.Fatalf("037 was not applied after 038: %v", err)
	}
	repo := &storeRepository{db: pool}
	actor := "00000000-0000-0000-0000-000000000001"
	for _, change := range []struct {
		kind  *string
		value *float64
	}{
		{discountPtr("percent"), discountPtr(10.0)},
		{discountPtr("amount"), discountPtr(50.0)},
		{nil, nil},
	} {
		if err := repo.UpdateLabourDiscount(ctx, 1, change.kind, change.value, actor); err != nil {
			t.Fatal(err)
		}
	}
	history, err := repo.LabourDiscountHistory(ctx, 1)
	if err != nil || len(history) != 3 {
		t.Fatalf("discount audit after 038: %+v, %v", history, err)
	}
	if history[0].NewType != nil || *history[0].OldType != "amount" || *history[0].OldValue != 50 || history[0].ChangedByName != "Owner" ||
		*history[1].OldType != "percent" || *history[1].OldValue != 10 || *history[1].NewValue != 50 || history[2].OldType != nil {
		t.Fatalf("incorrect discount history: %+v", history)
	}
	// Both features remain usable in the same migrated database.
	_, err = NewService(repo).CreatePartsPurchaseRequest(ctx, 1, CreatePartsPurchaseRequestInput{
		Source: "supplier", ItemName: "Review part", Quantity: 1, TotalPrice: 25, CreatedByUserID: actor,
	})
	if err != nil {
		t.Fatal(err)
	}
	partsHistory, err := NewService(repo).PartsPurchaseRequestHistory(ctx, 1, nil)
	if err != nil || len(partsHistory) != 6 {
		t.Fatalf("parts audit after 037: %+v, %v", partsHistory, err)
	}
}
