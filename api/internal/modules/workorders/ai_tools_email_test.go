package workorders

import (
	"encoding/json"
	"net/http"
	"testing"

	"humphreys/api/internal/domain"
)

func emailDraftStub() *aiToolsStub {
	return &aiToolsStub{
		details: map[int]domain.WorkOrderDetail{
			5: {
				ReferenceID: 5,
				StatusName:  ptrStr("Finished"),
				ItemName:    ptrStr("Receiver"),
				Customer:    domain.WorkOrderCustomer{FirstName: ptrStr("Jane"), LastName: ptrStr("Doe"), Email: ptrStr("jane@example.com")},
				LineItems: []domain.WorkOrderLineItem{
					{LineItemID: 1, ItemName: ptrStr("Fuse"), UnitPrice: ptrFloat(12.5)},
				},
			},
		},
		repairLogs: map[int][]domain.RepairLog{
			5: {{Details: "Replaced blown fuse and tested."}},
		},
	}
}

func TestEmailDraft(t *testing.T) {
	srv := mockLLMServer(t, `{"subject":"Your receiver is ready","body":"Hi Jane,\n\nYour receiver is ready for pickup.\n\nHumphreys Stereo and TV"}`)
	useMockLLM(t, srv)

	router := aiToolsRouter(t, emailDraftStub())
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/email-draft",
		`{"work_order_id":5,"type":"ready_for_pickup","notes":"ready to collect"}`, []string{permUpdate})
	if resp.Code != http.StatusOK {
		t.Fatalf("draft: got %d %s", resp.Code, resp.Body.String())
	}
	var body emailDraftResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Subject == "" || body.Body == "" {
		t.Fatalf("draft incomplete: %+v", body)
	}
	if body.Type != emailDraftTypePickup || body.Model != "mock-model" {
		t.Fatalf("draft metadata wrong: %+v", body)
	}
}

func TestEmailDraftBadType(t *testing.T) {
	srv := mockLLMServer(t, `{"subject":"x","body":"y"}`)
	useMockLLM(t, srv)
	router := aiToolsRouter(t, emailDraftStub())
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/email-draft",
		`{"work_order_id":5,"type":"nonsense"}`, []string{permUpdate})
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("bad type: got %d %s", resp.Code, resp.Body.String())
	}
}

func TestEmailDraftMissingJob(t *testing.T) {
	srv := mockLLMServer(t, `{"subject":"x","body":"y"}`)
	useMockLLM(t, srv)
	router := aiToolsRouter(t, emailDraftStub())
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/email-draft",
		`{"work_order_id":999,"type":"estimate"}`, []string{permUpdate})
	if resp.Code != http.StatusNotFound {
		t.Fatalf("missing job: got %d %s", resp.Code, resp.Body.String())
	}
}

func TestEmailDraftStaffForbidden(t *testing.T) {
	router := aiToolsRouter(t, emailDraftStub())
	if resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/email-draft",
		`{"work_order_id":5,"type":"estimate"}`, []string{permStatusUpdate}); resp.Code != http.StatusForbidden {
		t.Fatalf("staff draft: got %d, want 403", resp.Code)
	}
}
