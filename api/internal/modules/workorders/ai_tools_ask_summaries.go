package workorders

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"humphreys/api/internal/domain"
	"humphreys/api/internal/modules/aisettings"

	"github.com/gin-gonic/gin"
)

// Management Ask conversation summaries and 2-day memory.
//
// A conversation is the run of Ask messages from one login with no gap of
// askConversationIdle or more. It ends lazily (no cron): on the next interpret
// after the gap, or when the user taps "New conversation". Then one short
// plain-text AI call condenses its turns into a few factual lines (job and
// parts request numbers only; what was APPLIED versus only previewed), the
// server scrubs phone numbers and emails, and the summary is stored per login
// (ai_ask_conversation_summaries, migration 047) for askSummaryTTL.
//
// Every interpret then sends the model the recent summaries
// (PAST_CONVERSATIONS) as a hint and fresh database records for the jobs in
// question (LIVE_JOBS) as the source of truth. Previews are always built from
// the database by the resolver, never from memory.

const (
	// askConversationIdle ends a conversation: the next message after this
	// long without one starts a new 12-turn window.
	askConversationIdle = 12 * time.Minute
	// askSummaryTTL is how long conversation summaries are kept.
	askSummaryTTL = 48 * time.Hour
	// askMaxSummaryRunes caps one stored summary.
	askMaxSummaryRunes = 1500
	// askMaxPromptSummaries caps how many summaries one interpret sends.
	askMaxPromptSummaries = 5
	// askMaxPromptSummaryRunes caps one summary inside the interpret prompt.
	askMaxPromptSummaryRunes = 600
	// askMaxLiveJobs caps how many jobs LIVE_JOBS describes.
	askMaxLiveJobs = 8
	// askMaxLiveParts / askMaxLiveLogs cap the rows per job in LIVE_JOBS.
	askMaxLiveParts = 10
	askMaxLiveLogs  = 3
	// askSummaryMaxTokens bounds the summary completion.
	askSummaryMaxTokens = 300
	// askCleanupEvery throttles the opportunistic global expiry.
	askCleanupEvery = 10 * time.Minute
)

// askSummaryMarker is a stable phrase in the summary system prompt (the local
// stand-in model and the tests detect the summary call by it).
const askSummaryMarker = "condense a repair-shop Ask conversation"

// askNow is the Ask clock (tests replace it).
var askNow = time.Now

// askSummary is one stored conversation summary.
type askSummary struct {
	ID        int64
	Summary   string
	CreatedAt time.Time
}

// ---------------------------------------------------------------------------
// PostgreSQL
// ---------------------------------------------------------------------------

func (s *pgAskStore) InsertAskSummary(ctx context.Context, userID, summary string, createdAt time.Time) error {
	_, err := s.db.Exec(ctx,
		`INSERT INTO public.ai_ask_conversation_summaries (user_id, summary, created_at) VALUES ($1::uuid, $2, $3)`,
		userID, summary, createdAt)
	return err
}

// ListAskSummaries returns up to limit summaries newer than since, newest first.
func (s *pgAskStore) ListAskSummaries(ctx context.Context, userID string, since time.Time, limit int) ([]askSummary, error) {
	if limit < 1 {
		limit = askMaxPromptSummaries
	}
	rows, err := s.db.Query(ctx,
		`SELECT id, summary, created_at FROM public.ai_ask_conversation_summaries
		  WHERE user_id = $1::uuid AND created_at > $2
		  ORDER BY created_at DESC, id DESC LIMIT $3`, userID, since, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []askSummary{}
	for rows.Next() {
		var a askSummary
		if err := rows.Scan(&a.ID, &a.Summary, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// DeleteExpiredAskSummaries deletes every user's summaries created at or
// before cutoff.
func (s *pgAskStore) DeleteExpiredAskSummaries(ctx context.Context, cutoff time.Time) (int64, error) {
	tag, err := s.db.Exec(ctx, `DELETE FROM public.ai_ask_conversation_summaries WHERE created_at <= $1`, cutoff)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// DeleteExpiredAskContexts deletes every user's Ask context last updated at or
// before cutoff.
func (s *pgAskStore) DeleteExpiredAskContexts(ctx context.Context, cutoff time.Time) (int64, error) {
	tag, err := s.db.Exec(ctx, `DELETE FROM public.ai_ask_context WHERE updated_at <= $1`, cutoff)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

// cleanupAskMemory deletes summaries older than askSummaryTTL and Ask context
// rows older than askContextTTL, for all users. Unless force is set it runs at
// most once per askCleanupEvery per process. Errors are logged only.
func (h *Handler) cleanupAskMemory(ctx context.Context, now time.Time, force bool) {
	if h.askContext == nil {
		return
	}
	if !force {
		last := h.askCleanupAt.Load()
		if last != 0 && now.Sub(time.Unix(0, last)) < askCleanupEvery {
			return
		}
		if !h.askCleanupAt.CompareAndSwap(last, now.UnixNano()) {
			return
		}
	} else {
		h.askCleanupAt.Store(now.UnixNano())
	}
	if n, err := h.askContext.DeleteExpiredAskSummaries(ctx, now.Add(-askSummaryTTL)); err != nil {
		log.Printf("[ai] ask summaries expire: %v", err)
	} else if n > 0 {
		log.Printf("[ai] ask summaries expired: %d", n)
	}
	if _, err := h.askContext.DeleteExpiredAskContexts(ctx, now.Add(-askContextTTL)); err != nil {
		log.Printf("[ai] ask context expire all: %v", err)
	}
}

// startAskMemoryCleanup runs the expiry once at startup without blocking it.
func (h *Handler) startAskMemoryCleanup() {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		h.cleanupAskMemory(ctx, askNow(), true)
	}()
}

// recentAskSummaries returns this login's summaries from the last
// askSummaryTTL, oldest first (at most askMaxPromptSummaries, the newest).
func (h *Handler) recentAskSummaries(ctx context.Context, userID string, now time.Time) []askSummary {
	if h.askContext == nil || userID == "" {
		return nil
	}
	list, err := h.askContext.ListAskSummaries(ctx, userID, now.Add(-askSummaryTTL), askMaxPromptSummaries)
	if err != nil {
		log.Printf("[ai] ask summaries list: %v", err)
		return nil
	}
	out := make([]askSummary, 0, len(list))
	for _, s := range list {
		if s.CreatedAt.After(now.Add(-askSummaryTTL)) {
			out = append(out, s)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	if len(out) > askMaxPromptSummaries {
		out = out[len(out)-askMaxPromptSummaries:]
	}
	return out
}

// ---------------------------------------------------------------------------
// Ending a conversation
// ---------------------------------------------------------------------------

// askConversationEnded reports whether the saved conversation has turns and
// has been idle for askConversationIdle or more.
func askConversationEnded(ac askContext, now time.Time) bool {
	return len(ac.Turns) > 0 && !ac.UpdatedAt.IsZero() && now.Sub(ac.UpdatedAt) >= askConversationIdle
}

// closeAskConversation summarizes ac's turns (best-effort: one AI call, one
// rate-limit slot) and clears the turns, jobs, customer and topic of the
// user's context row. It reports whether a summary was stored. It never
// fails the caller; errors are logged.
func (h *Handler) closeAskConversation(c *gin.Context, settings *aisettings.Settings, userID string, ac askContext, createdAt time.Time) (summarized bool, err error) {
	ctx := c.Request.Context()
	if len(ac.Turns) > 0 && settings != nil {
		summarized = h.summarizeAskConversation(c, *settings, userID, ac, createdAt)
	}
	if h.askContext != nil && userID != "" && !ac.UpdatedAt.IsZero() {
		err = h.askContext.SaveAskContext(ctx, userID, askContext{ReferenceIDs: []int64{}, Topic: askTopicJobs})
		if err != nil {
			log.Printf("[ai] ask conversation clear: %v", err)
		}
	}
	h.cleanupAskMemory(ctx, askNow(), false)
	return summarized, err
}

// summarizeAskConversation makes the one summary call and stores the scrubbed
// result. It returns false (and logs) when no rate-limit slot is left, the
// call fails or the model returned nothing.
func (h *Handler) summarizeAskConversation(c *gin.Context, settings aisettings.Settings, userID string, ac askContext, createdAt time.Time) bool {
	if h.askContext == nil || userID == "" || len(ac.Turns) == 0 {
		return false
	}
	if !h.chargeAskRetry(c) {
		log.Printf("[ai] ask: conversation summary skipped (AI rate limit reached)")
		return false
	}
	start := time.Now()
	text, _, err := h.generateOpenRouterTextOnce(c, settings, askSummarySystemPrompt(), buildAskSummaryPrompt(ac), askSummaryMaxTokens)
	log.Printf("[ai] ask: conversation summary took %s", time.Since(start).Round(time.Millisecond))
	if err != nil {
		log.Printf("[ai] ask: conversation summary failed: %v", err)
		return false
	}
	summary := cleanAskSummary(text)
	if summary == "" {
		log.Printf("[ai] ask: conversation summary was empty")
		return false
	}
	if err := h.askContext.InsertAskSummary(c.Request.Context(), userID, summary, createdAt); err != nil {
		log.Printf("[ai] ask: conversation summary save: %v", err)
		return false
	}
	return true
}

// askSummarySystemPrompt is the plain-text summary instruction.
func askSummarySystemPrompt() string {
	return "You " + askSummaryMarker + " into a short factual summary that the same shop owner's Ask assistant will read later as a hint. " +
		"Write 1 to 5 short plain-text lines: no markdown, no JSON, no greeting. " +
		"Say which jobs were discussed (by job number, e.g. #31221) and which parts requests (by request id, e.g. request 480). " +
		"Say what was actually APPLIED (the conversation says Applied, saved or done) and, separately, what was only proposed or previewed " +
		"(a preview says \"nothing saved until Apply\"). Never record a preview as done; if it is unclear whether something was applied, call it previewed. " +
		"Do NOT include customer names, phone numbers, emails or addresses: use job numbers and parts request numbers only. " +
		"Never invent jobs, statuses, prices or actions that are not in the conversation."
}

// buildAskSummaryPrompt is the conversation to condense (no saved customer).
func buildAskSummaryPrompt(ac askContext) string {
	var b strings.Builder
	b.WriteString("Conversation to condense (oldest first):\n")
	for _, t := range ac.Turns {
		b.WriteString("USER: ")
		b.WriteString(askOneLine(t.User, askMaxTurnRunes))
		b.WriteString("\nASSISTANT: ")
		b.WriteString(askOneLine(t.Assistant, askMaxTurnRunes))
		b.WriteString("\n")
	}
	if len(ac.ReferenceIDs) > 0 {
		b.WriteString("Jobs the last answer was about: ")
		b.WriteString(askRefList(ac.ReferenceIDs, askSummaryRefs))
		b.WriteString("\n")
	}
	b.WriteString("Write the summary now.\n")
	return b.String()
}

var askCodeFence = regexp.MustCompile("(?m)^\\s*```[a-zA-Z]*\\s*$")

// cleanAskSummary trims the model's text, drops code fences and blank lines,
// scrubs phone numbers and emails and caps the length.
func cleanAskSummary(text string) string {
	text = askCodeFence.ReplaceAllString(text, "")
	lines := []string{}
	for _, l := range strings.Split(text, "\n") {
		if l = strings.Join(strings.Fields(l), " "); l != "" {
			lines = append(lines, l)
		}
	}
	out := scrubAskPII(strings.Join(lines, "\n"))
	return strings.TrimSpace(capRunes(out, askMaxSummaryRunes))
}

// ---------------------------------------------------------------------------
// PII scrub
// ---------------------------------------------------------------------------

var (
	askEmailRe = regexp.MustCompile(`(?i)[a-z0-9._%+\-]+@[a-z0-9\-]+(?:\.[a-z0-9\-]+)*\.[a-z]{2,}`)
	// International: + country code then 2-5 digit groups (8+ digits total).
	askIntlPhoneRe = regexp.MustCompile(`\+\d{1,3}(?:[ .\-]?\(?\d{1,4}\)?){2,5}`)
	// North American: (416) 555-1234, 416-555-1234, 416.555.1234, 4165551234.
	askNAPhoneRe = regexp.MustCompile(`(?:\(\s*[2-9]\d{2}\s*\)|\b[2-9]\d{2})[ .\-]?[2-9]\d{2}[ .\-]?\d{4}\b`)
)

// scrubAskPII replaces email addresses with [email] and phone numbers with
// [phone]. Job numbers (5 digits), request ids, prices and dates stay.
func scrubAskPII(s string) string {
	s = askEmailRe.ReplaceAllString(s, "[email]")
	s = askIntlPhoneRe.ReplaceAllStringFunc(s, func(m string) string {
		digits := 0
		for _, r := range m {
			if r >= '0' && r <= '9' {
				digits++
			}
		}
		if digits < 8 {
			return m
		}
		return "[phone]"
	})
	return askNAPhoneRe.ReplaceAllString(s, "[phone]")
}

// ---------------------------------------------------------------------------
// "All"-type questions
// ---------------------------------------------------------------------------

var (
	// A shop-wide list question: "which jobs …", "what parts requests …",
	// "how many jobs …", "any parts …".
	askBroadWhich = regexp.MustCompile(`(?i)^\s*(?:which|what|how\s+many|any)\s+(?:of\s+the\s+)?(?:jobs|work\s+orders|parts?(?:\s+(?:purchase\s+)?requests?)?|requests)\b`)
	// "show all …", "list every …", "give me all …".
	askBroadAll  = regexp.MustCompile(`(?i)\b(?:show|list|give|find|see)\s+(?:me\s+)?(?:all|every)\b|\ball\s+(?:the\s+)?(?:jobs|work\s+orders|parts|parts?\s+requests|requests)\b`)
	askBroadNoun = regexp.MustCompile(`(?i)\b(?:jobs?|work\s+orders?|parts?|requests?)\b`)
	// A reference to a specific remembered job or customer.
	askSpecificRef = regexp.MustCompile(`(?i)\b(?:that|this|those|these|the\s+same)\s+(?:job|jobs|one|ones|work\s+orders?|customer)\b|\bon\s+(?:it|them)\b|\bof\s+(?:it|them)\b`)
)

// isAskBroadQuery reports whether the message asks a shop-wide list question
// ("which parts requests are waiting for approval?", "which jobs are waiting
// on parts?", "show all X"), which must query everything rather than the
// remembered jobs. It is false when the message names a job or request
// number or refers to a specific remembered job ("that job", "their parts").
func isAskBroadQuery(msg string) bool {
	if len(parseAskJobIDs(msg)) > 0 || len(askStandaloneNumbers(msg)) > 0 || askPartsRequestRef.MatchString(msg) {
		return false
	}
	if askSpecificRef.MatchString(msg) || askFollowUpEN.MatchString(msg) || askFollowUpIt.MatchString(msg) || isAskCustomerFollowUp(msg) {
		return false
	}
	for _, phrase := range askFollowUpZH {
		if strings.Contains(msg, phrase) {
			return false
		}
	}
	if !isAskQuestion(msg) {
		return false
	}
	switch {
	case askWaitingOnParts.MatchString(msg):
		return true
	case askPartsStatusFilter[0].re.MatchString(msg):
		return true
	case askBroadWhich.MatchString(msg):
		return true
	case askBroadAll.MatchString(msg) && askBroadNoun.MatchString(msg):
		return true
	}
	return false
}

// ---------------------------------------------------------------------------
// LIVE_JOBS
// ---------------------------------------------------------------------------

// askLiveJobIDs are the jobs to load fresh for the prompt: typed job numbers,
// the jobs of typed parts request ids, then the saved jobs unless the message
// is a shop-wide question. Capped at askMaxLiveJobs.
func (h *Handler) askLiveJobIDs(ctx context.Context, msg string, prev askContext, broad bool) []int64 {
	out := []int64{}
	seen := map[int64]bool{}
	add := func(ids ...int64) {
		for _, id := range ids {
			if id > 0 && !seen[id] && len(out) < askMaxLiveJobs {
				seen[id] = true
				out = append(out, id)
			}
		}
	}
	add(parseAskJobIDs(msg)...)
	if reqs := askNumbersIn(askPartsRequestRef, msg); len(reqs) > 0 && h.askParts != nil {
		if rows, err := h.askParts.PartsRequestsByID(ctx, reqs); err == nil {
			add(askPartsJobs(rows)...)
		} else {
			log.Printf("[ai] ask live parts by id: %v", err)
		}
	}
	if !broad {
		add(prev.ReferenceIDs...)
	}
	return out
}

// askLiveJobs describes ids from the database right now: status, item, make
// and model, parts requests and the last repair logs. It never includes the
// customer. ok is false when no job lookup is configured (the block is then
// omitted).
func (h *Handler) askLiveJobs(ctx context.Context, ids []int64) (lines []string, ok bool) {
	if h.service == nil || h.service.repo == nil {
		return nil, false
	}
	parts := map[int64][]askPartsRow{}
	if h.askParts != nil && len(ids) > 0 {
		rows, err := h.askParts.PartsRequestsForJobs(ctx, ids)
		if err != nil {
			log.Printf("[ai] ask live parts: %v", err)
		}
		for _, p := range rows {
			parts[p.ReferenceID] = append(parts[p.ReferenceID], p)
		}
	}
	for _, id := range ids {
		detail, err := h.service.GetWorkOrderDetail(ctx, int(id))
		found := err == nil
		if err != nil && !errors.Is(err, ErrWorkOrderNotFound) {
			log.Printf("[ai] ask live job: %v", err)
		}
		if !found && len(parts[id]) == 0 {
			continue
		}
		var logs []domain.RepairLog
		if found {
			if l, err := h.service.ListRepairLogs(ctx, int(id)); err == nil {
				logs = l
			} else {
				log.Printf("[ai] ask live repair logs: %v", err)
			}
		}
		lines = append(lines, askLiveJobLine(id, detail, found, parts[id], logs))
	}
	return lines, true
}

// askLiveJobLine is one LIVE_JOBS line (single line, no customer details).
func askLiveJobLine(id int64, d domain.WorkOrderDetail, found bool, parts []askPartsRow, logs []domain.RepairLog) string {
	fields := []string{}
	if found {
		status := strings.TrimSpace(stringValue(d.StatusName))
		if status == "" {
			status = "unknown"
		}
		fields = append(fields, "status "+status)
		if v := strings.TrimSpace(stringValue(d.ItemName)); v != "" {
			fields = append(fields, "item "+v)
		}
		if len(d.BrandNames) > 0 {
			fields = append(fields, "make "+strings.Join(d.BrandNames, "/"))
		}
		if v := strings.TrimSpace(stringValue(d.ModelNumber)); v != "" {
			fields = append(fields, "model "+v)
		}
	} else {
		fields = append(fields, "job record not loaded")
	}
	if len(parts) == 0 {
		fields = append(fields, "parts requests: none")
	} else {
		ps := []string{}
		for i, p := range parts {
			if i == askMaxLiveParts {
				ps = append(ps, fmt.Sprintf("+%d more", len(parts)-askMaxLiveParts))
				break
			}
			ps = append(ps, fmt.Sprintf("request %d %s qty %d %s $%.2f", p.ID, strconv.Quote(askOneLine(p.ItemName, 80)), p.Quantity, p.Status, p.TotalPrice))
		}
		fields = append(fields, "parts requests: "+strings.Join(ps, ", "))
	}
	if found {
		sorted := append([]domain.RepairLog{}, logs...)
		at := func(l domain.RepairLog) time.Time {
			if l.RepairDate != nil {
				return *l.RepairDate
			}
			if l.CreatedAt != nil {
				return *l.CreatedAt
			}
			return time.Time{}
		}
		sort.SliceStable(sorted, func(i, j int) bool { return at(sorted[i]).After(at(sorted[j])) })
		if len(sorted) > askMaxLiveLogs {
			sorted = sorted[:askMaxLiveLogs]
		}
		if len(sorted) == 0 {
			fields = append(fields, "repair logs: none")
		} else {
			ls := []string{}
			for _, l := range sorted {
				date := "no date"
				if t := at(l); !t.IsZero() {
					date = t.Format("2006-01-02")
				}
				ls = append(ls, fmt.Sprintf("%s %gh %s", date, l.HoursUsed, strconv.Quote(askOneLine(l.Details, 120))))
			}
			fields = append(fields, "latest repair logs: "+strings.Join(ls, ", "))
		}
	}
	return scrubAskPII(fmt.Sprintf("- JOB #%d: %s", id, strings.Join(fields, "; ")))
}

// ---------------------------------------------------------------------------
// Interpret prompt
// ---------------------------------------------------------------------------

// askPromptInput is everything buildAskUserPrompt sends.
type askPromptInput struct {
	Prev      askContext
	Message   string
	Summaries []askSummary
	// LiveJobs are LIVE_JOBS lines; HasLiveJobs is false when no lookup is
	// configured (the block is omitted).
	LiveJobs    []string
	HasLiveJobs bool
	// Now dates the summaries ("3h ago"); zero uses askNow.
	Now time.Time
}

func askPastConversationsBlock(sums []askSummary, now time.Time) string {
	if len(sums) == 0 {
		return "PAST_CONVERSATIONS: (none)\n"
	}
	if now.IsZero() {
		now = askNow()
	}
	var b strings.Builder
	b.WriteString("PAST_CONVERSATIONS: summaries of this user's earlier Ask conversations in the last 2 days, oldest first (a hint only; may be out of date):\n")
	for _, s := range sums {
		ago := now.Sub(s.CreatedAt)
		if ago < 0 {
			ago = 0
		}
		label := fmt.Sprintf("%dh ago", int(ago.Hours()))
		if ago < time.Hour {
			label = fmt.Sprintf("%dm ago", int(ago.Minutes()))
		}
		b.WriteString("- ")
		b.WriteString(s.CreatedAt.UTC().Format("2006-01-02 15:04 UTC"))
		b.WriteString(" (" + label + "): ")
		b.WriteString(askOneLine(strings.ReplaceAll(s.Summary, "\n", "; "), askMaxPromptSummaryRunes))
		b.WriteString("\n")
	}
	return b.String()
}

func askLiveJobsBlock(lines []string) string {
	if len(lines) == 0 {
		return "LIVE_JOBS: (none)\n"
	}
	return "LIVE_JOBS: current database records for the jobs in question (source of truth):\n" + strings.Join(lines, "\n") + "\n"
}

// ---------------------------------------------------------------------------
// New conversation endpoint
// ---------------------------------------------------------------------------

// AskNewConversation ends the user's current Ask conversation: it summarizes
// it (best-effort; skipped when the AI limit is reached or AI is not
// configured) and clears the turns and saved jobs. {"ok":true,"summarized":bool}.
func (h *Handler) AskNewConversation(c *gin.Context) {
	userID := aiToolsActor(c)
	if h.askContext == nil || userID == "" {
		c.JSON(http.StatusOK, gin.H{"ok": true, "summarized": false})
		return
	}
	ctx := c.Request.Context()
	now := askNow()
	prev, canSave := h.loadAskContext(ctx, userID, now)
	if !canSave {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not start a new conversation"})
		return
	}
	var settings *aisettings.Settings
	if len(prev.Turns) > 0 {
		if s, err := h.getAISettings(c); err != nil {
			log.Printf("[ai] ask new conversation settings: %v", err)
		} else if s.HasOpenRouterAPIKey || strings.TrimSpace(s.OpenRouterAPIKey) != "" {
			settings = &s
		}
	}
	summarized, err := h.closeAskConversation(c, settings, userID, prev, now)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not start a new conversation"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "summarized": summarized})
}
