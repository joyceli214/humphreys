package workorders

import (
	"context"
	"net/http"
	"testing"

	"humphreys/api/internal/mailer"
	"humphreys/api/internal/middleware"

	"github.com/gin-gonic/gin"
)

// fakeSender records every message instead of sending it.
type fakeSender struct {
	sent []mailer.Message
}

func (f *fakeSender) Send(_ context.Context, msg mailer.Message) error {
	f.sent = append(f.sent, msg)
	return nil
}

// emailFlowRouter wires the AI Tools routes and the regular work-order routes
// (which include POST /work-orders/:id/customer-email) to one handler that
// uses the fake sender.
func emailFlowRouter(t *testing.T, sender *fakeSender) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	group := router.Group("", middleware.Auth("test-secret"))
	h := &Handler{service: NewService(multiJobEmailStub()), httpClient: &http.Client{}, emailClient: sender}
	RegisterAIToolsRoutes(group, h)
	RegisterRoutes(group, h)
	return router
}

var ownerPerms = []string{permRead, permUpdate, permSensitiveRead}

func TestEmailDraftNeverSends(t *testing.T) {
	useMockLLM(t, mockLLMServer(t, multiDraftLLM))
	sender := &fakeSender{}
	router := emailFlowRouter(t, sender)
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/email-draft",
		`{"work_order_ids":[5,6],"type":"progress_update"}`, ownerPerms)
	if resp.Code != http.StatusOK {
		t.Fatalf("draft: got %d %s", resp.Code, resp.Body.String())
	}
	if len(sender.sent) != 0 {
		t.Fatalf("draft must not send, sent %d", len(sender.sent))
	}
}

func TestCustomerEmailSendsOnceToServerSideRecipient(t *testing.T) {
	sender := &fakeSender{}
	router := emailFlowRouter(t, sender)
	// The AI Tools tab sends no "to": the recipient comes from the customer record.
	resp := partsAuditRequest(t, router, http.MethodPost, "/work-orders/5/customer-email",
		`{"template":"job_started","subject":"Update on jobs #5 and #6","body":"Hi Jane"}`, ownerPerms)
	if resp.Code != http.StatusOK {
		t.Fatalf("send: got %d %s", resp.Code, resp.Body.String())
	}
	if len(sender.sent) != 1 {
		t.Fatalf("want exactly 1 send, got %d", len(sender.sent))
	}
	msg := sender.sent[0]
	if msg.To != "jane@example.com" || msg.Subject != "Update on jobs #5 and #6" || msg.Body != "Hi Jane" {
		t.Fatalf("unexpected message: %+v", msg)
	}
	if len(msg.Attachments) != 0 {
		t.Fatalf("no attachments expected, got %d", len(msg.Attachments))
	}
}

func TestCustomerEmailBlockedWhenNoEmailOnFile(t *testing.T) {
	sender := &fakeSender{}
	router := emailFlowRouter(t, sender)
	resp := partsAuditRequest(t, router, http.MethodPost, "/work-orders/8/customer-email",
		`{"template":"job_completed","subject":"Ready","body":"Hi Nora"}`, ownerPerms)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("no email: got %d %s", resp.Code, resp.Body.String())
	}
	if len(sender.sent) != 0 {
		t.Fatalf("must not send without an email on file, sent %d", len(sender.sent))
	}
}
