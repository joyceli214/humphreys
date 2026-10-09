package workorders

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"humphreys/api/internal/domain"
	"humphreys/api/internal/middleware"
	"humphreys/api/internal/modules/auth/security"

	"github.com/gin-gonic/gin"
)

type partsAuditStub struct {
	Repository
	entries    []PartsAuditEntry
	err        error
	reference  int
	partsID    *int64
	actor      string
	status     string
	price      float64
	canApprove bool
	updatedAt  time.Time
	transition bool
}

func (r *partsAuditStub) PartsAuditForWorkOrder(_ context.Context, reference int, partsID *int64) ([]PartsAuditEntry, error) {
	r.reference, r.partsID = reference, partsID
	return r.entries, r.err
}

func (r *partsAuditStub) CreatePartsPurchaseRequest(_ context.Context, reference int, input CreatePartsPurchaseRequestInput) (domain.PartsPurchaseRequest, error) {
	r.reference, r.actor, r.status, r.price = reference, input.CreatedByUserID, *input.Status, input.TotalPrice
	return domain.PartsPurchaseRequest{Status: *input.Status, TotalPrice: input.TotalPrice}, nil
}

func (r *partsAuditStub) UpdatePartsPurchaseRequest(_ context.Context, reference int, _ int64, input UpdatePartsPurchaseRequestInput) (domain.PartsPurchaseRequest, error) {
	r.reference, r.actor, r.status, r.price = reference, input.ActorUserID, input.Status, input.TotalPrice
	r.canApprove, r.updatedAt = input.CanApprove, input.UpdatedAt
	if r.transition {
		if err := validatePartsTransition("waiting_approval", input.Status, input.CanApprove); err != nil {
			return domain.PartsPurchaseRequest{}, err
		}
	}
	return domain.PartsPurchaseRequest{Status: input.Status, TotalPrice: input.TotalPrice}, r.err
}

func (r *partsAuditStub) DeletePartsPurchaseRequest(_ context.Context, reference int, _ int64, actor string) error {
	r.reference, r.actor = reference, actor
	return nil
}

func partsAuditRouter(t *testing.T, repo Repository) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	group := router.Group("", middleware.Auth("test-secret"))
	RegisterRoutes(group, &Handler{service: NewService(repo)})
	return router
}

func partsAuditRequest(t *testing.T, router *gin.Engine, method, path, body string, permissions []string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if permissions != nil {
		token, _, err := security.NewAccessToken("test-secret", time.Minute, "00000000-0000-0000-0000-000000000001", nil, permissions)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, req)
	return response
}

func TestPartsAuditHistoryRoute(t *testing.T) {
	repo := &partsAuditStub{entries: []PartsAuditEntry{entry("delete", "status", strPtr("approved"), nil)}}
	router := partsAuditRouter(t, repo)
	path := "/work-orders/123/parts-purchase-requests/history"
	for _, tc := range []struct {
		path        string
		permissions []string
		status      int
	}{
		{path, nil, http.StatusUnauthorized},
		{path, []string{permRead}, http.StatusForbidden},
		{"/work-orders/bad/parts-purchase-requests/history", []string{permPartsRead}, http.StatusBadRequest},
		{"/work-orders/0/parts-purchase-requests/history", []string{permPartsRead}, http.StatusBadRequest},
		{path + "?parts_purchase_request_id=bad", []string{permPartsRead}, http.StatusBadRequest},
		{path + "?parts_purchase_request_id=-1", []string{permPartsRead}, http.StatusBadRequest},
		{path, []string{permPartsRead}, http.StatusOK},
		{path + "?parts_purchase_request_id=7", []string{permPartsRead}, http.StatusOK},
	} {
		response := partsAuditRequest(t, router, http.MethodGet, tc.path, "", tc.permissions)
		if response.Code != tc.status {
			t.Fatalf("%s: got %d, want %d: %s", tc.path, response.Code, tc.status, response.Body.String())
		}
	}
	if repo.reference != 123 || repo.partsID == nil || *repo.partsID != 7 {
		t.Fatalf("history filter not forwarded: %+v", repo)
	}
	repo.err = errors.New("private database failure")
	response := partsAuditRequest(t, router, http.MethodGet, path, "", []string{permPartsRead})
	if response.Code != 500 || strings.Contains(response.Body.String(), "private") {
		t.Fatalf("history failure response: %d %s", response.Code, response.Body.String())
	}
	for _, route := range router.Routes() {
		if strings.HasSuffix(route.Path, "/history") && route.Method != http.MethodGet {
			t.Fatalf("audit mutation route registered: %+v", route)
		}
	}
}

func TestPartsAuditActorsAndAllowedActions(t *testing.T) {
	repo := &partsAuditStub{}
	router := partsAuditRouter(t, repo)
	path := "/work-orders/123/parts-purchase-requests"
	body := `{"source":"supplier","status":"approved","total_price":25,"item_name":"Capacitor","quantity":1,"actor_user_id":"forged","updated_at":"2026-10-09T12:00:00.123456Z"}`
	for _, tc := range []struct {
		method, path, permission string
		status                   int
	}{
		{http.MethodPost, path, permPartsCreate, http.StatusCreated},
		{http.MethodPatch, path + "/7", permPartsUpdate, http.StatusOK},
		{http.MethodDelete, path + "/7", permPartsDelete, http.StatusNoContent},
	} {
		repo.actor = ""
		response := partsAuditRequest(t, router, tc.method, tc.path, body, []string{tc.permission})
		if response.Code != tc.status || repo.actor != "00000000-0000-0000-0000-000000000001" {
			t.Fatalf("%s: status=%d actor=%s body=%s", tc.method, response.Code, repo.actor, response.Body.String())
		}
		if tc.method != http.MethodDelete {
			var item domain.PartsPurchaseRequest
			if err := json.Unmarshal(response.Body.Bytes(), &item); err != nil || item.Status != "approved" || item.TotalPrice != 25 {
				t.Fatalf("approved request action failed: %s, %v", response.Body.String(), err)
			}
		}
	}
}

func TestPartsPatchPermissionAndConflict(t *testing.T) {
	repo := &partsAuditStub{transition: true}
	router := partsAuditRouter(t, repo)
	path := "/work-orders/123/parts-purchase-requests/7"
	body := `{"source":"supplier","status":"approved","total_price":25,"item_name":"Capacitor","quantity":1,"updated_at":"2026-10-09T12:00:00.123456Z"}`
	for _, tc := range []struct {
		permissions []string
		want        int
	}{
		{[]string{permPartsUpdate, permSensitiveRead}, http.StatusForbidden},
		{[]string{permPartsUpdate, permPartsApprove}, http.StatusOK},
		{[]string{permPartsApprove}, http.StatusForbidden},
	} {
		got := partsAuditRequest(t, router, http.MethodPatch, path, body, tc.permissions)
		if got.Code != tc.want {
			t.Fatalf("permissions %v: %d %s", tc.permissions, got.Code, got.Body.String())
		}
	}
	expected, _ := time.Parse(time.RFC3339Nano, "2026-10-09T12:00:00.123456Z")
	if !repo.updatedAt.Equal(expected) {
		t.Fatalf("timestamp not forwarded: %v", repo.updatedAt)
	}
	repo.err = ErrPartsPurchaseRequestConflict
	got := partsAuditRequest(t, router, http.MethodPatch, path, body, []string{permPartsUpdate, permPartsApprove})
	if got.Code != http.StatusConflict {
		t.Fatalf("stale response: %d %s", got.Code, got.Body.String())
	}
	for _, version := range []string{"", `,"updated_at":null`, `,"updated_at":"bad"`, `,"updated_at":"0001-01-01T00:00:00Z"`} {
		payload := `{"source":"supplier","status":"approved","total_price":25,"item_name":"Capacitor","quantity":1` + version + `}`
		got := partsAuditRequest(t, router, http.MethodPatch, path, payload, []string{permPartsUpdate, permPartsApprove})
		if got.Code != http.StatusBadRequest {
			t.Fatalf("invalid version %s: %d %s", version, got.Code, got.Body.String())
		}
	}
}
