package workorders

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"humphreys/api/internal/domain"
)

// recordingLLMServer answers like mockLLMServer but keeps every request body so
// tests can assert what was (and was not) sent to the model.
func recordingLLMServer(t *testing.T, content string) (*httptest.Server, func() string) {
	t.Helper()
	var mu sync.Mutex
	var bodies []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		mu.Lock()
		bodies = append(bodies, string(raw))
		mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{
			"model":   "mock-model",
			"choices": []map[string]any{{"message": map[string]any{"content": content}}},
		})
	}))
	t.Cleanup(srv.Close)
	return srv, func() string {
		mu.Lock()
		defer mu.Unlock()
		return strings.Join(bodies, "\n")
	}
}

// captureLog redirects the standard logger for the test's duration.
func captureLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	prev := log.Writer()
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(prev) })
	return &buf
}

func TestEmailDraftCustomerEmailAbsentWithoutSensitivePermission(t *testing.T) {
	useMockLLM(t, mockLLMServer(t, multiDraftLLM))
	code, out, raw := postEmailDraft(t, `{"work_order_ids":[5,6],"type":"progress_update"}`, []string{permRead, permUpdate})
	if code != http.StatusOK {
		t.Fatalf("draft: got %d %s", code, raw)
	}
	if _, ok := out["customer_email"]; ok {
		t.Fatalf("customer_email must be omitted without %s: %s", permSensitiveRead, raw)
	}
	if strings.Contains(raw, "jane@example.com") {
		t.Fatalf("full email leaked: %s", raw)
	}
}

func TestEmailDraftCustomerEmailAbsentWithSensitiveButNoUpdate(t *testing.T) {
	// The route itself requires work_orders:update; without it nothing is returned.
	code, out, raw := postEmailDraft(t, `{"work_order_ids":[5],"type":"estimate"}`, []string{permRead, permSensitiveRead})
	if code != http.StatusForbidden {
		t.Fatalf("want 403, got %d %s", code, raw)
	}
	if _, ok := out["customer_email"]; ok {
		t.Fatalf("customer_email leaked on 403: %s", raw)
	}
}

func TestEmailDraftCustomerEmailPresentWithSensitivePermission(t *testing.T) {
	useMockLLM(t, mockLLMServer(t, multiDraftLLM))
	code, out, raw := postEmailDraft(t, `{"work_order_ids":[5,6],"type":"progress_update"}`, ownerPerms)
	if code != http.StatusOK {
		t.Fatalf("draft: got %d %s", code, raw)
	}
	if out["customer_email"] != "jane@example.com" {
		t.Fatalf("customer_email = %v, want jane@example.com", out["customer_email"])
	}
	if _, ok := out["customer_email_mixed"]; ok {
		t.Fatalf("customer_email_mixed should be omitted for one customer: %s", raw)
	}
}

func TestEmailDraftCustomerEmailOmittedWhenNoneOnFile(t *testing.T) {
	useMockLLM(t, mockLLMServer(t, multiDraftLLM))
	code, out, raw := postEmailDraft(t, `{"work_order_ids":[8],"type":"ready_for_pickup"}`, ownerPerms)
	if code != http.StatusOK {
		t.Fatalf("draft: got %d %s", code, raw)
	}
	if _, ok := out["customer_email"]; ok {
		t.Fatalf("customer_email should be omitted when none on file: %s", raw)
	}
}

func TestEmailDraftCustomerEmailNotInLLMPromptOrLogs(t *testing.T) {
	srv, sent := recordingLLMServer(t, multiDraftLLM)
	useMockLLM(t, srv)
	logs := captureLog(t)
	stub := multiJobEmailStub()
	router := aiToolsRouter(t, stub)
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/email-draft",
		`{"work_order_ids":[5,6],"type":"progress_update","notes":"be brief"}`, ownerPerms)
	if resp.Code != http.StatusOK {
		t.Fatalf("draft: got %d %s", resp.Code, resp.Body.String())
	}
	prompt := sent()
	if !strings.Contains(prompt, "be brief") {
		t.Fatalf("recording server did not capture the prompt: %q", prompt)
	}
	if strings.Contains(prompt, "jane@example.com") || strings.Contains(prompt, "customer_email") {
		t.Fatalf("customer email reached the LLM prompt:\n%s", prompt)
	}
	if strings.Contains(logs.String(), "jane@example.com") {
		t.Fatalf("customer email logged:\n%s", logs.String())
	}
	// Drafting writes no audit (mass update apply is the only AI Tools audit path).
	if len(stub.applyCalls) != 0 {
		t.Fatalf("draft must not write audit rows, got apply calls %v", stub.applyCalls)
	}
}

func TestEmailDraftAuditPayloadNeverCarriesCustomerEmail(t *testing.T) {
	// The only AI Tools audit payload is the mass update metadata; it is built
	// from an op's before/after and has no customer email field.
	raw, err := massUpdateAuditMetadata(massUpdateAuditEntry{ReferenceID: 5, Op: massOpSetStatus,
		Before: map[string]any{"status": "Received"}, After: map[string]any{"status": "Finished"}})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "email") {
		t.Fatalf("audit metadata mentions email: %s", raw)
	}
}

func TestEmailDraftRecipientHelper(t *testing.T) {
	stub := multiJobEmailStub()
	jane1, jane2, bob, nora := stub.details[5], stub.details[6], stub.details[7], stub.details[8]

	cases := []struct {
		name      string
		items     []domain.WorkOrderDetail
		wantEmail string
		wantMixed bool
	}{
		{"single", []domain.WorkOrderDetail{jane1}, "jane@example.com", false},
		{"same customer", []domain.WorkOrderDetail{jane1, jane2}, "jane@example.com", false},
		{"mixed uses first", []domain.WorkOrderDetail{bob, jane1}, "bob@example.com", true},
		{"no email on file", []domain.WorkOrderDetail{nora}, "", false},
		{"empty", nil, "", false},
	}
	for _, tc := range cases {
		email, mixed := emailDraftRecipient(tc.items)
		if email != tc.wantEmail || mixed != tc.wantMixed {
			t.Errorf("%s: got (%q,%v), want (%q,%v)", tc.name, email, mixed, tc.wantEmail, tc.wantMixed)
		}
	}

	invalid := jane1
	invalid.Customer.Email = ptrStr("not-an-email")
	if email, _ := emailDraftRecipient([]domain.WorkOrderDetail{invalid}); email != "" {
		t.Errorf("invalid address should yield empty, got %q", email)
	}
}
