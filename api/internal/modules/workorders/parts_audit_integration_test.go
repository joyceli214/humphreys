package workorders

import (
	"context"
	"errors"
	"humphreys/api/internal/domain"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PARTS_AUDIT_TEST_DATABASE_URL names an administrative connection. Each run
// creates and drops its own database; it never migrates the supplied database.
func partsAuditTestDB(t *testing.T, beforeWorkflow ...func(*pgxpool.Pool)) *pgxpool.Pool {
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
		if file == "036_parts_request_status_workflow.sql" {
			for _, setup := range beforeWorkflow {
				setup(db)
			}
		}
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
	service := NewService(&storeRepository{db: db})
	creator, editor := uuid.NewString(), uuid.NewString()
	if _, err := db.Exec(ctx, `INSERT INTO users(id,email,password_hash,full_name) VALUES ($1,'creator@test','test','Creator'),($2,'editor@test','test','Editor');`, creator, editor); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO work_orders VALUES (1), (2)`); err != nil {
		t.Fatal(err)
	}
	create := func(referenceID int, status string) domain.PartsPurchaseRequest {
		t.Helper()
		item, err := service.CreatePartsPurchaseRequest(ctx, referenceID, CreatePartsPurchaseRequestInput{
			Source: "supplier", SourceURL: strPtr("https://example.com/a_b"), Status: &status, ItemName: "Capacitor", Quantity: 1, TotalPrice: 10, CreatedByUserID: creator,
		})
		if err != nil {
			t.Fatal(err)
		}
		if status == "approved" && !reflect.DeepEqual(item.AuditFlags, []string{PartsFlagApprovedWithoutReview}) {
			t.Fatalf("create flags: %v", item.AuditFlags)
		}
		return item
	}
	update := func(item domain.PartsPurchaseRequest, status string, price float64, actor string) domain.PartsPurchaseRequest {
		t.Helper()
		updated, err := service.UpdatePartsPurchaseRequest(ctx, int(item.ReferenceID), item.PartsPurchaseRequestID, UpdatePartsPurchaseRequestInput{
			UpdatedAt: *item.UpdatedAt, Source: item.Source, SourceURL: item.SourceURL, Status: status, ItemName: item.ItemName, Quantity: item.Quantity, TotalPrice: price, ActorUserID: actor, CanApprove: true,
		})
		if err != nil {
			t.Fatal(err)
		}
		if !updated.UpdatedAt.After(*item.UpdatedAt) {
			t.Fatal("version did not advance")
		}
		return updated
	}
	history := func(referenceID int, id *int64) []PartsAuditEntry {
		t.Helper()
		entries, err := service.PartsPurchaseRequestHistory(ctx, referenceID, id)
		if err != nil {
			t.Fatal(err)
		}
		return entries
	}
	item := create(1, "approved") // Direct approval remains allowed.
	id := item.PartsPurchaseRequestID
	created := history(1, &id)
	if len(created) != 6 {
		t.Fatalf("create snapshot: %+v", created)
	}
	for i, row := range createPartsAuditRows(item) {
		if created[i].Action != "create" || *created[i].Field != row.Field || created[i].OldValue != nil || !sameAuditValue(created[i].NewValue, row.New) {
			t.Fatalf("create field %s: %+v", row.Field, created[i])
		}
	}
	item = update(item, "approved", 25, editor)
	entries := history(1, &id)
	if len(entries) != 7 || *entries[6].OldValue != "10.00" || *entries[6].NewValue != "25.00" || !entries[6].AfterApproval || *entries[6].ChangedByUserID != editor || *entries[6].ChangedByName != "Editor" || entries[6].ChangedAt.IsZero() {
		t.Fatalf("price audit: %+v", entries)
	}
	wantFlags := []string{PartsFlagApprovedWithoutReview, PartsFlagPriceChangedAfterApproval}
	listed, err := service.ListPartsPurchaseRequests(ctx, 1)
	if err != nil || len(listed) != 1 || !reflect.DeepEqual(listed[0].AuditFlags, wantFlags) {
		t.Fatalf("work order flags: %+v, %v", listed, err)
	}
	all, err := service.ListAllPartsPurchaseRequests(ctx)
	if err != nil || len(all) != 1 || !reflect.DeepEqual(all[0].AuditFlags, wantFlags) {
		t.Fatalf("global flags: %+v, %v", all, err)
	}
	if _, err := db.Exec(ctx, `UPDATE users SET full_name='Renamed editor' WHERE id=$1`, editor); err != nil {
		t.Fatal(err)
	}
	if got := history(1, &id); *got[6].ChangedByName != "Editor" {
		t.Fatal("historical name changed")
	}
	item = update(item, "approved", 25.001, editor)
	if got := history(1, &id); len(got) != 7 {
		t.Fatalf("rounded no-op logged: %+v", got)
	}
	item = update(item, "ordered", 25, editor)
	if got := history(1, &id); len(got) != 8 || *got[7].Field != "status" || *got[7].OldValue != "approved" || *got[7].NewValue != "ordered" {
		t.Fatalf("status audit: %+v", got)
	}

	// Update all newly audited fields and clear a non-NULL URL, using a missing actor.
	missingActor := uuid.NewString()
	changed, err := service.UpdatePartsPurchaseRequest(ctx, 1, id, UpdatePartsPurchaseRequestInput{
		UpdatedAt: *item.UpdatedAt, Source: "online", Status: "ordered", ItemName: "New_part", Quantity: 3, TotalPrice: 25, ActorUserID: missingActor,
	})
	if err != nil {
		t.Fatalf("missing user blocked action: %v", err)
	}
	entries = history(1, &id)
	expected := diffPartsAudit(item, changed)
	if len(expected) != 4 || len(entries) != 12 {
		t.Fatalf("metadata audit: %+v", entries)
	}
	for i, row := range expected {
		e := entries[8+i]
		if *e.Field != row.Field || !sameAuditValue(e.OldValue, row.Old) || !sameAuditValue(e.NewValue, row.New) || *e.ChangedByUserID != missingActor || e.ChangedByName != nil || e.AfterApproval {
			t.Fatalf("metadata/actor mismatch: %+v", e)
		}
	}
	item = changed
	// An actual audit failure still rolls back the request, its version and audit.
	_, err = service.UpdatePartsPurchaseRequest(ctx, 1, id, UpdatePartsPurchaseRequestInput{UpdatedAt: *item.UpdatedAt, Source: item.Source, Status: item.Status, ItemName: item.ItemName, Quantity: item.Quantity, TotalPrice: 80, ActorUserID: "bad-uuid"})
	if err == nil {
		t.Fatal("invalid audit actor succeeded")
	}
	listed, err = service.ListPartsPurchaseRequests(ctx, 1)
	if err != nil || listed[0].TotalPrice != 25 || !listed[0].UpdatedAt.Equal(*item.UpdatedAt) || len(history(1, &id)) != 12 {
		t.Fatalf("audit failure not atomic: %+v %v", listed, err)
	}
	if err := service.DeletePartsPurchaseRequest(ctx, 1, id, ""); err == nil {
		t.Fatal("delete with malformed actor succeeded")
	}
	if err := service.DeletePartsPurchaseRequest(ctx, 2, id, editor); !errors.Is(err, ErrPartsPurchaseRequestNotFound) {
		t.Fatalf("cross-order delete: %v", err)
	}
	if got := history(2, &id); len(got) != 0 {
		t.Fatal("history leaked")
	}
	if err := service.DeletePartsPurchaseRequest(ctx, 1, id, missingActor); err != nil {
		t.Fatal(err)
	}
	entries = history(1, &id)
	if len(entries) != 18 {
		t.Fatalf("delete snapshot: %+v", entries)
	}
	for i, row := range deletePartsAuditRows(item) {
		e := entries[12+i]
		if e.Action != "delete" || *e.Field != row.Field || e.NewValue != nil || !sameAuditValue(e.OldValue, row.Old) || e.ChangedByName != nil {
			t.Fatalf("delete field %s: %+v", row.Field, e)
		}
	}
	// These statements run as the table owner, with superuser privileges.
	for _, sql := range []string{`UPDATE parts_purchase_request_audit SET new_value='tampered'`, `DELETE FROM parts_purchase_request_audit`, `TRUNCATE parts_purchase_request_audit`, `UPDATE parts_purchase_request_audit SET new_value='tampered' WHERE false`, `DELETE FROM parts_purchase_request_audit WHERE false`} {
		if _, err := db.Exec(ctx, sql); err == nil || !strings.Contains(err.Error(), "append-only") {
			t.Fatalf("enforcement failed for %s: %v", sql, err)
		}
	}
	if len(history(1, &id)) != 18 {
		t.Fatal("tampering changed audit")
	}

	normal := create(1, "draft")
	for _, status := range []string{"waiting_approval", "approved", "ordered", "arrived", "used", "cancelled"} {
		normal = update(normal, status, 15, editor)
		if len(normal.AuditFlags) != 0 {
			t.Fatalf("normal flow warned: %v", normal.AuditFlags)
		}
	}
	for _, stamp := range []*time.Time{normal.ApprovedAt, normal.OrderedAt, normal.ArrivedAt, normal.UsedAt, normal.CancelledAt} {
		if stamp == nil || stamp.IsZero() {
			t.Fatal("workflow timestamp missing")
		}
	}
	normal = update(normal, "cancelled", 15, editor)
	legacyID := int64(0)
	if err := db.QueryRow(ctx, `INSERT INTO parts_purchase_requests(reference_id,source,status,total_price,item_name,quantity,created_by_user_id,approved_at) VALUES (1,'supplier','ordered',10,'Legacy part',1,$1,now()) RETURNING parts_purchase_request_id`, creator).Scan(&legacyID); err != nil {
		t.Fatal(err)
	}
	listed, err = service.ListPartsPurchaseRequests(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	for _, legacy := range listed {
		if legacy.PartsPurchaseRequestID == legacyID {
			legacy = update(legacy, "ordered", 12, editor)
			if !reflect.DeepEqual(legacy.AuditFlags, []string{PartsFlagPriceChangedAfterApproval}) {
				t.Fatalf("legacy approval ignored: %v", legacy.AuditFlags)
			}
		}
	}
	other := create(2, "draft")
	if err := service.DeleteWorkOrder(ctx, 1, missingActor); err != nil {
		t.Fatal(err)
	}
	normalHistory := history(1, &normal.PartsPurchaseRequestID)
	if normalHistory[len(normalHistory)-6].Action != "delete" || *normalHistory[len(normalHistory)-3].OldValue != normal.ItemName {
		t.Fatal("work-order deletion missing full snapshot")
	}
	if len(history(1, &id)) != 18 || len(history(2, &other.PartsPurchaseRequestID)) != 6 {
		t.Fatal("work-order deletion changed unrelated history")
	}
}

func TestPartsPatchConcurrentPostgres(t *testing.T) {
	db := partsAuditTestDB(t)
	ctx := context.Background()
	actor := uuid.NewString()
	if _, err := db.Exec(ctx, `INSERT INTO users(id,email,password_hash,full_name) VALUES($1,'actor@test','test','Actor'); INSERT INTO work_orders VALUES(1);`, pgx.QueryExecModeSimpleProtocol, actor); err != nil {
		t.Fatal(err)
	}
	service := NewService(&storeRepository{db: db})
	item, err := service.CreatePartsPurchaseRequest(ctx, 1, CreatePartsPurchaseRequestInput{Source: "supplier", ItemName: "Part", Quantity: 1, CreatedByUserID: actor})
	if err != nil {
		t.Fatal(err)
	}
	start, result := make(chan struct{}), make(chan error, 2)
	for _, quantity := range []int32{2, 3} {
		go func(quantity int32) {
			<-start
			_, err := service.UpdatePartsPurchaseRequest(ctx, 1, item.PartsPurchaseRequestID, UpdatePartsPurchaseRequestInput{UpdatedAt: *item.UpdatedAt, Source: item.Source, Status: item.Status, TotalPrice: item.TotalPrice, ItemName: item.ItemName, Quantity: quantity, ActorUserID: actor})
			result <- err
		}(quantity)
	}
	close(start)
	successes, conflicts := 0, 0
	for i := 0; i < 2; i++ {
		err := <-result
		if err == nil {
			successes++
		} else if errors.Is(err, ErrPartsPurchaseRequestConflict) {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("successes=%d conflicts=%d", successes, conflicts)
	}
	history, err := service.PartsPurchaseRequestHistory(ctx, 1, &item.PartsPurchaseRequestID)
	if err != nil || len(history) != 7 || *history[6].Field != "quantity" {
		t.Fatalf("stale save wrote audit: %+v %v", history, err)
	}
	listed, err := service.ListPartsPurchaseRequests(ctx, 1)
	if err != nil || len(listed) != 1 || !listed[0].UpdatedAt.After(*item.UpdatedAt) || (listed[0].Quantity != 2 && listed[0].Quantity != 3) {
		t.Fatalf("concurrent result: %+v %v", listed, err)
	}
}

func TestPartsWorkflowMigrationPostgres(t *testing.T) {
	actor := uuid.NewString()
	db := partsAuditTestDB(t, func(db *pgxpool.Pool) {
		_, err := db.Exec(context.Background(), `ALTER TABLE parts_purchase_requests RENAME CONSTRAINT parts_purchase_requests_status_check TO imported_status_constraint;
   INSERT INTO users(id,email,password_hash,full_name) VALUES($1,'legacy@test','test','Legacy');`, pgx.QueryExecModeSimpleProtocol, actor)
		if err != nil {
			t.Fatal(err)
		}
		_, err = db.Exec(context.Background(), `INSERT INTO work_orders VALUES(1);
   INSERT INTO parts_purchase_requests(reference_id,source,status,item_name,quantity,created_by_user_id,updated_at)
   VALUES(1,'supplier','ordered','Ordered',1,$1,'2025-01-02T12:34:56Z'),(1,'supplier','used','Used',1,$1,'2025-01-03T12:34:56Z');`, pgx.QueryExecModeSimpleProtocol, actor)
		if err != nil {
			t.Fatal(err)
		}
	})
	ctx := context.Background()
	var count int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM parts_purchase_requests WHERE ordered_at = updated_at AND ((status='ordered' AND used_at IS NULL) OR (status='used' AND used_at=updated_at))`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("backfill: %d %v", count, err)
	}
	if _, err := db.Exec(ctx, `UPDATE parts_purchase_requests SET status='arrived' WHERE status='ordered'`); err != nil {
		t.Fatalf("legacy constraint not replaced: %v", err)
	}
	if _, err := db.Exec(ctx, `UPDATE parts_purchase_requests SET status='invalid'`); err == nil {
		t.Fatal("status CHECK lost")
	}
	if err := db.QueryRow(ctx, `SELECT count(*) FROM pg_constraint WHERE conrelid='public.parts_purchase_request_audit'::regclass AND contype='f'`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("audit foreign key: %d %v", count, err)
	}
	if err := db.QueryRow(ctx, `SELECT count(*) FROM permissions WHERE code='parts_purchase_requests:approve'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("approval permission missing: %d %v", count, err)
	}
}
