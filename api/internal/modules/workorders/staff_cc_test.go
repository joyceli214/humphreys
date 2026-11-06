package workorders

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"strings"
	"testing"
	"time"

	"humphreys/api/internal/domain"
	"humphreys/api/internal/emailphotos"
	"humphreys/api/internal/middleware"

	"github.com/gin-gonic/gin"
)

var testStaff = []StaffContact{
	{ID: "u1", Email: "Dave@Humphreys.test", FullName: "Dave"},
	{ID: "u2", Email: "amy@humphreys.test", FullName: "Amy"},
}

// staffEmailStub adds the staff directory to the multi-job email stub.
type staffEmailStub struct {
	*aiToolsStub
	staff    []StaffContact
	staffErr error
	calls    int
}

func (s *staffEmailStub) ListActiveStaffContacts(context.Context) ([]StaffContact, error) {
	s.calls++
	return s.staff, s.staffErr
}

// photoStore serves "managed:<key>" tokens from markdown as stored photos.
type photoStore struct{ objects map[string][]byte }

func (f *photoStore) Enabled() bool { return true }
func (f *photoStore) ManagedImageKeys(markdown string) []string {
	var keys []string
	for _, field := range strings.Fields(markdown) {
		if strings.HasPrefix(field, "managed:") {
			keys = append(keys, strings.TrimPrefix(field, "managed:"))
		}
	}
	return keys
}
func (f *photoStore) GetObjectBytes(_ context.Context, key string) ([]byte, string, error) {
	data, ok := f.objects[key]
	if !ok {
		return nil, "", errors.New("missing")
	}
	return data, "image/png", nil
}
func (f *photoStore) PresignedGetURL(key string, _ time.Duration) (string, error) {
	return "https://storage.example/" + key + "?sig=1", nil
}

func tinyPNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 4, 3))
	for x := 0; x < 4; x++ {
		for y := 0; y < 3; y++ {
			img.Set(x, y, color.RGBA{R: 200, G: 80, B: 20, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func staffEmailRouter(t *testing.T, stub *staffEmailStub, sender *fakeSender, store emailphotos.Store) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	group := router.Group("", middleware.Auth("test-secret"))
	h := &Handler{service: NewService(stub), httpClient: &http.Client{}, emailClient: sender}
	if store != nil {
		h.emailPhotos = emailphotos.NewService(store)
	}
	RegisterAIToolsRoutes(group, h)
	RegisterRoutes(group, h)
	return router
}

func newStaffEmailStub() *staffEmailStub {
	base := multiJobEmailStub()
	base.repairLogs[5] = append(base.repairLogs[5], domain.RepairLog{Details: "Bench photo managed:markdown-images/5/front.png"})
	base.repairLogs[6] = append(base.repairLogs[6], domain.RepairLog{Details: "managed:markdown-images/6/other.png"})
	return &staffEmailStub{aiToolsStub: base, staff: testStaff}
}

func TestResolveStaffCc(t *testing.T) {
	for _, tc := range []struct {
		name    string
		in      []string
		to      string
		want    []string
		wantErr error
	}{
		{name: "empty", in: nil, want: []string{}},
		{name: "case-insensitive match keeps directory spelling", in: []string{"dave@humphreys.test"}, want: []string{"Dave@Humphreys.test"}},
		{name: "dedupes and skips blanks", in: []string{"amy@humphreys.test", " ", "AMY@humphreys.test"}, want: []string{"amy@humphreys.test"}},
		{name: "drops the To address", in: []string{"amy@humphreys.test"}, to: "Amy@humphreys.test", want: []string{}},
		{name: "outside address rejected", in: []string{"someone@gmail.com"}, wantErr: ErrCcNotStaff},
		{name: "display-name form rejected", in: []string{"Dave <dave@humphreys.test>"}, wantErr: ErrCcNotStaff},
		{name: "garbage rejected", in: []string{"not an email"}, wantErr: ErrCcNotStaff},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := resolveStaffCc(tc.in, testStaff, tc.to)
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("err = %v, want %v", err, tc.wantErr)
			}
			if tc.wantErr != nil {
				return
			}
			if strings.Join(got, ",") != strings.Join(tc.want, ",") {
				t.Fatalf("got %v want %v", got, tc.want)
			}
		})
	}
}

func TestResolveStaffCcCapsCount(t *testing.T) {
	staff := make([]StaffContact, 0, MaxCustomerEmailCc+1)
	requested := make([]string, 0, MaxCustomerEmailCc+1)
	for i := 0; i <= MaxCustomerEmailCc; i++ {
		email := string(rune('a'+i)) + "@humphreys.test"
		staff = append(staff, StaffContact{Email: email})
		requested = append(requested, email)
	}
	if _, err := resolveStaffCc(requested, staff, ""); !errors.Is(err, ErrTooManyCc) {
		t.Fatalf("want ErrTooManyCc, got %v", err)
	}
}

func TestCustomerEmailCcStaffIsSent(t *testing.T) {
	stub := newStaffEmailStub()
	sender := &fakeSender{}
	router := staffEmailRouter(t, stub, sender, nil)
	resp := partsAuditRequest(t, router, http.MethodPost, "/work-orders/5/customer-email",
		`{"template":"job_started","subject":"Update","body":"Hi Jane","cc":["dave@humphreys.test","amy@humphreys.test"]}`, ownerPerms)
	if resp.Code != http.StatusOK {
		t.Fatalf("send: got %d %s", resp.Code, resp.Body.String())
	}
	if len(sender.sent) != 1 {
		t.Fatalf("want 1 send, got %d", len(sender.sent))
	}
	msg := sender.sent[0]
	if msg.To != "jane@example.com" || strings.Join(msg.Cc, ",") != "Dave@Humphreys.test,amy@humphreys.test" {
		t.Fatalf("unexpected recipients: to=%q cc=%v", msg.To, msg.Cc)
	}
}

func TestCustomerEmailRejectsNonStaffCc(t *testing.T) {
	stub := newStaffEmailStub()
	sender := &fakeSender{}
	router := staffEmailRouter(t, stub, sender, nil)
	resp := partsAuditRequest(t, router, http.MethodPost, "/work-orders/5/customer-email",
		`{"template":"job_started","subject":"Update","body":"Hi","cc":["dave@humphreys.test","attacker@evil.test"]}`, ownerPerms)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d %s", resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), "staff") {
		t.Fatalf("error should mention staff: %s", resp.Body.String())
	}
	if len(sender.sent) != 0 {
		t.Fatalf("nothing must be sent, got %d", len(sender.sent))
	}
}

func TestCustomerEmailWithoutCcSkipsStaffLookup(t *testing.T) {
	stub := newStaffEmailStub()
	stub.staffErr = errors.New("db down")
	sender := &fakeSender{}
	router := staffEmailRouter(t, stub, sender, nil)
	resp := partsAuditRequest(t, router, http.MethodPost, "/work-orders/5/customer-email",
		`{"template":"job_started","subject":"Update","body":"Hi","cc":[]}`, ownerPerms)
	if resp.Code != http.StatusOK || stub.calls != 0 {
		t.Fatalf("got %d (staff calls %d) %s", resp.Code, stub.calls, resp.Body.String())
	}
	if len(sender.sent) != 1 || len(sender.sent[0].Cc) != 0 {
		t.Fatalf("unexpected send: %+v", sender.sent)
	}
}

func TestCustomerEmailAttachesJobPhotosWithCc(t *testing.T) {
	stub := newStaffEmailStub()
	sender := &fakeSender{}
	store := &photoStore{objects: map[string][]byte{
		"markdown-images/5/front.png": tinyPNG(t),
		"markdown-images/6/other.png": tinyPNG(t),
	}}
	router := staffEmailRouter(t, stub, sender, store)

	// The photo list for job 5 contains only job 5's photo.
	list := partsAuditRequest(t, router, http.MethodGet, "/work-orders/5/email-photos", "", ownerPerms)
	if list.Code != http.StatusOK {
		t.Fatalf("list: got %d %s", list.Code, list.Body.String())
	}
	var listed struct {
		Items []struct {
			ID     string `json:"id"`
			Source string `json:"source"`
		} `json:"items"`
	}
	if err := json.Unmarshal(list.Body.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed.Items) != 1 || listed.Items[0].ID != emailphotos.PhotoID("markdown-images/5/front.png") {
		t.Fatalf("listed = %+v", listed.Items)
	}

	body := `{"template":"job_completed","subject":"Done","body":"Hi Jane","cc":["amy@humphreys.test"],"photo_ids":["` + listed.Items[0].ID + `"]}`
	resp := partsAuditRequest(t, router, http.MethodPost, "/work-orders/5/customer-email", body, ownerPerms)
	if resp.Code != http.StatusOK {
		t.Fatalf("send: got %d %s", resp.Code, resp.Body.String())
	}
	if len(sender.sent) != 1 {
		t.Fatalf("want 1 send, got %d", len(sender.sent))
	}
	msg := sender.sent[0]
	if len(msg.Attachments) != 1 || len(msg.Cc) != 1 || msg.Cc[0] != "amy@humphreys.test" {
		t.Fatalf("unexpected message: attachments=%d cc=%v", len(msg.Attachments), msg.Cc)
	}
}

func TestCustomerEmailRejectsPhotoFromAnotherJob(t *testing.T) {
	stub := newStaffEmailStub()
	sender := &fakeSender{}
	store := &photoStore{objects: map[string][]byte{"markdown-images/6/other.png": tinyPNG(t)}}
	router := staffEmailRouter(t, stub, sender, store)
	otherJobPhoto := emailphotos.PhotoID("markdown-images/6/other.png")
	resp := partsAuditRequest(t, router, http.MethodPost, "/work-orders/5/customer-email",
		`{"template":"job_completed","subject":"Done","body":"Hi","photo_ids":["`+otherJobPhoto+`"]}`, ownerPerms)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d %s", resp.Code, resp.Body.String())
	}
	if len(sender.sent) != 0 {
		t.Fatalf("nothing must be sent")
	}
}

func TestCustomerEmailAttachesPhotosFromSameCustomerJobs(t *testing.T) {
	stub := newStaffEmailStub()
	stub.repairLogs[7] = []domain.RepairLog{{Details: "managed:markdown-images/7/bob.png"}}
	sender := &fakeSender{}
	store := &photoStore{objects: map[string][]byte{
		"markdown-images/5/front.png": tinyPNG(t),
		"markdown-images/6/other.png": tinyPNG(t),
		"markdown-images/7/bob.png":   tinyPNG(t),
	}}
	router := staffEmailRouter(t, stub, sender, store)
	job5 := emailphotos.PhotoID("markdown-images/5/front.png")
	job6 := emailphotos.PhotoID("markdown-images/6/other.png")
	bob := emailphotos.PhotoID("markdown-images/7/bob.png")

	// Job 6 is Jane's too: allowed when listed in photo_work_order_ids.
	resp := partsAuditRequest(t, router, http.MethodPost, "/work-orders/5/customer-email",
		`{"template":"job_completed","subject":"Done","body":"Hi","photo_work_order_ids":[5,6],"photo_ids":["`+job5+`","`+job6+`"]}`, ownerPerms)
	if resp.Code != http.StatusOK {
		t.Fatalf("same customer: got %d %s", resp.Code, resp.Body.String())
	}
	if len(sender.sent) != 1 || len(sender.sent[0].Attachments) != 2 {
		t.Fatalf("want 1 send with 2 attachments, got %+v", sender.sent)
	}

	// Job 7 belongs to Bob: rejected, nothing sent.
	resp = partsAuditRequest(t, router, http.MethodPost, "/work-orders/5/customer-email",
		`{"template":"job_completed","subject":"Done","body":"Hi","photo_work_order_ids":[7],"photo_ids":["`+bob+`"]}`, ownerPerms)
	if resp.Code != http.StatusBadRequest || !strings.Contains(resp.Body.String(), "same customer") {
		t.Fatalf("other customer: got %d %s", resp.Code, resp.Body.String())
	}
	if len(sender.sent) != 1 {
		t.Fatalf("other-customer photos must not send, sent %d", len(sender.sent))
	}
}

func TestEmailStaffRouteRequiresSensitiveRead(t *testing.T) {
	stub := newStaffEmailStub()
	router := staffEmailRouter(t, stub, &fakeSender{}, nil)
	if resp := partsAuditRequest(t, router, http.MethodGet, "/work-orders/email-staff", "", []string{permRead}); resp.Code != http.StatusForbidden {
		t.Fatalf("staff without sensitive read: got %d", resp.Code)
	}
	resp := partsAuditRequest(t, router, http.MethodGet, "/work-orders/email-staff", "", ownerPerms)
	if resp.Code != http.StatusOK {
		t.Fatalf("owner: got %d %s", resp.Code, resp.Body.String())
	}
	var out struct {
		Items []StaffContact `json:"items"`
		MaxCc int            `json:"max_cc"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Items) != 2 || out.MaxCc != MaxCustomerEmailCc {
		t.Fatalf("unexpected staff payload: %+v", out)
	}
}
