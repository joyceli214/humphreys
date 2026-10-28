package mailer

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestSanitizeEmailHTMLKeepsOnlySafeFormatting(t *testing.T) {
	dirty := `<h1 style="color:red">Title</h1><p onclick="x()">Hi <strong>there</strong> <u>u</u> <em>e</em><img src=x onerror=alert(1)></p>` +
		`<script>alert("x")</script><style>p{}</style><ul><li>a</li></ul><ol><li>b</li></ol><hr><br/>` +
		`<a href="javascript:alert(1)">bad</a><a href="https://ok.example/?a=1&amp;b=2" target="_blank">ok</a>` +
		`<a href="mailto:a@b.co">m</a><a href="tel:+1416">t</a>`

	got := SanitizeEmailHTML(dirty)
	want := `Title<p>Hi <strong>there</strong> <u>u</u> <em>e</em></p><ul><li>a</li></ul><ol><li>b</li></ol><hr><br>` +
		`<a>bad</a><a href="https://ok.example/?a=1&amp;b=2">ok</a><a href="mailto:a@b.co">m</a><a href="tel:+1416">t</a>`
	if got != want {
		t.Fatalf("unexpected sanitized html\n got: %s\nwant: %s", got, want)
	}
}

func TestSanitizeEmailHTMLEscapesText(t *testing.T) {
	got := SanitizeEmailHTML(`<p>1 &lt; 2 &amp; "quotes"</p>`)
	if got != `<p>1 &lt; 2 &amp; &#34;quotes&#34;</p>` {
		t.Fatalf("unexpected escaping: %s", got)
	}
}

func TestHasVisibleText(t *testing.T) {
	if HasVisibleText(`<p></p><p><br></p><script>hi</script>`) {
		t.Fatal("expected empty html to have no visible text")
	}
	if !HasVisibleText(`<p>Hi</p>`) {
		t.Fatal("expected text")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// sendAndCapture runs Send against a fake Microsoft endpoint and returns the sendMail payload.
func sendAndCapture(t *testing.T, msg Message) map[string]any {
	t.Helper()
	var captured map[string]any
	client := &GraphClient{
		tenantID: "tenant", clientID: "client", clientSecret: "secret", senderEmail: "shop@example.com",
		httpClient: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			if strings.Contains(r.URL.Host, "login.microsoftonline.com") {
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"access_token":"fake"}`)), Header: http.Header{}}, nil
			}
			if !strings.HasSuffix(r.URL.Path, "/sendMail") {
				t.Fatalf("unexpected request to %s", r.URL)
			}
			if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
				t.Fatalf("decode payload: %v", err)
			}
			return &http.Response{StatusCode: http.StatusAccepted, Body: io.NopCloser(strings.NewReader("")), Header: http.Header{}}, nil
		})},
	}
	if err := client.Send(context.Background(), msg); err != nil {
		t.Fatalf("send: %v", err)
	}
	return captured
}

func payloadBody(t *testing.T, payload map[string]any) (string, string) {
	t.Helper()
	message := payload["message"].(map[string]any)
	body := message["body"].(map[string]any)
	return body["contentType"].(string), body["content"].(string)
}

func TestSendUsesSanitizedBodyHTML(t *testing.T) {
	payload := sendAndCapture(t, Message{
		To:       "customer@example.com",
		Subject:  "Job #31225 started",
		Body:     "Hi there (plain fallback)",
		BodyHTML: `<p>Hi <strong>Janice</strong>,</p><ul><li>Item</li></ul><hr><p>Phone: <a href="tel:+14169233777" class="x">+1 416-923-3777</a><script>bad()</script></p>`,
	})
	contentType, content := payloadBody(t, payload)
	if contentType != "HTML" {
		t.Fatalf("expected HTML content type, got %s", contentType)
	}
	for _, want := range []string{
		`<strong>Janice</strong>`,
		`<ul style="margin:0 0 12px 0;padding-left:24px;"><li>Item</li></ul>`,
		`<hr style=`,
		`<a href="tel:+14169233777">+1 416-923-3777</a>`,
	} {
		if !strings.Contains(content, want) {
			t.Fatalf("expected %q in content, got %s", want, content)
		}
	}
	if strings.Contains(content, "script") || strings.Contains(content, "plain fallback") || strings.Contains(content, `class=`) {
		t.Fatalf("unexpected content: %s", content)
	}
}

func TestSendFallsBackToMarkdownBodyWhenHTMLEmpty(t *testing.T) {
	payload := sendAndCapture(t, Message{To: "c@example.com", Subject: "s", Body: "Call [416](tel:+1416)", BodyHTML: "<p></p>"})
	contentType, content := payloadBody(t, payload)
	if contentType != "HTML" || content != `<p>Call <a href="tel:+1416">416</a></p>` {
		t.Fatalf("unexpected fallback body %s %s", contentType, content)
	}
}
