package workorders

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// askContextTTL is the sliding window for Management Ask follow-ups: a saved
// context counts only while it was updated within the last 5 days, and every
// answer slides the window forward.
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
// parts answer must never become a job-field Mass Update unless it clearly
// targets the jobs.
const (
	askTopicJobs  = "jobs"
	askTopicParts = "parts"
)

const (
	// askMaxTurns is how many recent turns are kept and sent to the model.
	askMaxTurns = 12
	// askMaxTurnRunes caps each side of a turn.
	askMaxTurnRunes = 300
)

// askTurn is one short exchange: the typed text and a server-built summary of
// the answer (never full tables).
type askTurn struct {
	User      string `json:"user"`
	Assistant string `json:"assistant"`
}

// askContext is what the server remembers per login account between Ask
// messages: the job numbers, customer search and topic of the last answer,
// plus the last few turns of the conversation.
type askContext struct {
	ReferenceIDs  []int64
	CustomerQuery string
	// Topic is askTopicJobs or askTopicParts ("" counts as jobs).
	Topic     string
	Turns     []askTurn
	UpdatedAt time.Time
}

// normalizeAskTopic maps anything but "parts" to "jobs".
func normalizeAskTopic(topic string) string {
	if topic == askTopicParts {
		return askTopicParts
	}
	return askTopicJobs
}

// askOneLine collapses all whitespace (including newlines) and caps the text.
func askOneLine(s string, max int) string {
	return capRunes(strings.Join(strings.Fields(s), " "), max)
}

// appendAskTurn adds a turn and keeps only the last askMaxTurns.
func appendAskTurn(turns []askTurn, user, assistant string) []askTurn {
	out := append(append([]askTurn{}, turns...), askTurn{
		User:      askOneLine(user, askMaxTurnRunes),
		Assistant: askOneLine(assistant, askMaxTurnRunes),
	})
	if len(out) > askMaxTurns {
		out = out[len(out)-askMaxTurns:]
	}
	return out
}

// askContextStore persists askContext per user (table ai_ask_context).
type askContextStore interface {
	LoadAskContext(ctx context.Context, userID string) (askContext, bool, error)
	// SaveAskContext upserts the row (ids, customer, topic, turns) and sets
	// updated_at = now().
	SaveAskContext(ctx context.Context, userID string, ac askContext) error
	// DeleteExpiredAskContext deletes the row only if it was last updated at or
	// before cutoff (so a save from another device in between is kept).
	DeleteExpiredAskContext(ctx context.Context, userID string, cutoff time.Time) error
}

// askJobCustomer is the customer a job belongs to.
type askJobCustomer struct {
	ID   int64
	Name string
}

// askJobLookup reports which job numbers exist, how many parts requests they
// have and whose they are, and runs the job search the front end uses for a
// customer.
type askJobLookup interface {
	ExistingJobIDs(ctx context.Context, ids []int64) (map[int64]bool, error)
	PartsRequestCount(ctx context.Context, ids []int64) (int, error)
	// SearchJobIDs runs the work-order list search (GET /work-orders?q=) and
	// returns up to limit job numbers in list order.
	SearchJobIDs(ctx context.Context, query string, includeSensitive bool, limit int) ([]int64, error)
	// JobCustomers returns the customer of each job that has one.
	JobCustomers(ctx context.Context, ids []int64) (map[int64]askJobCustomer, error)
}

// pgAskStore implements askContextStore and askJobLookup on PostgreSQL.
type pgAskStore struct{ db *pgxpool.Pool }

func (s *pgAskStore) LoadAskContext(ctx context.Context, userID string) (askContext, bool, error) {
	var ac askContext
	var turns []byte
	err := s.db.QueryRow(ctx,
		`SELECT reference_ids, customer_query, topic, turns, updated_at FROM public.ai_ask_context WHERE user_id = $1::uuid`,
		userID).Scan(&ac.ReferenceIDs, &ac.CustomerQuery, &ac.Topic, &turns, &ac.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return askContext{}, false, nil
	}
	if err != nil {
		return askContext{}, false, err
	}
	ac.Topic = normalizeAskTopic(ac.Topic)
	if len(turns) > 0 {
		if err := json.Unmarshal(turns, &ac.Turns); err != nil {
			log.Printf("[ai] ask context turns: %v", err)
			ac.Turns = nil
		}
	}
	return ac, true, nil
}

func (s *pgAskStore) SaveAskContext(ctx context.Context, userID string, ac askContext) error {
	ids := ac.ReferenceIDs
	if ids == nil {
		ids = []int64{}
	}
	turns := ac.Turns
	if turns == nil {
		turns = []askTurn{}
	}
	if len(turns) > askMaxTurns {
		turns = turns[len(turns)-askMaxTurns:]
	}
	turnsJSON, err := json.Marshal(turns)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(ctx,
		`INSERT INTO public.ai_ask_context (user_id, reference_ids, customer_query, topic, turns, updated_at)
		 VALUES ($1::uuid, $2::bigint[], $3, $4, $5::jsonb, now())
		 ON CONFLICT (user_id) DO UPDATE
		   SET reference_ids = EXCLUDED.reference_ids,
		       customer_query = EXCLUDED.customer_query,
		       topic = EXCLUDED.topic,
		       turns = EXCLUDED.turns,
		       updated_at = now()`,
		userID, ids, ac.CustomerQuery, normalizeAskTopic(ac.Topic), string(turnsJSON))
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

// SearchJobIDs uses the same repository search as GET /work-orders?q=.
func (s *pgAskStore) SearchJobIDs(ctx context.Context, query string, includeSensitive bool, limit int) ([]int64, error) {
	if limit < 1 || limit > 100 {
		limit = 100
	}
	items, err := NewRepository(s.db).ListWorkOrders(ctx, query, WorkOrderListFilters{}, includeSensitive, 1, limit)
	if err != nil {
		return nil, err
	}
	out := make([]int64, 0, len(items))
	for _, it := range items {
		out = append(out, int64(it.ReferenceID))
	}
	return out, nil
}

func (s *pgAskStore) JobCustomers(ctx context.Context, ids []int64) (map[int64]askJobCustomer, error) {
	ints := askInt32IDs(ids)
	out := make(map[int64]askJobCustomer, len(ints))
	if len(ints) == 0 {
		return out, nil
	}
	rows, err := s.db.Query(ctx,
		`SELECT wo.reference_id, c.customer_id::bigint,
		        btrim(concat_ws(' ', NULLIF(btrim(c.first_name), ''), NULLIF(btrim(c.last_name), '')))
		   FROM public.work_orders wo
		   JOIN public.customers c ON c.customer_id = wo.customer_id
		  WHERE wo.reference_id = ANY($1::int[])`, ints)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int32
		var jc askJobCustomer
		if err := rows.Scan(&id, &jc.ID, &jc.Name); err != nil {
			return nil, err
		}
		out[int64(id)] = jc
	}
	return out, rows.Err()
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
// treated as empty and deleted. Errors degrade to "no context"; saveOK is then
// false so a failed read never overwrites the stored row.
func (h *Handler) loadAskContext(ctx context.Context, userID string, now time.Time) (ac askContext, saveOK bool) {
	if h.askContext == nil || userID == "" {
		return askContext{}, false
	}
	ac, ok, err := h.askContext.LoadAskContext(ctx, userID)
	if err != nil {
		log.Printf("[ai] ask context load: %v", err)
		return askContext{}, false
	}
	if !ok {
		return askContext{}, true
	}
	cutoff := now.Add(-askContextTTL)
	if !ac.UpdatedAt.After(cutoff) {
		if err := h.askContext.DeleteExpiredAskContext(ctx, userID, cutoff); err != nil {
			log.Printf("[ai] ask context expire: %v", err)
		}
		return askContext{}, true
	}
	return ac, true
}

func (h *Handler) saveAskContext(ctx context.Context, userID string, ac askContext) {
	if h.askContext == nil || userID == "" {
		return
	}
	if err := h.askContext.SaveAskContext(ctx, userID, ac); err != nil {
		log.Printf("[ai] ask context save: %v", err)
	}
}

// recordAskTurn appends one turn to an existing fresh row, keeping its jobs,
// customer and topic (used after a Mass Update Apply). It does nothing when
// the user has no row.
func (h *Handler) recordAskTurn(ctx context.Context, userID, user, assistant string, now time.Time) {
	if h.askContext == nil || userID == "" {
		return
	}
	ac, ok, err := h.askContext.LoadAskContext(ctx, userID)
	if err != nil || !ok || !ac.UpdatedAt.After(now.Add(-askContextTTL)) {
		return
	}
	ac.Turns = appendAskTurn(ac.Turns, user, assistant)
	h.saveAskContext(ctx, userID, ac)
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
