package workorders

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// fakeSearchRows is an empty result set.
type fakeSearchRows struct{ pgx.Rows }

func (fakeSearchRows) Next() bool { return false }
func (fakeSearchRows) Close()     {}
func (fakeSearchRows) Err() error { return nil }

// fakeSearchTx records the calls AISearch makes inside its transaction.
type fakeSearchTx struct {
	pgx.Tx
	calls      []string
	execSQL    []string
	deadlines  []time.Duration // remaining time on the ctx at each call
	queryErr   error
	committed  bool
	rolledBack bool
}

func (t *fakeSearchTx) remaining(ctx context.Context) {
	if d, ok := ctx.Deadline(); ok {
		t.deadlines = append(t.deadlines, time.Until(d))
	} else {
		t.deadlines = append(t.deadlines, -1)
	}
}

func (t *fakeSearchTx) Exec(ctx context.Context, sql string, _ ...any) (pgconn.CommandTag, error) {
	t.calls = append(t.calls, "exec")
	t.execSQL = append(t.execSQL, sql)
	t.remaining(ctx)
	return pgconn.CommandTag{}, nil
}

func (t *fakeSearchTx) Query(ctx context.Context, _ string, _ ...any) (pgx.Rows, error) {
	t.calls = append(t.calls, "query")
	t.remaining(ctx)
	if t.queryErr != nil {
		return nil, t.queryErr
	}
	return fakeSearchRows{}, nil
}

func (t *fakeSearchTx) Commit(context.Context) error   { t.committed = true; return nil }
func (t *fakeSearchTx) Rollback(context.Context) error { t.rolledBack = true; return nil }

type fakeSearchDB struct{ tx *fakeSearchTx }

func (d fakeSearchDB) Begin(ctx context.Context) (pgx.Tx, error) {
	if _, ok := ctx.Deadline(); !ok {
		return nil, errors.New("Begin called without a deadline")
	}
	return d.tx, nil
}

func TestRunAISearchSetsStatementTimeoutInTx(t *testing.T) {
	tx := &fakeSearchTx{}
	rows, total, err := runAISearch(context.Background(), fakeSearchDB{tx}, aiResolvedSearchFilters{Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 0 || total != 0 {
		t.Fatalf("rows=%v total=%d", rows, total)
	}
	if len(tx.calls) != 2 || tx.calls[0] != "exec" || tx.calls[1] != "query" {
		t.Fatalf("calls = %v, want [exec query]", tx.calls)
	}
	if tx.execSQL[0] != "SET LOCAL statement_timeout = '10s'" {
		t.Fatalf("exec sql = %q", tx.execSQL[0])
	}
	for i, d := range tx.deadlines {
		if d <= 0 || d > 10*time.Second {
			t.Fatalf("call %d: ctx deadline remaining %v, want (0, 10s]", i, d)
		}
	}
	if !tx.rolledBack && !tx.committed {
		t.Fatal("transaction was left open")
	}
}

func TestRunAISearchRollsBackOnQueryError(t *testing.T) {
	tx := &fakeSearchTx{queryErr: errors.New("canceling statement due to statement timeout")}
	if _, _, err := runAISearch(context.Background(), fakeSearchDB{tx}, aiResolvedSearchFilters{Limit: 50}); err == nil {
		t.Fatal("expected error")
	}
	if !tx.rolledBack || tx.committed {
		t.Fatalf("rolledBack=%v committed=%v", tx.rolledBack, tx.committed)
	}
}
