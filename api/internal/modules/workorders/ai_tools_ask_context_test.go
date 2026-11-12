package workorders

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"humphreys/api/internal/middleware"
	"humphreys/api/internal/modules/auth/security"

	"github.com/gin-gonic/gin"
)

// memAskStore is an in-memory askContextStore + askJobLookup.
type memAskStore struct {
	mu      sync.Mutex
	rows    map[string]askContext
	jobs    map[int64]bool
	saves   int
	deletes int
	loadErr error
}

func newMemAskStore(jobs ...int64) *memAskStore {
	s := &memAskStore{rows: map[string]askContext{}, jobs: map[int64]bool{}}
	for _, id := range jobs {
		s.jobs[id] = true
	}
	return s
}

func (s *memAskStore) LoadAskContext(_ context.Context, userID string) (askContext, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.loadErr != nil {
		return askContext{}, false, s.loadErr
	}
	ac, ok := s.rows[userID]
	return ac, ok, nil
}

func (s *memAskStore) SaveAskContext(_ context.Context, userID string, ac askContext) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	ac.ReferenceIDs = append([]int64{}, ac.ReferenceIDs...)
	ac.UpdatedAt = time.Now()
	s.rows[userID] = ac
	s.saves++
	return nil
}

func (s *memAskStore) DeleteExpiredAskContext(_ context.Context, userID string, cutoff time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if ac, ok := s.rows[userID]; ok && !ac.UpdatedAt.After(cutoff) {
		delete(s.rows, userID)
		s.deletes++
	}
	return nil
}

func (s *memAskStore) ExistingJobIDs(_ context.Context, ids []int64) (map[int64]bool, error) {
	out := map[int64]bool{}
	for _, id := range ids {
		if s.jobs[id] {
			out[id] = true
		}
	}
	return out, nil
}

func (s *memAskStore) row(userID string) (askContext, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ac, ok := s.rows[userID]
	return ac, ok
}

const (
	askUserA = "00000000-0000-0000-0000-00000000000a"
	askUserB = "00000000-0000-0000-0000-00000000000b"
)

// askLLM answers every classification with whatever the test last set.
type askLLM struct {
	mu       sync.Mutex
	content  string
	prompts  []string
	srv      *httptest.Server
	callsOut int
}

func newAskLLM(t *testing.T) *askLLM {
	l := &askLLM{}
	l.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		l.mu.Lock()
		for _, m := range req.Messages {
			l.prompts = append(l.prompts, m.Content)
		}
		content := l.content
		l.callsOut++
		l.mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{
			"model":   "mock-model",
			"choices": []map[string]any{{"message": map[string]any{"content": content}}},
		})
	}))
	t.Cleanup(l.srv.Close)
	useMockLLM(t, l.srv)
	return l
}

func (l *askLLM) answer(intent string, ids ...int64) {
	b, _ := json.Marshal(map[string]any{
		"intent": intent, "customer_query": "", "reference_ids": append([]int64{}, ids...),
		"parts_query": "", "parts_statuses": []string{}, "reply": "",
	})
	l.mu.Lock()
	l.content = string(b)
	l.mu.Unlock()
}

func (l *askLLM) answerCustomer(name string) {
	b, _ := json.Marshal(map[string]any{"intent": askIntentCustomerJobs, "customer_query": name, "reference_ids": []int64{}})
	l.mu.Lock()
	l.content = string(b)
	l.mu.Unlock()
}

func askContextRouter(t *testing.T, store *memAskStore) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	group := router.Group("", middleware.Auth("test-secret"))
	h := &Handler{service: NewService(searchStub()), httpClient: &http.Client{}}
	if store != nil {
		h.askContext, h.askJobs = store, store
	}
	// A generous limiter so a multi-message test is not rate limited.
	h.aiLimiter = newAIRateLimiter(1000, time.Minute)
	RegisterAIToolsRoutes(group, h)
	return router
}

func askAs(t *testing.T, router *gin.Engine, userID, message string) askInterpretResponse {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"message": message})
	req := httptest.NewRequest(http.MethodPost, "/ai-tools/ask/interpret", strings.NewReader(string(body)))
	token, _, err := security.NewAccessToken("test-secret", time.Minute, userID, nil, []string{permUpdate})
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("%q: got %d %s", message, rec.Code, rec.Body.String())
	}
	var out askInterpretResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestAskContextFollowUpResolvesPreviousJobs(t *testing.T) {
	llm := newAskLLM(t)
	store := newMemAskStore(275, 27501)
	router := askContextRouter(t, store)

	// 1. Ask about three jobs; #15 does not exist. The model dropped 15.
	llm.answer(askIntentCustomerJobs, 275, 27501)
	first := askAs(t, router, askUserA, "show jobs 275、15 and 27501")
	if !reflect.DeepEqual(first.ReferenceIDs, []int64{275, 27501}) {
		t.Fatalf("reference_ids = %v", first.ReferenceIDs)
	}
	if !reflect.DeepEqual(first.FoundIDs, []int64{275, 27501}) || !reflect.DeepEqual(first.MissingIDs, []int64{15}) {
		t.Fatalf("found=%v missing=%v", first.FoundIDs, first.MissingIDs)
	}
	if first.Notice != "Found #275 and #27501. No job #15." || first.ContextUsed {
		t.Fatalf("notice=%q context_used=%v", first.Notice, first.ContextUsed)
	}
	saved, ok := store.row(askUserA)
	if !ok || !reflect.DeepEqual(saved.ReferenceIDs, []int64{275, 27501}) {
		t.Fatalf("saved context = %+v (ok=%v)", saved, ok)
	}

	// 2. Follow-up with no numbers; the model gives no ids and even the wrong intent.
	llm.mu.Lock()
	llm.prompts = nil
	llm.mu.Unlock()
	llm.answer(askIntentUnknown)
	second := askAs(t, router, askUserA, "update both to Finished")
	if second.Intent != askIntentUpdateJobs || !second.ContextUsed {
		t.Fatalf("intent=%q context_used=%v", second.Intent, second.ContextUsed)
	}
	if !reflect.DeepEqual(second.ReferenceIDs, []int64{275, 27501}) {
		t.Fatalf("reference_ids = %v", second.ReferenceIDs)
	}
	if second.PreviewInstruction != "Jobs #275, #27501: update both to Finished" {
		t.Fatalf("preview_instruction = %q", second.PreviewInstruction)
	}
	if second.Notice != "" {
		t.Fatalf("notice = %q", second.Notice)
	}
	// Only the message reaches the model; no saved ids are sent.
	if len(llm.prompts) == 0 {
		t.Fatal("model was not called")
	}
	for _, p := range llm.prompts {
		if strings.Contains(p, "275") {
			t.Fatalf("model prompt leaked context: %q", p)
		}
	}
}

func TestAskContextExpiredIsClearedAndIgnored(t *testing.T) {
	llm := newAskLLM(t)
	store := newMemAskStore(275, 27501)
	store.rows[askUserA] = askContext{ReferenceIDs: []int64{275, 27501}, UpdatedAt: time.Now().Add(-askContextTTL - time.Minute)}
	router := askContextRouter(t, store)

	llm.answer(askIntentUpdateJobs)
	resp := askAs(t, router, askUserA, "update both to Finished")
	if resp.Intent != askIntentUnknown || resp.Reply != askNoContextReply || resp.ContextUsed || resp.PreviewInstruction != "" {
		t.Fatalf("resp = %+v", resp)
	}
	if _, ok := store.row(askUserA); ok || store.deletes != 1 {
		t.Fatalf("expired context should be deleted (deletes=%d)", store.deletes)
	}

	// Just inside the window still counts and slides forward.
	store.rows[askUserA] = askContext{ReferenceIDs: []int64{275}, UpdatedAt: time.Now().Add(-askContextTTL + time.Hour)}
	resp = askAs(t, router, askUserA, "set it to Finished")
	if !resp.ContextUsed || resp.PreviewInstruction != "Job #275: set it to Finished" {
		t.Fatalf("resp = %+v", resp)
	}
	if row, _ := store.row(askUserA); time.Since(row.UpdatedAt) > time.Minute {
		t.Fatal("using the context should slide updated_at forward")
	}
}

func TestAskContextIsPerUser(t *testing.T) {
	llm := newAskLLM(t)
	store := newMemAskStore(275, 27501, 31225)
	router := askContextRouter(t, store)

	llm.answer(askIntentCustomerJobs)
	askAs(t, router, askUserA, "jobs 275 and 27501")
	llm.answer(askIntentCustomerJobs)
	askAs(t, router, askUserB, "job #31225")

	llm.answer(askIntentUpdateJobs)
	a := askAs(t, router, askUserA, "set those to Finished")
	b := askAs(t, router, askUserB, "set those to Finished")
	if !reflect.DeepEqual(a.ReferenceIDs, []int64{275, 27501}) || !reflect.DeepEqual(b.ReferenceIDs, []int64{31225}) {
		t.Fatalf("a=%v b=%v", a.ReferenceIDs, b.ReferenceIDs)
	}

	// A third user with nothing saved gets the plain reply.
	c := askAs(t, router, "00000000-0000-0000-0000-00000000000c", "set those to Finished")
	if c.Reply != askNoContextReply || c.Intent != askIntentUnknown {
		t.Fatalf("c = %+v", c)
	}
}

func TestAskContextAllMissing(t *testing.T) {
	llm := newAskLLM(t)
	store := newMemAskStore()
	router := askContextRouter(t, store)
	llm.answer(askIntentUpdateJobs, 15, 16)
	resp := askAs(t, router, askUserA, "set jobs 15 and 16 to Finished")
	if resp.Notice != "No jobs #15 or #16." || resp.Intent != askIntentUnknown || resp.PreviewInstruction != "" || len(resp.ReferenceIDs) != 0 {
		t.Fatalf("resp = %+v", resp)
	}
	if store.saves != 0 {
		t.Fatal("nothing found: context must not be saved")
	}
}

func TestAskContextCustomerFollowUp(t *testing.T) {
	llm := newAskLLM(t)
	store := newMemAskStore()
	router := askContextRouter(t, store)
	llm.answerCustomer("Test Customer A")
	askAs(t, router, askUserA, "show all jobs for Test Customer A")
	if row, ok := store.row(askUserA); !ok || row.CustomerQuery != "Test Customer A" {
		t.Fatalf("row = %+v", row)
	}
	llm.answer(askIntentCharges)
	resp := askAs(t, router, askUserA, "sum up charges for them")
	if !resp.ContextUsed || resp.CustomerQuery != "Test Customer A" || resp.Intent != askIntentCharges {
		t.Fatalf("resp = %+v", resp)
	}
	// An update cannot be built from a customer search alone.
	llm.answer(askIntentUpdateJobs)
	resp = askAs(t, router, askUserA, "set them to Finished")
	if resp.Reply != askNoContextReply {
		t.Fatalf("resp = %+v", resp)
	}
}

func TestAskExplicitIDsBeatContextAndModel(t *testing.T) {
	llm := newAskLLM(t)
	store := newMemAskStore(15, 275)
	store.rows[askUserA] = askContext{ReferenceIDs: []int64{275}, UpdatedAt: time.Now()}
	router := askContextRouter(t, store)
	// Model invents 999; text names job 15.
	llm.answer(askIntentUpdateJobs, 999)
	resp := askAs(t, router, askUserA, "set job 15 to Finished")
	if resp.ContextUsed || !reflect.DeepEqual(resp.ReferenceIDs, []int64{15}) || resp.PreviewInstruction != "Job #15: set job 15 to Finished" {
		t.Fatalf("resp = %+v", resp)
	}
}

func TestAskNilStoreDegrades(t *testing.T) {
	llm := newAskLLM(t)
	router := askContextRouter(t, nil)
	llm.answer(askIntentUpdateJobs)
	resp := askAs(t, router, askUserA, "set jobs 275 and 15 to Finished")
	if !reflect.DeepEqual(resp.ReferenceIDs, []int64{275, 15}) || resp.Notice != "" || resp.FoundIDs != nil {
		t.Fatalf("resp = %+v", resp)
	}
	resp = askAs(t, router, askUserA, "update both to Finished")
	if resp.Reply != askNoContextReply {
		t.Fatalf("resp = %+v", resp)
	}
}

func TestAskContextLoadErrorDegrades(t *testing.T) {
	llm := newAskLLM(t)
	store := newMemAskStore(1)
	store.loadErr = errors.New("db down")
	router := askContextRouter(t, store)
	llm.answer(askIntentUpdateJobs)
	if resp := askAs(t, router, askUserA, "update both"); resp.Reply != askNoContextReply {
		t.Fatalf("resp = %+v", resp)
	}
}
