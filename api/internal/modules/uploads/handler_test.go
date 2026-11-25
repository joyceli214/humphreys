package uploads

import (
	"bytes"
	"context"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"humphreys/api/internal/middleware"
	authsecurity "humphreys/api/internal/modules/auth/security"

	"github.com/gin-gonic/gin"
)

type recordedRequest struct {
	Method, Path, Authorization, CopySource, ContentType string
	Body                                                 []byte
}

// fakeS3 answers like a minimal S3 and records every request.
type fakeS3 struct {
	mu       sync.Mutex
	requests []recordedRequest
	objects  map[string][]byte
	// copyStatus/copyBody control the answer to a CopyObject request.
	copyStatus int
	copyBody   string
}

func (f *fakeS3) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	f.mu.Lock()
	f.requests = append(f.requests, recordedRequest{
		Method: r.Method, Path: r.URL.Path, Authorization: r.Header.Get("Authorization"),
		CopySource: r.Header.Get("X-Amz-Copy-Source"), ContentType: r.Header.Get("Content-Type"), Body: body,
	})
	f.mu.Unlock()
	switch {
	case r.Method == http.MethodPut && r.Header.Get("X-Amz-Copy-Source") != "":
		w.WriteHeader(f.copyStatus)
		_, _ = w.Write([]byte(f.copyBody))
	case r.Method == http.MethodPut:
		f.objects[r.URL.Path] = body
		w.WriteHeader(http.StatusOK)
	case r.Method == http.MethodGet:
		data, ok := f.objects[r.URL.Path]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write(data)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

func newTestHandler(t *testing.T, s3 *fakeS3) *Handler {
	t.Helper()
	srv := httptest.NewServer(s3)
	t.Cleanup(srv.Close)
	return &Handler{
		httpClient:      srv.Client(),
		endpoint:        strings.TrimPrefix(srv.URL, "http://"),
		accessKeyID:     "AK",
		secretAccessKey: "SK",
		region:          "us-east-1",
		bucket:          "bkt",
		useSSL:          false,
		enabled:         true,
	}
}

func TestCopyObjectAsksStorageToCopyWithoutDownloading(t *testing.T) {
	s3 := &fakeS3{objects: map[string][]byte{}, copyStatus: http.StatusOK, copyBody: "<CopyObjectResult/>"}
	h := newTestHandler(t, s3)

	if err := h.copyObject(context.Background(), "markdown-temp/u1/old photo.jpg", "markdown/42/new.jpg"); err != nil {
		t.Fatal(err)
	}
	if len(s3.requests) != 1 {
		t.Fatalf("expected a single server-side copy request, got %d: %+v", len(s3.requests), s3.requests)
	}
	req := s3.requests[0]
	if req.Method != http.MethodPut || req.Path != "/bkt/markdown/42/new.jpg" {
		t.Fatalf("unexpected request: %+v", req)
	}
	if req.CopySource != "/bkt/markdown-temp/u1/old%20photo.jpg" {
		t.Fatalf("copy source must be the URL-encoded source key, got %q", req.CopySource)
	}
	if !strings.Contains(req.Authorization, "SignedHeaders=host;x-amz-content-sha256;x-amz-copy-source;x-amz-date,") {
		t.Fatalf("x-amz-copy-source must be part of the signature: %s", req.Authorization)
	}
	if len(req.Body) != 0 {
		t.Fatalf("a server-side copy has no body, got %d bytes", len(req.Body))
	}
}

func TestCopyObjectFallsBackWhenStorageCannotCopy(t *testing.T) {
	for name, tc := range map[string]struct {
		status int
		body   string
	}{
		"not implemented":    {http.StatusNotImplemented, "<Error><Code>NotImplemented</Code></Error>"},
		"error inside a 200": {http.StatusOK, "<Error><Code>InternalError</Code></Error>"},
		"access denied":      {http.StatusForbidden, "<Error><Code>AccessDenied</Code></Error>"},
	} {
		t.Run(name, func(t *testing.T) {
			photo := []byte("\xff\xd8\xff-fake-jpeg-bytes")
			s3 := &fakeS3{objects: map[string][]byte{"/bkt/markdown-temp/u1/a.jpg": photo}, copyStatus: tc.status, copyBody: tc.body}
			h := newTestHandler(t, s3)

			if err := h.copyObject(context.Background(), "markdown-temp/u1/a.jpg", "markdown/42/b.jpg"); err != nil {
				t.Fatalf("fallback copy should succeed: %v", err)
			}
			if got := s3.objects["/bkt/markdown/42/b.jpg"]; !bytes.Equal(got, photo) {
				t.Fatalf("fallback must upload the same bytes, got %q", got)
			}
		})
	}
}

func TestSigningWithoutExtraHeadersIsUnchanged(t *testing.T) {
	h := &Handler{endpoint: "s3.example", accessKeyID: "AK", secretAccessKey: "SK", region: "us-east-1", bucket: "bkt", useSSL: true}
	req, err := h.buildSignedRequest(context.Background(), http.MethodGet, "/bkt/a.jpg", nil, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if got := req.Header.Get("Authorization"); !strings.Contains(got, "SignedHeaders=host;x-amz-content-sha256;x-amz-date,") {
		t.Fatalf("regular requests must keep signing the same three headers: %s", got)
	}
}

func uploadRouter(t *testing.T, h *Handler) (*gin.Engine, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	const secret = "test-secret"
	token, _, err := authsecurity.NewAccessToken(secret, time.Minute, "user-1", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	r.Use(middleware.Auth(secret))
	r.POST("/upload", h.UploadMarkdownImage)
	return r, token
}

func multipartBody(t *testing.T, filename string, size int) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, err := w.CreateFormFile("file", filename)
	if err != nil {
		t.Fatal(err)
	}
	// A PNG signature followed by padding, so it is detected as an image.
	payload := append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, size)...)
	if _, err := part.Write(payload); err != nil {
		t.Fatal(err)
	}
	_ = w.Close()
	return &buf, w.FormDataContentType()
}

func TestUploadRejectsOversizedRequestBodyWith413(t *testing.T) {
	s3 := &fakeS3{objects: map[string][]byte{}}
	h := newTestHandler(t, s3)
	router, token := uploadRouter(t, h)

	body, contentType := multipartBody(t, "huge.png", int(maxUploadRequestBytes)+1024)
	req := httptest.NewRequest(http.MethodPost, "/upload", body)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(s3.requests) != 0 {
		t.Fatalf("nothing must be stored for a rejected upload, got %+v", s3.requests)
	}
}

func TestUploadStoresNormalImage(t *testing.T) {
	s3 := &fakeS3{objects: map[string][]byte{}}
	h := newTestHandler(t, s3)
	router, token := uploadRouter(t, h)

	body, contentType := multipartBody(t, "ok.png", 200_000)
	req := httptest.NewRequest(http.MethodPost, "/upload", body)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(s3.requests) != 1 || s3.requests[0].Method != http.MethodPut || len(s3.requests[0].Body) != 200_000+8 {
		t.Fatalf("expected the full image to be stored once: %+v", s3.requests)
	}
}
