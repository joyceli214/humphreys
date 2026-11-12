package workorders

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseAskInterpretOutputValid(t *testing.T) {
	out, err := parseAskInterpretOutput("```json\n" + `{"intent":"customer_jobs","customer_query":"  Test Customer A  ","reference_ids":[12,12,0,-3,40],"parts_query":"","parts_statuses":["ordered","bogus","Approved"],"reply":"Here are the jobs."}` + "\n```")
	if err != nil {
		t.Fatal(err)
	}
	if out.Intent != askIntentCustomerJobs {
		t.Fatalf("intent = %q", out.Intent)
	}
	if out.CustomerQuery != "Test Customer A" {
		t.Fatalf("customer_query = %q", out.CustomerQuery)
	}
	if len(out.ReferenceIDs) != 2 || out.ReferenceIDs[0] != 12 || out.ReferenceIDs[1] != 40 {
		t.Fatalf("reference_ids = %v", out.ReferenceIDs)
	}
	if len(out.PartsStatuses) != 2 || out.PartsStatuses[0] != "ordered" || out.PartsStatuses[1] != "approved" {
		t.Fatalf("parts_statuses = %v", out.PartsStatuses)
	}
	if out.Reply != "Here are the jobs." {
		t.Fatalf("reply = %q", out.Reply)
	}
}

func TestParseAskInterpretOutputNormalizes(t *testing.T) {
	ids := make([]string, 0, 80)
	for i := 1; i <= 80; i++ {
		ids = append(ids, itoa(i))
	}
	long := strings.Repeat("x", 500)
	out, err := parseAskInterpretOutput(`{"intent":"DROP TABLE","customer_query":"` + long + `","reference_ids":[` + strings.Join(ids, ",") + `],"reply":"` + long + `"}`)
	if err != nil {
		t.Fatal(err)
	}
	if out.Intent != askIntentUnknown {
		t.Fatalf("unknown intent should map to unknown, got %q", out.Intent)
	}
	if len([]rune(out.CustomerQuery)) != askMaxString {
		t.Fatalf("customer_query not capped: %d", len(out.CustomerQuery))
	}
	if len(out.ReferenceIDs) != askMaxReferenceIDs {
		t.Fatalf("reference_ids not capped: %d", len(out.ReferenceIDs))
	}
	if out.ReferenceIDs == nil || out.PartsStatuses == nil {
		t.Fatal("slices must be non-nil for JSON")
	}
}

func TestParseAskInterpretOutputRejectsJunk(t *testing.T) {
	for _, raw := range []string{"", "sorry, no", `{"intent": 5}`, `{"reference_ids":"12"}`} {
		if _, err := parseAskInterpretOutput(raw); err == nil {
			t.Fatalf("%q: want error", raw)
		}
	}
}

func TestAskSystemPromptMarker(t *testing.T) {
	p := askSystemPrompt()
	if !strings.Contains(p, "classify a repair-shop management request") {
		t.Fatal("system prompt must contain the marker phrase")
	}
	for _, intent := range []string{"customer_jobs", "update_jobs", "parts_requests", "charges_summary", "unknown"} {
		if !strings.Contains(p, intent) {
			t.Fatalf("prompt missing intent %q", intent)
		}
	}
}

func TestAskInterpretHandler(t *testing.T) {
	var gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		gotBody = string(raw)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"model":   "mock-model",
			"choices": []map[string]any{{"message": map[string]any{"content": `{"intent":"update_jobs","customer_query":"","reference_ids":[7],"parts_query":"","parts_statuses":[],"reply":"I will preview the change."}`}}},
		})
	}))
	t.Cleanup(srv.Close)
	useMockLLM(t, srv)
	router := aiToolsRouter(t, searchStub())
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/ask/interpret", `{"message":"set job 7 to finished"}`, []string{permUpdate})
	if resp.Code != http.StatusOK {
		t.Fatalf("got %d %s", resp.Code, resp.Body.String())
	}
	var body askInterpretResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Intent != askIntentUpdateJobs || len(body.ReferenceIDs) != 1 || body.ReferenceIDs[0] != 7 || body.Model != "mock-model" {
		t.Fatalf("body = %+v", body)
	}
	if !strings.Contains(gotBody, "set job 7 to finished") {
		t.Fatalf("prompt should carry the message: %s", gotBody)
	}
}

func TestAskInterpretHandlerBadLLMOutput(t *testing.T) {
	useMockLLM(t, mockLLMServer(t, "no json here"))
	router := aiToolsRouter(t, searchStub())
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/ask/interpret", `{"message":"hello"}`, []string{permUpdate})
	if resp.Code != http.StatusBadGateway {
		t.Fatalf("got %d %s", resp.Code, resp.Body.String())
	}
}

func TestAskInterpretValidation(t *testing.T) {
	useMockLLM(t, mockLLMServer(t, `{}`))
	router := aiToolsRouter(t, searchStub())
	for _, payload := range []string{`{"message":"   "}`, `{}`, `nope`, `{"message":"` + strings.Repeat("a", aiToolsMaxTextChars+1) + `"}`} {
		resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/ask/interpret", payload, []string{permUpdate})
		if resp.Code != http.StatusBadRequest {
			t.Fatalf("%.40s: got %d %s", payload, resp.Code, resp.Body.String())
		}
	}
}

func TestAskInterpretForbiddenWithoutPermission(t *testing.T) {
	useMockLLM(t, mockLLMServer(t, `{}`))
	router := aiToolsRouter(t, searchStub())
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/ask/interpret", `{"message":"hello"}`, []string{"work_orders:read"})
	if resp.Code != http.StatusForbidden {
		t.Fatalf("got %d %s", resp.Code, resp.Body.String())
	}
}

