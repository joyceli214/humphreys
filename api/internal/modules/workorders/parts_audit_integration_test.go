package workorders

import (
	"context"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PARTS_AUDIT_TEST_DATABASE_URL names an administrative connection. Each run
// creates and drops its own database; it never migrates the supplied database.
func partsAuditTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("PARTS_AUDIT_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set PARTS_AUDIT_TEST_DATABASE_URL to run PostgreSQL integration tests")
	}
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = admin.Close(ctx) })
	database := "parts_audit_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{database}.Sanitize()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := admin.Exec(ctx, "DROP DATABASE "+pgx.Identifier{database}.Sanitize()); err != nil {
			t.Error(err)
		}
	})
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.Database = database
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	// Use the real users, parts, and workflow migrations with a minimal work
	// order fixture (the production work_orders table is imported separately).
	if _, err := db.Exec(ctx, `CREATE TABLE public.work_orders(reference_id integer PRIMARY KEY);
		CREATE TABLE public.work_order_line_items(reference_id integer);`); err != nil {
		t.Fatal(err)
	}
	for _, file := range []string{"001_init.sql", "005_repair_logs_and_parts_purchase_requests.sql", "036_parts_request_status_workflow.sql", "038_parts_purchase_request_audit.sql"} {
		migration, err := os.ReadFile("../../../migrations/" + file)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(ctx, string(migration)); err != nil {
			t.Fatalf("%s: %v", file, err)
		}
	}
	return db
}

func TestPartsAuditPostgres(t *testing.T) {
	db := partsAuditTestDB(t)
	ctx := context.Background()
	repo := &storeRepository{db: db}
	service := NewService(repo)
	creator, editor := uuid.NewString(), uuid.NewString()
	if _, err := db.Exec(ctx, `INSERT INTO users(id,email,password_hash,full_name) VALUES ($1,'creator@test','test','Creator'),($2,'editor@test','test','Editor');`, creator, editor); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO work_orders VALUES (1), (2)`); err != nil {
		t.Fatal(err)
	}
	create := func(referenceID int, status string) int64 {
		t.Helper()
		item, err := service.CreatePartsPurchaseRequest(ctx, referenceID, CreatePartsPurchaseRequestInput{
			Source: "supplier", Status: &status, ItemName: "Capacitor", Quantity: 1, TotalPrice: 10, CreatedByUserID: creator,
		})
		if err != nil {
			t.Fatal(err)
		}
		if status == "approved" && !reflect.DeepEqual(item.AuditFlags, []string{PartsFlagApprovedWithoutReview}) {
			t.Fatalf("create response missing warning: %v", item.AuditFlags)
		}
		return item.PartsPurchaseRequestID
	}
	update := func(id int64, status string, price float64, actor string) error {
		_, err := service.UpdatePartsPurchaseRequest(ctx, 1, id, UpdatePartsPurchaseRequestInput{
			Source: "supplier", Status: status, ItemName: "Capacitor", Quantity: 1, TotalPrice: price, ActorUserID: actor, CanApprove: true,
		})
		return err
	}
	history := func(referenceID int, id *int64) []PartsAuditEntry {
		t.Helper()
		entries, err := service.PartsPurchaseRequestHistory(ctx, referenceID, id)
		if err != nil {
			t.Fatal(err)
		}
		return entries
	}

	id := create(1, "approved") // Direct approval remains allowed.
	if err := update(id, "approved", 25, editor); err != nil {
		t.Fatalf("price editing after approval was blocked: %v", err)
	}
	entries := history(1, &id)
	if len(entries) != 3 || *entries[2].OldValue != "10.00" || *entries[2].NewValue != "25.00" || !entries[2].AfterApproval || *entries[2].ChangedByUserID != editor || *entries[2].ChangedByName != "Editor" || entries[2].ChangedAt.IsZero() {
		t.Fatalf("incorrect actor/price audit: %+v", entries)
	}
	wantFlags := []string{PartsFlagApprovedWithoutReview, PartsFlagPriceChangedAfterApproval}
	listed, err := service.ListPartsPurchaseRequests(ctx, 1)
	if err != nil || len(listed) != 1 || !reflect.DeepEqual(listed[0].AuditFlags, wantFlags) {
		t.Fatalf("work order flags: %+v, %v", listed, err)
	}
	all, err := service.ListAllPartsPurchaseRequests(ctx)
	if err != nil || len(all) != 1 || !reflect.DeepEqual(all[0].AuditFlags, wantFlags) {
		t.Fatalf("global list flags: %+v, %v", all, err)
	}
	if _, err := db.Exec(ctx, `UPDATE users SET full_name='Renamed editor' WHERE id=$1`, editor); err != nil {
		t.Fatal(err)
	}
	if got := history(1, &id); *got[2].ChangedByName != "Editor" {
		t.Fatal("historical name was not snapshotted")
	}
	if err := update(id, "approved", 25.001, editor); err != nil {
		t.Fatal(err)
	}
	if got := history(1, &id); len(got) != 3 {
		t.Fatalf("no-op update created audit rows: %+v", got)
	}
	if err := update(id, "ordered", 25, editor); err != nil {
		t.Fatal(err)
	}
	if got := history(1, &id); len(got) != 4 || got[3].Field == nil || *got[3].Field != "status" || *got[3].OldValue != "approved" || *got[3].NewValue != "ordered" {
		t.Fatalf("missing status change: %+v", got)
	}

	// Missing actors must roll back both the changed record and its log.
	if err := update(id, "ordered", 80, uuid.NewString()); err == nil {
		t.Fatal("update without an existing actor succeeded")
	}
	var price float64
	if err := db.QueryRow(ctx, `SELECT total_price::double precision FROM parts_purchase_requests WHERE parts_purchase_request_id=$1`, id).Scan(&price); err != nil || price != 25 {
		t.Fatalf("failed audit did not roll back price: %v, %v", price, err)
	}
	if err := service.DeletePartsPurchaseRequest(ctx, 1, id, ""); err == nil {
		t.Fatal("delete without an actor succeeded")
	}
	if err := service.DeletePartsPurchaseRequest(ctx, 2, id, editor); !errors.Is(err, ErrPartsPurchaseRequestNotFound) {
		t.Fatalf("cross-work-order delete: %v", err)
	}
	if got := history(2, &id); len(got) != 0 {
		t.Fatal("history leaked across work orders")
	}
	if err := service.DeletePartsPurchaseRequest(ctx, 1, id, editor); err != nil {
		t.Fatal(err)
	}
	entries = history(1, &id)
	if len(entries) != 6 || entries[4].Action != "delete" || entries[4].NewValue != nil || *entries[5].OldValue != "25.00" {
		t.Fatalf("deleted history missing: %+v", entries)
	}

	// These statements run as the table owner, with superuser privileges.
	for _, sql := range []string{
		`UPDATE parts_purchase_request_audit SET new_value='tampered'`,
		`DELETE FROM parts_purchase_request_audit`,
		`TRUNCATE parts_purchase_request_audit`,
		`UPDATE parts_purchase_request_audit SET new_value='tampered' WHERE false`,
		`DELETE FROM parts_purchase_request_audit WHERE false`,
	} {
		if _, err := db.Exec(ctx, sql); err == nil || !strings.Contains(err.Error(), "append-only") {
			t.Fatalf("append-only enforcement failed for %s: %v", sql, err)
		}
	}
	if got := history(1, &id); len(got) != 6 {
		t.Fatal("audit rows changed after attempted tampering")
	}

	normalID := create(1, "waiting_approval")
	if err := update(normalID, "approved", 15, editor); err != nil {
		t.Fatal(err)
	}
	if got := ComputePartsFlags(history(1, &normalID)); len(got) != 0 {
		t.Fatalf("price edited alongside first approval was warned: %v", got)
	}
	// A request approved before the audit rollout still warns on new price edits.
	var legacyID int64
	if err := db.QueryRow(ctx, `INSERT INTO parts_purchase_requests(reference_id,source,status,total_price,item_name,quantity,created_by_user_id,approved_at)
		VALUES (1,'supplier','ordered',10,'Legacy part',1,$1,now()) RETURNING parts_purchase_request_id`, creator).Scan(&legacyID); err != nil {
		t.Fatal(err)
	}
	if err := update(legacyID, "ordered", 12, editor); err != nil {
		t.Fatal(err)
	}
	if got := ComputePartsFlags(history(1, &legacyID)); !reflect.DeepEqual(got, []string{PartsFlagPriceChangedAfterApproval}) {
		t.Fatalf("preexisting approval was ignored: %v", got)
	}
	otherID := create(2, "draft")
	if err := service.DeleteWorkOrder(ctx, 1, editor); err != nil {
		t.Fatal(err)
	}
	if got := history(1, &normalID); got[len(got)-1].Action != "delete" {
		t.Fatal("work order deletion did not audit its parts deletions")
	}
	if got := history(1, &id); len(got) != 6 {
		t.Fatal("work order deletion removed earlier history")
	}
	if got := history(2, &otherID); len(got) != 2 {
		t.Fatal("work order deletion affected other history")
	}
}
