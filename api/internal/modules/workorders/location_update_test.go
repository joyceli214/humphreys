package workorders

import (
	"context"
	"net/http"
	"testing"

	"humphreys/api/internal/domain"
)

// locationUpdateStub records the equipment update issued by the narrow
// location-only route so the tests can assert exactly what was forwarded.
type locationUpdateStub struct {
	Repository
	detail       domain.WorkOrderDetail
	gotInput     EquipmentUpdateInput
	updateCalled bool
	unknownLoc   map[int64]bool
}

func (r *locationUpdateStub) GetWorkOrderDetail(_ context.Context, _ int) (domain.WorkOrderDetail, error) {
	return r.detail, nil
}

func (r *locationUpdateStub) UpdateEquipment(_ context.Context, _ int, input EquipmentUpdateInput) error {
	r.updateCalled = true
	r.gotInput = input
	if input.LocationID != nil && r.unknownLoc[*input.LocationID] {
		return ErrLocationNotFound
	}
	return nil
}

func TestLocationUpdateRoute(t *testing.T) {
	status := int64(2)
	loc := int64(5)
	stub := &locationUpdateStub{detail: domain.WorkOrderDetail{ReferenceID: 123, StatusID: &status, LocationID: &loc}}
	router := partsAuditRouter(t, stub)
	path := "/work-orders/123/location"

	// A location-only user can change the location via the narrow route.
	resp := partsAuditRequest(t, router, http.MethodPatch, path, `{"location_id":5}`, []string{permLocationUpdate})
	if resp.Code != http.StatusOK {
		t.Fatalf("location-only update: got %d %s", resp.Code, resp.Body.String())
	}
	if !stub.updateCalled || stub.gotInput.LocationID == nil || *stub.gotInput.LocationID != 5 {
		t.Fatalf("location not forwarded: %+v", stub.gotInput)
	}
	// Only the location changed; status is preserved from the existing record.
	if stub.gotInput.StatusID == nil || *stub.gotInput.StatusID != status {
		t.Fatalf("status should be preserved: %+v", stub.gotInput)
	}

	// A full-update user may also use the narrow route.
	if resp := partsAuditRequest(t, router, http.MethodPatch, path, `{"location_id":5}`, []string{permUpdate}); resp.Code != http.StatusOK {
		t.Fatalf("full-update via location route: got %d %s", resp.Code, resp.Body.String())
	}

	// Null clears the location.
	stub.gotInput = EquipmentUpdateInput{}
	if resp := partsAuditRequest(t, router, http.MethodPatch, path, `{"location_id":null}`, []string{permLocationUpdate}); resp.Code != http.StatusOK || stub.gotInput.LocationID != nil {
		t.Fatalf("clear location: got %d, input=%+v", resp.Code, stub.gotInput)
	}

	// Any other/unknown field in the body is rejected with 400.
	for _, body := range []string{`{"location_id":5,"status_id":9}`, `{"status_id":9}`, `{"location_id":5,"foo":1}`, `{"job_type_id":3}`} {
		if resp := partsAuditRequest(t, router, http.MethodPatch, path, body, []string{permLocationUpdate}); resp.Code != http.StatusBadRequest {
			t.Fatalf("strict body %s: got %d %s", body, resp.Code, resp.Body.String())
		}
	}

	// A user with neither permission is forbidden on the narrow route.
	if resp := partsAuditRequest(t, router, http.MethodPatch, path, `{"location_id":5}`, []string{permRead}); resp.Code != http.StatusForbidden {
		t.Fatalf("no perm: got %d %s", resp.Code, resp.Body.String())
	}
	// Missing auth is unauthorized.
	if resp := partsAuditRequest(t, router, http.MethodPatch, path, `{"location_id":5}`, nil); resp.Code != http.StatusUnauthorized {
		t.Fatalf("no auth: got %d %s", resp.Code, resp.Body.String())
	}

	// A non-existent location yields 400.
	stub.unknownLoc = map[int64]bool{99: true}
	if resp := partsAuditRequest(t, router, http.MethodPatch, path, `{"location_id":99}`, []string{permLocationUpdate}); resp.Code != http.StatusBadRequest {
		t.Fatalf("invalid location: got %d %s", resp.Code, resp.Body.String())
	}
}

func TestLocationUpdateStrictBody(t *testing.T) {
	loc := int64(5)
	stub := &locationUpdateStub{detail: domain.WorkOrderDetail{ReferenceID: 123, LocationID: &loc}}
	router := partsAuditRouter(t, stub)
	path := "/work-orders/123/location"

	// The location_id key must be present; empty bodies and {} are rejected.
	for _, body := range []string{`{}`, ``, `   `} {
		stub.updateCalled = false
		if resp := partsAuditRequest(t, router, http.MethodPatch, path, body, []string{permLocationUpdate}); resp.Code != http.StatusBadRequest {
			t.Fatalf("missing key %q: got %d %s", body, resp.Code, resp.Body.String())
		}
		if stub.updateCalled {
			t.Fatalf("missing key %q should not reach the service", body)
		}
	}

	// Trailing data after the JSON object is rejected.
	for _, body := range []string{`{"location_id":5}{"location_id":6}`, `{"location_id":5} {}`, `{"location_id":5}garbage`} {
		stub.updateCalled = false
		if resp := partsAuditRequest(t, router, http.MethodPatch, path, body, []string{permLocationUpdate}); resp.Code != http.StatusBadRequest {
			t.Fatalf("trailing data %q: got %d %s", body, resp.Code, resp.Body.String())
		}
		if stub.updateCalled {
			t.Fatalf("trailing data %q should not reach the service", body)
		}
	}

	// Explicit null is still accepted and clears the location.
	stub.gotInput = EquipmentUpdateInput{}
	if resp := partsAuditRequest(t, router, http.MethodPatch, path, `{"location_id":null}`, []string{permLocationUpdate}); resp.Code != http.StatusOK || stub.gotInput.LocationID != nil {
		t.Fatalf("explicit null clear: got %d input=%+v", resp.Code, stub.gotInput)
	}

	// Trailing whitespace after a valid object is fine.
	if resp := partsAuditRequest(t, router, http.MethodPatch, path, "{\"location_id\":5}\n  ", []string{permLocationUpdate}); resp.Code != http.StatusOK {
		t.Fatalf("trailing whitespace: got %d %s", resp.Code, resp.Body.String())
	}
}

func TestLocationOnlyUserForbiddenOnOtherUpdateRoutes(t *testing.T) {
	stub := &locationUpdateStub{}
	router := partsAuditRouter(t, stub)
	for _, path := range []string{
		"/work-orders/123/equipment",
		"/work-orders/123/work-notes",
		"/work-orders/123/line-items",
		"/work-orders/123/totals",
		"/work-orders/123/customer",
		"/work-orders/123/status",
	} {
		if resp := partsAuditRequest(t, router, http.MethodPatch, path, `{}`, []string{permLocationUpdate}); resp.Code != http.StatusForbidden {
			t.Fatalf("%s with location-only: got %d %s", path, resp.Code, resp.Body.String())
		}
	}
}
