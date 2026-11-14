package workorders

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Ask skills: parts request changes, repair logs, labour, job questions,
// "waiting on parts" and Complete Job. The model classifies; the word lists
// below are the server's backup (and what the local stand-in model follows);
// the server validates every id, status, price and hour count. Every change is
// a preview only: the front end applies it through the existing endpoints
//   - parts:      PATCH /work-orders/:id/parts-purchase-requests/:pid
//   - repair log: POST  /work-orders/:id/repair-logs
//   - labour:     POST  /ai-tools/mass-update/apply (set_labour_total)
//
// so their permission checks, transition rules and optimistic updated_at
// checks still decide what is written.
const (
	askIntentPartsUpdate   = "parts_update"
	askIntentWaitingParts  = "jobs_waiting_parts"
	askIntentJobDetails    = "job_details"
	askIntentRepairHistory = "repair_history"
	askIntentAddRepairLog  = "add_repair_log"
	askIntentAddLabour     = "add_labour"
	askIntentCompleteJob   = "complete_job"
)

// Parts actions the model may return in parts_action.
const (
	askPartsApprove  = "approve"
	askPartsOrder    = "order"
	askPartsArrive   = "arrive"
	askPartsCancel   = "cancel"
	askPartsSetPrice = "set_price"
)

var askPartsActions = map[string]string{
	askPartsApprove:  "approved",
	askPartsOrder:    "ordered",
	askPartsArrive:   "arrived",
	askPartsCancel:   "cancelled",
	askPartsSetPrice: "",
}

const (
	// askLabourHourlyRate is the shop labour rate ($/hr) used to turn hours
	// into the job's labour total. Not stored in the app; taken from the
	// shop's billing notes (1 hr = $110).
	askLabourHourlyRate = 110.0
	// askMaxHours caps hours on one repair log or labour change.
	askMaxHours = 24.0
	// askMaxPrice caps a parts request price typed into Ask.
	askMaxPrice = 100000.0
	// askMaxLogText caps a repair log typed into Ask.
	askMaxLogText = 2000
	// askMaxPartsChoices caps how many requests an ambiguity answer lists.
	askMaxPartsChoices = 20
)

// askNotUnderstoodReply is the friendly answer when the model returned no
// usable JSON twice.
const askNotUnderstoodReply = "Sorry, I didn't catch that — try rephrasing, or name the job number."

// askJSONReminder is appended to the prompt when the model's first reply was
// not valid JSON.
const askJSONReminder = "\nYour previous reply was not valid JSON. Respond with the JSON object only: no prose, no markdown, no code fences."

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

// askPartsChange is one parts request change: before -> after. The client
// sends the request back unchanged except status / total_price / source_url,
// with updated_at, to the existing PATCH endpoint.
type askPartsChange struct {
	PartsPurchaseRequestID int64      `json:"parts_purchase_request_id"`
	ReferenceID            int64      `json:"reference_id"`
	ItemName               string     `json:"item_name"`
	Quantity               int32      `json:"quantity"`
	Source                 string     `json:"source"`
	OldStatus              string     `json:"old_status"`
	NewStatus              string     `json:"new_status"`
	OldPrice               float64    `json:"old_price"`
	NewPrice               float64    `json:"new_price"`
	OldSourceURL           *string    `json:"old_source_url"`
	NewSourceURL           *string    `json:"new_source_url"`
	UpdatedAt              *time.Time `json:"updated_at"`
	Valid                  bool       `json:"valid"`
	Error                  string     `json:"error,omitempty"`
}

// askPartsChoice is one request listed when Ask needs the user to pick.
type askPartsChoice struct {
	PartsPurchaseRequestID int64   `json:"parts_purchase_request_id"`
	ReferenceID            int64   `json:"reference_id"`
	ItemName               string  `json:"item_name"`
	Quantity               int32   `json:"quantity"`
	Status                 string  `json:"status"`
	TotalPrice             float64 `json:"total_price"`
}

type askPartsPreview struct {
	Action  string           `json:"action"`
	Changes []askPartsChange `json:"changes"`
	Choices []askPartsChoice `json:"choices,omitempty"`
}

type askRepairLogPreview struct {
	ReferenceID int64   `json:"reference_id"`
	Details     string  `json:"details"`
	HoursUsed   float64 `json:"hours_used"`
}

type askLabourPreview struct {
	ReferenceID int64   `json:"reference_id"`
	Hours       float64 `json:"hours"`
	Rate        float64 `json:"rate"`
	Amount      float64 `json:"amount"`
	// Row is the Mass Update preview row (set_labour_total) the client applies
	// with POST /ai-tools/mass-update/apply.
	Row  MassUpdatePreviewRow `json:"row"`
	Note string               `json:"note,omitempty"`
}

type askWaitingParts struct {
	StatusID   int64  `json:"status_id"`
	StatusName string `json:"status_name"`
	// Total is how many jobs have that status (-1 when unknown).
	Total int `json:"total"`
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

// askPartsRow is a parts request as Ask needs it.
type askPartsRow struct {
	ID          int64
	ReferenceID int64
	ItemName    string
	Quantity    int32
	Status      string
	TotalPrice  float64
	Source      string
	SourceURL   *string
	UpdatedAt   *time.Time
}

// askPartsLookup reads parts requests and job ids by status for Ask.
type askPartsLookup interface {
	PartsRequestsByID(ctx context.Context, ids []int64) ([]askPartsRow, error)
	PartsRequestsForJobs(ctx context.Context, jobIDs []int64) ([]askPartsRow, error)
	// JobIDsWithStatus returns up to limit job numbers with the status (newest
	// first) and how many there are in total.
	JobIDsWithStatus(ctx context.Context, statusID int64, limit int) ([]int64, int, error)
}

const askPartsSelect = `SELECT parts_purchase_request_id, reference_id::bigint, item_name, quantity, status,
	total_price::double precision, source, source_url, updated_at FROM public.parts_purchase_requests`

func scanAskParts(ctx context.Context, db *pgxpool.Pool, query string, arg any) ([]askPartsRow, error) {
	rows, err := db.Query(ctx, query, arg)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []askPartsRow{}
	for rows.Next() {
		var p askPartsRow
		if err := rows.Scan(&p.ID, &p.ReferenceID, &p.ItemName, &p.Quantity, &p.Status, &p.TotalPrice, &p.Source, &p.SourceURL, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *pgAskStore) PartsRequestsByID(ctx context.Context, ids []int64) ([]askPartsRow, error) {
	if len(ids) == 0 {
		return []askPartsRow{}, nil
	}
	return scanAskParts(ctx, s.db, askPartsSelect+` WHERE parts_purchase_request_id = ANY($1::bigint[]) ORDER BY parts_purchase_request_id`, ids)
}

func (s *pgAskStore) PartsRequestsForJobs(ctx context.Context, jobIDs []int64) ([]askPartsRow, error) {
	ints := askInt32IDs(jobIDs)
	if len(ints) == 0 {
		return []askPartsRow{}, nil
	}
	return scanAskParts(ctx, s.db, askPartsSelect+` WHERE reference_id = ANY($1::int[]) ORDER BY reference_id, parts_purchase_request_id`, ints)
}

func (s *pgAskStore) JobIDsWithStatus(ctx context.Context, statusID int64, limit int) ([]int64, int, error) {
	var total int
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM public.work_orders WHERE status_id = $1`, statusID).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.Query(ctx, `SELECT reference_id::bigint FROM public.work_orders WHERE status_id = $1 ORDER BY reference_id DESC LIMIT $2`, statusID, limit)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, 0, err
		}
		out = append(out, id)
	}
	return out, total, rows.Err()
}

// ---------------------------------------------------------------------------
// Word lists
// ---------------------------------------------------------------------------

var (
	// Questions answer; they never open a change preview.
	askQuestionStart = regexp.MustCompile(`(?i)^\s*(?:what|what's|whats|which|who|whose|when|where|why|how|is|are|was|were|does|did|do|has|have|show|list|tell\s+me|give\s+me|find|look\s+up|any|anything|can\s+i\s+see|summari[sz]e)\b`)
	askQuestionZH    = regexp.MustCompile(`咩|乜|幾多|边|邊|點樣|嗎|吗`)
	// "make and model" is a question about the item, not the verb "make".
	askMakeModel = regexp.MustCompile(`(?i)\bmake\s*(?:and|&|/|,)\s*model\b|\bmake\s+of\b`)

	askCompleteJob = regexp.MustCompile(`(?i)\b(?:complete|close)\s+(?:out\s+)?(?:the\s+|this\s+|that\s+)?(?:job|jobs|wo|work\s+order|it|them|[#＃]?\s*\d)|\bmark\b[^.?!]{0,40}\b(?:as\s+)?(?:complete|completed|closed)\b`)

	askRepairLogAdd = regexp.MustCompile(`(?i)\b(?:add|write|create|new|enter|put)\b[^:]{0,60}?\b(?:repair[\s-]*)?log\b`)
	askLabourAdd    = regexp.MustCompile(`(?i)\b(?:add|bill|charge|put|log)\b[^:]{0,60}?\blabou?r\b|\blabou?r\b[^:]{0,20}?\b(?:add|of)\b`)

	askRepairHistory = regexp.MustCompile(`(?i)\brepair\s+(?:history|logs?|notes)\b|\bwhat\s+(?:did|have)\s+(?:we|you|they|i)\s+(?:do|done)\b|\bwhat\s+(?:was|has\s+been|got)\s+done\b|\bwork\s+done\s+on\b|\bhistory\b`)
	askJobDetails    = regexp.MustCompile(`(?i)\bmake\b|\bmodel\b|\bserial\b|\bbrand\b|\bmanufacturer\b|\bwhat\s+(?:is|kind\s+of|type\s+of)\s+(?:the\s+)?(?:unit|item|machine|equipment)\b`)

	askWaitingOnParts = regexp.MustCompile(`(?i)\bwaiting\s+(?:on|for)\s+(?:the\s+|any\s+)?parts?\b|\bwaiting[\s-]+on[\s-]+part\b`)

	// Parts request ids are named with a request word: "parts request #480",
	// "request 480", "PR 480", "requests 480 and 481".
	askPartsRequestRef  = regexp.MustCompile(`(?i)\b(?:parts?\s+(?:purchase\s+)?requests?|requests?|reqs?|prs?|ppr)\s*(?:no\.?|number|id)?\s*[#＃]?\s*(\d+(?:\s*(?:,|and|&|/|or)\s*[#＃]?\s*\d+)*)`)
	askJobMarkedRef     = regexp.MustCompile(`(?i)\b(?:jobs?|wo|work\s+orders?)\s*(?:no\.?|number)?\s*[#＃]?\s*(\d+(?:\s*(?:,|and|&|/|or)\s*[#＃]?\s*\d+)*)`)
	askDigits           = regexp.MustCompile(`\d+`)
	askPartsWord        = regexp.MustCompile(`(?i)\bparts?\b|\bparts?\s+requests?\b`)
	askPartsPlural      = regexp.MustCompile(`(?i)\bparts\b|\ball\b|\bboth\b|\bthem\b|\bthose\b|\bthese\b|\bevery\b|\brequests\b`)
	askURL              = regexp.MustCompile(`https?://[^\s<>"']+`)
	askPriceDollar      = regexp.MustCompile(`[$＄]\s*(\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?)\b`)
	askPriceWord        = regexp.MustCompile(`(?i)\b(?:price|cost|total|priced)\b`)
	askPriceTo          = regexp.MustCompile(`(?i)\bto\s*[$＄]?\s*(\d{1,6}(?:\.\d{1,2})?)(?:[^\d.]|$)`)
	askPriceAt          = regexp.MustCompile(`(?i)(?:\b(?:at|is|as|of)|=)\s*[$＄]?\s*(\d{1,6}(?:\.\d{1,2})?)(?:[^\d.]|$)`)
	askNumberRe         = regexp.MustCompile(`\d+(?:\.\d+)?`)
	askHoursRe          = regexp.MustCompile(`(?i)(\d{1,2}(?:\.\d{1,2})?|\.\d{1,2})\s*(?:h|hr|hrs|hour|hours)\b`)
	askHoursWords       = regexp.MustCompile(`(?i)\b(?:an|one)\s+hour\b|\bhalf\s+(?:an\s+)?hour\b|\b(?:a\s+)?quarter\s+(?:of\s+an\s+)?hour\b`)
	askHoursParen       = regexp.MustCompile(`(?i)\s*[(\[]\s*(?:\d{1,2}(?:\.\d{1,2})?|\.\d{1,2})\s*(?:h|hr|hrs|hour|hours)\s*[)\]]\s*`)
	askHoursTrail       = regexp.MustCompile(`(?i)[\s,;–—-]*\b(?:\d{1,2}(?:\.\d{1,2})?|\.\d{1,2})\s*(?:h|hr|hrs|hour|hours)\.?\s*$`)
	askApproveWord      = regexp.MustCompile(`(?i)\bapprove\b|\b(?:set|mark|change|move|update|make)\b[^.?!]{0,60}\bapproved\b`)
	askOrderedWord      = regexp.MustCompile(`(?i)\bordered\b|\bplaced?\s+(?:the\s+)?order\b`)
	askArrivedWord      = regexp.MustCompile(`(?i)\barrived\b|\b(?:came|come)\s+in\b`)
	askCancelWord       = regexp.MustCompile(`(?i)\bcancel(?:l?ed|ling)?\b`)
	askPriceWordPresent = regexp.MustCompile(`(?i)\b(?:price|cost|total|priced)\b|[$＄]\s*\d`)
	// Parts statuses as typed in a parts listing question.
	askPartsStatusFilter = []struct {
		re     *regexp.Regexp
		status string
	}{
		{regexp.MustCompile(`(?i)\bwaiting[\s_-]*(?:for\s+|on\s+)?approval\b|\bneeds?\s+approval\b|\bunapproved\b|\bto\s+approve\b`), "waiting_approval"},
		{regexp.MustCompile(`(?i)\bdrafts?\b`), "draft"},
		{regexp.MustCompile(`(?i)\bapproved\b`), "approved"},
		{regexp.MustCompile(`(?i)\bordered\b|\bon\s+order\b`), "ordered"},
		{regexp.MustCompile(`(?i)\barrived\b`), "arrived"},
		{regexp.MustCompile(`(?i)\bused\b`), "used"},
		{regexp.MustCompile(`(?i)\bcancell?ed\b`), "cancelled"},
	}
)

// isAskQuestion reports whether the message asks rather than tells.
func isAskQuestion(msg string) bool {
	if askQuestionStart.MatchString(msg) {
		return true
	}
	trimmed := strings.TrimSpace(msg)
	return askQuestionZH.MatchString(trimmed) && (strings.HasSuffix(trimmed, "?") || strings.HasSuffix(trimmed, "？"))
}

// askPartsActionIn is the parts action the text names ("" if none). A price
// alone is set_price.
func askPartsActionIn(msg string) string {
	text := askURL.ReplaceAllString(msg, " ")
	switch {
	case askCancelWord.MatchString(text):
		return askPartsCancel
	case askApproveWord.MatchString(text):
		return askPartsApprove
	case askOrderedWord.MatchString(text):
		return askPartsOrder
	case askArrivedWord.MatchString(text):
		return askPartsArrive
	case askPriceWordPresent.MatchString(text) && askPriceIn(text) != nil:
		return askPartsSetPrice
	}
	return ""
}

// askPriceIn reads a price from the text ("$59.62", "price to 59.62").
func askPriceIn(msg string) *float64 {
	text := askURL.ReplaceAllString(msg, " ")
	var raw string
	if m := askPriceDollar.FindStringSubmatch(text); m != nil {
		raw = strings.ReplaceAll(m[1], ",", "")
	} else if loc := askPriceWord.FindStringIndex(text); loc != nil {
		// "price on request 480 to 59.62": the number after "to" wins, then
		// "at/is/as/of/=" right after the price word.
		rest := text[loc[1]:]
		if m := askPriceTo.FindStringSubmatch(rest); m != nil {
			raw = m[1]
		} else if m := askPriceAt.FindStringSubmatch(rest); m != nil {
			raw = m[1]
		}
	}
	if raw == "" {
		return nil
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil || !askValidPrice(v) {
		return nil
	}
	v = round2(v)
	return &v
}

func askValidPrice(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= 0 && v <= askMaxPrice
}

// askHoursIn reads hours from the text ("0.25 hr", "1 hour", "an hour").
func askHoursIn(msg string) *float64 {
	if m := askHoursRe.FindStringSubmatch(msg); m != nil {
		if v, err := strconv.ParseFloat(m[1], 64); err == nil {
			return &v
		}
	}
	if m := askHoursWords.FindString(strings.ToLower(msg)); m != "" {
		v := 1.0
		switch {
		case strings.Contains(m, "half"):
			v = 0.5
		case strings.Contains(m, "quarter"):
			v = 0.25
		}
		return &v
	}
	return nil
}

// askNumbersIn returns the numbers named by a regexp's first group (lists
// included), deduped, in order.
func askNumbersIn(re *regexp.Regexp, msg string) []int64 {
	out := []int64{}
	seen := map[int64]bool{}
	for _, m := range re.FindAllStringSubmatch(askURL.ReplaceAllString(msg, " "), -1) {
		for _, d := range askDigits.FindAllString(m[1], -1) {
			n, err := strconv.ParseInt(d, 10, 64)
			if err != nil || n <= 0 || n > 1<<31-1 || seen[n] || len(out) >= askMaxReferenceIDs {
				continue
			}
			seen[n] = true
			out = append(out, n)
		}
	}
	return out
}

// askRepairLogText is the log text the user typed: what follows the first
// colon after "log" (or after the job number), without a trailing hours note.
func askRepairLogText(msg string) string {
	loc := askRepairLogAdd.FindStringIndex(msg)
	rest := msg
	if loc != nil {
		rest = msg[loc[1]:]
	}
	i := strings.IndexAny(rest, ":：")
	if i < 0 {
		return ""
	}
	text := rest[i+len(string([]rune(rest[i:])[0])):]
	text = askHoursParen.ReplaceAllString(text, " ")
	text = askHoursTrail.ReplaceAllString(text, "")
	return strings.TrimSpace(text)
}

// askPartsStatusesIn are the parts statuses a listing question names.
func askPartsStatusesIn(msg string) []string {
	out := []string{}
	for _, f := range askPartsStatusFilter {
		if f.re.MatchString(msg) {
			if f.status == "approved" && askPartsStatusFilter[0].re.MatchString(msg) {
				continue
			}
			out = append(out, f.status)
		}
	}
	return out
}

func askPartsStatusWord(status string) string {
	switch status {
	case "waiting_approval":
		return "waiting for approval"
	case "":
		return "unknown"
	}
	return status
}

// askPartsTransitionError explains why a request can't go from -> to ("" when
// it can). It mirrors validatePartsTransition, which Apply enforces again.
func askPartsTransitionError(from, to string, canApprove bool) string {
	if from == to {
		return "It is already " + askPartsStatusWord(from) + "."
	}
	err := validatePartsTransition(from, to, canApprove)
	switch {
	case err == nil:
		return ""
	case errors.Is(err, ErrPartsApprovalPermission):
		if to == "cancelled" {
			return "Cancelling a request that is waiting for approval needs the parts approve permission."
		}
		return "Approving needs the parts approve permission."
	}
	now := "It is " + askPartsStatusWord(from)
	switch {
	case from == "cancelled" || from == "used":
		return now + ", so it can't be changed to " + to + "."
	case to == "ordered" && (from == "draft" || from == "waiting_approval"):
		return now + "; it must be approved before it can be ordered."
	case to == "arrived" && (from == "draft" || from == "waiting_approval" || from == "approved"):
		return now + "; it must be ordered before it can be marked arrived."
	case to == "approved" && from == "draft":
		return "It is still a draft; it must be sent for approval before it can be approved."
	case to == "approved":
		return now + ", so there is nothing to approve."
	}
	return now + "; it can't go to " + to + "."
}

// askEligibleFrom reports whether a request in status can take the action
// (used to pick the requests on a job).
func askEligibleFrom(action, status string) bool {
	switch action {
	case askPartsApprove:
		return status == "waiting_approval"
	case askPartsOrder:
		return status == "approved"
	case askPartsArrive:
		return status == "ordered"
	case askPartsCancel:
		return status == "draft" || status == "waiting_approval" || status == "approved" || status == "ordered"
	case askPartsSetPrice:
		return status != "cancelled" && status != "used"
	}
	return false
}

func askPartsVerb(action string) string {
	switch action {
	case askPartsApprove:
		return "approved"
	case askPartsOrder:
		return "marked ordered"
	case askPartsArrive:
		return "marked arrived"
	case askPartsCancel:
		return "cancelled"
	}
	return "priced"
}

// ---------------------------------------------------------------------------
// Skill routing
// ---------------------------------------------------------------------------

// skillFor picks the skill for this message: the word rules first (so the
// local stand-in and a confused model still work), then the model's intent.
// It returns "" when the existing intents handle the message.
func (r *askResolver) skillFor() string {
	msg := r.in.Message
	model := r.resp.Intent
	question := isAskQuestion(msg)
	explicit := parseAskJobIDs(msg)
	if !question {
		switch {
		case askCompleteJob.MatchString(msg):
			return askIntentCompleteJob
		case askRepairLogAdd.MatchString(msg):
			return askIntentAddRepairLog
		case askLabourAdd.MatchString(msg) && !askPriceDollar.MatchString(msg):
			return askIntentAddLabour
		}
		if action := askPartsActionIn(msg); action != "" && r.partsContext(action) {
			return askIntentPartsUpdate
		}
	}
	if askWaitingOnParts.MatchString(msg) && len(explicit) == 0 && len(askPartsStatusesIn(msg)) == 0 {
		return askIntentWaitingParts
	}
	if (question || !isAskUpdateVerb(msg)) && (len(explicit) > 0 || isAskFollowUp(msg)) {
		switch {
		case askRepairHistory.MatchString(msg):
			return askIntentRepairHistory
		case askJobDetails.MatchString(msg):
			return askIntentJobDetails
		}
	}
	switch model {
	case askIntentWaitingParts, askIntentJobDetails, askIntentRepairHistory, askIntentCompleteJob:
		return model
	case askIntentAddRepairLog, askIntentAddLabour, askIntentPartsUpdate:
		if !question {
			return model
		}
	}
	return ""
}

// partsContext reports whether a parts action word is about parts requests
// (not a job status or location of the same name).
func (r *askResolver) partsContext(action string) bool {
	msg := r.in.Message
	if askPartsRequestRef.MatchString(msg) || askPartsWord.MatchString(msg) || action == askPartsApprove {
		return true
	}
	switch r.resp.Intent {
	case askIntentPartsUpdate, askIntentPartsRequests:
		return true
	}
	if r.resp.PartsQuery != "" {
		return true
	}
	if action == askPartsCancel {
		return normalizeAskTopic(r.in.Prev.Topic) == askTopicParts && !askJobWord.MatchString(msg)
	}
	// "Mark #480 as ordered": ordered/arrived are parts statuses unless the
	// text names a job or one of the shop's job statuses/locations.
	if action == askPartsOrder || action == askPartsArrive {
		return !askJobWord.MatchString(msg) && !askNamesAny(msg, r.h.askJobFieldNames(r.ctx))
	}
	return normalizeAskTopic(r.in.Prev.Topic) == askTopicParts && !r.targetsJobs(msg)
}

// resolveSkill answers the new skills. It returns false to let the existing
// intents handle the message (after fixing questions and parts filters).
func (r *askResolver) resolveSkill() bool {
	switch r.skillFor() {
	case askIntentCompleteJob:
		r.completeJob()
		return true
	case askIntentAddRepairLog:
		r.addRepairLog()
		return true
	case askIntentAddLabour:
		r.addLabour()
		return true
	case askIntentPartsUpdate:
		if r.partsUpdate() {
			return true
		}
		// Nothing to change was named: show the parts instead.
		r.resp.Intent = askIntentPartsRequests
	case askIntentWaitingParts:
		r.waitingParts()
		return true
	case askIntentJobDetails:
		r.readJobs(askIntentJobDetails)
		return true
	case askIntentRepairHistory:
		r.readJobs(askIntentRepairHistory)
		return true
	}
	if isAskQuestion(r.in.Message) {
		switch r.resp.Intent {
		case askIntentUpdateJobs, askIntentAddRepairLog, askIntentAddLabour, askIntentCompleteJob:
			r.resp.Intent = askIntentCustomerJobs
		case askIntentPartsUpdate:
			r.resp.Intent = askIntentPartsRequests
		}
	}
	if !askIntents[r.resp.Intent] || askSkillIntents[r.resp.Intent] {
		r.resp.Intent = askIntentUnknown
	}
	if r.resp.Intent == askIntentPartsRequests && len(r.resp.PartsStatuses) == 0 {
		r.resp.PartsStatuses = askPartsStatusesIn(r.in.Message)
	}
	return false
}

var askSkillIntents = map[string]bool{
	askIntentPartsUpdate: true, askIntentWaitingParts: true, askIntentJobDetails: true,
	askIntentRepairHistory: true, askIntentAddRepairLog: true, askIntentAddLabour: true,
	askIntentCompleteJob: true,
}

// skillJobs resolves the jobs a skill is about: typed numbers, else the
// model's numbers the user could have meant, else the saved jobs on a
// follow-up. ok is false when a plain reply was already set.
func (r *askResolver) skillJobs(explicit []int64, allowContext bool) ([]int64, bool) {
	prev := r.in.Prev
	followUp := isAskFollowUp(r.in.Message)
	ids, fromContext := r.pickIDs(explicit, followUp, false)
	if len(ids) == 0 && (followUp || allowContext) && !r.broad && len(prev.ReferenceIDs) > 0 {
		ids, fromContext = append([]int64{}, prev.ReferenceIDs...), true
	}
	if len(ids) == 0 {
		r.plain("Which job? Tell me the job number, e.g. #31352.")
		return nil, false
	}
	if found, missing, ok := r.h.checkAskJobs(r.ctx, ids); ok {
		r.resp.FoundIDs, r.resp.MissingIDs = found, missing
		r.resp.Notice = askNotice(found, missing)
		if len(found) == 0 {
			r.save = &askContext{ReferenceIDs: []int64{}, Topic: askTopicJobs}
			r.plain(askNoJobsReply)
			return nil, false
		}
		ids = found
	}
	r.resp.ContextUsed = fromContext
	r.resp.CustomerQuery = ""
	return ids, true
}

// clearSkillFields drops model fields a skill answer does not use.
func (r *askResolver) clearSkillFields(intent string) {
	r.resp.Intent = intent
	r.resp.PartsQuery = ""
	r.resp.PartsStatuses = []string{}
	r.resp.PreviewInstruction = ""
	r.resp.CustomerQuery = ""
}

func (r *askResolver) completeJob() {
	// Only a pointer to the button, so the saved jobs may be used ("complete it").
	ids, ok := r.skillJobs(parseAskJobIDs(r.in.Message), true)
	if !ok {
		return
	}
	r.clearSkillFields(askIntentCompleteJob)
	r.resp.ReferenceIDs = ids
	label := "job " + askJobRefs(ids, "and")
	if len(ids) > 1 {
		label = "each job (" + askJobRefs(ids, "and") + ")"
	}
	r.resp.Reply = "There's no “Complete” status to set from here. To complete " + label +
		", open the job page and tap Complete Job — it sets the finished status your shop chose for Complete Job."
	r.save = &askContext{ReferenceIDs: ids, CustomerQuery: r.customerFor(ids), Topic: askTopicJobs}
}

func (r *askResolver) readJobs(intent string) {
	ids, ok := r.skillJobs(parseAskJobIDs(r.in.Message), true)
	if !ok {
		return
	}
	r.clearSkillFields(intent)
	r.resp.Reply = ""
	r.resp.ReferenceIDs = ids
	r.save = &askContext{ReferenceIDs: ids, CustomerQuery: r.customerFor(ids), Topic: askTopicJobs}
}

func (r *askResolver) singleJob(what string) (int64, bool) {
	ids, ok := r.skillJobs(parseAskJobIDs(r.in.Message), false)
	if !ok {
		return 0, false
	}
	if len(ids) > 1 {
		r.plain("I can add " + what + " to one job at a time. Which job: " + askJobRefs(ids, "or") + "?")
		return 0, false
	}
	return ids[0], true
}

func (r *askResolver) addRepairLog() {
	if !r.in.CanCreateRepairLogs {
		r.plain("You don't have permission to add repair logs.")
		return
	}
	id, ok := r.singleJob("a repair log")
	if !ok {
		return
	}
	text := askRepairLogText(r.in.Message)
	if text == "" {
		text = strings.TrimSpace(r.in.Result.LogText)
	}
	text = capRunes(text, askMaxLogText)
	if text == "" {
		r.plain(fmt.Sprintf("What should the repair log on #%d say? For example: “Add a repair log to #%d: Final test OK (0.25 hr)”.", id, id))
		return
	}
	hours := askHoursIn(r.in.Message)
	if hours == nil {
		hours = r.in.Result.Hours
	}
	h := 0.0
	if hours != nil {
		h = *hours
	}
	if math.IsNaN(h) || h < 0 || h > askMaxHours {
		r.plain(fmt.Sprintf("Repair log hours must be between 0 and %g.", askMaxHours))
		return
	}
	r.clearSkillFields(askIntentAddRepairLog)
	r.resp.Reply = ""
	r.resp.ReferenceIDs = []int64{id}
	r.resp.RepairLogPreview = &askRepairLogPreview{ReferenceID: id, Details: text, HoursUsed: round2(h)}
	r.save = &askContext{ReferenceIDs: []int64{id}, CustomerQuery: r.customerFor([]int64{id}), Topic: askTopicJobs}
}

func (r *askResolver) addLabour() {
	id, ok := r.singleJob("labour")
	if !ok {
		return
	}
	hours := askHoursIn(r.in.Message)
	if hours == nil {
		hours = r.in.Result.Hours
	}
	if hours == nil {
		r.plain(fmt.Sprintf("How many hours of labour? For example: “Add 1 hour labour to #%d”.", id))
		return
	}
	h := *hours
	if math.IsNaN(h) || h <= 0 || h > askMaxHours || math.Abs(h*4-math.Round(h*4)) > 1e-9 {
		r.plain(fmt.Sprintf("Labour is added in quarter hours (0.25 to %g). How many hours?", askMaxHours))
		return
	}
	if r.h.service == nil {
		r.plain("I couldn't load that job right now.")
		return
	}
	detail, err := r.h.service.GetWorkOrderDetail(r.ctx, int(id))
	if err != nil {
		log.Printf("[ai] ask labour detail: %v", err)
		r.plain(fmt.Sprintf("I couldn't load job #%d right now.", id))
		return
	}
	amount := round2(h * askLabourHourlyRate)
	total := round2(float64Value(detail.LabourTotal) + amount)
	op := MassUpdateOp{ReferenceID: int32(id), Op: massOpSetLabourTotal, LabourTotal: &total}
	rows, _, err := r.h.buildMassUpdateRows(r.ctx, []MassUpdateOp{op}, nil, nil)
	if err != nil || len(rows) != 1 {
		r.plain(fmt.Sprintf("I couldn't prepare the labour change for #%d.", id))
		return
	}
	note := fmt.Sprintf("At $%.0f/hr. Admin time is not added automatically — if this job bills the 0.25 hr admin time, ask for %g hours instead. Flat-rate jobs: set the labour total in Mass Update.", askLabourHourlyRate, h+0.25)
	r.clearSkillFields(askIntentAddLabour)
	r.resp.Reply = ""
	r.resp.ReferenceIDs = []int64{id}
	r.resp.LabourPreview = &askLabourPreview{ReferenceID: id, Hours: h, Rate: askLabourHourlyRate, Amount: amount, Row: rows[0], Note: note}
	r.save = &askContext{ReferenceIDs: []int64{id}, CustomerQuery: r.customerFor([]int64{id}), Topic: askTopicJobs}
}

// waitingParts lists the jobs in the "Waiting on Part (s)" status (the rule:
// a job is waiting on parts when its status says so; open parts requests are
// shown next to each job by the client).
func (r *askResolver) waitingParts() {
	if r.h.service == nil || r.h.service.repo == nil {
		r.plain("I couldn't load the job statuses right now.")
		return
	}
	statuses, err := r.h.service.repo.AIStatuses(r.ctx)
	if err != nil {
		log.Printf("[ai] ask statuses: %v", err)
		r.plain("I couldn't load the job statuses right now.")
		return
	}
	var status *AIStatusOption
	for i, s := range statuses {
		key := strings.Join(strings.FieldsFunc(strings.ToLower(s.Name), askNotWordRune), "")
		if strings.Contains(key, "waitingonpart") || strings.Contains(key, "waitingforpart") {
			status = &statuses[i]
			break
		}
	}
	if status == nil {
		r.plain("There is no “Waiting on Part (s)” status set up, so I can't list those jobs.")
		return
	}
	r.clearSkillFields(askIntentWaitingParts)
	r.resp.Reply = ""
	r.resp.ReferenceIDs = []int64{}
	wp := &askWaitingParts{StatusID: status.ID, StatusName: status.Name, Total: -1}
	saved := []int64{}
	if r.h.askParts != nil {
		ids, total, err := r.h.askParts.JobIDsWithStatus(r.ctx, status.ID, askMaxReferenceIDs)
		if err != nil {
			log.Printf("[ai] ask waiting jobs: %v", err)
		} else {
			wp.Total = total
			saved = ids
			r.resp.ReferenceIDs = ids
		}
	}
	r.resp.WaitingParts = wp
	r.save = &askContext{ReferenceIDs: saved, Topic: askTopicJobs}
}

// ---------------------------------------------------------------------------
// Parts request changes
// ---------------------------------------------------------------------------

// partsUpdate builds a parts change preview. It returns false when nothing to
// change was named (the caller then lists the parts).
func (r *askResolver) partsUpdate() bool {
	msg := r.in.Message
	res := r.in.Result
	action := askPartsActionIn(msg)
	if action == "" {
		if _, ok := askPartsActions[res.PartsAction]; ok {
			action = res.PartsAction
		}
	}
	price := askPriceIn(msg)
	if price == nil && res.TotalPrice != nil && askValidPrice(*res.TotalPrice) && askTypedNumber(msg, *res.TotalPrice) {
		v := round2(*res.TotalPrice)
		price = &v
	}
	var url *string
	if u := askURL.FindString(msg); u != "" {
		u = strings.TrimRight(u, ".,;)")
		url = &u
	}
	if action == askPartsSetPrice && price == nil && url == nil {
		action = ""
	}
	if action == "" && (price != nil || url != nil) {
		action = askPartsSetPrice
	}
	if action == "" {
		return false
	}
	if r.h.askParts == nil {
		r.plain("I can't look up parts requests right now.")
		return true
	}
	r.clearSkillFields(askIntentPartsUpdate)
	r.resp.Reply = ""

	targets, jobs, done := r.partsTargets(action)
	if done {
		return true
	}
	// Permissions are checked before any request is shown; Apply goes through
	// the parts endpoint, which checks them again.
	if !r.in.CanReadParts {
		r.plain("You don't have access to parts requests.")
		return true
	}
	if !r.in.CanUpdateParts {
		r.plain("You don't have permission to change parts requests.")
		return true
	}
	preview := &askPartsPreview{Action: action, Changes: []askPartsChange{}}
	newStatus := askPartsActions[action]
	for _, p := range targets {
		preview.Changes = append(preview.Changes, r.partsChange(p, newStatus, price, url, jobs))
	}
	r.resp.PartsPreview = preview
	r.resp.ReferenceIDs = askPartsJobs(targets)
	r.save = &askContext{ReferenceIDs: r.resp.ReferenceIDs, Topic: askTopicParts}
	return true
}

func (r *askResolver) partsChange(p askPartsRow, newStatus string, price *float64, url *string, jobs map[int64]bool) askPartsChange {
	ch := askPartsChange{
		PartsPurchaseRequestID: p.ID, ReferenceID: p.ReferenceID, ItemName: p.ItemName, Quantity: p.Quantity,
		Source: p.Source, OldStatus: p.Status, NewStatus: p.Status, OldPrice: p.TotalPrice, NewPrice: p.TotalPrice,
		OldSourceURL: p.SourceURL, NewSourceURL: p.SourceURL, UpdatedAt: p.UpdatedAt, Valid: true,
	}
	if newStatus != "" {
		ch.NewStatus = newStatus
	}
	if price != nil {
		ch.NewPrice = *price
	}
	if url != nil {
		ch.NewSourceURL = url
	}
	fail := func(msg string) askPartsChange {
		ch.Valid = false
		ch.Error = msg
		return ch
	}
	if len(jobs) > 0 && !jobs[p.ReferenceID] {
		return fail(fmt.Sprintf("Request %d is on job #%d, not %s.", p.ID, p.ReferenceID, askJobRefs(askSortedKeys(jobs), "or")))
	}
	if ch.UpdatedAt == nil {
		return fail("This request has no saved timestamp; change it from the job's Parts list.")
	}
	if newStatus != "" {
		if e := askPartsTransitionError(p.Status, newStatus, r.in.CanApproveParts); e != "" && !(p.Status == newStatus && price != nil) {
			return fail(e)
		}
	}
	if newStatus == "" && (p.Status == "cancelled" || p.Status == "used") {
		return fail("It is " + p.Status + ", so its price can't be changed here.")
	}
	if ch.NewStatus == ch.OldStatus && ch.NewPrice == ch.OldPrice && askSameURL(ch.OldSourceURL, ch.NewSourceURL) {
		return fail("Nothing would change.")
	}
	return ch
}

// partsTargets finds the requests to change. done is true when it already
// answered (a question back, or nothing found).
func (r *askResolver) partsTargets(action string) (targets []askPartsRow, jobs map[int64]bool, done bool) {
	msg := r.in.Message
	reqIDs := askNumbersIn(askPartsRequestRef, msg)
	jobIDs := askNumbersIn(askJobMarkedRef, msg)
	reqSet, jobSet := map[int64]bool{}, map[int64]bool{}
	for _, id := range reqIDs {
		reqSet[id] = true
	}
	for _, id := range jobIDs {
		jobSet[id] = true
	}
	// Other typed numbers ("#480", "for #31272") and the model's request ids
	// that the user typed: a job if it exists with parts, else a request.
	ambiguous := []int64{}
	typed := askStandaloneNumbers(msg)
	seen := map[int64]bool{}
	marked := map[int64]bool{}
	for _, id := range parseAskJobIDs(msg) {
		marked[id] = true
	}
	candidates := append(parseAskJobIDs(msg), askBareNumbers(msg)...)
	for _, id := range append(candidates, r.in.Result.PartsRequestIDs...) {
		if !typed[id] || reqSet[id] || jobSet[id] || seen[id] {
			continue
		}
		seen[id] = true
		ambiguous = append(ambiguous, id)
	}
	notices := []string{}
	for _, n := range ambiguous {
		isReq := false
		if rows, err := r.h.askParts.PartsRequestsByID(r.ctx, []int64{n}); err == nil && len(rows) > 0 {
			isReq = true
		}
		isJob := false
		if found, _, ok := r.h.checkAskJobs(r.ctx, []int64{n}); ok && len(found) > 0 {
			if rows, err := r.h.askParts.PartsRequestsForJobs(r.ctx, []int64{n}); err == nil && len(rows) > 0 {
				isJob = true
			}
		}
		switch {
		case isReq && isJob:
			r.plain(fmt.Sprintf("#%d could be job #%d or parts request %d. Say “job %d” or “request %d”.", n, n, n, n, n))
			return nil, nil, true
		case isReq:
			reqIDs = append(reqIDs, n)
		case isJob:
			jobIDs = append(jobIDs, n)
		case marked[n]:
			notices = append(notices, fmt.Sprintf("No job or parts request #%d.", n))
		}
	}
	jobs = map[int64]bool{}
	if len(reqIDs) > 0 {
		rows, err := r.h.askParts.PartsRequestsByID(r.ctx, reqIDs)
		if err != nil {
			log.Printf("[ai] ask parts by id: %v", err)
			r.plain("I couldn't load those parts requests right now.")
			return nil, nil, true
		}
		found := map[int64]bool{}
		for _, p := range rows {
			found[p.ID] = true
		}
		for _, id := range reqIDs {
			if !found[id] {
				notices = append(notices, fmt.Sprintf("No parts request %d.", id))
			}
		}
		for _, id := range jobIDs {
			jobs[id] = true
		}
		r.resp.Notice = strings.Join(notices, " ")
		if len(rows) == 0 {
			r.plain("Check the parts request number and try again.")
			return nil, nil, true
		}
		return rows, jobs, false
	}

	// By job: typed, the model's, or the saved jobs on a follow-up.
	ids := jobIDs
	fromContext := false
	if len(ids) == 0 && len(notices) == 0 {
		ids, fromContext = r.pickIDs(nil, false, false)
		prev := r.in.Prev
		if len(ids) == 0 && len(prev.ReferenceIDs) > 0 &&
			(isAskFollowUp(msg) || normalizeAskTopic(prev.Topic) == askTopicParts || len(prev.ReferenceIDs) == 1) {
			ids, fromContext = append([]int64{}, prev.ReferenceIDs...), true
		}
	}
	if len(ids) == 0 {
		r.resp.Notice = strings.Join(notices, " ")
		if len(notices) > 0 {
			r.plain("Check the job or parts request number and try again.")
		} else {
			r.plain("Which parts request? Say e.g. “approve request 480” or name the job number.")
		}
		return nil, nil, true
	}
	if found, missing, ok := r.h.checkAskJobs(r.ctx, ids); ok {
		r.resp.FoundIDs, r.resp.MissingIDs = found, missing
		if n := askNotice(found, missing); n != "" {
			notices = append(notices, n)
		}
		ids = found
	}
	r.resp.Notice = strings.Join(notices, " ")
	r.resp.ContextUsed = fromContext
	if len(ids) == 0 {
		r.plain(askNoJobsReply)
		return nil, nil, true
	}
	rows, err := r.h.askParts.PartsRequestsForJobs(r.ctx, ids)
	if err != nil {
		log.Printf("[ai] ask parts for jobs: %v", err)
		r.plain("I couldn't load the parts requests right now.")
		return nil, nil, true
	}
	if len(rows) == 0 {
		r.plain(askNoPartsToChangeReply(ids))
		r.save = &askContext{ReferenceIDs: ids, Topic: askTopicParts}
		return nil, nil, true
	}
	// Narrow by part name when the user named one ("the 10,000uF cap").
	named := askMatchPartName(rows, r.in.Result.PartsQuery, msg)
	eligible := []askPartsRow{}
	for _, p := range named {
		if askEligibleFrom(action, p.Status) {
			eligible = append(eligible, p)
		}
	}
	plural := askPartsPlural.MatchString(msg) && action != askPartsSetPrice
	switch {
	case len(eligible) == 1:
		return eligible, nil, false
	case len(eligible) > 1 && plural && len(named) == len(rows):
		return eligible, nil, false
	case len(eligible) > 1:
		r.askWhichParts(ids, eligible, fmt.Sprintf("%s %d parts requests that can be %s. Which one? Say e.g. “%s”.",
			askOnJobs(ids), len(eligible), askPartsVerb(action), askPartsExample(action, eligible[0].ID)))
		return nil, nil, true
	case len(named) == 1:
		// One request, but it can't take this action: preview it as invalid
		// so the reason shows.
		return named, nil, false
	default:
		open := []askPartsRow{}
		for _, p := range named {
			if p.Status != "cancelled" && p.Status != "used" {
				open = append(open, p)
			}
		}
		if len(open) == 0 {
			open = named
		}
		r.askWhichParts(ids, open, fmt.Sprintf("Nothing %s can be %s. Here are its parts requests.", askOnJobs(ids), askPartsVerb(action)))
		return nil, nil, true
	}
}

func (r *askResolver) askWhichParts(ids []int64, rows []askPartsRow, reply string) {
	if !r.in.CanReadParts {
		r.plain("You don't have access to parts requests.")
		return
	}
	preview := &askPartsPreview{Action: "", Changes: []askPartsChange{}, Choices: []askPartsChoice{}}
	for i, p := range rows {
		if i >= askMaxPartsChoices {
			break
		}
		preview.Choices = append(preview.Choices, askPartsChoice{
			PartsPurchaseRequestID: p.ID, ReferenceID: p.ReferenceID, ItemName: p.ItemName,
			Quantity: p.Quantity, Status: p.Status, TotalPrice: p.TotalPrice,
		})
	}
	r.clearSkillFields(askIntentPartsUpdate)
	r.resp.Reply = reply
	r.resp.ReferenceIDs = ids
	r.resp.PartsPreview = preview
	r.save = &askContext{ReferenceIDs: ids, Topic: askTopicParts}
}

func askOnJobs(ids []int64) string {
	if len(ids) == 1 {
		return fmt.Sprintf("Job #%d has", ids[0])
	}
	return "Jobs " + askJobRefs(ids, "and") + " have"
}

func askPartsExample(action string, id int64) string {
	switch action {
	case askPartsApprove:
		return fmt.Sprintf("approve request %d", id)
	case askPartsOrder:
		return fmt.Sprintf("mark request %d ordered", id)
	case askPartsArrive:
		return fmt.Sprintf("mark request %d arrived", id)
	case askPartsCancel:
		return fmt.Sprintf("cancel request %d", id)
	}
	return fmt.Sprintf("set the price on request %d to $20", id)
}

// askMatchPartName keeps the requests whose name best matches the part the
// user named (all rows when nothing matches). When the model left parts_query
// empty the words come from the user's message instead.
func askMatchPartName(rows []askPartsRow, query, msg string) []askPartsRow {
	words := askPartWords(query)
	if len(words) == 0 {
		words = askPartWords(msg)
	}
	if len(words) == 0 {
		return rows
	}
	best, out := 0, []askPartsRow{}
	for _, p := range rows {
		name := strings.ToLower(strings.ReplaceAll(p.ItemName, ",", ""))
		score := 0
		for _, w := range words {
			if strings.Contains(name, w) && strings.Contains(strings.ToLower(strings.ReplaceAll(msg, ",", "")), w) {
				score++
			}
		}
		switch {
		case score > best:
			best, out = score, []askPartsRow{p}
		case score == best && score > 0:
			out = append(out, p)
		}
	}
	if best == 0 {
		return rows
	}
	return out
}

var askPartStopWords = map[string]bool{
	"the": true, "a": true, "an": true, "for": true, "on": true, "of": true, "part": true, "parts": true,
	"request": true, "requests": true, "job": true, "it": true, "them": true, "and": true, "to": true,
	// Filler and action words from shop phrasing, so the message fallback
	// keeps only part-like words.
	"cancel": true, "cancelled": true, "canceled": true, "approve": true, "approved": true,
	"order": true, "ordered": true, "arrive": true, "arrived": true, "mark": true, "set": true,
	"price": true, "status": true, "pending": true, "as": true, "is": true, "in": true, "at": true,
	"with": true, "from": true, "by": true, "be": true, "not": true, "no": true, "or": true,
	"have": true, "has": true, "had": true, "doesn't": true, "don't": true, "dont": true,
	"doesnt": true, "isn't": true, "isnt": true, "can't": true, "cant": true, "won't": true,
	"jerry": true, "please": true, "pls": true, "can": true, "could": true, "would": true,
	"you": true, "me": true, "my": true, "we": true, "our": true, "us": true, "i": true,
	"already": true, "still": true, "just": true, "this": true, "that": true, "those": true,
	"these": true, "their": true, "they": true, "its": true, "one": true, "all": true,
	"now": true, "need": true, "needs": true, "get": true, "got": true, "thanks": true,
	"customer": true, "pr": true,
}

func askPartWords(query string) []string {
	out := []string{}
	text := strings.NewReplacer(",", "", "’", "'", "‘", "'").Replace(strings.ToLower(query))
	for _, w := range strings.Fields(text) {
		w = strings.Trim(w, ".:;!?()[]\"'#＃")
		if len([]rune(w)) < 2 || askPartStopWords[w] || askAllDigits(w) {
			continue
		}
		out = append(out, w)
	}
	return out
}

// askAllDigits is true for job/request numbers ("31271"), never part words.
func askAllDigits(w string) bool {
	for _, r := range w {
		if r < '0' || r > '9' {
			return false
		}
	}
	return w != ""
}

var askBareInt = regexp.MustCompile(`(?:^|[\s(])[#＃]?(\d{1,7})(?:[\s!?)]|[,.](?:\s|$)|$)`)

// askBareNumbers are whole numbers typed on their own ("approve 480"), not
// prices, hours, quantities or parts of a link.
func askBareNumbers(msg string) []int64 {
	text := askURL.ReplaceAllString(msg, " ")
	text = askPriceDollar.ReplaceAllString(text, " ")
	text = askHoursRe.ReplaceAllString(text, " ")
	if loc := askPriceWord.FindStringIndex(text); loc != nil {
		// "price on request 480 to 59.62": drop the price after "to".
		text = text[:loc[1]] + askPriceTo.ReplaceAllString(text[loc[1]:], " ")
	}
	out := []int64{}
	for _, m := range askBareInt.FindAllStringSubmatch(text, -1) {
		if n, err := strconv.ParseInt(m[1], 10, 64); err == nil && n > 0 && n <= 1<<31-1 {
			out = append(out, n)
		}
	}
	return out
}

// askTypedNumber reports whether v appears as a number in the text.
func askTypedNumber(msg string, v float64) bool {
	text := strings.ReplaceAll(askURL.ReplaceAllString(msg, " "), ",", "")
	for _, m := range askNumberRe.FindAllString(text, -1) {
		if f, err := strconv.ParseFloat(m, 64); err == nil && math.Abs(f-v) < 0.005 {
			return true
		}
	}
	return false
}

func askSameURL(a, b *string) bool {
	sa, sb := "", ""
	if a != nil {
		sa = strings.TrimSpace(*a)
	}
	if b != nil {
		sb = strings.TrimSpace(*b)
	}
	return sa == sb
}

func askPartsJobs(rows []askPartsRow) []int64 {
	out := []int64{}
	seen := map[int64]bool{}
	for _, p := range rows {
		if !seen[p.ReferenceID] {
			seen[p.ReferenceID] = true
			out = append(out, p.ReferenceID)
		}
	}
	return out
}

func askSortedKeys(m map[int64]bool) []int64 {
	out := make([]int64, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

// chargeAskRetry takes one more slot of the per-user AI limit for the
// invalid-JSON retry; false (no retry) when the user has none left.
func (h *Handler) chargeAskRetry(c *gin.Context) bool {
	if h.aiLimiter == nil {
		return true
	}
	key := aiToolsActor(c)
	if key == "" {
		key = "ip:" + c.ClientIP()
	}
	ok, _ := h.aiLimiter.allowNAt(key, 1, time.Now())
	return ok
}

// massUpdateMoneyWords: an instruction that names none of these asks for no
// labour, price, line item or shipping change.
var massUpdateMoneyWords = regexp.MustCompile(`(?i)labou?r|hours?\b|\bhrs?\b|[$＄€£]|\bprice|\bcost|\bcharge|discount|\bfee|\bline|\bitem|\bparts?\b|shipping|delivery|freight|courier|postage|\badd\b|\bremove|\bdelete|\bdrop\b|\bbill|invoice|quote|%|dollar|\btotal|amount|\brate\b|加|減|减|錢|钱|運費|运费|人工`)

// dropUnaskedMoneyOps keeps a status/location instruction ("Set #31351 to On
// Test") free of labour, price, line item and shipping changes even if the
// model proposed some: when the model proposed a status or location change
// and the instruction names no money, labour or line words, only the
// non-money ops stay. Anything else is left as the model proposed.
func dropUnaskedMoneyOps(instruction string, ops []MassUpdateOp) []MassUpdateOp {
	statusOrLocation := false
	for _, op := range ops {
		if op.Op == massOpSetStatus || op.Op == massOpSetLocation {
			statusOrLocation = true
		}
	}
	if !statusOrLocation || massUpdateMoneyWords.MatchString(instruction) {
		return ops
	}
	out := make([]MassUpdateOp, 0, len(ops))
	for _, op := range ops {
		switch op.Op {
		case massOpSetLabourTotal, massOpSetLabourDiscount, massOpSetLineItemPrice, massOpAddLineItem, massOpRemoveLineItem:
			continue
		}
		out = append(out, op)
	}
	return out
}

// skillSummary is the turn line recorded for a skill answer ("" for others).
func (r *askResolver) skillSummary() string {
	resp := r.resp
	ids := resp.ReferenceIDs
	switch resp.Intent {
	case askIntentPartsUpdate:
		pp := resp.PartsPreview
		if pp == nil {
			return ""
		}
		if len(pp.Changes) == 0 {
			return "Asked which parts request on " + askRefList(ids, askSummaryRefs) + ": " + resp.Reply
		}
		parts := []string{}
		for _, ch := range pp.Changes {
			s := fmt.Sprintf("request %d (job #%d) %s", ch.PartsPurchaseRequestID, ch.ReferenceID, askPartsStatusWord(ch.OldStatus))
			if ch.NewStatus != ch.OldStatus {
				s += " → " + askPartsStatusWord(ch.NewStatus)
			}
			if ch.NewPrice != ch.OldPrice {
				s += fmt.Sprintf(", price $%.2f → $%.2f", ch.OldPrice, ch.NewPrice)
			}
			if !ch.Valid {
				s += " (can't: " + ch.Error + ")"
			}
			parts = append(parts, s)
		}
		return "Opened a parts preview: " + strings.Join(parts, "; ") + " (nothing saved until Apply)."
	case askIntentAddRepairLog:
		if p := resp.RepairLogPreview; p != nil {
			return fmt.Sprintf("Opened a repair log preview for job #%d (%g hr): %s (nothing saved until Apply).", p.ReferenceID, p.HoursUsed, p.Details)
		}
	case askIntentAddLabour:
		if p := resp.LabourPreview; p != nil {
			return fmt.Sprintf("Opened a labour preview: %g hr ($%.2f) on job #%d (nothing saved until Apply).", p.Hours, p.Amount, p.ReferenceID)
		}
	case askIntentWaitingParts:
		if len(ids) > 0 {
			return "Listed jobs waiting on parts: " + askRefList(ids, askSummaryRefs) + "."
		}
		return "Listed jobs waiting on parts."
	case askIntentJobDetails:
		return "Showed make, model and serial of " + askRefList(ids, askSummaryRefs) + "."
	case askIntentRepairHistory:
		return "Showed repair logs of " + askRefList(ids, askSummaryRefs) + "."
	case askIntentCompleteJob:
		return "Said: " + resp.Reply
	}
	return ""
}
