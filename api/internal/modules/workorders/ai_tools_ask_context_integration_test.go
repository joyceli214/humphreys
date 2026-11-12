package workorders

import (
	"context"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ASK_CONTEXT_TEST_DATABASE_URL names an administrative connection. Each run
// creates and drops its own database; it never migrates the supplied database.
func askContextTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("ASK_CONTEXT_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set ASK_CONTEXT_TEST_DATABASE_URL to run PostgreSQL integration tests")
	}
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = admin.Close(ctx) })
	database := "ask_context_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	// Real users migration, 005 (parts requests), 043 then 045; minimal
	// work_orders fixture.
	if _, err := db.Exec(ctx, `CREATE TABLE public.work_orders(reference_id integer PRIMARY KEY)`); err != nil {
		t.Fatal(err)
	}
	for _, file := range []string{
		"001_init.sql", "005_repair_logs_and_parts_purchase_requests.sql",
		"043_ask_context.sql", "043_ask_context.sql", // twice: idempotent
		"045_ask_context_topic.sql", "045_ask_context_topic.sql",
	} {
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

func TestAskContextPostgres(t *testing.T) {
	db := askContextTestDB(t)
	ctx := context.Background()
	store := &pgAskStore{db: db}
	userA, userB := uuid.NewString(), uuid.NewString()
	if _, err := db.Exec(ctx, `INSERT INTO users(id,email,password_hash,full_name) VALUES ($1,'a@test','x','A'),($2,'b@test','x','B')`, userA, userB); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO work_orders VALUES (15), (275), (27501)`); err != nil {
		t.Fatal(err)
	}

	if _, ok, err := store.LoadAskContext(ctx, userA); err != nil || ok {
		t.Fatalf("empty load: ok=%v err=%v", ok, err)
	}
	if err := store.SaveAskContext(ctx, userA, askContext{ReferenceIDs: []int64{275, 27501}}); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveAskContext(ctx, userB, askContext{CustomerQuery: "Test Customer B"}); err != nil {
		t.Fatal(err)
	}
	got, ok, err := store.LoadAskContext(ctx, userA)
	if err != nil || !ok || !reflect.DeepEqual(got.ReferenceIDs, []int64{275, 27501}) || got.Topic != askTopicJobs || time.Since(got.UpdatedAt) > time.Minute {
		t.Fatalf("load A = %+v ok=%v err=%v", got, ok, err)
	}
	got, _, _ = store.LoadAskContext(ctx, userB)
	if got.CustomerQuery != "Test Customer B" || len(got.ReferenceIDs) != 0 {
		t.Fatalf("load B = %+v", got)
	}

	// Upsert overwrites.
	if err := store.SaveAskContext(ctx, userA, askContext{ReferenceIDs: []int64{15}, CustomerQuery: "x"}); err != nil {
		t.Fatal(err)
	}
	got, _, _ = store.LoadAskContext(ctx, userA)
	if !reflect.DeepEqual(got.ReferenceIDs, []int64{15}) || got.CustomerQuery != "x" {
		t.Fatalf("upsert = %+v", got)
	}

	// Topic round-trips; an empty id list is kept (not treated as missing).
	if err := store.SaveAskContext(ctx, userA, askContext{ReferenceIDs: []int64{}, Topic: askTopicParts}); err != nil {
		t.Fatal(err)
	}
	got, ok, _ = store.LoadAskContext(ctx, userA)
	if !ok || len(got.ReferenceIDs) != 0 || got.Topic != askTopicParts {
		t.Fatalf("parts topic = %+v ok=%v", got, ok)
	}
	if _, err := db.Exec(ctx, `UPDATE ai_ask_context SET topic = 'other' WHERE user_id = $1`, userA); err == nil {
		t.Fatal("topic check constraint should reject unknown topics")
	}

	// Expired rows are deleted on read through the handler.
	if _, err := db.Exec(ctx, `UPDATE ai_ask_context SET updated_at = now() - interval '6 days' WHERE user_id = $1`, userA); err != nil {
		t.Fatal(err)
	}
	h := &Handler{askContext: store, askJobs: store}
	if ac := h.loadAskContext(ctx, userA, time.Now()); len(ac.ReferenceIDs) != 0 {
		t.Fatalf("expired context should be empty: %+v", ac)
	}
	if _, ok, _ := store.LoadAskContext(ctx, userA); ok {
		t.Fatal("expired row should be deleted")
	}
	if _, ok, _ := store.LoadAskContext(ctx, userB); !ok {
		t.Fatal("other user's row must stay")
	}

	// Existence check.
	exists, err := store.ExistingJobIDs(ctx, []int64{275, 16, 27501})
	if err != nil || !exists[275] || !exists[27501] || exists[16] {
		t.Fatalf("exists = %v err=%v", exists, err)
	}

	// Parts request count on jobs.
	if _, err := db.Exec(ctx, `INSERT INTO parts_purchase_requests(reference_id, source, item_name, quantity, created_by_user_id)
		VALUES (275, 'supplier', 'Belt', 1, $1), (275, 'online', 'Fuse', 2, $1), (15, 'supplier', 'Knob', 1, $1)`, userA); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		ids  []int64
		want int
	}{{[]int64{275}, 2}, {[]int64{275, 15}, 3}, {[]int64{27501}, 0}, {[]int64{}, 0}} {
		if n, err := store.PartsRequestCount(ctx, c.ids); err != nil || n != c.want {
			t.Fatalf("PartsRequestCount(%v) = %d err=%v, want %d", c.ids, n, err, c.want)
		}
	}

	// Deleting a user removes the context.
	if _, err := db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userB); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := store.LoadAskContext(ctx, userB); ok {
		t.Fatal("context should cascade on user delete")
	}
}
