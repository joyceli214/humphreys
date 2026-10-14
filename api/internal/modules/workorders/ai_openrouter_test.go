package workorders

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"humphreys/api/internal/modules/aisettings"

	"github.com/gin-gonic/gin"
)

func TestOpenRouterSummaryRequest(t *testing.T) {
	// Exercise the default even when the developer has configured a fallback.
	t.Setenv("OPENROUTER_FALLBACK_MODEL", "")
	if err := os.Unsetenv("OPENROUTER_FALLBACK_MODEL"); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/chat/completions" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		var payload struct {
			Reasoning map[string]any `json:"reasoning"`
			Model     string         `json:"model"`
			Models    []string       `json:"models"`
			Provider  map[string]any `json:"provider"`
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
		if payload.Model != "test-model" {
			t.Errorf("model = %q; want test-model", payload.Model)
		}
		if want := []string{"test-model", "google/gemini-2.5-flash"}; !reflect.DeepEqual(payload.Models, want) {
			t.Errorf("models = %v; want %v", payload.Models, want)
		}
		if payload.Provider["data_collection"] != "deny" {
			t.Errorf("provider.data_collection = %v; want deny", payload.Provider["data_collection"])
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
	text, model, err := h.generateOpenRouterSummaryOnce(c, aisettings.Settings{OpenRouterAPIKey: "test-key", OpenRouterModel: "test-model"}, "prompt")
	if err != nil || text != "Summary text" {
		t.Fatalf("got %q, %v", text, err)
	}
	if model != "test-model" {
		t.Fatalf("model = %q; want test-model when response omits model", model)
	}
	if client.Timeout != 25*time.Second {
		t.Fatal("shared client timeout changed")
	}
}

func TestOpenRouterEmptyLengthRetriesWithLargerBudget(t *testing.T) {
	setOpenRouterTestBackoffs(t, [2]time.Duration{5 * time.Millisecond, 10 * time.Millisecond})
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempt := calls.Add(1)
		var payload openRouterChatRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
		}
		want := 2000 << (attempt - 1)
		if payload.MaxTokens != want {
			t.Errorf("attempt %d: max_tokens = %d; want %d", attempt, payload.MaxTokens, want)
		}
		if attempt < 3 {
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
	text, _, err := h.generateOpenRouterSummaryOnce(c, aisettings.Settings{}, "prompt")
	if err != nil || text != "Recovered summary" {
		t.Fatalf("got %q, %v", text, err)
	}
	if calls.Load() != 3 {
		t.Fatalf("calls = %d; want 3", calls.Load())
	}
	if time.Since(start) < 15*time.Millisecond {
		t.Error("retries did not wait for both backoffs")
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
	_, _, err := h.generateOpenRouterSummaryOnce(c, aisettings.Settings{}, "prompt")
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

func setOpenRouterTestBackoffs(t *testing.T, backoffs [2]time.Duration) {
	t.Helper()
	original := openRouterRetryBackoffs
	openRouterRetryBackoffs = backoffs
	t.Cleanup(func() { openRouterRetryBackoffs = original })
}

type openRouterTestTransport func(*http.Request) (*http.Response, error)

func (transport openRouterTestTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	return transport(r)
}

type openRouterTestBody struct {
	io.ReadCloser
	closed chan struct{}
}

func (body *openRouterTestBody) Close() error {
	err := body.ReadCloser.Close()
	close(body.closed)
	return err
}

func TestOpenRouterFallbackConfiguration(t *testing.T) {
	for _, tc := range []struct {
		name     string
		fallback string
		models   []string
	}{
		{name: "none", fallback: "none"},
		{name: "case insensitive none", fallback: " NoNe "},
		{name: "empty", fallback: ""},
		{name: "same as primary", fallback: "test-model"},
		{name: "custom", fallback: " custom/fallback ", models: []string{"test-model", "custom/fallback"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("OPENROUTER_FALLBACK_MODEL", tc.fallback)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var payload map[string]json.RawMessage
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
					t.Error(err)
				}
				if tc.models == nil {
					if _, exists := payload["models"]; exists {
						t.Error("models must be omitted when fallback is disabled or equals primary")
					}
				} else {
					var models []string
					if err := json.Unmarshal(payload["models"], &models); err != nil {
						t.Error(err)
					}
					if !reflect.DeepEqual(models, tc.models) {
						t.Errorf("models = %v; want %v", models, tc.models)
					}
				}
				var provider openRouterProvider
				if err := json.Unmarshal(payload["provider"], &provider); err != nil {
					t.Error(err)
				}
				if provider.DataCollection != "deny" {
					t.Errorf("provider.data_collection = %q; want deny", provider.DataCollection)
				}
				fmt.Fprint(w, `{"choices":[{"message":{"content":"Summary text"}}]}`)
			}))
			defer server.Close()
			t.Setenv("OPENROUTER_BASE_URL", server.URL)
			h := &Handler{httpClient: server.Client()}
			_, _, err := h.generateOpenRouterTextAttempt(context.Background(), aisettings.Settings{OpenRouterModel: "test-model"}, "system", "prompt", 2000)
			if err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestOpenRouterRetryableResponses(t *testing.T) {
	setOpenRouterTestBackoffs(t, [2]time.Duration{})
	for _, tc := range []struct {
		name       string
		status     int
		body       string
		incomplete bool
		disconnect bool
	}{
		{name: "rate limited", status: http.StatusTooManyRequests, body: `{"error":{"message":"busy"}}`},
		{name: "server error", status: http.StatusInternalServerError},
		{name: "service unavailable", status: http.StatusServiceUnavailable},
		{name: "empty body", status: http.StatusOK},
		{name: "no choices", status: http.StatusOK, body: `{"choices":[]}`},
		{name: "unexpected EOF", status: http.StatusOK, body: `{"choices":`, incomplete: true},
		{name: "connection lost", disconnect: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if calls.Add(1) == 1 {
					if tc.disconnect {
						conn, _, err := w.(http.Hijacker).Hijack()
						if err != nil {
							t.Error(err)
							return
						}
						conn.Close()
						return
					}
					if tc.incomplete {
						w.Header().Set("Content-Length", "100")
					}
					w.WriteHeader(tc.status)
					fmt.Fprint(w, tc.body)
					return
				}
				fmt.Fprint(w, `{"model":"google/gemini-2.5-flash","choices":[{"message":{"content":"Recovered summary"}}]}`)
			}))
			defer server.Close()
			t.Setenv("OPENROUTER_BASE_URL", server.URL)
			h := &Handler{httpClient: server.Client()}
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/", nil)
			text, model, err := h.generateOpenRouterSummaryOnce(c, aisettings.Settings{OpenRouterModel: "test-model"}, "prompt")
			if err != nil || text != "Recovered summary" || model != "google/gemini-2.5-flash" {
				t.Fatalf("got %q, model %q, %v", text, model, err)
			}
			if calls.Load() != 2 {
				t.Fatalf("calls = %d; want 2", calls.Load())
			}
		})
	}
}

func TestOpenRouterTimeoutRetries(t *testing.T) {
	setOpenRouterTestBackoffs(t, [2]time.Duration{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"choices":[{"message":{"content":"Recovered summary"}}]}`)
	}))
	defer server.Close()
	t.Setenv("OPENROUTER_BASE_URL", server.URL)
	client := server.Client()
	originalTransport := client.Transport
	var attempts atomic.Int32
	client.Transport = openRouterTestTransport(func(r *http.Request) (*http.Response, error) {
		if attempts.Add(1) == 1 {
			return nil, context.DeadlineExceeded
		}
		return originalTransport.RoundTrip(r)
	})
	h := &Handler{httpClient: client}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/", nil)
	text, _, err := h.generateOpenRouterSummaryOnce(c, aisettings.Settings{}, "prompt")
	if err != nil || text != "Recovered summary" || attempts.Load() != 2 {
		t.Fatalf("got %q, %v, attempts = %d; want success after 2 attempts", text, err, attempts.Load())
	}
}

func TestOpenRouterRetriesStopAfterThreeAttempts(t *testing.T) {
	setOpenRouterTestBackoffs(t, [2]time.Duration{})
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer server.Close()
	t.Setenv("OPENROUTER_BASE_URL", server.URL)
	h := &Handler{httpClient: server.Client()}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/", nil)
	_, _, err := h.generateOpenRouterSummaryOnce(c, aisettings.Settings{}, "prompt")
	var provider *openRouterError
	if !errors.As(err, &provider) || provider.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("expected typed 429 error, got %v", err)
	}
	if calls.Load() != 3 {
		t.Fatalf("calls = %d; want 3", calls.Load())
	}
	if got := aiErrorMessage(err); got != "AI is busy (rate limited). Please try again in a minute." {
		t.Fatalf("unexpected error message: %q", got)
	}
}

func TestOpenRouterContextCancelDuringBackoff(t *testing.T) {
	setOpenRouterTestBackoffs(t, [2]time.Duration{time.Hour, time.Hour})
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer server.Close()
	t.Setenv("OPENROUTER_BASE_URL", server.URL)
	h := &Handler{httpClient: server.Client()}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	// Finish the first attempt synchronously so cancellation occurs during the wait.
	originalTransport := h.httpClient.Transport
	responseRead := make(chan struct{})
	h.httpClient.Transport = openRouterTestTransport(func(r *http.Request) (*http.Response, error) {
		res, err := originalTransport.RoundTrip(r)
		if err == nil {
			res.Body = &openRouterTestBody{ReadCloser: res.Body, closed: responseRead}
		}
		return res, err
	})
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/", nil).WithContext(ctx)
	result := make(chan error, 1)
	go func() {
		_, _, err := h.generateOpenRouterSummaryOnce(c, aisettings.Settings{}, "prompt")
		result <- err
	}()
	select {
	case <-responseRead:
	case <-time.After(time.Second):
		t.Fatal("first attempt did not finish")
	}
	time.Sleep(10 * time.Millisecond)
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("expected context cancellation, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("cancellation did not interrupt backoff")
	}
	if calls.Load() != 1 {
		t.Fatalf("calls = %d; want 1", calls.Load())
	}
}

func TestOpenRouterRetryAfterOverridesBackoff(t *testing.T) {
	setOpenRouterTestBackoffs(t, [2]time.Duration{time.Hour, time.Hour})
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		fmt.Fprint(w, `{"choices":[{"message":{"content":"Summary text"}}]}`)
	}))
	defer server.Close()
	t.Setenv("OPENROUTER_BASE_URL", server.URL)
	h := &Handler{httpClient: server.Client()}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/", nil).WithContext(ctx)
	text, _, err := h.generateOpenRouterSummaryOnce(c, aisettings.Settings{}, "prompt")
	if err != nil || text != "Summary text" || calls.Load() != 2 {
		t.Fatalf("got %q, %v, calls = %d; want success after 2 calls", text, err, calls.Load())
	}
}

func TestOpenRouterRetryAfter(t *testing.T) {
	now := time.Date(2026, time.October, 13, 12, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name  string
		value string
		want  time.Duration
		valid bool
	}{
		{name: "seconds", value: "3", want: 3 * time.Second, valid: true},
		{name: "zero", value: "0", valid: true},
		{name: "seconds capped", value: "300", want: 10 * time.Second, valid: true},
		{name: "date", value: now.Add(4 * time.Second).Format(http.TimeFormat), want: 4 * time.Second, valid: true},
		{name: "date capped", value: now.Add(time.Minute).Format(http.TimeFormat), want: 10 * time.Second, valid: true},
		{name: "past date", value: now.Add(-time.Minute).Format(http.TimeFormat), valid: true},
		{name: "absent"},
		{name: "invalid", value: "invalid"},
		{name: "negative", value: "-1"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			delay := parseOpenRouterRetryAfter(tc.value, now)
			if (delay != nil) != tc.valid {
				t.Fatalf("delay = %v; valid = %v", delay, tc.valid)
			}
			if delay != nil && *delay != tc.want {
				t.Fatalf("delay = %s; want %s", *delay, tc.want)
			}
		})
	}
}

func TestOpenRouterAnsweredModelInMarkdownMetadata(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"model":"google/gemini-2.5-flash","choices":[{"message":{"content":"Generated markdown"}}]}`)
	}))
	defer server.Close()
	t.Setenv("OPENROUTER_BASE_URL", server.URL)
	t.Setenv("OPENROUTER_API_KEY", "test-key")
	t.Setenv("OPENROUTER_MODEL", "test-model")
	h := &Handler{httpClient: server.Client()}
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"field":"work_done","prompt":"Describe the repair"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	h.GenerateAIMarkdownWithoutWorkOrder(c)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d; body = %s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Markdown string `json:"markdown"`
		Model    string `json:"model"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Markdown != "Generated markdown" || response.Model != "google/gemini-2.5-flash" {
		t.Fatalf("unexpected response: %+v", response)
	}
}
