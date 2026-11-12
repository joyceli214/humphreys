package workorders

import (
	"context"
	"errors"
	"log"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// askContextTTL is the sliding window for Management Ask follow-ups: a saved
// context counts only while it was updated within the last 5 days, and every
// answer that shows jobs or a customer slides the window forward.
const askContextTTL = 5 * 24 * time.Hour

// askNoContextReply answers a follow-up ("update both") when there is nothing
// recent to refer to.
const askNoContextReply = "I don't have recent jobs to refer to. Tell me the job numbers."

// askNoJobsReply answers when every job number named does not exist.
const askNoJobsReply = "Check the job numbers and try again."

// askPartsStatusNotice is shown when a follow-up asks to change the status of
// parts requests: Ask has no parts-status write tool.
const askPartsStatusNotice = "Ask can't change parts request status yet. Change it from each job's Parts list."

// Context topics: what the last answer was about. A follow-up update after a
// parts answer must never become a job-field Mass Update.
const (
	askTopicJobs  = "jobs"
	askTopicParts = "parts"
)

// askContext is what the server remembers per login account between Ask
// messages: only job numbers, a customer search and the topic, never message
// text.
type askContext struct {
	ReferenceIDs  []int64
	CustomerQuery string
	// Topic is askTopicJobs or askTopicParts ("" counts as jobs).
	Topic     string
	UpdatedAt time.Time
}

// normalizeAskTopic maps anything but "parts" to "jobs".
func normalizeAskTopic(topic string) string {
	if topic == askTopicParts {
		return askTopicParts
	}
	return askTopicJobs
}

// askContextStore persists askContext per user (table ai_ask_context).
type askContextStore interface {
	LoadAskContext(ctx context.Context, userID string) (askContext, bool, error)
	// SaveAskContext upserts the row and sets updated_at = now().
	SaveAskContext(ctx context.Context, userID string, ac askContext) error
	// DeleteExpiredAskContext deletes the row only if it was last updated at or
	// before cutoff (so a save from another device in between is kept).
	DeleteExpiredAskContext(ctx context.Context, userID string, cutoff time.Time) error
}

// askJobLookup reports which job numbers exist and how many parts requests
// they have.
type askJobLookup interface {
	ExistingJobIDs(ctx context.Context, ids []int64) (map[int64]bool, error)
	PartsRequestCount(ctx context.Context, ids []int64) (int, error)
}

// pgAskStore implements askContextStore and askJobLookup on PostgreSQL.
type pgAskStore struct{ db *pgxpool.Pool }

func (s *pgAskStore) LoadAskContext(ctx context.Context, userID string) (askContext, bool, error) {
	var ac askContext
	err := s.db.QueryRow(ctx,
		`SELECT reference_ids, customer_query, topic, updated_at FROM public.ai_ask_context WHERE user_id = $1::uuid`,
		userID).Scan(&ac.ReferenceIDs, &ac.CustomerQuery, &ac.Topic, &ac.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return askContext{}, false, nil
	}
	if err != nil {
		return askContext{}, false, err
	}
	ac.Topic = normalizeAskTopic(ac.Topic)
	return ac, true, nil
}

func (s *pgAskStore) SaveAskContext(ctx context.Context, userID string, ac askContext) error {
	ids := ac.ReferenceIDs
	if ids == nil {
		ids = []int64{}
	}
	_, err := s.db.Exec(ctx,
		`INSERT INTO public.ai_ask_context (user_id, reference_ids, customer_query, topic, updated_at)
		 VALUES ($1::uuid, $2::bigint[], $3, $4, now())
		 ON CONFLICT (user_id) DO UPDATE
		   SET reference_ids = EXCLUDED.reference_ids,
		       customer_query = EXCLUDED.customer_query,
		       topic = EXCLUDED.topic,
		       updated_at = now()`,
		userID, ids, ac.CustomerQuery, normalizeAskTopic(ac.Topic))
	return err
}

func (s *pgAskStore) PartsRequestCount(ctx context.Context, ids []int64) (int, error) {
	ints := askInt32IDs(ids)
	if len(ints) == 0 {
		return 0, nil
	}
	var n int
	err := s.db.QueryRow(ctx,
		`SELECT count(*) FROM public.parts_purchase_requests WHERE reference_id = ANY($1::int[])`, ints).Scan(&n)
	return n, err
}

// askInt32IDs keeps the ids that fit work_orders.reference_id (integer).
func askInt32IDs(ids []int64) []int32 {
	ints := make([]int32, 0, len(ids))
	for _, id := range ids {
		if id > 0 && id <= math.MaxInt32 {
			ints = append(ints, int32(id))
		}
	}
	return ints
}

func (s *pgAskStore) DeleteExpiredAskContext(ctx context.Context, userID string, cutoff time.Time) error {
	_, err := s.db.Exec(ctx,
		`DELETE FROM public.ai_ask_context WHERE user_id = $1::uuid AND updated_at <= $2`, userID, cutoff)
	return err
}

func (s *pgAskStore) ExistingJobIDs(ctx context.Context, ids []int64) (map[int64]bool, error) {
	ints := askInt32IDs(ids)
	out := make(map[int64]bool, len(ints))
	if len(ints) == 0 {
		return out, nil
	}
	rows, err := s.db.Query(ctx, `SELECT reference_id FROM public.work_orders WHERE reference_id = ANY($1::int[])`, ints)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int32
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[int64(id)] = true
	}
	return out, rows.Err()
}

// loadAskContext returns the user's context if it is fresh. An expired row is
// treated as empty and deleted. Errors degrade to "no context".
func (h *Handler) loadAskContext(ctx context.Context, userID string, now time.Time) askContext {
	if h.askContext == nil || userID == "" {
		return askContext{}
	}
	ac, ok, err := h.askContext.LoadAskContext(ctx, userID)
	if err != nil {
		log.Printf("[ai] ask context load: %v", err)
		return askContext{}
	}
	if !ok {
		return askContext{}
	}
	cutoff := now.Add(-askContextTTL)
	if !ac.UpdatedAt.After(cutoff) {
		if err := h.askContext.DeleteExpiredAskContext(ctx, userID, cutoff); err != nil {
			log.Printf("[ai] ask context expire: %v", err)
		}
		return askContext{}
	}
	return ac
}

func (h *Handler) saveAskContext(ctx context.Context, userID string, ac askContext) {
	if h.askContext == nil || userID == "" {
		return
	}
	if err := h.askContext.SaveAskContext(ctx, userID, ac); err != nil {
		log.Printf("[ai] ask context save: %v", err)
	}
}

// checkAskJobs splits ids into found and missing (order kept). ok is false when
// no lookup is configured or it failed; callers then skip the check.
func (h *Handler) checkAskJobs(ctx context.Context, ids []int64) (found, missing []int64, ok bool) {
	if h.askJobs == nil || len(ids) == 0 {
		return nil, nil, false
	}
	exists, err := h.askJobs.ExistingJobIDs(ctx, ids)
	if err != nil {
		log.Printf("[ai] ask job lookup: %v", err)
		return nil, nil, false
	}
	found, missing = make([]int64, 0, len(ids)), make([]int64, 0)
	for _, id := range ids {
		if exists[id] {
			found = append(found, id)
		} else {
			missing = append(missing, id)
		}
	}
	return found, missing, true
}
