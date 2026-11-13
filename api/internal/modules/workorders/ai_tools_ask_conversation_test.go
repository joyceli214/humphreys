package workorders

import (
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"

	"humphreys/api/internal/middleware"

	"github.com/gin-gonic/gin"
)

// Conversation memory: the model receives the saved context and the recent
// turns; the server keeps the word list as a backup and never lets a follow-up
// become an update without job numbers.

func (l *askLLM) answerJSON(v map[string]any) {
	b, _ := json.Marshal(v)
	l.mu.Lock()
	l.content = string(b)
	l.mu.Unlock()
}

func (l *askLLM) answerReply(reply string) {
	l.answerJSON(map[string]any{"intent": askIntentUnknown, "reply": reply})
}

func (l *askLLM) answerIntentCustomer(intent, name string) {
	l.answerJSON(map[string]any{"intent": intent, "customer_query": name})
}

// lastUserPrompt is the user message of the last model call.
func (l *askLLM) lastUserPrompt(t *testing.T) string {
	t.Helper()
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.prompts) < 2 {
		t.Fatal("model was not called")
	}
	return l.prompts[len(l.prompts)-1]
}

// conversation starts a user with "Show all jobs for #31121 #7".
func conversation(t *testing.T, setup ...func(*memAskStore)) (*askLLM, *memAskStore, func(string) askInterpretResponse) {
	t.Helper()
	llm := newAskLLM(t)
	store := newMemAskStore(31121, 7, 275, 15)
	for _, f := range setup {
		f(store)
	}
	router := askContextRouter(t, store)
	ask := func(msg string) askInterpretResponse { return askAs(t, router, askUserA, msg) }
	llm.answer(askIntentCustomerJobs, 31121, 7)
	first := ask("Show all jobs for #31121 #7")
	if first.Intent != askIntentCustomerJobs || !reflect.DeepEqual(first.ReferenceIDs, []int64{31121, 7}) {
		t.Fatalf("first = %+v", first)
	}
	return llm, store, ask
}

func assertPreview(t *testing.T, label string, resp askInterpretResponse, ids []int64) {
	t.Helper()
	if resp.Intent != askIntentUpdateJobs || !reflect.DeepEqual(resp.ReferenceIDs, ids) {
		t.Fatalf("[%s] want preview on %v, got %+v", label, ids, resp)
	}
	refs := make([]string, len(ids))
	for i, id := range ids {
		refs[i] = fmt.Sprintf("#%d", id)
	}
	prefix := "Jobs "
	if len(ids) == 1 {
		prefix = "Job "
	}
	prefix += strings.Join(refs, ", ") + ":"
	if !strings.HasPrefix(resp.PreviewInstruction, prefix) {
		t.Fatalf("[%s] preview_instruction = %q, want prefix %q", label, resp.PreviewInstruction, prefix)
	}
}

func TestAskPromptCarriesSavedContextAndTurns(t *testing.T) {
	llm, store, ask := conversation(t, func(s *memAskStore) {
		s.customers = map[string][]int64{"Jordan Demo": {31121, 7}}
	})

	llm.answer(askIntentUnknown)
	ask("what can you do?\nreally")
	p := llm.lastUserPrompt(t)
	for _, want := range []string{
		"Saved context from this user's recent Ask answers (may be empty):\n",
		"\nSAVED_TOPIC: jobs\n",
		"\nSAVED_JOBS: 31121, 7\n",
		"\nRecent conversation (oldest first):\n",
		"\nUSER: Show all jobs for #31121 #7\n",
		"\nASSISTANT: Showed jobs #31121, #7.",
	} {
		if !strings.Contains(p, want) {
			t.Fatalf("prompt missing %q:\n%s", want, p)
		}
	}
	lines := strings.Split(strings.TrimRight(p, "\n"), "\n")
	if last := lines[len(lines)-1]; last != "Request: what can you do? really" {
		t.Fatalf("last line = %q", last)
	}
	// Both jobs belong to one customer, so the customer is saved too.
	if !strings.Contains(p, "\nSAVED_CUSTOMER: Jordan Demo\n") {
		t.Fatalf("prompt missing saved customer:\n%s", p)
	}
	row, _ := store.row(askUserA)
	if len(row.Turns) != 2 || row.Turns[1].User != "what can you do? really" || !strings.HasPrefix(row.Turns[1].Assistant, "Said: ") {
		t.Fatalf("turns = %+v", row.Turns)
	}
	// Unknown answers keep the saved jobs.
	if !reflect.DeepEqual(row.ReferenceIDs, []int64{31121, 7}) {
		t.Fatalf("saved jobs = %v", row.ReferenceIDs)
	}
}

func TestAskPromptEmptyContext(t *testing.T) {
	llm := newAskLLM(t)
	router := askContextRouter(t, newMemAskStore())
	llm.answer(askIntentUnknown)
	askAs(t, router, askUserA, "hello")
	p := llm.lastUserPrompt(t)
	want := "Saved context from this user's recent Ask answers (may be empty):\n" +
		"SAVED_TOPIC: none\nSAVED_JOBS:\nSAVED_CUSTOMER:\n" +
		"Recent conversation (oldest first):\n(none)\nRequest: hello\n"
	if p != want {
		t.Fatalf("prompt = %q\nwant     %q", p, want)
	}
}

func TestAskTurnsCappedAndPerUser(t *testing.T) {
	llm := newAskLLM(t)
	store := newMemAskStore()
	router := askContextRouter(t, store)
	llm.answerReply("I can help with jobs.")
	for i := 0; i < askMaxTurns+5; i++ {
		askAs(t, router, askUserA, fmt.Sprintf("message %d", i))
	}
	row, _ := store.row(askUserA)
	if len(row.Turns) != askMaxTurns || row.Turns[0].User != "message 5" || row.Turns[askMaxTurns-1].User != fmt.Sprintf("message %d", askMaxTurns+4) {
		t.Fatalf("turns = %+v", row.Turns)
	}
	if row.Turns[0].Assistant != "Said: I can help with jobs." {
		t.Fatalf("assistant = %q", row.Turns[0].Assistant)
	}
	// Long text is capped.
	askAs(t, router, askUserA, strings.Repeat("a ", 400))
	row, _ = store.row(askUserA)
	if n := len([]rune(row.Turns[askMaxTurns-1].User)); n > askMaxTurnRunes {
		t.Fatalf("user turn has %d runes", n)
	}
	// Another user sees none of it.
	askAs(t, router, askUserB, "hi")
	if p := llm.lastUserPrompt(t); strings.Contains(p, "message") || !strings.Contains(p, "(none)") {
		t.Fatalf("user B prompt leaked A's turns:\n%s", p)
	}
}

func TestAskExpiredTurnsIgnored(t *testing.T) {
	llm := newAskLLM(t)
	store := newMemAskStore(275)
	store.rows[askUserA] = askContext{
		ReferenceIDs: []int64{275}, Topic: askTopicJobs,
		Turns:     []askTurn{{User: "old question", Assistant: "Showed jobs #275."}},
		UpdatedAt: time.Now().Add(-askContextTTL - time.Minute),
	}
	router := askContextRouter(t, store)
	llm.answer(askIntentUnknown)
	askAs(t, router, askUserA, "hello")
	p := llm.lastUserPrompt(t)
	if strings.Contains(p, "old question") || strings.Contains(p, "275") {
		t.Fatalf("expired context reached the model:\n%s", p)
	}
	row, _ := store.row(askUserA)
	if len(row.Turns) != 1 || row.Turns[0].User != "hello" {
		t.Fatalf("turns = %+v", row.Turns)
	}
}

func TestAskTheirStatusFollowUp(t *testing.T) {
	for _, tc := range []struct {
		name   string
		intent string
		ids    []int64
	}{
		{"update_jobs empty ids", askIntentUpdateJobs, nil},
		{"customer_jobs empty ids", askIntentCustomerJobs, nil},
		{"update_jobs with ids", askIntentUpdateJobs, []int64{31121, 7}},
		{"unknown", askIntentUnknown, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			llm, store, ask := conversation(t)
			llm.answer(tc.intent, tc.ids...)
			resp := ask("update their status to picked up")
			assertPreview(t, tc.name, resp, []int64{31121, 7})
			if resp.PreviewInstruction != "Jobs #31121, #7: update their status to picked up" {
				t.Fatalf("preview_instruction = %q", resp.PreviewInstruction)
			}
			row, _ := store.row(askUserA)
			if last := row.Turns[len(row.Turns)-1]; last.Assistant != "Opened a preview to change jobs #31121, #7 (nothing saved until Apply)." {
				t.Fatalf("assistant turn = %q", last.Assistant)
			}
		})
	}
}

func TestAskImplicitUpdatesUseSavedJobs(t *testing.T) {
	for _, msg := range []string{
		"update status to picked up", "set to pending", "update the jobs to Finished",
		"they are picked up", "change its status", "update all to Finished", "mark as finished",
		"改做完成", "全部改做完成", "個狀態改做完成",
	} {
		t.Run(msg, func(t *testing.T) {
			llm, _, ask := conversation(t)
			llm.answer(askIntentUpdateJobs)
			assertPreview(t, msg, ask(msg), []int64{31121, 7})
		})
	}
}

func TestAskModelIDsMustComeFromContext(t *testing.T) {
	llm, _, ask := conversation(t)
	// 275 exists but was never mentioned: dropped, saved jobs used instead.
	llm.answer(askIntentUpdateJobs, 275)
	resp := ask("update their status to Finished")
	assertPreview(t, "hallucinated", resp, []int64{31121, 7})

	// A model id that is only a plain number in the message is kept.
	llm.answer(askIntentCustomerJobs, 275)
	resp = ask("show 275")
	if !reflect.DeepEqual(resp.ReferenceIDs, []int64{275}) {
		t.Fatalf("resp = %+v", resp)
	}
	// Ids from the recent conversation are allowed (#31121 was shown two turns ago).
	llm.answer(askIntentCustomerJobs, 31121)
	resp = ask("show the first one again")
	if !reflect.DeepEqual(resp.ReferenceIDs, []int64{31121}) || !resp.ContextUsed {
		t.Fatalf("resp = %+v", resp)
	}
}

func TestAskBareJobNumbers(t *testing.T) {
	llm := newAskLLM(t)
	store := newMemAskStore(31121, 7)
	router := askContextRouter(t, store)
	for _, msg := range []string{"#31121 #7", "#31121, #7", "jobs 31121 and 7", "#31121 同 #7"} {
		llm.answer(askIntentUnknown)
		resp := askAs(t, router, askUserA, msg)
		if resp.Intent != askIntentCustomerJobs || !reflect.DeepEqual(resp.ReferenceIDs, []int64{31121, 7}) {
			t.Fatalf("%q: resp = %+v", msg, resp)
		}
	}
}

func TestAskCustomerSearchSavesJobs(t *testing.T) {
	llm := newAskLLM(t)
	store := newMemAskStore(1, 2, 3)
	store.customers = map[string][]int64{"Jordan Demo": {1, 2, 3}}
	router := askContextRouter(t, store)
	ask := func(msg string) askInterpretResponse { return askAs(t, router, askUserA, msg) }

	llm.answerCustomer("Jordan Demo")
	first := ask("Show all jobs for Jordan Demo")
	// The front end still searches by customer (heading "3 jobs found for …").
	if first.Intent != askIntentCustomerJobs || first.CustomerQuery != "Jordan Demo" || len(first.ReferenceIDs) != 0 {
		t.Fatalf("first = %+v", first)
	}
	row, _ := store.row(askUserA)
	if !reflect.DeepEqual(row.ReferenceIDs, []int64{1, 2, 3}) || row.CustomerQuery != "Jordan Demo" {
		t.Fatalf("saved = %+v", row)
	}
	if got := row.Turns[0].Assistant; got != `Showed 3 jobs for customer "Jordan Demo": #1, #2, #3.` {
		t.Fatalf("assistant = %q", got)
	}

	llm.answer(askIntentUpdateJobs)
	assertPreview(t, "update them", ask("update them to Finished"), []int64{1, 2, 3})

	llm.answer(askIntentCharges)
	resp := ask("sum up charges for them")
	if resp.Intent != askIntentCharges || !resp.ContextUsed || (!reflect.DeepEqual(resp.ReferenceIDs, []int64{1, 2, 3}) && resp.CustomerQuery != "Jordan Demo") {
		t.Fatalf("charges = %+v", resp)
	}
}

func TestAskCustomerSearchCapsSavedJobs(t *testing.T) {
	llm := newAskLLM(t)
	ids := make([]int64, 0, 60)
	for i := int64(1); i <= 60; i++ {
		ids = append(ids, i)
	}
	store := newMemAskStore(ids...)
	store.customers = map[string][]int64{"Big Customer": ids}
	router := askContextRouter(t, store)
	llm.answerCustomer("Big Customer")
	askAs(t, router, askUserA, "jobs for Big Customer")
	row, _ := store.row(askUserA)
	if len(row.ReferenceIDs) != askMaxReferenceIDs || row.ReferenceIDs[0] != 1 {
		t.Fatalf("saved %d ids", len(row.ReferenceIDs))
	}
	if a := row.Turns[0].Assistant; !strings.Contains(a, "60 jobs") || !strings.Contains(a, "first 50") {
		t.Fatalf("assistant = %q", a)
	}
}

func TestAskCustomerFollowUps(t *testing.T) {
	llm, store, ask := conversation(t, func(s *memAskStore) {
		s.jobs[8], s.jobs[9] = true, true
		s.customers = map[string][]int64{"Jordan Demo": {31121, 7, 8, 9}, "Other Person": {275}}
	})

	// The job lookup above saved Jordan Demo as the customer (both jobs are theirs).
	llm.mu.Lock()
	llm.prompts = nil
	llm.mu.Unlock()
	for _, msg := range []string{"show her other jobs", "that customer", "the same customer"} {
		llm.answer(askIntentUnknown)
		resp := ask(msg)
		if resp.Intent != askIntentCustomerJobs || resp.CustomerQuery != "Jordan Demo" || !resp.ContextUsed {
			t.Fatalf("%q: resp = %+v", msg, resp)
		}
	}
	row, _ := store.row(askUserA)
	if !reflect.DeepEqual(row.ReferenceIDs, []int64{31121, 7, 8, 9}) {
		t.Fatalf("saved = %+v", row)
	}

	// A new customer typed by the user replaces memory.
	llm.answerCustomer("Other Person")
	resp := ask("show jobs for Other Person")
	if resp.CustomerQuery != "Other Person" || resp.ContextUsed {
		t.Fatalf("resp = %+v", resp)
	}
	row, _ = store.row(askUserA)
	if row.CustomerQuery != "Other Person" || !reflect.DeepEqual(row.ReferenceIDs, []int64{275}) {
		t.Fatalf("saved = %+v", row)
	}
	// A customer the model invented (not typed, not saved) is ignored.
	llm.answerCustomer("Someone Else")
	resp = ask("show me what you have")
	if resp.CustomerQuery == "Someone Else" {
		t.Fatalf("invented customer used: %+v", resp)
	}
}

func TestAskShopWidePartsClearsJobs(t *testing.T) {
	llm, store, ask := conversation(t)
	llm.answer(askIntentPartsRequests)
	resp := ask("show parts requests")
	if resp.Intent != askIntentPartsRequests || len(resp.ReferenceIDs) != 0 || resp.ContextUsed {
		t.Fatalf("parts = %+v", resp)
	}
	row, _ := store.row(askUserA)
	if len(row.ReferenceIDs) != 0 || row.Topic != askTopicParts || row.CustomerQuery != "" {
		t.Fatalf("saved = %+v", row)
	}
	if a := row.Turns[len(row.Turns)-1].Assistant; a != "Showed all parts requests in the shop (not tied to specific jobs)." {
		t.Fatalf("assistant = %q", a)
	}
	llm.answer(askIntentUpdateJobs)
	resp = ask("update them to Finished")
	if resp.Intent != askIntentUnknown || resp.Reply != askNoContextReply || resp.PreviewInstruction != "" {
		t.Fatalf("resp = %+v", resp)
	}
}

func partsOn275and15(t *testing.T) (*askLLM, func(string) askInterpretResponse) {
	t.Helper()
	llm := newAskLLM(t)
	store := newMemAskStore(275, 15)
	store.parts[275] = 1
	router := askContextRouter(t, store)
	ask := func(msg string) askInterpretResponse { return askAs(t, router, askUserA, msg) }
	llm.answer(askIntentPartsRequests)
	if resp := ask("parts requests on #275 #15"); !reflect.DeepEqual(resp.ReferenceIDs, []int64{275, 15}) {
		t.Fatalf("parts = %+v", resp)
	}
	return llm, ask
}

func TestAskPartsTopicRouting(t *testing.T) {
	llm, ask := partsOn275and15(t)
	llm.answer(askIntentUpdateJobs)
	resp := ask("set them to pending")
	if resp.Intent != askIntentPartsRequests || resp.PreviewInstruction != "" || resp.Notice != askPartsStatusNotice {
		t.Fatalf("pending = %+v", resp)
	}

	// The model already resolved the jobs (update_jobs or parts_requests with
	// ids): "set them to pending" still never becomes a job preview.
	for _, intent := range []string{askIntentUpdateJobs, askIntentPartsRequests} {
		llm, ask := partsOn275and15(t)
		llm.answer(intent, 275, 15)
		resp := ask("set them to pending")
		if resp.Intent != askIntentPartsRequests || resp.PreviewInstruction != "" || resp.Notice != askPartsStatusNotice {
			t.Fatalf("pending with model %s ids = %+v", intent, resp)
		}
	}

	for _, msg := range []string{"set those jobs to Finished", "set them to Finished", "update their status to picked up"} {
		llm, ask := partsOn275and15(t)
		llm.answer(askIntentUpdateJobs)
		assertPreview(t, msg, ask(msg), []int64{275, 15})
		// The topic becomes jobs: the next update is a job preview too.
		llm.answer(askIntentUpdateJobs)
		assertPreview(t, msg+" again", ask("update them to In Progress"), []int64{275, 15})
	}
}

func TestAskFollowUpPlusTypedJobs(t *testing.T) {
	llm, _, ask := conversation(t)
	llm.answer(askIntentUpdateJobs, 275)
	assertPreview(t, "union", ask("update them and #275 to Finished"), []int64{31121, 7, 275})

	// "both" naming two typed jobs does not pull in the saved ones.
	llm.answer(askIntentUpdateJobs)
	assertPreview(t, "both typed", ask("set both #275 and #15 to Finished"), []int64{275, 15})
}

func TestAskPartsFollowUpForSavedJobs(t *testing.T) {
	for _, msg := range []string{"what parts do they need", "show their parts"} {
		llm, _, ask := conversation(t)
		llm.answer(askIntentPartsRequests)
		resp := ask(msg)
		if resp.Intent != askIntentPartsRequests || !reflect.DeepEqual(resp.ReferenceIDs, []int64{31121, 7}) || !resp.ContextUsed {
			t.Fatalf("%q: resp = %+v", msg, resp)
		}
	}
	// No saved jobs: never the whole shop.
	llm := newAskLLM(t)
	router := askContextRouter(t, newMemAskStore())
	llm.answer(askIntentPartsRequests)
	if resp := askAs(t, router, askUserA, "what parts do they need"); resp.Reply != askNoContextReply {
		t.Fatalf("resp = %+v", resp)
	}
}

func TestAskChargesFollowUp(t *testing.T) {
	llm, _, ask := conversation(t)
	llm.answer(askIntentCharges)
	resp := ask("sum up their charges")
	if resp.Intent != askIntentCharges || !reflect.DeepEqual(resp.ReferenceIDs, []int64{31121, 7}) {
		t.Fatalf("resp = %+v", resp)
	}
}

func TestMassUpdateApplyRecordsAskTurn(t *testing.T) {
	const user = "00000000-0000-0000-0000-000000000001"
	stub := massUpdateStub()
	store := newMemAskStore(1)
	store.rows[user] = askContext{ReferenceIDs: []int64{1}, Topic: askTopicJobs, UpdatedAt: time.Now()}
	gin.SetMode(gin.TestMode)
	router := gin.New()
	h := &Handler{service: NewService(stub), httpClient: &http.Client{}, askContext: store, askJobs: store}
	RegisterAIToolsRoutes(router.Group("", middleware.Auth("test-secret")), h)

	payload := `{"operations":[{"reference_id":1,"op":"set_labour_total","labour_total":100}],"expected_updated_at":{"1":null}}`
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/apply", payload, []string{permUpdate})
	if resp.Code != http.StatusOK {
		t.Fatalf("apply: %d %s", resp.Code, resp.Body.String())
	}
	row, _ := store.row(user)
	if len(row.Turns) != 1 || row.Turns[0].Assistant != "Applied changes to job #1." || !reflect.DeepEqual(row.ReferenceIDs, []int64{1}) {
		t.Fatalf("row = %+v", row)
	}
	// A user with no Ask row gets none.
	delete(store.rows, user)
	partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/apply", payload, []string{permUpdate})
	if _, ok := store.row(user); ok {
		t.Fatal("apply must not create an Ask row")
	}
}

// The response is never update_jobs without a preview instruction, whatever
// the model says and whatever is saved.
func TestAskNeverUpdateWithoutPreviewInstruction(t *testing.T) {
	phrases := []string{
		"update their status to picked up", "update status to picked up", "set to pending",
		"update the jobs to Finished", "change its status", "they are picked up", "update all to Finished",
		"mark as finished", "改做完成", "全部改做完成", "個狀態改做完成", "update both", "set it to Finished",
		"show all jobs for Jane", "show parts requests", "hello", "update", "#99999", "set job 99999 to Finished",
		"show her other jobs", "sum up charges for them", "what parts do they need",
	}
	intents := []string{askIntentCustomerJobs, askIntentUpdateJobs, askIntentPartsRequests, askIntentCharges, askIntentUnknown}
	setups := map[string]func(*memAskStore){
		"empty": func(*memAskStore) {},
		"jobs": func(s *memAskStore) {
			s.rows[askUserA] = askContext{ReferenceIDs: []int64{31121, 7}, Topic: askTopicJobs, UpdatedAt: time.Now()}
		},
		"parts": func(s *memAskStore) {
			s.rows[askUserA] = askContext{ReferenceIDs: []int64{275}, Topic: askTopicParts, UpdatedAt: time.Now()}
		},
		"shop parts": func(s *memAskStore) {
			s.rows[askUserA] = askContext{ReferenceIDs: []int64{}, Topic: askTopicParts, UpdatedAt: time.Now()}
		},
		"customer": func(s *memAskStore) {
			s.rows[askUserA] = askContext{CustomerQuery: "Jane", Topic: askTopicJobs, UpdatedAt: time.Now()}
		},
	}
	llm := newAskLLM(t)
	for name, setup := range setups {
		for _, intent := range intents {
			for _, withIDs := range []bool{false, true} {
				store := newMemAskStore(31121, 7, 275)
				setup(store)
				router := askContextRouter(t, store)
				if withIDs {
					llm.answer(intent, 31121, 275, 424242)
				} else {
					llm.answer(intent)
				}
				for _, msg := range phrases {
					resp := askAs(t, router, askUserA, msg)
					if resp.Intent == askIntentUpdateJobs && (resp.PreviewInstruction == "" || len(resp.ReferenceIDs) == 0) {
						t.Fatalf("[%s/%s/%v] %q: update without preview: %+v", name, intent, withIDs, msg, resp)
					}
					if resp.PreviewInstruction != "" && !strings.HasPrefix(resp.PreviewInstruction, "Job") {
						t.Fatalf("[%s/%s/%v] %q: preview = %q", name, intent, withIDs, msg, resp.PreviewInstruction)
					}
					for _, id := range resp.ReferenceIDs {
						if id == 424242 {
							t.Fatalf("[%s/%s/%v] %q: invented id used: %+v", name, intent, withIDs, msg, resp)
						}
					}
				}
			}
		}
	}
}
