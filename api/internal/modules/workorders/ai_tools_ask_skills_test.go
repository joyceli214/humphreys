package workorders

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"humphreys/api/internal/domain"
	"humphreys/api/internal/middleware"
	"humphreys/api/internal/modules/auth/security"

	"github.com/gin-gonic/gin"
)

// Ask skills (admin portal cases ap-02 … ap-25): parts changes, waiting on
// parts, questions vs changes, repair logs, labour, Complete Job and the
// invalid-JSON retry. Every change is a preview; the interpret endpoint only
// reads (memAskStore has no write methods besides the Ask context).

func (s *memAskStore) PartsRequestsByID(_ context.Context, ids []int64) ([]askPartsRow, error) {
	out := []askPartsRow{}
	for _, p := range s.partRows {
		for _, id := range ids {
			if p.ID == id {
				out = append(out, p)
			}
		}
	}
	return out, nil
}

func (s *memAskStore) PartsRequestsForJobs(_ context.Context, jobIDs []int64) ([]askPartsRow, error) {
	out := []askPartsRow{}
	for _, p := range s.partRows {
		for _, id := range jobIDs {
			if p.ReferenceID == id {
				out = append(out, p)
			}
		}
	}
	return out, nil
}

func (s *memAskStore) JobIDsWithStatus(_ context.Context, statusID int64, limit int) ([]int64, int, error) {
	ids := s.statusJobs[statusID]
	if len(ids) > limit {
		return append([]int64{}, ids[:limit]...), len(ids), nil
	}
	return append([]int64{}, ids...), len(ids), nil
}

var skillPerms = []string{permUpdate, permSensitiveRead, permPartsRead, permPartsUpdate, permPartsApprove, permRepairLogsCreate}

var skillUpdatedAt = time.Date(2026, 11, 13, 6, 45, 0, 123456000, time.UTC)

func partRow(id, job int64, item, status string, price float64) askPartsRow {
	at := skillUpdatedAt
	return askPartsRow{ID: id, ReferenceID: job, ItemName: item, Quantity: 1, Status: status, TotalPrice: price, Source: "online", UpdatedAt: &at}
}

// shopStore mirrors the live snapshot in admin_portal_cases.md. Job 480 also
// exists (an old job number) but has no parts requests.
func shopStore() *memAskStore {
	s := newMemAskStore(31271, 31272, 31178, 31352, 31351, 31165, 31310, 31348, 480)
	s.partRows = []askPartsRow{
		partRow(480, 31271, "10,000uF 63v Dia:35mm H:85mm", "waiting_approval", 59.62),
		partRow(479, 31272, "10,000uF 50v filter capacitor", "ordered", 16.43),
		partRow(481, 31272, "2200uF 10V capacitor", "ordered", 5.33),
		partRow(470, 31272, "Old fuse", "cancelled", 1),
		partRow(490, 31178, "MJ15025G", "waiting_approval", 80),
		partRow(491, 31178, "MJ15024G", "waiting_approval", 80),
		partRow(492, 31178, "1N4004", "approved", 3),
	}
	s.statusJobs = map[int64][]int64{7: {31352, 31348, 31272, 31271, 31178}}
	return s
}

func shopStub() *aiToolsStub {
	stub := searchStub()
	stub.statuses = append(stub.statuses,
		AIStatusOption{ID: 7, Name: "Waiting on Part (s)", Group: "staged"},
		AIStatusOption{ID: 8, Name: "On Test", Group: "in_progress"},
		AIStatusOption{ID: 9, Name: "Received", Group: "to_do"},
	)
	at := skillUpdatedAt
	labour := 220.0
	statusName := "Received"
	stub.details = map[int]domain.WorkOrderDetail{
		31351: {ReferenceID: 31351, UpdatedAt: &at, StatusName: &statusName},
		31165: {ReferenceID: 31165, UpdatedAt: &at, LabourTotal: &labour},
	}
	return stub
}

func skillRouter(t *testing.T, store *memAskStore, stub *aiToolsStub, limit int) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	group := router.Group("", middleware.Auth("test-secret"))
	h := &Handler{service: NewService(stub), httpClient: &http.Client{}}
	if store != nil {
		h.askContext, h.askJobs, h.askParts = store, store, store
	}
	h.aiLimiter = newAIRateLimiter(limit, time.Minute)
	RegisterAIToolsRoutes(group, h)
	return router
}

func askWith(t *testing.T, router *gin.Engine, perms []string, message string) askInterpretResponse {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"message": message})
	req := httptest.NewRequest(http.MethodPost, "/ai-tools/ask/interpret", strings.NewReader(string(body)))
	token, _, err := security.NewAccessToken("test-secret", time.Minute, askUserA, nil, perms)
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

func skillSetup(t *testing.T) (*askLLM, *memAskStore, func(string) askInterpretResponse) {
	t.Helper()
	llm := newAskLLM(t)
	store := shopStore()
	router := skillRouter(t, store, shopStub(), 1000)
	return llm, store, func(msg string) askInterpretResponse { return askWith(t, router, skillPerms, msg) }
}

func onlyChange(t *testing.T, label string, resp askInterpretResponse) askPartsChange {
	t.Helper()
	if resp.Intent != askIntentPartsUpdate || resp.PartsPreview == nil || len(resp.PartsPreview.Changes) != 1 {
		t.Fatalf("[%s] want one parts change, got %+v (preview %+v)", label, resp, resp.PartsPreview)
	}
	if resp.PreviewInstruction != "" {
		t.Fatalf("[%s] parts change must not open a job preview: %q", label, resp.PreviewInstruction)
	}
	return resp.PartsPreview.Changes[0]
}

// --- Fix 1: parts changes -------------------------------------------------

func TestAskPartsApproveByRequestID(t *testing.T) {
	llm, store, ask := skillSetup(t)
	// The live model said parts_requests with reference_ids [480] (a job!).
	llm.answerJSON(map[string]any{"intent": askIntentPartsRequests, "reference_ids": []int64{480}, "parts_statuses": []string{"waiting_approval"}})
	resp := ask("Approve parts request #480")
	ch := onlyChange(t, "approve", resp)
	if ch.PartsPurchaseRequestID != 480 || ch.ReferenceID != 31271 || ch.OldStatus != "waiting_approval" || ch.NewStatus != "approved" || !ch.Valid {
		t.Fatalf("change = %+v", ch)
	}
	if ch.OldPrice != 59.62 || ch.NewPrice != 59.62 || ch.UpdatedAt == nil || !ch.UpdatedAt.Equal(skillUpdatedAt) || ch.ItemName == "" || ch.Quantity != 1 || ch.Source != "online" {
		t.Fatalf("change must carry the request for the PATCH: %+v", ch)
	}
	if !reflect.DeepEqual(resp.ReferenceIDs, []int64{31271}) {
		t.Fatalf("reference_ids = %v", resp.ReferenceIDs)
	}
	row, _ := store.row(askUserA)
	if row.Topic != askTopicParts || !reflect.DeepEqual(row.ReferenceIDs, []int64{31271}) {
		t.Fatalf("context = %+v", row)
	}
	if last := row.Turns[len(row.Turns)-1].Assistant; !strings.Contains(last, "request 480") || !strings.Contains(last, "nothing saved until Apply") {
		t.Fatalf("turn = %q", last)
	}
	for _, w := range []string{"approve PR 480", "approve request 480", "please approve 480"} {
		llm.answer(askIntentUnknown)
		if ch := onlyChange(t, w, ask(w)); ch.PartsPurchaseRequestID != 480 || ch.NewStatus != "approved" {
			t.Fatalf("[%s] change = %+v", w, ch)
		}
	}
}

func TestAskPartsApproveNeedsApprovePermission(t *testing.T) {
	llm := newAskLLM(t)
	router := skillRouter(t, shopStore(), shopStub(), 1000)
	llm.answer(askIntentPartsUpdate)
	perms := []string{permUpdate, permPartsRead, permPartsUpdate}
	ch := onlyChange(t, "no approve", askWith(t, router, perms, "Approve parts request 480"))
	if ch.Valid || !strings.Contains(ch.Error, "approve permission") {
		t.Fatalf("change = %+v", ch)
	}
	// No parts permissions at all: nothing about the request is shown.
	resp := askWith(t, router, []string{permUpdate}, "Approve parts request 480")
	if resp.Intent != askIntentUnknown || resp.PartsPreview != nil || !strings.Contains(resp.Reply, "access to parts") {
		t.Fatalf("resp = %+v", resp)
	}
	resp = askWith(t, router, []string{permUpdate, permPartsRead}, "Approve parts request 480")
	if resp.Intent != askIntentUnknown || resp.PartsPreview != nil || !strings.Contains(resp.Reply, "permission to change parts") {
		t.Fatalf("resp = %+v", resp)
	}
}

func TestAskPartsOrderedBeforeApprovedIsExplained(t *testing.T) {
	llm, _, ask := skillSetup(t)
	// Job 480 exists but has no parts requests, so #480 is the request. Works
	// whatever the model said (the local stand-in says update_jobs).
	for _, intent := range []string{askIntentUpdateJobs, askIntentUnknown} {
		llm.answer(intent, 480)
		ch := onlyChange(t, intent, ask("Mark #480 as ordered"))
		if ch.PartsPurchaseRequestID != 480 || ch.Valid {
			t.Fatalf("[%s] change = %+v", intent, ch)
		}
	}
	llm.answer(askIntentPartsRequests, 480)
	ch := onlyChange(t, "ordered", ask("Mark #480 as ordered"))
	if ch.PartsPurchaseRequestID != 480 || ch.NewStatus != "ordered" || ch.Valid || !strings.Contains(ch.Error, "must be approved before it can be ordered") {
		t.Fatalf("change = %+v", ch)
	}
}

func TestAskPartsArrivedForJobChangesOnlyOrdered(t *testing.T) {
	llm, _, ask := skillSetup(t)
	llm.answerJSON(map[string]any{"intent": askIntentPartsRequests, "reference_ids": []int64{31272}, "parts_statuses": []string{"arrived"}})
	resp := ask("Mark the parts for #31272 as arrived")
	if resp.Intent != askIntentPartsUpdate || resp.PartsPreview == nil || len(resp.PartsPreview.Changes) != 2 {
		t.Fatalf("resp = %+v preview=%+v", resp, resp.PartsPreview)
	}
	got := map[int64]bool{}
	for _, ch := range resp.PartsPreview.Changes {
		if !ch.Valid || ch.OldStatus != "ordered" || ch.NewStatus != "arrived" {
			t.Fatalf("change = %+v", ch)
		}
		got[ch.PartsPurchaseRequestID] = true
	}
	if !got[479] || !got[481] {
		t.Fatalf("want #479 and #481, got %v", got)
	}
}

func TestAskPartsCancelByPartName(t *testing.T) {
	llm, store, ask := skillSetup(t)
	store.partRows = append(store.partRows, partRow(482, 31271, "Fuse 2A slow blow", "waiting_approval", 2))
	llm.answerJSON(map[string]any{"intent": askIntentPartsRequests, "reference_ids": []int64{31271}, "parts_query": "10,000uF cap", "parts_statuses": []string{"cancelled"}})
	ch := onlyChange(t, "cancel", ask("Jerry doesn't have the 10,000uF cap for #31271, cancel it"))
	if ch.PartsPurchaseRequestID != 480 || ch.NewStatus != "cancelled" || !ch.Valid {
		t.Fatalf("change = %+v", ch)
	}
}

// The live model classified the cancel but left parts_query empty; the part
// named in the user's text still narrows the job's requests.
func TestAskPartsCancelByPartNameWithoutPartsQuery(t *testing.T) {
	for _, intent := range []string{askIntentPartsRequests, askIntentPartsUpdate} {
		llm, store, ask := skillSetup(t)
		store.partRows = append(store.partRows, partRow(482, 31271, "Fuse 2A slow blow", "waiting_approval", 2))
		llm.answerJSON(map[string]any{"intent": intent, "reference_ids": []int64{31271}, "parts_query": "", "parts_statuses": []string{"cancelled"}})
		resp := ask("Jerry doesn't have the 10,000uF cap for #31271, cancel it")
		if resp.PartsPreview != nil && len(resp.PartsPreview.Choices) > 0 {
			t.Fatalf("[%s] want a single change, got choices %+v", intent, resp.PartsPreview.Choices)
		}
		ch := onlyChange(t, intent, resp)
		if ch.PartsPurchaseRequestID != 480 || ch.NewStatus != "cancelled" || !ch.Valid {
			t.Fatalf("[%s] change = %+v", intent, ch)
		}
	}
}

func TestAskMatchPartNameFallsBackToMessage(t *testing.T) {
	rows := []askPartsRow{
		partRow(1, 31221, "TEST Drive belt 3mm", "waiting_approval", 5),
		partRow(2, 31221, "TEST Power switch", "waiting_approval", 5),
	}
	got := askMatchPartName(rows, "", "Jerry doesn't have the drive belt for #31221, cancel it")
	if len(got) != 1 || got[0].ID != 1 {
		t.Fatalf("got %+v", got)
	}
	// Nothing part-like in the message: every row stays.
	if got := askMatchPartName(rows, "", "cancel it for #31221 please"); len(got) != 2 {
		t.Fatalf("filler only: got %+v", got)
	}
}

func TestAskPartWordsSkipsNumbersAndFiller(t *testing.T) {
	got := askPartWords("Jerry doesn't have the 10,000uF cap for #31271, cancel it")
	if !reflect.DeepEqual(got, []string{"10000uf", "cap"}) {
		t.Fatalf("got %v", got)
	}
}

func TestAskPartsSetPriceAndLink(t *testing.T) {
	llm, _, ask := skillSetup(t)
	llm.answer(askIntentPartsRequests, 480)
	msg := "Set the price on parts request #480 to 59.99 with link https://www.mouser.ca/ProductDetail/Knowles-Syfer/SLP103M063H9P3"
	ch := onlyChange(t, "price", ask(msg))
	if ch.PartsPurchaseRequestID != 480 || ch.OldStatus != ch.NewStatus || ch.OldPrice != 59.62 || ch.NewPrice != 59.99 || !ch.Valid {
		t.Fatalf("change = %+v", ch)
	}
	if ch.NewSourceURL == nil || *ch.NewSourceURL != "https://www.mouser.ca/ProductDetail/Knowles-Syfer/SLP103M063H9P3" || ch.ItemName != "10,000uF 63v Dia:35mm H:85mm" {
		t.Fatalf("change = %+v", ch)
	}
	// A price the user did not type is never taken from the model.
	llm.answerJSON(map[string]any{"intent": askIntentPartsUpdate, "parts_request_ids": []int64{480}, "parts_action": "set_price", "total_price": 12.5})
	resp := ask("update the price on request 480")
	if resp.PartsPreview != nil && len(resp.PartsPreview.Changes) > 0 {
		t.Fatalf("invented price applied: %+v", resp.PartsPreview)
	}
}

func TestAskPartsAmbiguousListsChoices(t *testing.T) {
	llm, _, ask := skillSetup(t)
	llm.answer(askIntentPartsUpdate, 31178)
	resp := ask("approve the transistor on #31178")
	if resp.Intent != askIntentPartsUpdate || resp.PartsPreview == nil || len(resp.PartsPreview.Changes) != 0 {
		t.Fatalf("resp = %+v preview=%+v", resp, resp.PartsPreview)
	}
	if len(resp.PartsPreview.Choices) != 2 || !strings.Contains(resp.Reply, "Which one") {
		t.Fatalf("choices = %+v reply = %q", resp.PartsPreview.Choices, resp.Reply)
	}
	for _, c := range resp.PartsPreview.Choices {
		if c.Status != "waiting_approval" || c.ItemName == "" || c.PartsPurchaseRequestID == 0 {
			t.Fatalf("choice = %+v", c)
		}
	}
	// Setting a price on a job with several requests always asks.
	llm.answer(askIntentPartsUpdate, 31178)
	resp = ask("set the price on the parts for #31178 to $20")
	if resp.PartsPreview == nil || len(resp.PartsPreview.Changes) != 0 || len(resp.PartsPreview.Choices) == 0 {
		t.Fatalf("price on many: %+v", resp.PartsPreview)
	}
}

func TestAskPartsNumberBothJobAndRequestAsks(t *testing.T) {
	llm, store, ask := skillSetup(t)
	store.partRows = append(store.partRows, partRow(31271, 480, "Belt", "approved", 5)) // job 480 has a request; request 31271 exists
	llm.answer(askIntentPartsUpdate)
	resp := ask("Mark #480 as ordered")
	if resp.Intent != askIntentUnknown || !strings.Contains(resp.Reply, "job #480 or parts request 480") {
		t.Fatalf("resp = %+v", resp)
	}
}

func TestAskPartsBareNumberWithoutContext(t *testing.T) {
	llm, _, ask := skillSetup(t)
	llm.answer(askIntentUnknown)
	if ch := onlyChange(t, "bare", ask("please approve 480")); ch.PartsPurchaseRequestID != 480 || ch.NewStatus != "approved" {
		t.Fatalf("change = %+v", ch)
	}
}

func TestAskBareNumbers(t *testing.T) {
	cases := map[string][]int64{
		"please approve 480":                     {480},
		"the 10,000uF cap for #31271, cancel it": {31271},
		"set the price on request 480 to 59.62":  {480},
		"approve 480 at $59.62":                  {480},
		"add 2 hours":                            {},
		"https://x.test/481 approve 482.":        {482},
	}
	for msg, want := range cases {
		if got := askBareNumbers(msg); !reflect.DeepEqual(got, want) {
			t.Fatalf("%q: got %v want %v", msg, got, want)
		}
	}
}

func TestAskPartsMissingRequest(t *testing.T) {
	llm, _, ask := skillSetup(t)
	llm.answer(askIntentPartsUpdate)
	resp := ask("approve request 9999")
	if resp.Intent != askIntentUnknown || resp.PartsPreview != nil || !strings.Contains(resp.Notice, "No parts request 9999") {
		t.Fatalf("resp = %+v", resp)
	}
}

func TestAskPartsFollowUpOrderedPreviewsSavedJobs(t *testing.T) {
	llm, store, ask := skillSetup(t)
	store.rows[askUserA] = askContext{ReferenceIDs: []int64{31178}, Topic: askTopicParts, UpdatedAt: time.Now()}
	llm.answer(askIntentUpdateJobs)
	ch := onlyChange(t, "follow-up", ask("set them to ordered"))
	if ch.PartsPurchaseRequestID != 492 || ch.OldStatus != "approved" || ch.NewStatus != "ordered" || !ch.Valid {
		t.Fatalf("change = %+v", ch)
	}
}

// --- Fix 2: waiting on parts / parts filters -------------------------------

func TestAskWaitingOnPartsReturnsJobs(t *testing.T) {
	llm, store, ask := skillSetup(t)
	for _, msg := range []string{"Which jobs are waiting on parts?", "what's waiting on parts", "jobs waiting for parts"} {
		// Live: the model said parts_requests with parts_statuses [ordered].
		llm.answerJSON(map[string]any{"intent": askIntentPartsRequests, "parts_statuses": []string{"ordered"}})
		resp := ask(msg)
		if resp.Intent != askIntentWaitingParts || resp.WaitingParts == nil || resp.WaitingParts.StatusID != 7 || resp.WaitingParts.StatusName != "Waiting on Part (s)" {
			t.Fatalf("[%s] resp = %+v", msg, resp)
		}
		if resp.WaitingParts.Total != 5 || !reflect.DeepEqual(resp.ReferenceIDs, []int64{31352, 31348, 31272, 31271, 31178}) || len(resp.PartsStatuses) != 0 {
			t.Fatalf("[%s] jobs = %v total=%d statuses=%v", msg, resp.ReferenceIDs, resp.WaitingParts.Total, resp.PartsStatuses)
		}
	}
	row, _ := store.row(askUserA)
	if row.Topic != askTopicJobs || len(row.ReferenceIDs) != 5 {
		t.Fatalf("context = %+v", row)
	}
}

func TestAskPartsListFiltersStatusAndJob(t *testing.T) {
	llm, _, ask := skillSetup(t)
	llm.answer(askIntentPartsRequests) // the model forgot the status
	resp := ask("Which parts requests are waiting for approval?")
	if resp.Intent != askIntentPartsRequests || !reflect.DeepEqual(resp.PartsStatuses, []string{"waiting_approval"}) || len(resp.ReferenceIDs) != 0 {
		t.Fatalf("resp = %+v", resp)
	}
	llm.answer(askIntentPartsRequests)
	resp = ask("Show the parts requests for #31178")
	if resp.Intent != askIntentPartsRequests || !reflect.DeepEqual(resp.ReferenceIDs, []int64{31178}) || len(resp.PartsStatuses) != 0 {
		t.Fatalf("resp = %+v", resp)
	}
	llm.answer(askIntentPartsRequests, 31178)
	resp = ask("how many parts on #31178 are still waiting approval?")
	if resp.Intent != askIntentPartsRequests || !reflect.DeepEqual(resp.ReferenceIDs, []int64{31178}) || !reflect.DeepEqual(resp.PartsStatuses, []string{"waiting_approval"}) {
		t.Fatalf("resp = %+v", resp)
	}
}

// --- Fix 3: questions vs changes; repair log; labour -------------------------

func TestAskQuestionsNeverOpenUpdatePreview(t *testing.T) {
	llm, _, ask := skillSetup(t)
	cases := []struct {
		msg, model, want string
		id               int64
	}{
		{"What's the make and model on #31178?", askIntentUpdateJobs, askIntentJobDetails, 31178},
		{"What's the make and model on #31178?", askIntentCustomerJobs, askIntentJobDetails, 31178},
		{"serial number of #31178", askIntentUnknown, askIntentJobDetails, 31178},
		{"What did we do on #31165?", askIntentCustomerJobs, askIntentRepairHistory, 31165},
		{"repair history of #31165", askIntentUpdateJobs, askIntentRepairHistory, 31165},
		{"What's the status of #31310?", askIntentUpdateJobs, askIntentCustomerJobs, 31310},
	}
	for _, c := range cases {
		llm.answer(c.model, c.id)
		resp := ask(c.msg)
		if resp.Intent != c.want || resp.PreviewInstruction != "" || !reflect.DeepEqual(resp.ReferenceIDs, []int64{c.id}) {
			t.Fatalf("[%s / model %s] resp = %+v", c.msg, c.model, resp)
		}
	}
	// The model's skill intents are accepted for read questions.
	llm.answer(askIntentRepairHistory, 31165)
	if resp := ask("anything logged on #31165"); resp.Intent != askIntentRepairHistory {
		t.Fatalf("resp = %+v", resp)
	}
}

func TestAskRepairLogPreview(t *testing.T) {
	llm, store, ask := skillSetup(t)
	llm.answer(askIntentUpdateJobs, 31352)
	resp := ask("Add a 0.25 hr repair log to #31352: Final test: unit tested OK.")
	p := resp.RepairLogPreview
	if resp.Intent != askIntentAddRepairLog || p == nil || resp.PreviewInstruction != "" {
		t.Fatalf("resp = %+v", resp)
	}
	if p.ReferenceID != 31352 || p.Details != "Final test: unit tested OK." || p.HoursUsed != 0.25 {
		t.Fatalf("preview = %+v", p)
	}
	llm.answer(askIntentUnknown)
	p = ask("add a repair log to #31352: Replaced belt (1.5 hr)").RepairLogPreview
	if p == nil || p.Details != "Replaced belt" || p.HoursUsed != 1.5 {
		t.Fatalf("preview = %+v", p)
	}
	// The model's text is used when the user typed no colon.
	llm.answerJSON(map[string]any{"intent": askIntentAddRepairLog, "reference_ids": []int64{31352}, "log_text": "Cleaned the tape heads", "hours": 0.5})
	p = ask("log that we cleaned the tape heads on #31352 add log 0.5 hr").RepairLogPreview
	if p == nil || p.Details != "Cleaned the tape heads" || p.HoursUsed != 0.5 {
		t.Fatalf("preview = %+v", p)
	}
	llm.answer(askIntentAddRepairLog, 31352)
	if resp := ask("add a repair log to #31352"); resp.Intent != askIntentUnknown || !strings.Contains(resp.Reply, "What should the repair log") {
		t.Fatalf("resp = %+v", resp)
	}
	if row, _ := store.row(askUserA); row.Topic != askTopicJobs || !reflect.DeepEqual(row.ReferenceIDs, []int64{31352}) {
		t.Fatalf("context = %+v", row)
	}
}

func TestAskRepairLogNeedsPermissionAndOneJob(t *testing.T) {
	llm := newAskLLM(t)
	router := skillRouter(t, shopStore(), shopStub(), 1000)
	llm.answer(askIntentAddRepairLog, 31352)
	resp := askWith(t, router, []string{permUpdate}, "Add a repair log to #31352: tested OK")
	if resp.Intent != askIntentUnknown || resp.RepairLogPreview != nil || !strings.Contains(resp.Reply, "permission to add repair logs") {
		t.Fatalf("resp = %+v", resp)
	}
	resp = askWith(t, router, skillPerms, "Add a repair log to #31352 and #31351: tested OK")
	if resp.Intent != askIntentUnknown || resp.RepairLogPreview != nil || !strings.Contains(resp.Reply, "one job at a time") {
		t.Fatalf("resp = %+v", resp)
	}
	resp = askWith(t, router, skillPerms, "Add a repair log to #31352: tested OK (30 hr)")
	if resp.Intent != askIntentUnknown || !strings.Contains(resp.Reply, "between 0 and 24") {
		t.Fatalf("resp = %+v", resp)
	}
}

func TestAskLabourPreview(t *testing.T) {
	llm, _, ask := skillSetup(t)
	llm.answer(askIntentUpdateJobs, 31351)
	resp := ask("Add labour to #31351 for 1 hour")
	p := resp.LabourPreview
	if resp.Intent != askIntentAddLabour || p == nil || resp.PreviewInstruction != "" {
		t.Fatalf("resp = %+v", resp)
	}
	if p.ReferenceID != 31351 || p.Hours != 1 || p.Rate != 110 || p.Amount != 110 || !strings.Contains(p.Note, "1.25") {
		t.Fatalf("preview = %+v", p)
	}
	op := p.Row.Operation
	if op.Op != massOpSetLabourTotal || op.ReferenceID != 31351 || op.LabourTotal == nil || *op.LabourTotal != 110 || !p.Row.Valid {
		t.Fatalf("row = %+v", p.Row)
	}
	if p.Row.Before != "$0.00" || p.Row.After != "$110.00" || p.Row.UpdatedAt == nil || !p.Row.UpdatedAt.Equal(skillUpdatedAt) {
		t.Fatalf("row = %+v", p.Row)
	}
	// Existing labour is added to.
	llm.answer(askIntentAddLabour, 31165)
	if p := ask("add 1.5 hours labour to #31165").LabourPreview; p == nil || *p.Row.Operation.LabourTotal != 385 || p.Row.Before != "$220.00" {
		t.Fatalf("preview = %+v", p)
	}
	for _, msg := range []string{"add 0.3 hours labour to #31351", "add 30 hours labour to #31351"} {
		llm.answer(askIntentAddLabour, 31351)
		if resp := ask(msg); resp.Intent != askIntentUnknown || !strings.Contains(resp.Reply, "quarter hours") {
			t.Fatalf("[%s] resp = %+v", msg, resp)
		}
	}
	llm.answer(askIntentAddLabour, 31351)
	if resp := ask("add labour to #31351"); resp.Intent != askIntentUnknown || !strings.Contains(resp.Reply, "How many hours") {
		t.Fatalf("resp = %+v", resp)
	}
}

func TestAskStatusOnlyPreviewHasNoMoneyLines(t *testing.T) {
	llm, _, ask := skillSetup(t)
	llm.answer(askIntentUpdateJobs, 31351)
	resp := ask("Set #31351 to On Test")
	if resp.Intent != askIntentUpdateJobs || resp.PreviewInstruction != "Job #31351: Set #31351 to On Test" {
		t.Fatalf("resp = %+v", resp)
	}
	for _, s := range []string{resp.PreviewInstruction, resp.Reply, resp.Notice} {
		if strings.Contains(strings.ToLower(s), "labour") || strings.Contains(strings.ToLower(s), "shipping") {
			t.Fatalf("money words in a status answer: %+v", resp)
		}
	}
	if resp.LabourPreview != nil || resp.RepairLogPreview != nil || resp.PartsPreview != nil {
		t.Fatalf("resp = %+v", resp)
	}

	// Even if the Mass Update model adds labour or shipping, a status-only
	// instruction previews only the status.
	ops := `{"operations":[{"reference_id":31351,"op":"set_status","status_name":"On Test"},{"reference_id":31351,"op":"set_labour_total","labour_total":110},{"reference_id":31351,"op":"add_line_item","item_name":"Shipping","unit_price":15}]}`
	useMockLLM(t, mockLLMServer(t, ops))
	router := aiToolsRouter(t, shopStub())
	rec := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/preview", `{"instruction":"Job #31351: Set #31351 to On Test"}`, []string{permUpdate})
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d %s", rec.Code, rec.Body.String())
	}
	var body massUpdatePreviewResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Rows) != 1 || body.Rows[0].Operation.Op != massOpSetStatus || body.Rows[0].After != "On Test" {
		t.Fatalf("rows = %+v", body.Rows)
	}
	// An instruction that asks for money keeps those ops.
	kept := dropUnaskedMoneyOps("Set #5 to On Test and add $15 shipping", []MassUpdateOp{{ReferenceID: 5, Op: massOpSetStatus}, {ReferenceID: 5, Op: massOpAddLineItem}})
	if len(kept) != 2 {
		t.Fatalf("kept = %+v", kept)
	}
}

// --- Fix 4: Complete Job --------------------------------------------------

func TestAskCompleteJobPointsToButton(t *testing.T) {
	llm, _, ask := skillSetup(t)
	for _, msg := range []string{"Complete job #31352", "close job #31352", "mark #31352 complete", "please complete #31352"} {
		llm.answer(askIntentUpdateJobs, 31352)
		resp := ask(msg)
		if resp.Intent != askIntentCompleteJob || resp.PreviewInstruction != "" || !reflect.DeepEqual(resp.ReferenceIDs, []int64{31352}) {
			t.Fatalf("[%s] resp = %+v", msg, resp)
		}
		if !strings.Contains(resp.Reply, "Complete Job") || !strings.Contains(resp.Reply, "#31352") {
			t.Fatalf("[%s] reply = %q", msg, resp.Reply)
		}
	}
	llm.answer(askIntentCompleteJob)
	if resp := ask("complete it"); resp.Intent != askIntentCompleteJob || !reflect.DeepEqual(resp.ReferenceIDs, []int64{31352}) || !resp.ContextUsed {
		t.Fatalf("follow-up resp = %+v", resp)
	}
	llm.answer(askIntentCompleteJob, 99999)
	if resp := ask("complete job #99999"); resp.Intent != askIntentUnknown || resp.Notice != "No job #99999." {
		t.Fatalf("missing resp = %+v", resp)
	}
}

// --- Fix 5: invalid JSON retry --------------------------------------------

// seqLLM answers the i-th model call with replies[i] (the last one repeats).
type seqLLM struct {
	mu      sync.Mutex
	replies []string
	prompts []string
}

func newSeqLLM(t *testing.T, replies ...string) *seqLLM {
	l := &seqLLM{replies: replies}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		l.mu.Lock()
		n := len(l.prompts)
		if len(req.Messages) > 0 {
			l.prompts = append(l.prompts, req.Messages[len(req.Messages)-1].Content)
		}
		reply := l.replies[min(n, len(l.replies)-1)]
		l.mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"model": "mock-model", "choices": []map[string]any{{"message": map[string]any{"content": reply}}}})
	}))
	t.Cleanup(srv.Close)
	useMockLLM(t, srv)
	return l
}

func (l *seqLLM) calls() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]string{}, l.prompts...)
}

func TestAskInvalidJSONRetriesOnceThenSucceeds(t *testing.T) {
	l := newSeqLLM(t, "Sure! The job is 31178.", `{"intent":"customer_jobs","reference_ids":[31178]}`)
	store := shopStore()
	router := skillRouter(t, store, shopStub(), 1000)
	resp := askWith(t, router, skillPerms, "how many parts on that job are still waiting approval? #31178")
	if resp.Intent == askIntentUnknown && resp.Reply == askNotUnderstoodReply {
		t.Fatalf("retry was not used: %+v", resp)
	}
	calls := l.calls()
	if len(calls) != 2 || strings.Contains(calls[0], "not valid JSON") || !strings.Contains(calls[1], "Respond with the JSON object only") {
		t.Fatalf("calls = %q", calls)
	}
}

func TestAskInvalidJSONTwiceIsFriendly(t *testing.T) {
	l := newSeqLLM(t, "nope", "still not json")
	store := shopStore()
	store.rows[askUserA] = askContext{ReferenceIDs: []int64{31178}, Topic: askTopicJobs, UpdatedAt: time.Now()}
	router := skillRouter(t, store, shopStub(), 1000)
	resp := askWith(t, router, skillPerms, "how many parts on that job are still waiting approval?")
	if resp.Intent != askIntentUnknown || resp.Reply != askNotUnderstoodReply || len(l.calls()) != 2 {
		t.Fatalf("resp = %+v calls=%d", resp, len(l.calls()))
	}
	row, _ := store.row(askUserA)
	if len(row.Turns) != 1 || row.Turns[0].Assistant != "Said: "+askNotUnderstoodReply || !reflect.DeepEqual(row.ReferenceIDs, []int64{31178}) {
		t.Fatalf("context = %+v", row)
	}
}

func TestAskInvalidJSONRetryRespectsRateLimit(t *testing.T) {
	l := newSeqLLM(t, "nope", `{"intent":"customer_jobs"}`)
	router := skillRouter(t, shopStore(), shopStub(), 1) // one AI call per minute
	resp := askWith(t, router, skillPerms, "hello")
	if resp.Reply != askNotUnderstoodReply || len(l.calls()) != 1 {
		t.Fatalf("resp = %+v calls=%d", resp, len(l.calls()))
	}
}
