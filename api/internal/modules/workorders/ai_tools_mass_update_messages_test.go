package workorders

import (
	"errors"
	"net/http"
	"strings"
	"testing"
)

// User-facing Mass Update messages are full, capitalised sentences.

func TestMassUpdateUserFacingMessages(t *testing.T) {
	if want := "This job was changed after the preview was created. Preview again before applying."; massUpdateStaleMessage != want {
		t.Fatalf("stale message = %q, want %q", massUpdateStaleMessage, want)
	}
	if want := "This job's preview timestamp is missing. Preview again before applying."; massUpdateMissingVersionMessage != want {
		t.Fatalf("missing-version message = %q, want %q", massUpdateMissingVersionMessage, want)
	}
	cases := map[error]string{
		errors.New("boom"):   "The changes could not be applied.",
		ErrWorkOrderNotFound: "Job not found.",
		ErrLineItemNotFound:  "Line item not found.",
		ErrLocationNotFound:  "Location not found.",
		ErrMassUpdateStale:   massUpdateStaleMessage,
	}
	for err, want := range cases {
		if got := applyErrorMessage(err); got != want {
			t.Fatalf("applyErrorMessage(%v) = %q, want %q", err, got, want)
		}
	}
}

func TestMassUpdatePreviewEmptyInstructionMessage(t *testing.T) {
	router := aiToolsRouter(t, massUpdateStub())
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/preview",
		`{"instruction":"   "}`, []string{permUpdate})
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("empty instruction: got %d", resp.Code)
	}
	if msg, want := errorBody(t, resp.Body.Bytes()), "Describe what should change."; msg != want {
		t.Fatalf("error = %q, want %q", msg, want)
	}
}

func TestMassUpdateApplyNoOperationsMessage(t *testing.T) {
	router := aiToolsRouter(t, massUpdateStub())
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/apply",
		`{"operations":[],"expected_updated_at":{}}`, []string{permUpdate})
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("no operations: got %d", resp.Code)
	}
	if msg, want := errorBody(t, resp.Body.Bytes()), "There are no changes to apply."; msg != want {
		t.Fatalf("error = %q, want %q", msg, want)
	}
}

func TestMassUpdatePreviewOverCapMessage(t *testing.T) {
	srv := mockLLMServer(t, `{"operations":`+opsJSON(seq(massUpdateJobCap+1), 1)+`}`)
	useMockLLM(t, srv)
	router := aiToolsRouter(t, massUpdateStub())
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/preview",
		`{"instruction":"set labour everywhere"}`, []string{permUpdate})
	msg := errorBody(t, resp.Body.Bytes())
	if !strings.HasPrefix(msg, "The AI's suggested changes could not be previewed: ") {
		t.Fatalf("error = %q", msg)
	}
}
