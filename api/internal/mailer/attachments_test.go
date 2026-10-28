package mailer

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
)

type graphCall struct {
	Method, URL, ContentRange, Auth string
	Body                            []byte
}

// fakeGraph imitates Microsoft's token, draft, attachment, upload-session and send endpoints.
type fakeGraph struct {
	mu        sync.Mutex
	calls     []graphCall
	uploadURL string
	failOn    string
}

func (f *fakeGraph) client() *GraphClient {
	return &GraphClient{
		tenantID: "tenant", clientID: "client", clientSecret: "secret", senderEmail: "shop@example.com",
		httpClient: &http.Client{Transport: roundTripFunc(f.roundTrip)},
	}
}

func (f *fakeGraph) roundTrip(r *http.Request) (*http.Response, error) {
	var body []byte
	if r.Body != nil {
		body, _ = io.ReadAll(r.Body)
	}
	f.mu.Lock()
	f.calls = append(f.calls, graphCall{Method: r.Method, URL: r.URL.String(), ContentRange: r.Header.Get("Content-Range"), Auth: r.Header.Get("Authorization"), Body: body})
	f.mu.Unlock()
	respond := func(status int, payload string) (*http.Response, error) {
		return &http.Response{StatusCode: status, Status: fmt.Sprintf("%d", status), Body: io.NopCloser(strings.NewReader(payload)), Header: http.Header{}}, nil
	}
	path := r.URL.Path
	switch {
	case strings.Contains(r.URL.Host, "login.microsoftonline.com"):
		return respond(200, `{"access_token":"fake"}`)
	case f.failOn != "" && strings.HasSuffix(path, f.failOn) && r.Method == http.MethodPost:
		return respond(500, `{"error":"boom"}`)
	case r.Method == http.MethodPost && strings.HasSuffix(path, "/users/shop@example.com/messages"):
		return respond(201, `{"id":"draft-1"}`)
	case r.Method == http.MethodPost && strings.HasSuffix(path, "/attachments/createUploadSession"):
		return respond(201, fmt.Sprintf(`{"uploadUrl":%q}`, f.uploadURL))
	case r.Method == http.MethodPost && strings.HasSuffix(path, "/attachments"):
		return respond(201, `{"id":"att"}`)
	case r.Method == http.MethodPut:
		return respond(200, `{}`)
	case r.Method == http.MethodPost && strings.HasSuffix(path, "/send"):
		return respond(202, ``)
	case r.Method == http.MethodDelete:
		return respond(204, ``)
	case strings.HasSuffix(path, "/sendMail"):
		return respond(202, ``)
	}
	return respond(404, `{}`)
}

func (f *fakeGraph) summary() []string {
	out := []string{}
	for _, call := range f.calls {
		if strings.Contains(call.URL, "login.microsoftonline.com") {
			continue
		}
		u := strings.TrimPrefix(call.URL, "https://graph.microsoft.com/v1.0/users/shop@example.com")
		out = append(out, call.Method+" "+u)
	}
	return out
}

func TestSendWithoutAttachmentsStillUsesSendMail(t *testing.T) {
	fake := &fakeGraph{}
	if err := fake.client().Send(context.Background(), Message{To: "c@example.com", Subject: "s", Body: "hi"}); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(fake.summary(), "|"); got != "POST /sendMail" {
		t.Fatalf("unexpected calls %s", got)
	}
}

func TestSendWithAttachmentsCreatesDraftAttachesAndSends(t *testing.T) {
	fake := &fakeGraph{uploadURL: "https://outlook.office.com/api/v2.0/Users('x')/Messages('draft-1')/AttachmentSessions('s')?authtoken=abc"}
	small := []byte("small-jpeg-bytes")
	large := []byte(strings.Repeat("x", inlineAttachmentMaxBytes+uploadChunkBytes+10))
	err := fake.client().Send(context.Background(), Message{
		To: "c@example.com", Subject: "Job #1", BodyHTML: "<p>Hi</p>",
		Attachments: []Attachment{
			{Name: "job-1-photo-1.jpg", ContentType: "image/jpeg", Data: small},
			{Name: "job-1-photo-2.jpg", ContentType: "image/jpeg", Data: large},
		},
	})
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	want := []string{
		"POST /messages",
		"POST /messages/draft-1/attachments",
		"POST /messages/draft-1/attachments/createUploadSession",
		"PUT " + fake.uploadURL,
		"PUT " + fake.uploadURL,
		"POST /messages/draft-1/send",
	}
	if got := fake.summary(); strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("unexpected calls:\n%s", strings.Join(got, "\n"))
	}

	var draft map[string]any
	_ = json.Unmarshal(fake.calls[1].Body, &draft)
	body := draft["body"].(map[string]any)
	if body["contentType"] != "HTML" || !strings.Contains(body["content"].(string), "<p style=\"margin:0 0 12px 0;\">Hi</p>") {
		t.Fatalf("draft should keep the HTML body: %v", body)
	}
	var attachment map[string]any
	_ = json.Unmarshal(fake.calls[2].Body, &attachment)
	decoded, _ := base64.StdEncoding.DecodeString(attachment["contentBytes"].(string))
	if attachment["@odata.type"] != "#microsoft.graph.fileAttachment" || attachment["name"] != "job-1-photo-1.jpg" || string(decoded) != string(small) {
		t.Fatalf("unexpected small attachment: %v", attachment)
	}
	var session map[string]map[string]any
	_ = json.Unmarshal(fake.calls[3].Body, &session)
	if session["AttachmentItem"]["size"].(float64) != float64(len(large)) {
		t.Fatalf("unexpected upload session: %v", session)
	}
	first, second := fake.calls[4], fake.calls[5]
	if first.ContentRange != fmt.Sprintf("bytes 0-%d/%d", uploadChunkBytes-1, len(large)) ||
		second.ContentRange != fmt.Sprintf("bytes %d-%d/%d", uploadChunkBytes, len(large)-1, len(large)) {
		t.Fatalf("unexpected ranges %q %q", first.ContentRange, second.ContentRange)
	}
	if first.Auth != "" || len(first.Body)+len(second.Body) != len(large) {
		t.Fatal("chunk upload must not send the bearer token and must send every byte")
	}
}

func TestSendWithAttachmentsDeletesDraftOnFailure(t *testing.T) {
	fake := &fakeGraph{failOn: "/attachments"}
	err := fake.client().Send(context.Background(), Message{To: "c@example.com", Subject: "s", Body: "hi",
		Attachments: []Attachment{{Name: "a.jpg", ContentType: "image/jpeg", Data: []byte("x")}}})
	if err == nil {
		t.Fatal("expected error")
	}
	got := fake.summary()
	if got[len(got)-1] != "DELETE /messages/draft-1" {
		t.Fatalf("expected draft cleanup, got %v", got)
	}
}

func TestUploadSessionRejectsNonMicrosoftURL(t *testing.T) {
	fake := &fakeGraph{uploadURL: "http://169.254.169.254/latest"}
	err := fake.client().Send(context.Background(), Message{To: "c@example.com", Subject: "s", Body: "hi",
		Attachments: []Attachment{{Name: "big.jpg", ContentType: "image/jpeg", Data: make([]byte, inlineAttachmentMaxBytes+1)}}})
	if err == nil || !strings.Contains(err.Error(), "unexpected upload url") {
		t.Fatalf("expected rejection, got %v", err)
	}
	for _, call := range fake.calls {
		if call.Method == http.MethodPut {
			t.Fatal("must not upload to a non-Microsoft URL")
		}
	}
}
