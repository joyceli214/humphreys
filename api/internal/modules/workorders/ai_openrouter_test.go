package workorders

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"humphreys/api/internal/modules/aisettings"

	"github.com/gin-gonic/gin"
)

func TestOpenRouterSummaryRequest(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/chat/completions" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		var payload struct {
			Reasoning map[string]any `json:"reasoning"`
			MaxTokens int            `json:"max_tokens"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
		}
		if payload.Reasoning["exclude"] != true {
			t.Errorf("reasoning.exclude = %v", payload.Reasoning["exclude"])
		}
		if _, exists := payload.Reasoning["enabled"]; exists {
			t.Error("reasoning.enabled must be absent")
		}
		if payload.MaxTokens != 2000 {
			t.Errorf("max_tokens = %d; want 2000", payload.MaxTokens)
		}
		fmt.Fprint(w, `{"choices":[{"message":{"content":"Summary text"},"finish_reason":"stop"}]}`)
	}))
	defer server.Close()
	t.Setenv("OPENROUTER_BASE_URL", server.URL)
	client := server.Client()
	client.Timeout = 25 * time.Second
	h := &Handler{httpClient: client}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/", nil)
	text, err := h.generateOpenRouterSummaryOnce(c, aisettings.Settings{OpenRouterAPIKey: "test-key", OpenRouterModel: "test-model"}, "prompt")
	if err != nil || text != "Summary text" {
		t.Fatalf("got %q, %v", text, err)
	}
	if client.Timeout != 25*time.Second {
		t.Fatal("shared client timeout changed")
	}
}

func TestOpenRouterEmptyLengthRetriesWithLargerBudget(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempt := calls.Add(1)
		var payload openRouterChatRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
		}
		want := 2000
		if attempt == 2 {
			want = 4000
		}
		if payload.MaxTokens != want {
			t.Errorf("attempt %d: max_tokens = %d; want %d", attempt, payload.MaxTokens, want)
		}
		if attempt == 1 {
			fmt.Fprint(w, `{"choices":[{"message":{"content":""},"finish_reason":"length"}]}`)
			return
		}
		fmt.Fprint(w, `{"choices":[{"message":{"content":"Recovered summary"},"finish_reason":"stop"}]}`)
	}))
	defer server.Close()
	t.Setenv("OPENROUTER_BASE_URL", server.URL)
	h := &Handler{httpClient: server.Client()}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/", nil)
	start := time.Now()
	text, err := h.generateOpenRouterSummaryOnce(c, aisettings.Settings{}, "prompt")
	if err != nil || text != "Recovered summary" {
		t.Fatalf("got %q, %v", text, err)
	}
	if calls.Load() != 2 {
		t.Fatalf("calls = %d; want 2", calls.Load())
	}
	if time.Since(start) < time.Second {
		t.Error("retry did not wait one second")
	}
}

func TestOpenRouterCreditsExhaustedDoesNotRetry(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusPaymentRequired)
		fmt.Fprint(w, `{"error":{"message":"Insufficient credits"}}`)
	}))
	defer server.Close()
	t.Setenv("OPENROUTER_BASE_URL", server.URL)
	h := &Handler{httpClient: server.Client()}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/", nil)
	_, err := h.generateOpenRouterSummaryOnce(c, aisettings.Settings{}, "prompt")
	var provider *openRouterError
	if !errors.As(err, &provider) || provider.StatusCode != http.StatusPaymentRequired {
		t.Fatalf("expected typed 402 error, got %v", err)
	}
	if calls.Load() != 1 {
		t.Fatalf("calls = %d; want 1", calls.Load())
	}
	if got := aiErrorMessage(err); got != "AI credits exhausted. Please top up OpenRouter credits." {
		t.Fatalf("unexpected error message: %q", got)
	}
}
