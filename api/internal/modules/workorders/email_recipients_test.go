package workorders

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"humphreys/api/internal/emailphotos"
)

// senderPerms can send customer email but cannot type outside addresses.
var senderPerms = []string{permRead, permSensitiveRead}

var testContacts = []CommonEmailContact{
	{ID: 1, Name: "Boss", Email: "boss@shop.test", Role: "boss", IsPinned: true},
	{ID: 2, Name: "Bookkeeper", Email: "books@shop.test", Role: "other"},
}

// staticDirectory is an in-memory recipientDirectory.
type staticDirectory struct {
	staff    []StaffContact
	contacts []CommonEmailContact
	err      error
}

func (d staticDirectory) Staff() ([]StaffContact, error) { return d.staff, d.err }
func (d staticDirectory) Contacts() ([]CommonEmailContact, error) {
	return d.contacts, d.err
}

func boolPtr(v bool) *bool { return &v }

func TestResolveCustomerEmailRecipients(t *testing.T) {
	dir := staticDirectory{staff: testStaff, contacts: testContacts}
	for _, tc := range []struct {
		name     string
		req      sendCustomerEmailRequest
		customer string
		canType  bool
		wantTo   []string
		wantCc   []string
		wantErr  error
	}{
		{name: "legacy empty to uses customer", req: sendCustomerEmailRequest{}, customer: "jane@example.com", wantTo: []string{"jane@example.com"}, wantCc: []string{}},
		{name: "legacy to equal to customer ok for staff", req: sendCustomerEmailRequest{To: "JANE@example.com"}, customer: "jane@example.com", wantTo: []string{"jane@example.com"}, wantCc: []string{}},
		{name: "legacy override forbidden for staff", req: sendCustomerEmailRequest{To: "other@example.com"}, customer: "jane@example.com", wantErr: ErrTypedRecipientForbidden},
		{name: "legacy override allowed for admin", req: sendCustomerEmailRequest{To: "other@example.com"}, customer: "jane@example.com", canType: true, wantTo: []string{"other@example.com"}, wantCc: []string{}},
		{name: "legacy override when no customer email for admin", req: sendCustomerEmailRequest{To: "other@example.com"}, canType: true, wantTo: []string{"other@example.com"}, wantCc: []string{}},
		{name: "legacy missing customer email", req: sendCustomerEmailRequest{}, wantErr: ErrCustomerEmailMissing},
		{name: "legacy cc staff keeps directory spelling and drops dupes", req: sendCustomerEmailRequest{Cc: []string{"dave@humphreys.test", " ", "DAVE@humphreys.test"}}, customer: "jane@example.com", wantTo: []string{"jane@example.com"}, wantCc: []string{"Dave@Humphreys.test"}},
		{name: "legacy cc common contact allowed for staff", req: sendCustomerEmailRequest{Cc: []string{"Boss@shop.test"}}, customer: "jane@example.com", wantTo: []string{"jane@example.com"}, wantCc: []string{"boss@shop.test"}},
		{name: "cc outside rejected for staff", req: sendCustomerEmailRequest{Cc: []string{"someone@gmail.com"}}, customer: "jane@example.com", wantErr: ErrCcNotStaff},
		{name: "cc display-name form rejected for staff", req: sendCustomerEmailRequest{Cc: []string{"Dave <dave@humphreys.test>"}}, customer: "jane@example.com", wantErr: ErrCcNotStaff},
		{name: "cc garbage rejected for admin", req: sendCustomerEmailRequest{CcEmails: []string{"not an email"}}, customer: "jane@example.com", canType: true, wantErr: ErrInvalidEmailFormat},
		{name: "cc outside allowed for admin", req: sendCustomerEmailRequest{CcEmails: []string{"someone@gmail.com"}}, customer: "jane@example.com", canType: true, wantTo: []string{"jane@example.com"}, wantCc: []string{"someone@gmail.com"}},
		{name: "cc drops the To address", req: sendCustomerEmailRequest{CcEmails: []string{"Jane@example.com"}}, customer: "jane@example.com", canType: true, wantTo: []string{"jane@example.com"}, wantCc: []string{}},
		{
			name:     "picker customer plus contacts",
			req:      sendCustomerEmailRequest{ToCustomer: boolPtr(true), ToContactIDs: []int64{1}, CcContactIDs: []int64{2, 1}, CcEmails: []string{"amy@humphreys.test"}},
			customer: "jane@example.com",
			wantTo:   []string{"jane@example.com", "boss@shop.test"},
			wantCc:   []string{"books@shop.test", "amy@humphreys.test"},
		},
		{name: "picker default includes customer", req: sendCustomerEmailRequest{CcContactIDs: []int64{1}}, customer: "jane@example.com", wantTo: []string{"jane@example.com"}, wantCc: []string{"boss@shop.test"}},
		{name: "picker contact only, customer off", req: sendCustomerEmailRequest{ToCustomer: boolPtr(false), ToContactIDs: []int64{2}}, wantTo: []string{"books@shop.test"}, wantCc: []string{}},
		{name: "picker customer off and nothing else", req: sendCustomerEmailRequest{ToCustomer: boolPtr(false), CcContactIDs: []int64{1}}, customer: "jane@example.com", wantErr: ErrNoToRecipient},
		{name: "picker customer on but missing email", req: sendCustomerEmailRequest{ToCustomer: boolPtr(true), ToContactIDs: []int64{1}}, wantErr: ErrCustomerEmailMissing},
		{name: "picker unknown or inactive contact", req: sendCustomerEmailRequest{CcContactIDs: []int64{99}}, customer: "jane@example.com", wantErr: ErrUnknownCommonContact},
		{name: "picker typed To forbidden for staff", req: sendCustomerEmailRequest{ToEmails: []string{"x@example.com"}}, customer: "jane@example.com", wantErr: ErrTypedRecipientForbidden},
		{name: "picker typed To allowed for admin", req: sendCustomerEmailRequest{ToCustomer: boolPtr(false), ToEmails: []string{"x@example.com"}}, canType: true, wantTo: []string{"x@example.com"}, wantCc: []string{}},
		{name: "picker typed To must be bare", req: sendCustomerEmailRequest{ToEmails: []string{"X <x@example.com>"}}, customer: "jane@example.com", canType: true, wantErr: ErrInvalidEmailFormat},
		{name: "picker rejects legacy to", req: sendCustomerEmailRequest{To: "x@example.com", ToCustomer: boolPtr(true)}, customer: "jane@example.com", canType: true, wantErr: ErrMixedRecipientFields},
	} {
		t.Run(tc.name, func(t *testing.T) {
			to, cc, err := resolveCustomerEmailRecipients(tc.req, tc.customer, tc.canType, dir)
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("err = %v, want %v", err, tc.wantErr)
			}
			if tc.wantErr != nil {
				return
			}
			if strings.Join(to, ",") != strings.Join(tc.wantTo, ",") || strings.Join(cc, ",") != strings.Join(tc.wantCc, ",") {
				t.Fatalf("to=%v cc=%v, want to=%v cc=%v", to, cc, tc.wantTo, tc.wantCc)
			}
		})
	}
}

func TestResolveCustomerEmailRecipientsCaps(t *testing.T) {
	cc := make([]string, 0, MaxCustomerEmailCc+1)
	to := make([]string, 0, MaxCustomerEmailTo)
	for i := 0; i <= MaxCustomerEmailCc; i++ {
		cc = append(cc, fmt.Sprintf("cc%d@example.com", i))
	}
	for i := 0; i < MaxCustomerEmailTo; i++ {
		to = append(to, fmt.Sprintf("to%d@example.com", i))
	}
	if _, _, err := resolveCustomerEmailRecipients(sendCustomerEmailRequest{CcEmails: cc}, "jane@example.com", true, staticDirectory{}); !errors.Is(err, ErrTooManyCc) {
		t.Fatalf("want ErrTooManyCc, got %v", err)
	}
	// Customer + 10 typed = 11 To.
	if _, _, err := resolveCustomerEmailRecipients(sendCustomerEmailRequest{ToEmails: to}, "jane@example.com", true, staticDirectory{}); !errors.Is(err, ErrTooManyTo) {
		t.Fatalf("want ErrTooManyTo, got %v", err)
	}
}

func TestResolveCustomerEmailRecipientsDirectoryError(t *testing.T) {
	_, _, err := resolveCustomerEmailRecipients(sendCustomerEmailRequest{CcContactIDs: []int64{1}}, "jane@example.com", false, staticDirectory{err: errors.New("db down")})
	// staticDirectory returns raw errors; the lazy directory wraps them.
	if err == nil {
		t.Fatal("want error")
	}
	if got := recipientErrorStatus(errDirectoryLoad{errors.New("db down")}); got != http.StatusInternalServerError {
		t.Fatalf("status = %d", got)
	}
	if got := recipientErrorStatus(ErrTypedRecipientForbidden); got != http.StatusForbidden {
		t.Fatalf("status = %d", got)
	}
}

func TestCustomerEmailPickerSendsToCustomerAndContacts(t *testing.T) {
	stub := newStaffEmailStub()
	sender := &fakeSender{}
	router := staffEmailRouter(t, stub, sender, nil)
	resp := partsAuditRequest(t, router, http.MethodPost, "/work-orders/5/customer-email",
		`{"template":"job_started","subject":"Update","body":"Hi Jane","to_customer":true,"to_contact_ids":[1],"cc_contact_ids":[2],"cc_emails":["amy@humphreys.test"]}`, senderPerms)
	if resp.Code != http.StatusOK {
		t.Fatalf("send: got %d %s", resp.Code, resp.Body.String())
	}
	if len(sender.sent) != 1 {
		t.Fatalf("want 1 send, got %d", len(sender.sent))
	}
	msg := sender.sent[0]
	if msg.To != "jane@example.com" || strings.Join(msg.ExtraTo, ",") != "boss@shop.test" || strings.Join(msg.Cc, ",") != "books@shop.test,amy@humphreys.test" {
		t.Fatalf("unexpected recipients: to=%q extra=%v cc=%v", msg.To, msg.ExtraTo, msg.Cc)
	}
}

func TestCustomerEmailPickerRejectsTypedForStaff(t *testing.T) {
	stub := newStaffEmailStub()
	sender := &fakeSender{}
	router := staffEmailRouter(t, stub, sender, nil)
	for _, body := range []string{
		`{"template":"job_started","subject":"S","body":"B","cc_emails":["outsider@example.com"]}`,
	} {
		resp := partsAuditRequest(t, router, http.MethodPost, "/work-orders/5/customer-email", body, senderPerms)
		if resp.Code != http.StatusBadRequest {
			t.Fatalf("typed cc: want 400, got %d %s", resp.Code, resp.Body.String())
		}
	}
	for _, body := range []string{
		`{"template":"job_started","subject":"S","body":"B","to_emails":["outsider@example.com"]}`,
		`{"template":"job_started","subject":"S","body":"B","to":"outsider@example.com"}`,
	} {
		resp := partsAuditRequest(t, router, http.MethodPost, "/work-orders/5/customer-email", body, senderPerms)
		if resp.Code != http.StatusForbidden {
			t.Fatalf("typed to %s: want 403, got %d %s", body, resp.Code, resp.Body.String())
		}
	}
	if len(sender.sent) != 0 {
		t.Fatalf("nothing must be sent, got %d", len(sender.sent))
	}
}

func TestCustomerEmailPickerAcceptsTypedForAdmin(t *testing.T) {
	stub := newStaffEmailStub()
	sender := &fakeSender{}
	router := staffEmailRouter(t, stub, sender, nil)
	resp := partsAuditRequest(t, router, http.MethodPost, "/work-orders/5/customer-email",
		`{"template":"job_started","subject":"S","body":"B","to_customer":false,"to_emails":["partner@example.com"],"cc_emails":["outsider@example.com"]}`, ownerPerms)
	if resp.Code != http.StatusOK {
		t.Fatalf("send: got %d %s", resp.Code, resp.Body.String())
	}
	msg := sender.sent[0]
	if msg.To != "partner@example.com" || len(msg.ExtraTo) != 0 || strings.Join(msg.Cc, ",") != "outsider@example.com" {
		t.Fatalf("unexpected recipients: to=%q extra=%v cc=%v", msg.To, msg.ExtraTo, msg.Cc)
	}
}

func TestCustomerEmailPickerInactiveContactRejected(t *testing.T) {
	stub := newStaffEmailStub()
	sender := &fakeSender{}
	router := staffEmailRouter(t, stub, sender, nil)
	// Id 3 is not in the active list (inactive or deleted).
	resp := partsAuditRequest(t, router, http.MethodPost, "/work-orders/5/customer-email",
		`{"template":"job_started","subject":"S","body":"B","cc_contact_ids":[3]}`, ownerPerms)
	if resp.Code != http.StatusBadRequest || !strings.Contains(resp.Body.String(), "inactive") {
		t.Fatalf("want 400 inactive, got %d %s", resp.Code, resp.Body.String())
	}
	if len(sender.sent) != 0 {
		t.Fatalf("nothing must be sent")
	}
}

func TestCustomerEmailPickerContactsLoadFailure(t *testing.T) {
	stub := newStaffEmailStub()
	stub.contactsErr = errors.New("db down")
	sender := &fakeSender{}
	router := staffEmailRouter(t, stub, sender, nil)
	resp := partsAuditRequest(t, router, http.MethodPost, "/work-orders/5/customer-email",
		`{"template":"job_started","subject":"S","body":"B","cc_contact_ids":[1]}`, ownerPerms)
	if resp.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d %s", resp.Code, resp.Body.String())
	}
}

func TestCustomerEmailPickerWithoutCustomerEmail(t *testing.T) {
	stub := newStaffEmailStub()
	sender := &fakeSender{}
	router := staffEmailRouter(t, stub, sender, nil)
	// Job 8 (Nora) has no email on file: customer To fails, contact To works.
	resp := partsAuditRequest(t, router, http.MethodPost, "/work-orders/8/customer-email",
		`{"template":"job_completed","subject":"S","body":"B","to_customer":true}`, senderPerms)
	if resp.Code != http.StatusBadRequest || !strings.Contains(resp.Body.String(), "customer email missing") {
		t.Fatalf("want 400 missing, got %d %s", resp.Code, resp.Body.String())
	}
	resp = partsAuditRequest(t, router, http.MethodPost, "/work-orders/8/customer-email",
		`{"template":"job_completed","subject":"S","body":"B","to_customer":false,"to_contact_ids":[1]}`, senderPerms)
	if resp.Code != http.StatusOK || len(sender.sent) != 1 || sender.sent[0].To != "boss@shop.test" {
		t.Fatalf("contact-only send: got %d %s %+v", resp.Code, resp.Body.String(), sender.sent)
	}
}

func TestCustomerEmailPickerAttachesPhotos(t *testing.T) {
	stub := newStaffEmailStub()
	sender := &fakeSender{}
	store := &photoStore{objects: map[string][]byte{"markdown-images/5/front.png": tinyPNG(t)}}
	router := staffEmailRouter(t, stub, sender, store)
	photo := emailphotos.PhotoID("markdown-images/5/front.png")
	resp := partsAuditRequest(t, router, http.MethodPost, "/work-orders/5/customer-email",
		`{"template":"job_completed","subject":"Done","body":"Hi","to_customer":true,"cc_contact_ids":[1],"photo_ids":["`+photo+`"]}`, senderPerms)
	if resp.Code != http.StatusOK {
		t.Fatalf("send: got %d %s", resp.Code, resp.Body.String())
	}
	msg := sender.sent[0]
	if len(msg.Attachments) != 1 || msg.To != "jane@example.com" || strings.Join(msg.Cc, ",") != "boss@shop.test" {
		t.Fatalf("unexpected message: attachments=%d to=%q cc=%v", len(msg.Attachments), msg.To, msg.Cc)
	}
}

func TestEmailCommonContactsRoute(t *testing.T) {
	stub := newStaffEmailStub()
	router := staffEmailRouter(t, stub, &fakeSender{}, nil)
	if resp := partsAuditRequest(t, router, http.MethodGet, "/work-orders/email-common-contacts", "", []string{permRead}); resp.Code != http.StatusForbidden {
		t.Fatalf("without sensitive read: got %d", resp.Code)
	}
	resp := partsAuditRequest(t, router, http.MethodGet, "/work-orders/email-common-contacts", "", senderPerms)
	if resp.Code != http.StatusOK {
		t.Fatalf("sender: got %d %s", resp.Code, resp.Body.String())
	}
	if resp.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("want no-store")
	}
	var out struct {
		Items []CommonEmailContact `json:"items"`
		MaxTo int                  `json:"max_to"`
		MaxCc int                  `json:"max_cc"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Items) != 2 || out.Items[0].Email != "boss@shop.test" || out.MaxTo != MaxCustomerEmailTo || out.MaxCc != MaxCustomerEmailCc {
		t.Fatalf("unexpected payload: %+v", out)
	}
}
