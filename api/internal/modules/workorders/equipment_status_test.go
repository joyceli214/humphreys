package workorders

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"humphreys/api/internal/domain"
)

// equipmentStatusStub records the equipment/status updates forwarded by the
// PATCH /equipment and /status routes so the tests can assert exactly what the
// handler/service passed to the repository, and serves a fixed detail (with a
// current status) so the response-building path works without a database.
type equipmentStatusStub struct {
	Repository
	detail          domain.WorkOrderDetail
	gotEquipment    EquipmentUpdateInput
	equipmentCalled bool
	gotStatus       *int64
	statusCalled    bool
}

func (r *equipmentStatusStub) GetWorkOrderDetail(_ context.Context, _ int) (domain.WorkOrderDetail, error) {
	return r.detail, nil
}

func (r *equipmentStatusStub) UpdateEquipment(_ context.Context, _ int, input EquipmentUpdateInput) error {
	r.equipmentCalled = true
	r.gotEquipment = input
	return nil
}

func (r *equipmentStatusStub) UpdateStatus(_ context.Context, _ int, statusID *int64) error {
	r.statusCalled = true
	r.gotStatus = statusID
	return nil
}

func newEquipmentStatusStub() *equipmentStatusStub {
	status := int64(2)
	return &equipmentStatusStub{detail: domain.WorkOrderDetail{ReferenceID: 123, StatusID: &status}}
}

// TestEquipmentUpdateKeepsStatusWhenOmitted covers the core bug: omitting
// status_id (or sending null) must preserve the job's existing status instead of
// clearing it to NULL, while an explicit number still sets it.
func TestEquipmentUpdateKeepsStatusWhenOmitted(t *testing.T) {
	path := "/work-orders/123/equipment"

	cases := []struct {
		name  string
		perms []string
		body  string
		want  *int64
	}{
		{"full editor omits status_id -> keeps current", []string{permUpdate}, `{"location_id":5}`, ptrInt64(2)},
		{"full editor null status_id -> keeps current", []string{permUpdate}, `{"location_id":5,"status_id":null}`, ptrInt64(2)},
		{"full editor explicit status_id -> sets it", []string{permUpdate}, `{"location_id":5,"status_id":7}`, ptrInt64(7)},
		{"staff omits status_id -> keeps current", []string{permStatusUpdate}, `{"location_id":5}`, ptrInt64(2)},
		{"staff explicit status_id -> sets it", []string{permStatusUpdate}, `{"location_id":5,"status_id":7}`, ptrInt64(7)},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			stub := newEquipmentStatusStub()
			router := partsAuditRouter(t, stub)

			resp := partsAuditRequest(t, router, http.MethodPatch, path, tc.body, tc.perms)
			if resp.Code != http.StatusOK {
				t.Fatalf("got %d %s", resp.Code, resp.Body.String())
			}
			if !stub.equipmentCalled {
				t.Fatalf("UpdateEquipment was not called")
			}
			if stub.gotEquipment.StatusID == nil {
				t.Fatalf("StatusID forwarded as nil, want %d", *tc.want)
			}
			if *stub.gotEquipment.StatusID != *tc.want {
				t.Fatalf("forwarded StatusID = %d, want %d", *stub.gotEquipment.StatusID, *tc.want)
			}
		})
	}
}

// TestStatusRouteStillWorksForStaff confirms the separate status route is
// unchanged and still forwards the status for a status-only user.
func TestStatusRouteStillWorksForStaff(t *testing.T) {
	stub := newEquipmentStatusStub()
	router := partsAuditRouter(t, stub)

	resp := partsAuditRequest(t, router, http.MethodPatch, "/work-orders/123/status", `{"status_id":7}`, []string{permStatusUpdate})
	if resp.Code != http.StatusOK {
		t.Fatalf("got %d %s", resp.Code, resp.Body.String())
	}
	if !stub.statusCalled || stub.gotStatus == nil || *stub.gotStatus != 7 {
		t.Fatalf("status not forwarded: called=%v value=%v", stub.statusCalled, stub.gotStatus)
	}
}

// TestEquipmentResponseSanitizedForNonSensitive verifies that the equipment
// response hides customer contact details from users without
// work_orders_sensitive:read while keeping names, and preserves them for users
// who do hold the permission.
func TestEquipmentResponseSanitizedForNonSensitive(t *testing.T) {
	path := "/work-orders/123/equipment"
	body := `{"location_id":5,"status_id":7}`

	email := "customer@example.com"
	home := "4165551234"
	work := "4165559999"
	first := "Jane"
	last := "Doe"
	detailWithCustomer := func() domain.WorkOrderDetail {
		status := int64(2)
		return domain.WorkOrderDetail{
			ReferenceID: 123,
			StatusID:    &status,
			Customer: domain.WorkOrderCustomer{
				FirstName: &first,
				LastName:  &last,
				Email:     &email,
				HomePhone: &home,
				WorkPhone: &work,
			},
		}
	}

	type customerJSON struct {
		FirstName *string `json:"first_name"`
		LastName  *string `json:"last_name"`
		Email     *string `json:"email"`
		HomePhone *string `json:"home_phone"`
		WorkPhone *string `json:"work_phone"`
	}
	type detailJSON struct {
		Customer customerJSON `json:"customer"`
	}

	// Staff (no sensitive read): contact details stripped, names kept.
	stub := &equipmentStatusStub{detail: detailWithCustomer()}
	router := partsAuditRouter(t, stub)
	resp := partsAuditRequest(t, router, http.MethodPatch, path, body, []string{permStatusUpdate})
	if resp.Code != http.StatusOK {
		t.Fatalf("staff: got %d %s", resp.Code, resp.Body.String())
	}
	var staffDetail detailJSON
	if err := json.Unmarshal(resp.Body.Bytes(), &staffDetail); err != nil {
		t.Fatalf("staff: decode: %v", err)
	}
	if staffDetail.Customer.Email != nil || staffDetail.Customer.HomePhone != nil || staffDetail.Customer.WorkPhone != nil {
		t.Fatalf("staff response leaked contact details: %+v", staffDetail.Customer)
	}
	if staffDetail.Customer.FirstName == nil || *staffDetail.Customer.FirstName != first ||
		staffDetail.Customer.LastName == nil || *staffDetail.Customer.LastName != last {
		t.Fatalf("staff response dropped customer name: %+v", staffDetail.Customer)
	}

	// Full user with sensitive read: contact details preserved.
	stub = &equipmentStatusStub{detail: detailWithCustomer()}
	router = partsAuditRouter(t, stub)
	resp = partsAuditRequest(t, router, http.MethodPatch, path, body, []string{permUpdate, permSensitiveRead})
	if resp.Code != http.StatusOK {
		t.Fatalf("full user: got %d %s", resp.Code, resp.Body.String())
	}
	var fullDetail detailJSON
	if err := json.Unmarshal(resp.Body.Bytes(), &fullDetail); err != nil {
		t.Fatalf("full user: decode: %v", err)
	}
	if fullDetail.Customer.Email == nil || *fullDetail.Customer.Email != email ||
		fullDetail.Customer.HomePhone == nil || *fullDetail.Customer.HomePhone != home ||
		fullDetail.Customer.WorkPhone == nil || *fullDetail.Customer.WorkPhone != work {
		t.Fatalf("full user response missing contact details: %+v", fullDetail.Customer)
	}
}

func ptrInt64(v int64) *int64 { return &v }
