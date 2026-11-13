package workorders

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// torontoPool reopens the test database with every pooled connection's
// session TimeZone set to America/Toronto, as in production.
func torontoPool(t *testing.T, base *pgxpool.Pool) *pgxpool.Pool {
	t.Helper()
	cfg := base.Config()
	if cfg.ConnConfig.RuntimeParams == nil {
		cfg.ConnConfig.RuntimeParams = map[string]string{}
	}
	cfg.ConnConfig.RuntimeParams["timezone"] = "America/Toronto"
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	var tz string
	if err := pool.QueryRow(context.Background(), `SHOW TimeZone`).Scan(&tz); err != nil || tz != "America/Toronto" {
		t.Fatalf("session TimeZone = %q err=%v", tz, err)
	}
	return pool
}

// viaJSON round-trips the preview's updated_at through JSON like the browser.
func viaJSON(t *testing.T, ts *time.Time) *time.Time {
	t.Helper()
	b, err := json.Marshal(ts)
	if err != nil {
		t.Fatal(err)
	}
	var out *time.Time
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestSameUpdatedAt(t *testing.T) {
	base := time.Date(2026, 11, 8, 11, 57, 48, 705151000, time.UTC)
	toronto, err := time.LoadLocation("America/Toronto")
	if err != nil {
		t.Fatal(err)
	}
	sameInstant := base.In(toronto)
	withNanos := base.Add(300 * time.Nanosecond)
	later := base.Add(time.Microsecond)
	cases := []struct {
		name              string
		current, expected *time.Time
		want              bool
	}{
		{"both nil", nil, nil, true},
		{"was null, now set", &base, nil, false},
		{"was set, now null", nil, &base, false},
		{"same value", &base, viaJSON(t, &base), true},
		{"same instant other zone", &base, &sameInstant, true},
		{"sub-microsecond noise", &withNanos, &base, true},
		{"edited", &later, &base, false},
	}
	for _, c := range cases {
		if got := sameUpdatedAt(c.current, c.expected); got != c.want {
			t.Errorf("%s: got %v want %v", c.name, got, c.want)
		}
	}
}

// Production work_orders.updated_at is `timestamp without time zone` (legacy
// import) and the session TimeZone is America/Toronto. An unchanged job must
// apply; a real edit after the preview must still be rejected. Same for a
// timestamptz column.
func TestApplyMassUpdateJobStaleCheckAcrossColumnTypesPostgres(t *testing.T) {
	for _, colType := range []string{"timestamp without time zone", "timestamptz"} {
		t.Run(colType, func(t *testing.T) {
			pool := torontoPool(t, partsAuditTestDB(t))
			ctx := context.Background()
			if _, err := pool.Exec(ctx, `
				ALTER TABLE work_orders ADD COLUMN updated_at `+colType+`, ADD COLUMN labour_total numeric(12,2);
				INSERT INTO work_orders(reference_id, labour_total, updated_at)
				VALUES (1, 50, now() - interval '1 hour'), (2, 50, NULL), (3, 50, NULL);`); err != nil {
				t.Fatal(err)
			}
			repo := &storeRepository{db: pool}
			op := []massUpdateResolvedOp{{Op: massOpSetLabourTotal, LabourTotal: ptrFloat(80)}}

			// Unchanged since preview: applies.
			previewed := viaJSON(t, currentUpdatedAt(t, pool, 1))
			if _, err := repo.ApplyMassUpdateJob(ctx, 1, previewed, op, ""); err != nil {
				t.Fatalf("unchanged job apply err = %v, want success", err)
			}

			// A real edit after the preview: stale.
			previewed = viaJSON(t, currentUpdatedAt(t, pool, 1))
			if _, err := pool.Exec(ctx, `UPDATE work_orders SET labour_total = 60, updated_at = now() + interval '1 second' WHERE reference_id = 1`); err != nil {
				t.Fatal(err)
			}
			if _, err := repo.ApplyMassUpdateJob(ctx, 1, previewed, op, ""); !errors.Is(err, ErrMassUpdateStale) {
				t.Fatalf("edited job apply err = %v, want ErrMassUpdateStale", err)
			}

			// NULL in preview and still NULL: applies.
			if _, err := repo.ApplyMassUpdateJob(ctx, 2, viaJSON(t, currentUpdatedAt(t, pool, 2)), op, ""); err != nil {
				t.Fatalf("null/null apply err = %v", err)
			}
			// NULL in preview but set since: stale.
			if _, err := pool.Exec(ctx, `UPDATE work_orders SET updated_at = now() WHERE reference_id = 3`); err != nil {
				t.Fatal(err)
			}
			if _, err := repo.ApplyMassUpdateJob(ctx, 3, nil, op, ""); !errors.Is(err, ErrMassUpdateStale) {
				t.Fatalf("null preview, now set err = %v, want ErrMassUpdateStale", err)
			}
		})
	}
}
