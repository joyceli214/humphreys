package workorders

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"humphreys/api/internal/domain"
	"humphreys/api/internal/middleware"
	"humphreys/api/internal/modules/catalog"

	"github.com/gin-gonic/gin"
)

// Admin Portal "finish" items: retry reply, JSON mode, labour questions,
// supplier invoice, two parts actions, parts request create, Complete Job and
// new job from Ask. Interpret only previews; every write happens on Apply
// through the existing endpoints (the web tests cover Apply).

// --- fakes ------------------------------------------------------------------

func (s *memAskStore) OpenPartsRequests(_ context.Context, statuses []string, limit int) ([]askPartsRow, error) {
	want := map[string]bool{}
	for _, st := range statuses {
		want[st] = true
	}
	out := []askPartsRow{}
	for _, p := range s.partRows {
		if want[p.Status] && len(out) < limit {
			out = append(out, p)
		}
	}
	return out, nil
}

// memCatalog is the catalog lookups Ask reads (the same repository calls the
// create page and Complete Job button use).
type memCatalog struct {
	completeID *int64
	statuses   []catalog.LookupOption
	jobTypes   []catalog.LookupOption
	items      []catalog.LookupOption
	brands     []catalog.LookupOption
	payments   []catalog.LookupOption
	presets    []catalog.LookupOption
}

func filterOptions(opts []catalog.LookupOption, q string) ([]catalog.LookupOption, error) {
	out := []catalog.LookupOption{}
	for _, o := range opts {
		if q == "" || strings.Contains(strings.ToLower(o.Label), strings.ToLower(q)) {
			out = append(out, o)
		}
	}
	return out, nil
}

func (m *memCatalog) GetCompleteJobStatusID(context.Context) (*int64, error) {
	return m.completeID, nil
}
func (m *memCatalog) ListWorkOrderStatuses(_ context.Context, q string) ([]catalog.LookupOption, error) {
	return filterOptions(m.statuses, q)
}
func (m *memCatalog) ListJobTypes(_ context.Context, q string) ([]catalog.LookupOption, error) {
	return filterOptions(m.jobTypes, q)
}
func (m *memCatalog) ListItems(_ context.Context, q string) ([]catalog.LookupOption, error) {
	return filterOptions(m.items, q)
}
func (m *memCatalog) ListBrands(_ context.Context, q string) ([]catalog.LookupOption, error) {
	return filterOptions(m.brands, q)
}
func (m *memCatalog) ListPaymentMethods(_ context.Context, q string) ([]catalog.LookupOption, error) {
	return filterOptions(m.payments, q)
}
func (m *memCatalog) ListPartsItemPresets(_ context.Context, q string) ([]catalog.LookupOption, error) {
	return filterOptions(m.presets, q)
}

func group(g string) *string { return &g }

func shopCatalog() *memCatalog {
	return &memCatalog{
		// Same order as ListWorkOrderStatuses (pinned, then name).
		statuses: []catalog.LookupOption{
			{ID: 20, Label: "Finished", StatusGroup: group("completed")},
			{ID: 8, Label: "On Test", StatusGroup: group("in_progress")},
			{ID: 21, Label: "Picked Up", StatusGroup: group("completed")},
			{ID: 9, Label: "Received", StatusGroup: group("to_do")},
			{ID: 7, Label: "Waiting on Part (s)", StatusGroup: group("staged")},
		},
		jobTypes: []catalog.LookupOption{{ID: 1, Label: "Repair"}, {ID: 2, Label: "Estimate"}},
		items:    []catalog.LookupOption{{ID: 11, Label: "Receiver"}, {ID: 12, Label: "Turntable"}},
		brands:   []catalog.LookupOption{{ID: 31, Label: "Sony"}, {ID: 32, Label: "Yamaha"}},
		payments: []catalog.LookupOption{{ID: 41, Label: "Cash"}, {ID: 42, Label: "Debit"}, {ID: 43, Label: "Visa"}},
		presets:  []catalog.LookupOption{{ID: 51, Label: "L6"}},
	}
}

// finishStub adds the customer search (the create page's existing-customer
// lookup) to the shop stub.
type finishStub struct {
	*aiToolsStub
	customers []CustomerLookupOption
}

func (s *finishStub) ListCustomers(_ context.Context, q string) ([]CustomerLookupOption, error) {
	out := []CustomerLookupOption{}
	for _, c := range s.customers {
		if strings.Contains(strings.ToLower(c.Label), strings.ToLower(q)) {
			out = append(out, c)
		}
	}
	return out, nil
}

func finishShopStub() *finishStub {
	stub := shopStub()
	at := skillUpdatedAt
	received, finished := int64(9), int64(20)
	rName, fName := "Received", "Finished"
	stub.details[31352] = domain.WorkOrderDetail{ReferenceID: 31352, UpdatedAt: &at, StatusID: &received, StatusName: &rName}
	stub.details[31351] = domain.WorkOrderDetail{ReferenceID: 31351, UpdatedAt: &at, StatusID: &received, StatusName: &rName}
	stub.details[31310] = domain.WorkOrderDetail{ReferenceID: 31310, UpdatedAt: &at, StatusID: &finished, StatusName: &fName}
	jane := "Jane Doe"
	return &finishStub{aiToolsStub: stub, customers: []CustomerLookupOption{
		{ID: 1, Label: "Jane Doe", FirstName: &jane},
		{ID: 2, Label: "John Smith"},
		{ID: 3, Label: "John Smithers"},
	}}
}

var finishPerms = append(append([]string{}, skillPerms...), permStatusUpdate, permCreate, permPartsCreate)

func finishRouter(t *testing.T, store *memAskStore, repo Repository, cat askCatalogLookup) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	g := router.Group("", middleware.Auth("test-secret"))
	h := &Handler{service: NewService(repo), httpClient: &http.Client{}}
	h.askContext, h.askJobs, h.askParts = store, store, store
	if cat != nil {
		h.askCatalog = cat
	}
	h.aiLimiter = newAIRateLimiter(1000, time.Minute)
	RegisterAIToolsRoutes(g, h)
	return router
}

func finishSetup(t *testing.T) (*askLLM, *memAskStore, *memCatalog, func(string) askInterpretResponse) {
	t.Helper()
	llm := newAskLLM(t)
	store := shopStore()
	for _, id := range []int64{29277, 31221, 275, 28800, 30175} {
		store.jobs[id] = true
	}
	cat := shopCatalog()
	router := finishRouter(t, store, finishShopStub(), cat)
	return llm, store, cat, func(msg string) askInterpretResponse { return askWith(t, router, finishPerms, msg) }
}

func lastTurn(t *testing.T, store *memAskStore) askTurn {
	t.Helper()
	row, ok := store.row(askUserA)
	if !ok || len(row.Turns) == 0 {
		t.Fatal("no turn recorded")
	}
	return row.Turns[len(row.Turns)-1]
}

// --- Item 1.1: the invalid-JSON retry never answers with an empty reply ----

func TestAskRetryWithEmptyReplyGetsFallback(t *testing.T) {
	newSeqLLM(t, "Sure thing! intent unknown", `{"intent":"unknown","reply":""}`)
	store := shopStore()
	router := skillRouter(t, store, shopStub(), 1000)
	resp := askWith(t, router, skillPerms, "hmm can you help")
	if resp.Intent != askIntentUnknown || resp.Reply != askNotUnderstoodReply {
		t.Fatalf("resp = %+v", resp)
	}
	if turn := lastTurn(t, store); !strings.Contains(turn.Assistant, askNotUnderstoodReply) {
		t.Fatalf("turn = %+v", turn)
	}
}

func TestAskRetryLookupKeepsCardAndHasReply(t *testing.T) {
	newSeqLLM(t, "```json\n{oops", `{"intent":"job_details","reference_ids":[31178],"reply":""}`)
	router := skillRouter(t, shopStore(), shopStub(), 1000)
	resp := askWith(t, router, skillPerms, "make and model of #31178?")
	if resp.Intent != askIntentJobDetails || !reflect.DeepEqual(resp.ReferenceIDs, []int64{31178}) {
		t.Fatalf("lookup lost: %+v", resp)
	}
	if strings.TrimSpace(resp.Reply) == "" {
		t.Fatalf("retry path left reply empty: %+v", resp)
	}
}

// --- Item 1.2: JSON mode and temperature 0 for interpret only ---------------

type rawLLM struct {
	mu     sync.Mutex
	bodies []map[string]any
	// rejectFormat answers 400 to any request carrying response_format.
	rejectFormat bool
	reply        string
	summary      string
}

func newRawLLM(t *testing.T, reply string) *rawLLM {
	l := &rawLLM{reply: reply, summary: "- Job #31178: looked at parts."}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		l.mu.Lock()
		l.bodies = append(l.bodies, body)
		reject := l.rejectFormat
		l.mu.Unlock()
		if _, ok := body["response_format"]; ok && reject {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"message": "response_format is not supported by this model"}})
			return
		}
		content := l.reply
		if strings.Contains(string(raw), askSummaryMarker) {
			content = l.summary
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"model": "mock-model", "choices": []map[string]any{{"message": map[string]any{"content": content}}}})
	}))
	t.Cleanup(srv.Close)
	useMockLLM(t, srv)
	return l
}

func (l *rawLLM) all() []map[string]any {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]map[string]any{}, l.bodies...)
}

func TestAskInterpretAsksForJSONAtTemperatureZero(t *testing.T) {
	l := newRawLLM(t, `{"intent":"customer_jobs","reference_ids":[31178]}`)
	store := shopStore()
	router := skillRouter(t, store, shopStub(), 1000)
	askWith(t, router, skillPerms, "show #31178")
	bodies := l.all()
	if len(bodies) != 1 {
		t.Fatalf("calls = %d", len(bodies))
	}
	rf, ok := bodies[0]["response_format"].(map[string]any)
	if !ok || rf["type"] != "json_object" {
		t.Fatalf("interpret must ask for a JSON object: %v", bodies[0]["response_format"])
	}
	if bodies[0]["temperature"] != float64(0) {
		t.Fatalf("interpret temperature = %v", bodies[0]["temperature"])
	}
	// Interpret turns hidden reasoning off so it cannot use up max_tokens.
	if rs, ok := bodies[0]["reasoning"].(map[string]any); !ok || rs["enabled"] != false {
		t.Fatalf("interpret must turn reasoning off: %v", bodies[0]["reasoning"])
	}

	// The conversation summary is unchanged: no JSON mode, shared temperature.
	if code, out := newConversationAs(t, router, askUserA, skillPerms); code != http.StatusOK || out["summarized"] != true {
		t.Fatalf("new-conversation: %d %v", code, out)
	}
	bodies = l.all()
	if len(bodies) != 2 {
		t.Fatalf("summary not called: %d calls", len(bodies))
	}
	if _, ok := bodies[1]["response_format"]; ok {
		t.Fatalf("summary must not use JSON mode: %v", bodies[1])
	}
	if rs, _ := bodies[1]["reasoning"].(map[string]any); rs != nil && rs["enabled"] == false {
		t.Fatalf("summary keeps the shared reasoning setting: %v", rs)
	}
	if bodies[1]["temperature"] != 0.2 {
		t.Fatalf("summary temperature = %v", bodies[1]["temperature"])
	}
}

func TestAskInterpretRetriesWithoutJSONModeWhenProviderRejectsIt(t *testing.T) {
	l := newRawLLM(t, `{"intent":"customer_jobs","reference_ids":[31178]}`)
	l.rejectFormat = true
	router := skillRouter(t, shopStore(), shopStub(), 1000)
	resp := askWith(t, router, skillPerms, "show #31178")
	if resp.Intent != askIntentCustomerJobs || !reflect.DeepEqual(resp.ReferenceIDs, []int64{31178}) {
		t.Fatalf("resp = %+v", resp)
	}
	bodies := l.all()
	if len(bodies) != 2 {
		t.Fatalf("want one call with JSON mode and one without, got %d", len(bodies))
	}
	if _, ok := bodies[1]["response_format"]; ok {
		t.Fatalf("second call still used response_format")
	}
	if rs, _ := bodies[1]["reasoning"].(map[string]any); rs != nil && rs["enabled"] == false {
		t.Fatalf("second call still turned reasoning off: %v", rs)
	}
}

func TestAskSystemPromptStatesStrictSchema(t *testing.T) {
	p := askSystemPrompt() + askJSONReminder
	for _, want := range []string{"code fences", "reply", `"intent"`, "nothing before or after"} {
		if !strings.Contains(p, want) {
			t.Fatalf("prompt missing %q", want)
		}
	}
}

// --- Item 1.3: "did we already add labour?" answers from charges -----------

func TestAskLabourQuestionShowsCharges(t *testing.T) {
	llm, store, _, ask := finishSetup(t)
	for _, model := range []string{askIntentRepairHistory, askIntentAddLabour, askIntentCustomerJobs, askIntentUnknown} {
		llm.answer(model, 29277)
		resp := ask("did we already add labour on #29277?")
		if resp.Intent != askIntentCharges || resp.ChargesFocus != "labour" || !reflect.DeepEqual(resp.ReferenceIDs, []int64{29277}) {
			t.Fatalf("[model %s] resp = %+v", model, resp)
		}
		if resp.LabourPreview != nil || resp.PreviewInstruction != "" {
			t.Fatalf("[model %s] a labour question opened a change: %+v", model, resp)
		}
	}
	if turn := lastTurn(t, store); !strings.Contains(turn.Assistant, "labour") || !strings.Contains(turn.Assistant, "#29277") {
		t.Fatalf("turn = %+v", turn)
	}
	for _, msg := range []string{"how much labour is on #29277?", "what's the labour total on #29277", "is there labour on #29277"} {
		llm.answer(askIntentRepairHistory, 29277)
		if resp := ask(msg); resp.Intent != askIntentCharges || resp.ChargesFocus != "labour" {
			t.Fatalf("[%s] resp = %+v", msg, resp)
		}
	}
	// Repair history wording and the add-labour command are unchanged.
	llm.answer(askIntentRepairHistory, 29277)
	if resp := ask("what did we do on #29277?"); resp.Intent != askIntentRepairHistory {
		t.Fatalf("history resp = %+v", resp)
	}
	llm.answer(askIntentAddLabour, 31351)
	if resp := ask("Add labour to #31351: $110, 1 hour"); resp.Intent != askIntentAddLabour || resp.LabourPreview == nil {
		t.Fatalf("add labour resp = %+v", resp)
	}
}

// --- Item 2: bulk mark ordered from a supplier invoice ----------------------

func invoiceStore(s *memAskStore) {
	s.partRows = []askPartsRow{
		partRow(501, 31221, "Drive belt 3mm", "approved", 0),
		partRow(502, 31221, "Power switch SW-12", "approved", 0),
		partRow(503, 275, "Dial lamp 8V", "ordered", 6),
		partRow(504, 28800, "Power switch SW-12", "approved", 0),
		partRow(505, 30175, "Pinch roller", "waiting_approval", 0),
	}
}

const invoiceMsg = "Mark ordered from Jerry's invoice INV-7781:\n" +
	"Drive belt 3mm $4.50\n" +
	"Power switch SW-12 $7.25\n" +
	"Pinch roller $12\n" +
	"Flux capacitor $99"

func TestAskInvoiceMatchesLinesToApprovedRequests(t *testing.T) {
	llm, store, _, ask := finishSetup(t)
	invoiceStore(store)
	llm.answer(askIntentPartsUpdate)
	resp := ask(invoiceMsg)
	p := resp.InvoicePreview
	if resp.Intent != askIntentPartsInvoice || p == nil {
		t.Fatalf("resp = %+v", resp)
	}
	if p.InvoiceNumber != "INV-7781" || len(p.Lines) != 4 {
		t.Fatalf("preview = %+v", p)
	}
	belt := p.Lines[0]
	if belt.Match != "matched" || belt.Change == nil || belt.Change.PartsPurchaseRequestID != 501 ||
		belt.Change.OldStatus != "approved" || belt.Change.NewStatus != "ordered" || belt.Change.NewPrice != 4.5 ||
		!belt.Change.Valid || belt.Change.UpdatedAt == nil || belt.Price == nil || *belt.Price != 4.5 {
		t.Fatalf("belt = %+v change=%+v", belt, belt.Change)
	}
	sw := p.Lines[1]
	if sw.Match != "ambiguous" || sw.Change != nil || len(sw.Candidates) != 2 {
		t.Fatalf("switch = %+v", sw)
	}
	roller := p.Lines[2]
	if roller.Match != "matched" || roller.Change == nil || roller.Change.PartsPurchaseRequestID != 505 || roller.Change.Valid ||
		!strings.Contains(roller.Change.Error, "approved before it can be ordered") {
		t.Fatalf("roller = %+v change=%+v", roller, roller.Change)
	}
	if flux := p.Lines[3]; flux.Match != "unmatched" || flux.Change != nil || flux.Text != "Flux capacitor" {
		t.Fatalf("flux = %+v", flux)
	}
	turn := lastTurn(t, store)
	if !strings.Contains(turn.Assistant, "INV-7781") || !strings.Contains(turn.Assistant, "nothing saved until Apply") || !strings.Contains(turn.Assistant, "request 501") {
		t.Fatalf("turn = %q", turn.Assistant)
	}
}

func TestAskInvoiceLineWithJobNumberResolvesAmbiguity(t *testing.T) {
	llm, store, _, ask := finishSetup(t)
	invoiceStore(store)
	llm.answer(askIntentUnknown)
	resp := ask("invoice 4410 - mark these ordered\nPower switch SW-12 for #28800 7.25\nDrive belt 3mm")
	p := resp.InvoicePreview
	if p == nil || len(p.Lines) != 2 {
		t.Fatalf("resp = %+v", resp)
	}
	if ch := p.Lines[0].Change; ch == nil || ch.PartsPurchaseRequestID != 504 || ch.NewPrice != 7.25 || !ch.Valid {
		t.Fatalf("line 1 = %+v", p.Lines[0])
	}
	// No price typed: the price is left as it is.
	if ch := p.Lines[1].Change; ch == nil || ch.PartsPurchaseRequestID != 501 || ch.NewPrice != ch.OldPrice || p.Lines[1].Price != nil {
		t.Fatalf("line 2 = %+v", p.Lines[1])
	}
}

func TestAskInvoiceNeedsPartsPermission(t *testing.T) {
	llm := newAskLLM(t)
	store := shopStore()
	invoiceStore(store)
	router := finishRouter(t, store, finishShopStub(), shopCatalog())
	llm.answer(askIntentUnknown)
	resp := askWith(t, router, []string{permUpdate, permPartsRead}, invoiceMsg)
	if resp.InvoicePreview != nil || !strings.Contains(resp.Reply, "permission to change parts") {
		t.Fatalf("resp = %+v", resp)
	}
}

// --- Item 3: two actions on one part; several job statuses ------------------

func dualStore(s *memAskStore) {
	s.partRows = []askPartsRow{
		partRow(601, 31221, "Drive belt 3mm", "waiting_approval", 0),
		partRow(602, 31221, "Power switch", "approved", 0),
	}
}

func TestAskApproveAndSetPriceIsOneChange(t *testing.T) {
	llm, store, _, ask := finishSetup(t)
	dualStore(store)
	llm.answerJSON(map[string]any{"intent": askIntentPartsUpdate, "reference_ids": []int64{31221}, "parts_action": "approve"})
	ch := onlyChange(t, "approve+price", ask("approve the drive belt on #31221 and set the invoice price to $12.50"))
	if ch.PartsPurchaseRequestID != 601 || ch.OldStatus != "waiting_approval" || ch.NewStatus != "approved" || ch.NewPrice != 12.5 || ch.ViaStatus != "" || !ch.Valid {
		t.Fatalf("change = %+v", ch)
	}
	llm.answer(askIntentPartsUpdate)
	ch = onlyChange(t, "ordered+price", ask("mark request 602 ordered and set price $7.25"))
	if ch.NewStatus != "ordered" || ch.OldStatus != "approved" || ch.NewPrice != 7.25 || ch.ViaStatus != "" || !ch.Valid {
		t.Fatalf("change = %+v", ch)
	}
}

func TestAskApproveAndOrderGoesThroughApproved(t *testing.T) {
	llm, store, _, ask := finishSetup(t)
	dualStore(store)
	llm.answerJSON(map[string]any{"intent": askIntentPartsUpdate, "parts_request_ids": []int64{601}, "parts_actions": []string{"approve", "order"}})
	ch := onlyChange(t, "approve+order", ask("approve and mark ordered request 601 at $9.99"))
	if ch.OldStatus != "waiting_approval" || ch.ViaStatus != "approved" || ch.NewStatus != "ordered" || ch.NewPrice != 9.99 || !ch.Valid {
		t.Fatalf("change = %+v", ch)
	}
	// Already approved: a plain order, no extra step.
	ch = onlyChange(t, "already approved", ask("approve and mark ordered request 602"))
	if ch.ViaStatus != "" || ch.NewStatus != "ordered" || !ch.Valid {
		t.Fatalf("change = %+v", ch)
	}
	// Without the approve permission the two-step change can't be applied.
	router := finishRouter(t, store, finishShopStub(), shopCatalog())
	ch = onlyChange(t, "no approve", askWith(t, router, []string{permUpdate, permPartsRead, permPartsUpdate}, "approve and mark ordered request 601"))
	if ch.Valid || !strings.Contains(ch.Error, "approve permission") {
		t.Fatalf("change = %+v", ch)
	}
}

func TestAskSeveralJobStatusesInOneMessage(t *testing.T) {
	llm, _, _, ask := finishSetup(t)
	llm.answer(askIntentUpdateJobs, 31351, 31352)
	resp := ask("Set #31351 to On Test and #31352 to Waiting on Part (s)")
	if resp.Intent != askIntentUpdateJobs || !reflect.DeepEqual(resp.ReferenceIDs, []int64{31351, 31352}) {
		t.Fatalf("resp = %+v", resp)
	}
	if !strings.HasPrefix(resp.PreviewInstruction, "Jobs #31351, #31352:") || !strings.Contains(resp.PreviewInstruction, "On Test") {
		t.Fatalf("instruction = %q", resp.PreviewInstruction)
	}
}

// --- Item 4: create a parts request -----------------------------------------

func TestAskCreatePartsRequestPreview(t *testing.T) {
	llm, store, _, ask := finishSetup(t)
	llm.answer(askIntentUnknown)
	resp := ask("Create a parts request on #275: L6 x2 $3.50")
	p := resp.PartsCreatePreview
	if resp.Intent != askIntentCreatePartsRequest || p == nil {
		t.Fatalf("resp = %+v", resp)
	}
	if p.ReferenceID != 275 || p.ItemName != "L6" || p.Quantity != 2 || p.TotalPrice != 3.5 || p.Source != "online" || p.Status != "waiting_approval" || !p.PresetMatch {
		t.Fatalf("preview = %+v", p)
	}
	if turn := lastTurn(t, store); !strings.Contains(turn.Assistant, "#275") || !strings.Contains(turn.Assistant, "nothing saved until Apply") {
		t.Fatalf("turn = %q", turn.Assistant)
	}

	llm.answer(askIntentCreatePartsRequest, 275)
	p = ask("add a parts request for #275: L7 from supplier, save as draft").PartsCreatePreview
	if p == nil || p.ItemName != "L7" || p.Source != "supplier" || p.Status != "draft" || p.Quantity != 1 || p.TotalPrice != 0 || p.PresetMatch {
		t.Fatalf("preview = %+v", p)
	}

	// The model's item name counts only when the user typed it.
	llm.answerJSON(map[string]any{"intent": askIntentCreatePartsRequest, "reference_ids": []int64{275}, "item_name": "dial lamp"})
	if p := ask("new parts request for a dial lamp on #275").PartsCreatePreview; p == nil || p.ItemName != "dial lamp" {
		t.Fatalf("preview = %+v", p)
	}
	llm.answerJSON(map[string]any{"intent": askIntentCreatePartsRequest, "reference_ids": []int64{275}, "item_name": "invented part"})
	if resp := ask("new parts request for #275"); resp.PartsCreatePreview != nil || !strings.Contains(resp.Reply, "What part") {
		t.Fatalf("resp = %+v", resp)
	}
}

func TestAskCreatePartsRequestAsksForJobAndChecksPermission(t *testing.T) {
	llm, _, _, ask := finishSetup(t)
	llm.answer(askIntentCreatePartsRequest)
	if resp := ask("create a parts request: L6"); resp.PartsCreatePreview != nil || !strings.Contains(resp.Reply, "Which job") {
		t.Fatalf("resp = %+v", resp)
	}
	llm.answer(askIntentCreatePartsRequest, 99999)
	if resp := ask("create a parts request on #99999: L6"); resp.PartsCreatePreview != nil || resp.Notice != "No job #99999." {
		t.Fatalf("resp = %+v", resp)
	}
	store := shopStore()
	store.jobs[275] = true
	router := finishRouter(t, store, finishShopStub(), shopCatalog())
	resp := askWith(t, router, []string{permUpdate, permPartsRead}, "Create a parts request on #275: L6")
	if resp.PartsCreatePreview != nil || !strings.Contains(resp.Reply, "permission to create parts") {
		t.Fatalf("resp = %+v", resp)
	}
}

// --- Item 5: Complete Job ---------------------------------------------------

func TestAskCompleteJobPreviewsTheButtonStatus(t *testing.T) {
	llm, store, cat, ask := finishSetup(t)
	id := int64(21)
	cat.completeID = &id // the shop chose Picked Up for Complete Job
	for _, msg := range []string{"Complete job #31352", "close job #31352", "mark #31352 complete", "please complete #31352"} {
		llm.answer(askIntentUpdateJobs, 31352)
		resp := ask(msg)
		p := resp.CompleteJobPreview
		if resp.Intent != askIntentCompleteJob || p == nil || resp.PreviewInstruction != "" {
			t.Fatalf("[%s] resp = %+v", msg, resp)
		}
		if p.TargetStatusID != 21 || p.TargetStatusName != "Picked Up" || p.TargetSource != "setting" || len(p.Jobs) != 1 {
			t.Fatalf("[%s] preview = %+v", msg, p)
		}
		if j := p.Jobs[0]; j.ReferenceID != 31352 || j.CurrentStatusName != "Received" || j.Already {
			t.Fatalf("[%s] job = %+v", msg, j)
		}
	}
	if turn := lastTurn(t, store); !strings.Contains(turn.Assistant, "Complete Job") || !strings.Contains(turn.Assistant, "nothing saved until Apply") {
		t.Fatalf("turn = %q", turn.Assistant)
	}
	// No Complete Job setting: the first status in the completed group, as the button does.
	cat.completeID = nil
	llm.answer(askIntentCompleteJob, 31352)
	if p := ask("complete job #31352").CompleteJobPreview; p == nil || p.TargetStatusID != 20 || p.TargetSource != "completed_group" {
		t.Fatalf("preview = %+v", p)
	}
	// Follow-up with one remembered job.
	llm.answer(askIntentCompleteJob)
	if resp := ask("complete it"); resp.CompleteJobPreview == nil || !resp.ContextUsed || resp.CompleteJobPreview.Jobs[0].ReferenceID != 31352 {
		t.Fatalf("follow-up = %+v", resp)
	}
}

func TestAskCompleteJobEdgeCases(t *testing.T) {
	llm, store, cat, ask := finishSetup(t)
	// Already in the target status: say so, nothing to apply.
	llm.answer(askIntentCompleteJob, 31310)
	resp := ask("complete job #31310")
	if resp.CompleteJobPreview != nil || !strings.Contains(resp.Reply, "already Finished") {
		t.Fatalf("already resp = %+v", resp)
	}
	// A question never completes.
	llm.answer(askIntentCompleteJob, 31352)
	if resp := ask("did we complete #31352?"); resp.CompleteJobPreview != nil || resp.Intent == askIntentCompleteJob {
		t.Fatalf("question resp = %+v", resp)
	}
	// "it" with two remembered jobs: ask which.
	store.rows[askUserA] = askContext{ReferenceIDs: []int64{31352, 31351}, Topic: askTopicJobs, UpdatedAt: time.Now()}
	llm.answer(askIntentCompleteJob)
	if resp := ask("complete it"); resp.CompleteJobPreview != nil || !strings.Contains(resp.Reply, "Which job") {
		t.Fatalf("pronoun resp = %+v", resp)
	}
	// Two typed jobs: one preview row each.
	llm.answer(askIntentCompleteJob, 31352, 31351)
	if p := ask("complete jobs #31352 and #31351").CompleteJobPreview; p == nil || len(p.Jobs) != 2 {
		t.Fatalf("two jobs = %+v", p)
	}
	// No completed status configured.
	cat.statuses = cat.statuses[1:2]
	llm.answer(askIntentCompleteJob, 31352)
	if resp := ask("complete job #31352"); resp.CompleteJobPreview != nil || !strings.Contains(resp.Reply, "No status is configured in the completed group") {
		t.Fatalf("no status resp = %+v", resp)
	}
	// No permission to change status.
	router := finishRouter(t, shopStore(), finishShopStub(), shopCatalog())
	llm.answer(askIntentCompleteJob, 31352)
	resp = askWith(t, router, skillPerms, "complete job #31352")
	if resp.CompleteJobPreview != nil || !strings.Contains(resp.Reply, "permission to change job status") {
		t.Fatalf("perm resp = %+v", resp)
	}
}

// --- Item 6: create a new job -----------------------------------------------

const newJobMsg = "New job\n" +
	"Customer name: Pat Example\n" +
	"Phone: (416) 555-0199\n" +
	"Email: pat@example.com\n" +
	"Full address: 1412-64 Bramalea Rd, Brampton ON L6T 2W8\n" +
	"Brand: Sony\n" +
	"Item: Receiver\n" +
	"Model: STR-DH190\n" +
	"Serial: 12345\n" +
	"Problem description: No sound from left channel\n" +
	"Quote before tax: $80\n" +
	"Deposit collected: yes, cash"

func TestAskCreateJobTurnSummaryScrubsTypedDetails(t *testing.T) {
	got := askScrubNewJobText("New job for Pat Example, 416-555-0199, pat@example.com, 64 Bramalea Rd")
	for _, pii := range []string{"Pat", "555", "pat@", "Bramalea"} {
		if strings.Contains(got, pii) {
			t.Fatalf("scrubbed = %q", got)
		}
	}
}

// --- Real-AI regressions (2026-11-14) ----------------------------------------

func TestAskInvoiceOnOneLine(t *testing.T) {
	llm2, store2, _, ask2 := finishSetup(t)
	invoiceStore(store2)
	llm2.answerJSON(map[string]any{"intent": askIntentPartsInvoice, "invoice_number": "INV-5521"})
	resp := ask2("Supplier invoice INV-5521: Drive belt 3mm $13.10, Pinch roller $18.08. Mark them ordered.")
	p := resp.InvoicePreview
	if resp.Intent != askIntentPartsInvoice || p == nil || p.InvoiceNumber != "INV-5521" || len(p.Lines) != 2 {
		t.Fatalf("resp = %+v preview=%+v", resp, p)
	}
	if ch := p.Lines[0].Change; ch == nil || ch.PartsPurchaseRequestID != 501 || ch.NewStatus != "ordered" || ch.NewPrice != 13.10 {
		t.Fatalf("line 1 = %+v", p.Lines[0])
	}
	if ch := p.Lines[1].Change; ch == nil || ch.PartsPurchaseRequestID != 505 || p.Lines[1].Text != "Pinch roller" {
		t.Fatalf("line 2 = %+v", p.Lines[1])
	}
	// A single part on one line is not an invoice list.
	if askInvoiceMessage("invoice INV-1: mark the drive belt ordered", true) {
		t.Fatal("one part on one line should stay a parts update")
	}
}

func TestAskApproveAndOrderVerb(t *testing.T) {
	if got := askPartsActionIn("Approve and order parts request 5"); got != askPartsApproveOrder {
		t.Fatalf("action = %q", got)
	}
	llm, store, _, ask := finishSetup(t)
	dualStore(store)
	llm.answerJSON(map[string]any{"intent": askIntentPartsUpdate, "parts_request_ids": []int64{602}, "parts_actions": []string{"approve", "order"}})
	ch := onlyChange(t, "already approved", ask("Approve and order parts request 602"))
	if ch.OldStatus != "approved" || ch.NewStatus != "ordered" || ch.ViaStatus != "" || !ch.Valid {
		t.Fatalf("change = %+v", ch)
	}
}

func TestAskModelCreatePartsRequestBeatsRequestNumberWords(t *testing.T) {
	llm, store, _, ask := finishSetup(t)
	dualStore(store)
	llm.answerJSON(map[string]any{"intent": askIntentCreatePartsRequest, "reference_ids": []int64{31221}, "item_name": "L7", "quantity": 2, "total_price": 24})
	resp := ask("Request 2 x L7 for job 31221 from the supplier, $24 total")
	p := resp.PartsCreatePreview
	if resp.Intent != askIntentCreatePartsRequest || p == nil || resp.PartsPreview != nil {
		t.Fatalf("resp = %+v", resp)
	}
	if p.ReferenceID != 31221 || p.ItemName != "L7" || p.Quantity != 2 || p.TotalPrice != 24 || p.Source != "supplier" {
		t.Fatalf("preview = %+v", p)
	}
	// The model's name must be typed, else the word rules decide.
	llm.answerJSON(map[string]any{"intent": askIntentCreatePartsRequest, "reference_ids": []int64{31221}, "item_name": "invented"})
	if resp := ask("set request 602 price to $24"); resp.PartsCreatePreview != nil {
		t.Fatalf("resp = %+v", resp)
	}
}
