package workorders

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"humphreys/api/internal/domain"
)

// multiJobEmailStub has two jobs for Jane (customer 1), one for Bob (customer 2)
// and one for Nora (customer 3) who has no email on file.
func multiJobEmailStub() *aiToolsStub {
	jane := domain.WorkOrderCustomer{CustomerID: ptrInt64(1), FirstName: ptrStr("Jane"), LastName: ptrStr("Doe"), Email: ptrStr("jane@example.com")}
	bob := domain.WorkOrderCustomer{CustomerID: ptrInt64(2), FirstName: ptrStr("Bob"), Email: ptrStr("bob@example.com")}
	nora := domain.WorkOrderCustomer{CustomerID: ptrInt64(3), FirstName: ptrStr("Nora")}
	return &aiToolsStub{
		details: map[int]domain.WorkOrderDetail{
			5: {ReferenceID: 5, StatusName: ptrStr("Finished"), ItemName: ptrStr("Receiver"), Customer: jane,
				LineItems: []domain.WorkOrderLineItem{{LineItemID: 1, ItemName: ptrStr("Fuse"), UnitPrice: ptrFloat(12.5)}}},
			6: {ReferenceID: 6, StatusName: ptrStr("In Progress"), ItemName: ptrStr("Turntable"), Customer: jane},
			7: {ReferenceID: 7, StatusName: ptrStr("Received"), ItemName: ptrStr("Amplifier"), Customer: bob},
			8: {ReferenceID: 8, StatusName: ptrStr("Finished"), ItemName: ptrStr("Tape deck"), Customer: nora},
		},
		repairLogs: map[int][]domain.RepairLog{
			5: {{Details: "Replaced blown fuse and tested."}},
			6: {{Details: "Cleaned tonearm bearings."}},
		},
	}
}

const multiDraftLLM = `{"subject":"Update on jobs #5 and #6","body":"Hi Jane,\n\nUpdates.\n\nHumphreys Stereo and TV"}`

func postEmailDraft(t *testing.T, body string, perms []string) (int, map[string]any, string) {
	t.Helper()
	router := aiToolsRouter(t, multiJobEmailStub())
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/email-draft", body, perms)
	var out map[string]any
	_ = json.Unmarshal(resp.Body.Bytes(), &out)
	return resp.Code, out, resp.Body.String()
}

func TestEmailDraftMultiJobSameCustomer(t *testing.T) {
	useMockLLM(t, mockLLMServer(t, multiDraftLLM))
	code, out, raw := postEmailDraft(t, `{"work_order_ids":[5,6],"type":"progress_update"}`, []string{permUpdate})
	if code != http.StatusOK {
		t.Fatalf("multi draft: got %d %s", code, raw)
	}
	ids, _ := out["work_order_ids"].([]any)
	if len(ids) != 2 || ids[0].(float64) != 5 || ids[1].(float64) != 6 {
		t.Fatalf("work_order_ids = %v", out["work_order_ids"])
	}
	if out["customer_name"] != "Jane Doe" || out["has_recipient_email"] != true || out["recipient_hint"] != "j***@example.com" {
		t.Fatalf("recipient metadata wrong: %v", out)
	}
	if strings.Contains(raw, "jane@example.com") {
		t.Fatalf("full customer email leaked: %s", raw)
	}
}

func TestEmailDraftMultiJobRejectsDifferentCustomers(t *testing.T) {
	useMockLLM(t, mockLLMServer(t, multiDraftLLM))
	code, out, raw := postEmailDraft(t, `{"work_order_ids":[5,7],"type":"estimate"}`, []string{permUpdate})
	if code != http.StatusBadRequest || !strings.Contains(fmt.Sprint(out["error"]), "different customers") {
		t.Fatalf("different customers: got %d %s", code, raw)
	}
}

func TestEmailDraftMultiJobRejectsTooMany(t *testing.T) {
	useMockLLM(t, mockLLMServer(t, multiDraftLLM))
	code, _, raw := postEmailDraft(t, `{"work_order_ids":[1,2,3,4,5,6,7,8,9,10,11],"type":"estimate"}`, []string{permUpdate})
	if code != http.StatusBadRequest || !strings.Contains(raw, "10") {
		t.Fatalf(">10 jobs: got %d %s", code, raw)
	}
}

func TestEmailDraftMultiJobRejectsEmptyAndMissing(t *testing.T) {
	useMockLLM(t, mockLLMServer(t, multiDraftLLM))
	if code, _, raw := postEmailDraft(t, `{"work_order_ids":[],"type":"estimate"}`, []string{permUpdate}); code != http.StatusBadRequest {
		t.Fatalf("empty ids: got %d %s", code, raw)
	}
	if code, _, raw := postEmailDraft(t, `{"work_order_ids":[5,999],"type":"estimate"}`, []string{permUpdate}); code != http.StatusNotFound {
		t.Fatalf("missing job: got %d %s", code, raw)
	}
}

func TestEmailDraftMultiJobStaffForbidden(t *testing.T) {
	code, _, raw := postEmailDraft(t, `{"work_order_ids":[5,6],"type":"estimate"}`, []string{permStatusUpdate, permRead})
	if code != http.StatusForbidden {
		t.Fatalf("staff multi draft: got %d %s", code, raw)
	}
}

func TestEmailDraftSingleIDBackCompat(t *testing.T) {
	useMockLLM(t, mockLLMServer(t, multiDraftLLM))
	code, out, raw := postEmailDraft(t, `{"work_order_id":5,"type":"estimate"}`, []string{permUpdate})
	if code != http.StatusOK {
		t.Fatalf("single id: got %d %s", code, raw)
	}
	ids, _ := out["work_order_ids"].([]any)
	if len(ids) != 1 || ids[0].(float64) != 5 || out["subject"] == "" {
		t.Fatalf("single id response wrong: %v", out)
	}
}

func TestEmailDraftNoEmailOnFile(t *testing.T) {
	useMockLLM(t, mockLLMServer(t, multiDraftLLM))
	code, out, raw := postEmailDraft(t, `{"work_order_ids":[8],"type":"ready_for_pickup"}`, []string{permUpdate})
	if code != http.StatusOK {
		t.Fatalf("no email draft: got %d %s", code, raw)
	}
	if out["has_recipient_email"] != false || out["recipient_hint"] != "" {
		t.Fatalf("expected no recipient: %v", out)
	}
}

func TestBuildMultiJobEmailPrompt(t *testing.T) {
	stub := multiJobEmailStub()
	items := []domain.WorkOrderDetail{stub.details[5], stub.details[6]}
	logs := [][]domain.RepairLog{stub.repairLogs[5], stub.repairLogs[6]}
	prompt := buildMultiJobEmailDraftPrompt(emailDraftTypeProgress, "be brief", items, logs)
	for _, want := range []string{"Job #5", "Job #6", "Receiver", "Turntable", "Fuse: $12.50", "Cleaned tonearm", "Finished", "In Progress", "be brief", "Do not invent prices"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q:\n%s", want, prompt)
		}
	}
	if strings.Contains(prompt, "jane@example.com") {
		t.Fatal("prompt must not contain the customer email")
	}
}

func TestMaskEmailHint(t *testing.T) {
	cases := map[string]string{
		"jane@gmail.com": "j***@gmail.com",
		" J@x.ca ":       "J***@x.ca",
		"":               "",
		"not-an-email":   "",
		"@nolocal.com":   "",
	}
	for in, want := range cases {
		if got := maskEmailHint(in); got != want {
			t.Errorf("maskEmailHint(%q) = %q, want %q", in, got, want)
		}
	}
}
