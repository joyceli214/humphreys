package workorders

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestEmailBlankTokens(t *testing.T) {
	got := emailBlankTokens("Hi {Name},\n{{customer_name}} {Qty} and {Qty} {not\nblank} {}" + " {" + strings.Repeat("a", 61) + "}")
	want := map[string]int{"{Name}": 1, "{Qty}": 2}
	if len(got) != len(want) {
		t.Fatalf("tokens = %v", got)
	}
	for k, v := range want {
		if got[k] != v {
			t.Fatalf("tokens = %v", got)
		}
	}
	if !sameBlankTokens("a {X} b {Y}", "{Y} reworded {X}") {
		t.Fatal("same multiset in a different order should match")
	}
	if sameBlankTokens("{X} {X}", "{X}") || sameBlankTokens("{X}", "{x}") || sameBlankTokens("{X}", "{X} {Z}") {
		t.Fatal("changed blanks must not match")
	}
}

func TestEmailRewriteSystemPrompt(t *testing.T) {
	p := emailRewriteSystemPrompt()
	if !strings.Contains(p, "rewrite a repair-shop email") {
		t.Fatal("system prompt must contain the marker phrase")
	}
	for _, rule := range []string{"prices", "dates", "part numbers", "names"} {
		if !strings.Contains(p, rule) {
			t.Fatalf("prompt should forbid inventing %s", rule)
		}
	}
}

func rewriteLLM(t *testing.T, body string, gotPrompt *string) {
	t.Helper()
	content, _ := json.Marshal(map[string]string{"body": body})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		if gotPrompt != nil {
			*gotPrompt = string(raw)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"model":   "mock-model",
			"choices": []map[string]any{{"message": map[string]any{"content": string(content)}}},
		})
	}))
	t.Cleanup(srv.Close)
	useMockLLM(t, srv)
}

func TestEmailRewriteKeepsBlanks(t *testing.T) {
	var prompt string
	rewriteLLM(t, "Hello {Name},\n\nThe part {Part for #7} is needed. Qty {Qty}.\n\nThanks", &prompt)
	router := aiToolsRouter(t, searchStub())
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/email-rewrite",
		`{"action":"fix_grammar","subject":"Parts","body":"hi {Name}, need {Part for #7} qty {Qty} thx"}`, []string{permUpdate})
	if resp.Code != http.StatusOK {
		t.Fatalf("got %d %s", resp.Code, resp.Body.String())
	}
	var body emailRewriteResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(body.Body, "{Part for #7}") || body.Model != "mock-model" {
		t.Fatalf("body = %+v", body)
	}
	if !strings.Contains(prompt, "need {Part for #7}") {
		t.Fatalf("prompt should carry the body: %s", prompt)
	}
}

func TestEmailRewriteRejectsChangedBlanks(t *testing.T) {
	rewriteLLM(t, "Hello Sam, the part is a 10uF capacitor. Qty 2.", nil)
	router := aiToolsRouter(t, searchStub())
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/email-rewrite",
		`{"action":"more_detail","subject":"","body":"hi {Name}, need {Part for #7} qty {Qty}"}`, []string{permUpdate})
	if resp.Code != http.StatusUnprocessableEntity {
		t.Fatalf("got %d %s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), "AI changed the blanks; try again") {
		t.Fatalf("error = %s", resp.Body.String())
	}
}

func TestEmailRewriteValidation(t *testing.T) {
	rewriteLLM(t, "x", nil)
	router := aiToolsRouter(t, searchStub())
	for _, payload := range []string{
		`{"action":"delete_everything","body":"hi"}`,
		`{"action":"","body":"hi"}`,
		`{"action":"shorter","body":"   "}`,
		`{"action":"shorter","body":"` + strings.Repeat("a", emailRewriteMaxBody+1) + `"}`,
		`{"action":"shorter","subject":"` + strings.Repeat("a", emailRewriteMaxSubject+1) + `","body":"hi"}`,
		`nope`,
	} {
		resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/email-rewrite", payload, []string{permUpdate})
		if resp.Code != http.StatusBadRequest {
			t.Fatalf("%.50s: got %d %s", payload, resp.Code, resp.Body.String())
		}
	}
	for _, action := range []string{"fix_grammar", "more_detail", "shorter", "friendlier"} {
		if !emailRewriteActions[action] {
			t.Fatalf("action %q should be allowed", action)
		}
	}
}

func TestEmailRewriteForbiddenWithoutPermission(t *testing.T) {
	rewriteLLM(t, "x", nil)
	router := aiToolsRouter(t, searchStub())
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/email-rewrite", `{"action":"shorter","body":"hi"}`, []string{"work_orders:read"})
	if resp.Code != http.StatusForbidden {
		t.Fatalf("got %d %s", resp.Code, resp.Body.String())
	}
}
