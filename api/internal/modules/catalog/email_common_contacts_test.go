package catalog

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"humphreys/api/internal/middleware"
	"humphreys/api/internal/modules/auth/security"

	"github.com/gin-gonic/gin"
)

// contactsRepo is an in-memory common contacts store mirroring the SQL
// constraints (unique lower(email), count cap).
type contactsRepo struct {
	Repository
	items  []EmailCommonContact
	nextID int64
}

func (r *contactsRepo) ListEmailCommonContacts(context.Context) ([]EmailCommonContact, error) {
	return append([]EmailCommonContact{}, r.items...), nil
}

func (r *contactsRepo) GetEmailCommonContact(_ context.Context, id int64) (EmailCommonContact, error) {
	for _, item := range r.items {
		if item.ID == id {
			return item, nil
		}
	}
	return EmailCommonContact{}, ErrEmailContactNotFound
}

func (r *contactsRepo) emailTaken(email string, exceptID int64) bool {
	for _, item := range r.items {
		if item.ID != exceptID && strings.EqualFold(item.Email, email) {
			return true
		}
	}
	return false
}

func (r *contactsRepo) CreateEmailCommonContact(_ context.Context, item EmailCommonContact) (EmailCommonContact, error) {
	if len(r.items) >= MaxEmailCommonContacts {
		return EmailCommonContact{}, ErrEmailContactTooMany
	}
	if r.emailTaken(item.Email, 0) {
		return EmailCommonContact{}, ErrEmailContactDuplicate
	}
	r.nextID++
	item.ID = r.nextID
	item.CreatedAt, item.UpdatedAt = time.Now(), time.Now()
	r.items = append(r.items, item)
	return item, nil
}

func (r *contactsRepo) UpdateEmailCommonContact(_ context.Context, item EmailCommonContact) (EmailCommonContact, error) {
	if r.emailTaken(item.Email, item.ID) {
		return EmailCommonContact{}, ErrEmailContactDuplicate
	}
	for i := range r.items {
		if r.items[i].ID == item.ID {
			r.items[i] = item
			return item, nil
		}
	}
	return EmailCommonContact{}, ErrEmailContactNotFound
}

func (r *contactsRepo) DeleteEmailCommonContact(_ context.Context, id int64) error {
	for i := range r.items {
		if r.items[i].ID == id {
			r.items = append(r.items[:i], r.items[i+1:]...)
			return nil
		}
	}
	return ErrEmailContactNotFound
}

var (
	adminScope  = []string{permWorkOrdersRead, permWorkOrdersUpdate}
	readerScope = []string{permWorkOrdersRead, "work_orders_sensitive:read"}
)

func contactsRouter(repo *contactsRepo) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	group := router.Group("", middleware.Auth("test-secret"))
	RegisterRoutes(group, NewWithService(NewService(repo)))
	return router
}

func contactsRequest(t *testing.T, router *gin.Engine, method, path, body string, scope []string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	token, _, err := security.NewAccessToken("test-secret", time.Minute, "00000000-0000-0000-0000-000000000001", nil, scope)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)
	return res
}

func TestEmailCommonContactsRequireUpdatePermission(t *testing.T) {
	router := contactsRouter(&contactsRepo{})
	for _, tc := range []struct{ method, path, body string }{
		{http.MethodGet, "/catalog/email-common-contacts", ""},
		{http.MethodPost, "/catalog/email-common-contacts", `{"name":"Boss","email":"boss@shop.test","role":"boss"}`},
		{http.MethodPatch, "/catalog/email-common-contacts/1", `{"is_active":false}`},
		{http.MethodDelete, "/catalog/email-common-contacts/1", ""},
	} {
		if res := contactsRequest(t, router, tc.method, tc.path, tc.body, readerScope); res.Code != http.StatusForbidden {
			t.Fatalf("%s %s without update: got %d", tc.method, tc.path, res.Code)
		}
	}
}

func TestEmailCommonContactsCRUD(t *testing.T) {
	repo := &contactsRepo{}
	router := contactsRouter(repo)

	res := contactsRequest(t, router, http.MethodPost, "/catalog/email-common-contacts", `{"name":"  Big Boss ","email":" Boss@Shop.TEST ","role":"Boss","is_pinned":true}`, adminScope)
	if res.Code != http.StatusCreated {
		t.Fatalf("create: got %d %s", res.Code, res.Body)
	}
	var created EmailCommonContact
	if err := json.Unmarshal(res.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Name != "Big Boss" || created.Email != "boss@shop.test" || created.Role != "boss" || !created.IsActive || !created.IsPinned {
		t.Fatalf("unexpected created contact: %+v", created)
	}

	// Duplicate email (case-insensitive) → 409.
	res = contactsRequest(t, router, http.MethodPost, "/catalog/email-common-contacts", `{"name":"Again","email":"BOSS@shop.test","role":"staff"}`, adminScope)
	if res.Code != http.StatusConflict {
		t.Fatalf("duplicate: got %d %s", res.Code, res.Body)
	}

	res = contactsRequest(t, router, http.MethodPost, "/catalog/email-common-contacts", `{"name":"Books","email":"books@shop.test","role":"other"}`, adminScope)
	if res.Code != http.StatusCreated {
		t.Fatalf("create second: got %d %s", res.Code, res.Body)
	}

	// Renaming onto an existing email → 409.
	res = contactsRequest(t, router, http.MethodPatch, "/catalog/email-common-contacts/2", `{"email":"boss@shop.test"}`, adminScope)
	if res.Code != http.StatusConflict {
		t.Fatalf("patch duplicate: got %d %s", res.Code, res.Body)
	}

	res = contactsRequest(t, router, http.MethodPatch, "/catalog/email-common-contacts/2", `{"is_active":false,"sort_order":5}`, adminScope)
	if res.Code != http.StatusOK {
		t.Fatalf("patch: got %d %s", res.Code, res.Body)
	}
	var updated EmailCommonContact
	_ = json.Unmarshal(res.Body.Bytes(), &updated)
	if updated.IsActive || updated.SortOrder != 5 || updated.Name != "Books" {
		t.Fatalf("unexpected update: %+v", updated)
	}

	res = contactsRequest(t, router, http.MethodGet, "/catalog/email-common-contacts", "", adminScope)
	var list struct {
		Items []EmailCommonContact `json:"items"`
	}
	_ = json.Unmarshal(res.Body.Bytes(), &list)
	if res.Code != http.StatusOK || len(list.Items) != 2 {
		t.Fatalf("list (incl inactive): got %d %s", res.Code, res.Body)
	}

	if res = contactsRequest(t, router, http.MethodPatch, "/catalog/email-common-contacts/99", `{"is_active":true}`, adminScope); res.Code != http.StatusNotFound {
		t.Fatalf("patch missing: got %d", res.Code)
	}
	if res = contactsRequest(t, router, http.MethodPatch, "/catalog/email-common-contacts/abc", `{}`, adminScope); res.Code != http.StatusBadRequest {
		t.Fatalf("patch bad id: got %d", res.Code)
	}
	if res = contactsRequest(t, router, http.MethodDelete, "/catalog/email-common-contacts/2", "", adminScope); res.Code != http.StatusNoContent {
		t.Fatalf("delete: got %d %s", res.Code, res.Body)
	}
	if res = contactsRequest(t, router, http.MethodDelete, "/catalog/email-common-contacts/2", "", adminScope); res.Code != http.StatusNotFound {
		t.Fatalf("delete again: got %d", res.Code)
	}
}

func TestEmailCommonContactValidation(t *testing.T) {
	router := contactsRouter(&contactsRepo{})
	long := strings.Repeat("a", MaxEmailCommonContactName+1)
	for _, body := range []string{
		`{"email":"a@b.test","role":"boss"}`,
		`{"name":"` + long + `","email":"a@b.test","role":"boss"}`,
		`{"name":"A","role":"boss"}`,
		`{"name":"A","email":"not an email","role":"boss"}`,
		`{"name":"A","email":"A <a@b.test>","role":"boss"}`,
		`{"name":"A","email":"a@b.test","role":"manager"}`,
		`{"name":"A","email":"a@b.test"}`,
		`{"name":"A","email":"a@b.test","role":"boss","sort_order":1000000}`,
		`{`,
	} {
		if res := contactsRequest(t, router, http.MethodPost, "/catalog/email-common-contacts", body, adminScope); res.Code != http.StatusBadRequest {
			t.Fatalf("%s: want 400, got %d %s", body, res.Code, res.Body)
		}
	}
}

func TestEmailCommonContactCap(t *testing.T) {
	repo := &contactsRepo{}
	svc := NewService(repo)
	for i := 0; i < MaxEmailCommonContacts; i++ {
		repo.items = append(repo.items, EmailCommonContact{ID: int64(i + 1), Email: string(rune('a'+i%26)) + strings.Repeat("x", i) + "@b.test"})
	}
	_, err := svc.CreateEmailCommonContact(context.Background(), EmailCommonContact{Name: "One more", Email: "more@b.test", Role: "other"})
	if !errors.Is(err, ErrEmailContactTooMany) {
		t.Fatalf("want ErrEmailContactTooMany, got %v", err)
	}
	if status, _ := emailContactErrorStatus(err); status != http.StatusBadRequest {
		t.Fatalf("cap status = %d", status)
	}
}
