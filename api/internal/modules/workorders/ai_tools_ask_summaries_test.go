package workorders

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"humphreys/api/internal/domain"
	"humphreys/api/internal/modules/auth/security"

	"github.com/gin-gonic/gin"
)

// Management Ask conversation summaries and 2-day memory: a conversation ends
// after askConversationIdle without a message (or on "New conversation"), is
// condensed into one scrubbed summary per login, and summaries older than
// 48 hours are deleted. Every interpret sends the recent summaries as a hint
// and LIVE_JOBS (fresh database records) as the source of truth.

// --- memAskStore summaries --------------------------------------------------

type memAskSummary struct {
	user string
	askSummary
}

func (s *memAskStore) InsertAskSummary(_ context.Context, userID, summary string, createdAt time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.nextSummaryID++
	s.summaries = append(s.summaries, memAskSummary{user: userID, askSummary: askSummary{ID: s.nextSummaryID, Summary: summary, CreatedAt: createdAt}})
	return nil
}

func (s *memAskStore) ListAskSummaries(_ context.Context, userID string, since time.Time, limit int) ([]askSummary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []askSummary{}
	for _, row := range s.summaries {
		if row.user == userID && row.CreatedAt.After(since) {
			out = append(out, row.askSummary)
		}
	}
	// Newest first, like the SQL.
	sort.SliceStable(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (s *memAskStore) DeleteExpiredAskSummaries(_ context.Context, cutoff time.Time) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	keep := s.summaries[:0]
	var n int64
	for _, row := range s.summaries {
		if row.CreatedAt.After(cutoff) {
			keep = append(keep, row)
		} else {
			n++
		}
	}
	s.summaries = keep
	return n, nil
}

func (s *memAskStore) DeleteExpiredAskContexts(_ context.Context, cutoff time.Time) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var n int64
	for user, ac := range s.rows {
		if !ac.UpdatedAt.After(cutoff) {
			delete(s.rows, user)
			s.deletes++
			n++
		}
	}
	return n, nil
}

func (s *memAskStore) userSummaries(userID string) []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []string{}
	for _, row := range s.summaries {
		if row.user == userID {
			out = append(out, row.Summary)
		}
	}
	return out
}

func (l *askLLM) counts() (interprets, summaries int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.callsOut, l.summaryCalls
}

func (l *askLLM) setSummary(text string) {
	l.mu.Lock()
	l.summary = text
	l.mu.Unlock()
}

// newConversationAs calls POST /ai-tools/ask/new-conversation.
func newConversationAs(t *testing.T, router *gin.Engine, userID string, perms []string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/ai-tools/ask/new-conversation", strings.NewReader("{}"))
	token, _, err := security.NewAccessToken("test-secret", time.Minute, userID, nil, perms)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

// liveJobsBlock is the LIVE_JOBS section of an interpret prompt ("" when absent).
func liveJobsBlock(p string) string {
	i := strings.Index(p, "\nLIVE_JOBS:")
	if i < 0 {
		return ""
	}
	rest := p[i+1:]
	if j := strings.Index(rest, "\nRequest: "); j >= 0 {
		rest = rest[:j]
	}
	return rest
}

func pastBlock(p string) string {
	i := strings.Index(p, "PAST_CONVERSATIONS:")
	if i < 0 {
		return ""
	}
	rest := p[i:]
	if j := strings.Index(rest, "\nSaved context"); j >= 0 {
		rest = rest[:j]
	}
	return rest
}

func idleRow(minutesAgo int) askContext {
	return askContext{
		ReferenceIDs: []int64{31221}, CustomerQuery: "Jane Doe", Topic: askTopicParts,
		Turns: []askTurn{
			{User: "show parts on job 31221", Assistant: "Showed parts requests on job #31221."},
			{User: "approve request 480", Assistant: "Opened a preview to approve parts request 480 on job #31221 (nothing saved until Apply)."},
		},
		UpdatedAt: time.Now().Add(-time.Duration(minutesAgo) * time.Minute),
	}
}

// --- 1. Summary on the next interpret after the idle gap ----------------------

func TestAskIdleConversationIsSummarizedBeforeInterpret(t *testing.T) {
	llm := newAskLLM(t)
	llm.setSummary("Job 31221: parts request 480 approval was previewed, not applied.")
	store := newMemAskStore(31221)
	store.rows[askUserA] = idleRow(13)
	router := askContextRouter(t, store)

	llm.answer(askIntentUnknown)
	askAs(t, router, askUserA, "hello")
	if _, n := llm.counts(); n != 1 {
		t.Fatalf("summary calls = %d, want 1", n)
	}
	// The summary call saw the old turns, never as an interpret.
	llm.mu.Lock()
	sp := strings.Join(llm.summaryPrompts, "\n")
	llm.mu.Unlock()
	if !strings.Contains(sp, "approve request 480") || !strings.Contains(sp, "31221") {
		t.Fatalf("summary prompt lacks the conversation:\n%s", sp)
	}
	if got := store.userSummaries(askUserA); len(got) != 1 || got[0] != "Job 31221: parts request 480 approval was previewed, not applied." {
		t.Fatalf("summaries = %q", got)
	}
	// The interpret saw the new summary but not the old turns or saved jobs.
	p := llm.lastUserPrompt(t)
	if !strings.Contains(pastBlock(p), "parts request 480 approval was previewed") {
		t.Fatalf("prompt lacks the fresh summary:\n%s", p)
	}
	if strings.Contains(p, "USER: show parts on job 31221") || strings.Contains(p, "SAVED_JOBS: 31221") || strings.Contains(p, "Jane Doe") {
		t.Fatalf("a closed conversation reached the model as live context:\n%s", p)
	}
	row, _ := store.row(askUserA)
	if len(row.Turns) != 1 || row.Turns[0].User != "hello" || len(row.ReferenceIDs) != 0 || row.CustomerQuery != "" {
		t.Fatalf("context should start a new window: %+v", row)
	}

	// Inside the window: no new summary, the window keeps growing.
	askAs(t, router, askUserA, "and again")
	if _, n := llm.counts(); n != 1 {
		t.Fatalf("summary calls = %d, want still 1", n)
	}
	if row, _ := store.row(askUserA); len(row.Turns) != 2 {
		t.Fatalf("turns = %+v", row.Turns)
	}
}

func TestAskInsideIdleWindowKeepsConversation(t *testing.T) {
	llm := newAskLLM(t)
	store := newMemAskStore(31221)
	store.rows[askUserA] = idleRow(11)
	router := askContextRouter(t, store)
	llm.answer(askIntentUnknown)
	askAs(t, router, askUserA, "hello")
	if _, n := llm.counts(); n != 0 {
		t.Fatalf("summary calls = %d, want 0", n)
	}
	if p := llm.lastUserPrompt(t); !strings.Contains(p, "USER: show parts on job 31221") || !strings.Contains(p, "SAVED_JOBS: 31221") {
		t.Fatalf("same conversation must keep its turns and jobs:\n%s", p)
	}
	if row, _ := store.row(askUserA); len(row.Turns) != 3 || !reflect.DeepEqual(row.ReferenceIDs, []int64{31221}) {
		t.Fatalf("row = %+v", row)
	}
}

func TestAskIdleUsesAskNowClock(t *testing.T) {
	llm := newAskLLM(t)
	llm.setSummary("Job 275 was shown.")
	store := newMemAskStore(275)
	router := askContextRouter(t, store)
	llm.answer(askIntentCustomerJobs, 275)
	askAs(t, router, askUserA, "show job 275")
	if _, n := llm.counts(); n != 0 {
		t.Fatalf("summary calls = %d", n)
	}
	orig := askNow
	askNow = func() time.Time { return time.Now().Add(askConversationIdle + time.Minute) }
	t.Cleanup(func() { askNow = orig })
	llm.answer(askIntentUnknown)
	askAs(t, router, askUserA, "hi")
	if _, n := llm.counts(); n != 1 {
		t.Fatalf("summary calls = %d, want 1", n)
	}
	if row, _ := store.row(askUserA); len(row.Turns) != 1 || len(row.ReferenceIDs) != 0 {
		t.Fatalf("row = %+v", row)
	}
}

func TestAskIdleSummaryFailureStillClosesConversation(t *testing.T) {
	llm := newAskLLM(t)
	llm.setSummary("Job 31221 shown.")
	store := shopStore()
	store.jobs[31221] = true
	store.rows[askUserA] = idleRow(30)
	// One slot: the interpret takes it, so the summary call is skipped.
	router := skillRouter(t, store, shopStub(), 1)
	llm.answer(askIntentUnknown)
	askWith(t, router, skillPerms, "hello")
	if _, n := llm.counts(); n != 0 {
		t.Fatalf("summary must be skipped when no slot is left (calls=%d)", n)
	}
	if got := store.userSummaries(askUserA); len(got) != 0 {
		t.Fatalf("summaries = %q", got)
	}
	if row, _ := store.row(askUserA); len(row.Turns) != 1 || row.Turns[0].User != "hello" || len(row.ReferenceIDs) != 0 {
		t.Fatalf("conversation should still close: %+v", row)
	}

	// An empty model summary is not stored either.
	llm2 := newAskLLM(t)
	llm2.setSummary("   ")
	store2 := newMemAskStore(31221)
	store2.rows[askUserA] = idleRow(30)
	router2 := askContextRouter(t, store2)
	llm2.answer(askIntentUnknown)
	askAs(t, router2, askUserA, "hello")
	if got := store2.userSummaries(askUserA); len(got) != 0 {
		t.Fatalf("empty summary stored: %q", got)
	}
}

// --- 2. New conversation endpoint ---------------------------------------------

func TestAskNewConversationEndpoint(t *testing.T) {
	llm := newAskLLM(t)
	llm.setSummary("Job 31221: request 480 approval previewed only.")
	store := newMemAskStore(31221)
	store.rows[askUserA] = idleRow(1)
	store.rows[askUserB] = idleRow(1)
	router := askContextRouter(t, store)

	code, body := newConversationAs(t, router, askUserA, []string{permUpdate})
	if code != http.StatusOK || body["ok"] != true || body["summarized"] != true {
		t.Fatalf("got %d %v", code, body)
	}
	if got := store.userSummaries(askUserA); len(got) != 1 {
		t.Fatalf("summaries = %q", got)
	}
	row, _ := store.row(askUserA)
	if len(row.Turns) != 0 || len(row.ReferenceIDs) != 0 || row.CustomerQuery != "" {
		t.Fatalf("context should be cleared: %+v", row)
	}
	// Another login is untouched.
	if rowB, _ := store.row(askUserB); len(rowB.Turns) != 2 {
		t.Fatalf("user B row = %+v", rowB)
	}
	// Nothing left to summarize: no model call.
	code, body = newConversationAs(t, router, askUserA, []string{permUpdate})
	if code != http.StatusOK || body["summarized"] != false {
		t.Fatalf("got %d %v", code, body)
	}
	if _, n := llm.counts(); n != 1 {
		t.Fatalf("summary calls = %d, want 1", n)
	}
	// The next interpret starts fresh but sees the summary.
	llm.answer(askIntentUnknown)
	askAs(t, router, askUserA, "hello")
	p := llm.lastUserPrompt(t)
	if !strings.Contains(pastBlock(p), "request 480 approval previewed only") || strings.Contains(p, "USER: show parts") {
		t.Fatalf("prompt = %s", p)
	}
	// Permission gate.
	if code, _ := newConversationAs(t, router, askUserA, []string{permRead}); code != http.StatusForbidden {
		t.Fatalf("staff got %d, want 403", code)
	}
}

func TestAskNewConversationWhenRateLimited(t *testing.T) {
	llm := newAskLLM(t)
	llm.setSummary("Job 31221 shown.")
	store := shopStore()
	store.jobs[31221] = true
	router := skillRouter(t, store, shopStub(), 1)
	llm.answer(askIntentCustomerJobs, 31221)
	askWith(t, router, skillPerms, "show job 31221") // uses the only slot
	code, body := newConversationAs(t, router, askUserA, skillPerms)
	if code != http.StatusOK || body["ok"] != true || body["summarized"] != false {
		t.Fatalf("got %d %v", code, body)
	}
	if _, n := llm.counts(); n != 0 {
		t.Fatalf("summary calls = %d", n)
	}
	if row, _ := store.row(askUserA); len(row.Turns) != 0 || len(row.ReferenceIDs) != 0 {
		t.Fatalf("context should be cleared: %+v", row)
	}
}

// --- 3. PII scrub ------------------------------------------------------------

func TestScrubAskPII(t *testing.T) {
	for _, c := range []struct{ in, want string }{
		{"Call 416-555-1234 about job 31221.", "Call [phone] about job 31221."},
		{"(416) 555-1234", "[phone]"},
		{"+1 416 555 1234", "[phone]"},
		{"phone 4165551234 now", "phone [phone] now"},
		{"416.555.1234", "[phone]"},
		{"+44 20 7946 0958", "[phone]"},
		{"jane.doe+shop@example.co.uk wrote", "[email] wrote"},
		{"Email JANE@EXAMPLE.COM.", "Email [email]."},
		{"Jobs 31221, 30175 and request 480 at $59.62", "Jobs 31221, 30175 and request 480 at $59.62"},
		{"Total $1234.56; 2026-11-14 approved", "Total $1234.56; 2026-11-14 approved"},
		{"Jobs #31221 #31222 #31223", "Jobs #31221 #31222 #31223"},
		{"1.5 hours on 2026-11-13", "1.5 hours on 2026-11-13"},
	} {
		if got := scrubAskPII(c.in); got != c.want {
			t.Errorf("scrubAskPII(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestAskSummaryIsScrubbedBeforeSaving(t *testing.T) {
	llm := newAskLLM(t)
	llm.setSummary("Job 31221 (Jane, 416-555-1234, jane.doe@example.com): request 480 approved (applied).\n```")
	store := newMemAskStore(31221)
	store.rows[askUserA] = idleRow(20)
	router := askContextRouter(t, store)
	llm.answer(askIntentUnknown)
	askAs(t, router, askUserA, "hello")
	got := store.userSummaries(askUserA)
	if len(got) != 1 {
		t.Fatalf("summaries = %q", got)
	}
	s := got[0]
	if strings.Contains(s, "416-555-1234") || strings.Contains(s, "jane.doe@example.com") ||
		!strings.Contains(s, "[phone]") || !strings.Contains(s, "[email]") || !strings.Contains(s, "31221") {
		t.Fatalf("summary not scrubbed: %q", s)
	}
	// The summary system prompt forbids personal details and preview-as-done.
	sys := askSummarySystemPrompt()
	for _, want := range []string{askSummaryMarker, "customer names", "phone", "email", "address", "APPLIED", "preview"} {
		if !strings.Contains(sys, want) {
			t.Fatalf("summary system prompt lacks %q", want)
		}
	}
}

func TestAskSummaryIsCapped(t *testing.T) {
	long := strings.Repeat("Job 31221 shown. ", 400)
	if got := cleanAskSummary(long); len([]rune(got)) > askMaxSummaryRunes {
		t.Fatalf("summary has %d runes", len([]rune(got)))
	}
	if got := cleanAskSummary("```\nJob 1 shown.\n```"); got != "Job 1 shown." {
		t.Fatalf("got %q", got)
	}
}

// --- 4. 48h retention --------------------------------------------------------

func TestAskSummariesExpireAfter48Hours(t *testing.T) {
	if askContextTTL != 2*24*time.Hour || askSummaryTTL != 48*time.Hour || askConversationIdle != 12*time.Minute || askMaxTurns != 12 {
		t.Fatalf("ttl=%s summaryTTL=%s idle=%s turns=%d", askContextTTL, askSummaryTTL, askConversationIdle, askMaxTurns)
	}
	ctx := context.Background()
	store := newMemAskStore()
	now := time.Now()
	_ = store.InsertAskSummary(ctx, askUserA, "old A", now.Add(-49*time.Hour))
	_ = store.InsertAskSummary(ctx, askUserA, "new A", now.Add(-time.Hour))
	_ = store.InsertAskSummary(ctx, askUserB, "old B", now.Add(-72*time.Hour))
	h := &Handler{askContext: store}
	got := h.recentAskSummaries(ctx, askUserA, now)
	if len(got) != 1 || got[0].Summary != "new A" {
		t.Fatalf("recent = %+v", got)
	}
	h.cleanupAskMemory(ctx, now, true)
	store.mu.Lock()
	n := len(store.summaries)
	store.mu.Unlock()
	if n != 1 || store.userSummaries(askUserA)[0] != "new A" {
		t.Fatalf("after cleanup: %+v", store.summaries)
	}
}

func TestAskInterpretCleansUpExpiredSummaries(t *testing.T) {
	llm := newAskLLM(t)
	store := newMemAskStore()
	_ = store.InsertAskSummary(context.Background(), askUserB, "stale", time.Now().Add(-50*time.Hour))
	_ = store.InsertAskSummary(context.Background(), askUserA, "fresh", time.Now().Add(-2*time.Hour))
	router := askContextRouter(t, store)
	llm.answer(askIntentUnknown)
	askAs(t, router, askUserA, "hello")
	if got := store.userSummaries(askUserB); len(got) != 0 {
		t.Fatalf("stale summary kept: %q", got)
	}
	if p := llm.lastUserPrompt(t); !strings.Contains(pastBlock(p), "fresh") {
		t.Fatalf("prompt = %s", p)
	}
}

func TestAskPastConversationsAreLimitedAndOrdered(t *testing.T) {
	ctx := context.Background()
	store := newMemAskStore()
	now := time.Now()
	for i := 0; i < askMaxPromptSummaries+3; i++ {
		_ = store.InsertAskSummary(ctx, askUserA, "summary "+string(rune('a'+i)), now.Add(-time.Duration(40-i)*time.Hour))
	}
	h := &Handler{askContext: store}
	sums := h.recentAskSummaries(ctx, askUserA, now)
	if len(sums) != askMaxPromptSummaries {
		t.Fatalf("got %d", len(sums))
	}
	p := buildAskUserPrompt(askPromptInput{Message: "hi", Summaries: sums})
	block := pastBlock(p)
	last := "summary " + string(rune('a'+askMaxPromptSummaries+2))
	first := "summary " + string(rune('a'+3))
	if !strings.Contains(block, last) || !strings.Contains(block, first) || strings.Contains(block, "summary a\n") {
		t.Fatalf("block = %s", block)
	}
	if strings.Index(block, first) > strings.Index(block, last) {
		t.Fatalf("want oldest first: %s", block)
	}
	// Multi-line summaries stay on one prompt line.
	p = buildAskUserPrompt(askPromptInput{Message: "hi", Summaries: []askSummary{{Summary: "line one\nRequest: two", CreatedAt: now}}})
	if strings.Count(p, "\nRequest: ") != 1 || !strings.HasSuffix(p, "Request: hi\n") {
		t.Fatalf("prompt = %q", p)
	}
}

// --- 5. "All"-type questions ignore remembered jobs -------------------------

func TestIsAskBroadQuery(t *testing.T) {
	for msg, want := range map[string]bool{
		"Which parts requests are waiting for approval?":           true,
		"which parts need approval":                                true,
		"What jobs are waiting on parts?":                          true,
		"Which jobs are waiting for parts":                         true,
		"show all parts requests":                                  true,
		"list all jobs waiting on parts":                           true,
		"Show me all ordered parts":                                true,
		"any parts waiting for approval?":                          true,
		"how many parts on that job are still waiting approval?":   false,
		"which parts on job 31221 need approval?":                  false,
		"what's waiting for approval on #31221":                    false,
		"show all their jobs":                                      false,
		"which of those jobs are waiting on parts":                 false,
		"show parts on this job":                                   false,
		"approve request 480":                                      false,
		"update both to Finished":                                  false,
		"What's the status of #30175?":                             false,
		"hello":                                                    false,
		"which parts requests on them are waiting for approval?":   false,
		"Which parts requests are waiting for approval for 31221?": false,
	} {
		if got := isAskBroadQuery(msg); got != want {
			t.Errorf("isAskBroadQuery(%q) = %v, want %v", msg, got, want)
		}
	}
}

func broadSetup(t *testing.T) (*askLLM, *memAskStore, func(string) askInterpretResponse) {
	t.Helper()
	llm := newAskLLM(t)
	store := shopStore()
	store.jobs[31221] = true
	store.partRows = append(store.partRows, partRow(500, 31221, "Fuse 2A", "waiting_approval", 4))
	store.statusJobs[7] = append(store.statusJobs[7], 31221)
	router := skillRouter(t, store, shopStub(), 1000)
	return llm, store, func(msg string) askInterpretResponse {
		// Each question follows a fresh discussion of job 31221.
		store.mu.Lock()
		store.rows[askUserA] = askContext{ReferenceIDs: []int64{31221}, Topic: askTopicParts, UpdatedAt: time.Now(),
			Turns: []askTurn{{User: "show parts on job 31221", Assistant: "Showed parts requests on job #31221."}}}
		store.mu.Unlock()
		return askWith(t, router, skillPerms, msg)
	}
}

func TestAskBroadQueriesIgnoreRememberedJobs(t *testing.T) {
	llm, _, ask := broadSetup(t)

	// The model put the remembered job in reference_ids.
	llm.answerJSON(map[string]any{"intent": askIntentPartsRequests, "reference_ids": []int64{31221}, "parts_statuses": []string{"waiting_approval"}})
	resp := ask("Which parts requests are waiting for approval?")
	if resp.Intent != askIntentPartsRequests || len(resp.ReferenceIDs) != 0 || resp.ContextUsed {
		t.Fatalf("approval list must be shop-wide: %+v", resp)
	}
	if !reflect.DeepEqual(resp.PartsStatuses, []string{"waiting_approval"}) {
		t.Fatalf("statuses = %v", resp.PartsStatuses)
	}
	if lj := liveJobsBlock(llm.lastUserPrompt(t)); strings.Contains(lj, "31221") {
		t.Fatalf("a broad question must not load remembered jobs:\n%s", lj)
	}

	// The model said unknown but the text is a shop-wide parts list: still no memory.
	llm.answerJSON(map[string]any{"intent": askIntentPartsRequests, "reference_ids": []int64{}})
	resp = ask("show all parts requests")
	if len(resp.ReferenceIDs) != 0 || resp.ContextUsed {
		t.Fatalf("show all: %+v", resp)
	}

	llm.answerJSON(map[string]any{"intent": askIntentWaitingParts, "reference_ids": []int64{31221}})
	resp = ask("Which jobs are waiting on parts?")
	if resp.Intent != askIntentWaitingParts || resp.ContextUsed {
		t.Fatalf("waiting parts: %+v", resp)
	}
	if reflect.DeepEqual(resp.ReferenceIDs, []int64{31221}) || len(resp.ReferenceIDs) != 6 {
		t.Fatalf("waiting parts must list every job with the status: %v", resp.ReferenceIDs)
	}
	if resp.WaitingParts == nil || resp.WaitingParts.Total != 6 {
		t.Fatalf("waiting = %+v", resp.WaitingParts)
	}

	// A specific reference may use the remembered job.
	llm.answerJSON(map[string]any{"intent": askIntentPartsRequests, "reference_ids": []int64{31221}, "parts_statuses": []string{"waiting_approval"}})
	resp = ask("how many parts on that job are still waiting approval?")
	if !reflect.DeepEqual(resp.ReferenceIDs, []int64{31221}) || !resp.ContextUsed {
		t.Fatalf("that job: %+v", resp)
	}
	if lj := liveJobsBlock(llm.lastUserPrompt(t)); !strings.Contains(lj, "#31221") {
		t.Fatalf("the remembered job should be loaded live:\n%s", lj)
	}
}

// --- 6. Answers and previews follow the database, not memory -----------------

func liveSetup(t *testing.T) (*askLLM, *memAskStore, func(string) askInterpretResponse) {
	t.Helper()
	llm := newAskLLM(t)
	store := shopStore()
	store.jobs[30175] = true
	stub := shopStub()
	received := "Received"
	amp := "Amplifier"
	model := "RX-V671"
	first, last, phone, email := "Jane", "Secretname", "416-555-0199", "jane@secret.example"
	addr := "12 Hidden Lane"
	day := time.Date(2026, 11, 12, 0, 0, 0, 0, time.UTC)
	stub.details[30175] = domain.WorkOrderDetail{
		ReferenceID: 30175, StatusName: &received, ItemName: &amp, BrandNames: []string{"Yamaha"}, ModelNumber: &model,
		Customer: domain.WorkOrderCustomer{FirstName: &first, LastName: &last, HomePhone: &phone, Email: &email, AddressLine1: &addr},
	}
	waiting := "Waiting on Part (s)"
	stub.details[31271] = domain.WorkOrderDetail{ReferenceID: 31271, StatusName: &waiting}
	stub.repairLogs = map[int][]domain.RepairLog{30175: {
		{ReferenceID: 30175, RepairDate: &day, HoursUsed: 1.5, Details: "Replaced fuse; customer asked to call 905-555-0142"},
	}}
	_ = store.InsertAskSummary(context.Background(), askUserA,
		"Job 30175 set to On Test (applied). Request 480 approved at $10 (applied).", time.Now().Add(-time.Hour))
	router := skillRouter(t, store, stub, 1000)
	return llm, store, func(msg string) askInterpretResponse { return askWith(t, router, skillPerms, msg) }
}

func TestAskStatusFollowsLiveRecordNotSummary(t *testing.T) {
	llm, _, ask := liveSetup(t)
	llm.answer(askIntentCustomerJobs, 30175)
	resp := ask("What's the status of #30175?")
	if resp.Intent != askIntentCustomerJobs || !reflect.DeepEqual(resp.ReferenceIDs, []int64{30175}) || resp.ContextUsed {
		t.Fatalf("resp = %+v", resp)
	}
	p := llm.lastUserPrompt(t)
	if !strings.Contains(pastBlock(p), "On Test") {
		t.Fatalf("the summary is still sent as a hint:\n%s", p)
	}
	lj := liveJobsBlock(p)
	var line string
	for _, l := range strings.Split(lj, "\n") {
		if strings.Contains(l, "#30175") {
			line = l
		}
	}
	if line == "" || !strings.Contains(line, "status Received") || strings.Contains(line, "On Test") {
		t.Fatalf("LIVE_JOBS must show the live status:\n%s", lj)
	}
	for _, want := range []string{"Amplifier", "Yamaha", "RX-V671", "2026-11-12", "1.5", "Replaced fuse", "[phone]"} {
		if !strings.Contains(line, want) {
			t.Fatalf("LIVE_JOBS line lacks %q: %s", want, line)
		}
	}
	for _, secret := range []string{"Jane", "Secretname", "416-555-0199", "905-555-0142", "jane@secret.example", "Hidden Lane"} {
		if strings.Contains(p, secret) {
			t.Fatalf("prompt leaks %q:\n%s", secret, p)
		}
	}
	// The system prompt states memory is a hint and LIVE_JOBS is the truth.
	sys := askSystemPrompt()
	for _, want := range []string{"PAST_CONVERSATIONS", "LIVE_JOBS", "source of truth", "only a hint", "never treat a preview as already done", "ask which job", "reference_ids"} {
		if !strings.Contains(strings.ToLower(sys), strings.ToLower(want)) {
			t.Fatalf("system prompt lacks %q", want)
		}
	}
}

func TestAskPartsPreviewUsesLiveRowNotSummary(t *testing.T) {
	llm, _, ask := liveSetup(t)
	// The model even "remembers" the stale price.
	llm.answerJSON(map[string]any{"intent": askIntentPartsUpdate, "parts_request_ids": []int64{480}, "parts_action": "approve", "total_price": 10})
	resp := ask("approve request 480")
	ch := onlyChange(t, "approve", resp)
	if ch.OldStatus != "waiting_approval" || ch.NewStatus != "approved" || ch.OldPrice != 59.62 || ch.NewPrice != 59.62 || !ch.Valid {
		t.Fatalf("preview must use the live row: %+v", ch)
	}
	lj := liveJobsBlock(llm.lastUserPrompt(t))
	if !strings.Contains(lj, "#31271") || !strings.Contains(lj, "request 480") || !strings.Contains(lj, "waiting_approval") || !strings.Contains(lj, "59.62") {
		t.Fatalf("LIVE_JOBS should carry the request's job:\n%s", lj)
	}
}

func TestAskPromptLiveJobsCapped(t *testing.T) {
	llm := newAskLLM(t)
	ids := []int64{}
	stub := shopStub()
	for i := int64(1); i <= 12; i++ {
		ids = append(ids, 40000+i)
		name := "Received"
		stub.details[int(40000+i)] = domain.WorkOrderDetail{ReferenceID: int32(40000 + i), StatusName: &name}
	}
	store := newMemAskStore(ids...)
	router := skillRouter(t, store, stub, 1000)
	llm.answer(askIntentCustomerJobs)
	askWith(t, router, skillPerms, "show jobs #40001, #40002, #40003, #40004, #40005, #40006, #40007, #40008, #40009, #40010, #40011, #40012")
	lj := liveJobsBlock(llm.lastUserPrompt(t))
	if n := strings.Count(lj, "\n- JOB #"); n != askMaxLiveJobs {
		t.Fatalf("live jobs = %d, want %d:\n%s", n, askMaxLiveJobs, lj)
	}
}
