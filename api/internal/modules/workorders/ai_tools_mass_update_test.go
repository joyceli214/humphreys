package workorders

import (
	"encoding/json"
	"net/http"
	"testing"

	"humphreys/api/internal/domain"
)

func massUpdateStub() *aiToolsStub {
	return &aiToolsStub{
		statuses: []AIStatusOption{
			{ID: 1, Name: "Received", Group: "to_do"},
			{ID: 2, Name: "Finished", Group: "completed"},
		},
		locations: []AILocationOption{
			{ID: 10, Shelf: "A", Floor: 1},
		},
		details: map[int]domain.WorkOrderDetail{
			123: {ReferenceID: 123, LabourTotal: ptrFloat(200), StatusName: ptrStr("Received"),
				Customer: domain.WorkOrderCustomer{FirstName: ptrStr("Jane"), LastName: ptrStr("Doe")}},
			1: {ReferenceID: 1, LabourTotal: ptrFloat(50)},
			2: {ReferenceID: 2, LabourTotal: ptrFloat(75)},
		},
		applyErr: map[int]error{},
	}
}

func TestMassUpdatePreview(t *testing.T) {
	srv := mockLLMServer(t, `{"operations":[
		{"reference_id":123,"op":"set_labour_total","labour_total":150},
		{"reference_id":123,"op":"set_status","status_name":"Finished"},
		{"reference_id":123,"op":"set_status","status_name":"Nonexistent"}
	]}`)
	useMockLLM(t, srv)

	router := aiToolsRouter(t, massUpdateStub())
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/preview",
		`{"instruction":"lower labour to 150 and mark finished"}`, []string{permUpdate})
	if resp.Code != http.StatusOK {
		t.Fatalf("preview: got %d %s", resp.Code, resp.Body.String())
	}

	var body massUpdatePreviewResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Rows) != 3 {
		t.Fatalf("expected 3 rows, got %d: %+v", len(body.Rows), body.Rows)
	}
	labour := body.Rows[0]
	if !labour.Valid || labour.Before != "$200.00" || labour.After != "$150.00" || !labour.LowerThanBefore {
		t.Fatalf("labour row wrong: %+v", labour)
	}
	if labour.CustomerName != "Jane Doe" {
		t.Fatalf("customer name = %q", labour.CustomerName)
	}
	status := body.Rows[1]
	if !status.Valid || status.After != "Finished" {
		t.Fatalf("status row wrong: %+v", status)
	}
	bad := body.Rows[2]
	if want := `Unknown status "Nonexistent".`; bad.Valid || bad.Error != want {
		t.Fatalf("unknown status should be invalid with error %q: %+v", want, bad)
	}
}

func TestMassUpdatePreviewRejectsJunk(t *testing.T) {
	srv := mockLLMServer(t, "I'm sorry, I cannot help with that.")
	useMockLLM(t, srv)

	router := aiToolsRouter(t, massUpdateStub())
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/preview",
		`{"instruction":"do something"}`, []string{permUpdate})
	if resp.Code != http.StatusBadGateway {
		t.Fatalf("junk LLM output: got %d %s", resp.Code, resp.Body.String())
	}
}

func TestMassUpdatePreviewStaffForbidden(t *testing.T) {
	router := aiToolsRouter(t, massUpdateStub())
	for _, perms := range [][]string{{permStatusUpdate}, {permLocationUpdate}, {permRead}} {
		resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/preview",
			`{"instruction":"x"}`, perms)
		if resp.Code != http.StatusForbidden {
			t.Fatalf("perms %v: got %d, want 403", perms, resp.Code)
		}
	}
	// No auth at all is unauthorized.
	if resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/preview", `{"instruction":"x"}`, nil); resp.Code != http.StatusUnauthorized {
		t.Fatalf("no auth: got %d", resp.Code)
	}
}

func TestMassUpdateApplyPartialFailure(t *testing.T) {
	stub := massUpdateStub()
	// Job 2's apply fails; job 1 succeeds; job 3 has no detail (validation fails).
	stub.applyErr = map[int]error{2: ErrWorkOrderNotFound}

	router := aiToolsRouter(t, stub)
	payload := `{"operations":[
		{"reference_id":1,"op":"set_labour_total","labour_total":100},
		{"reference_id":2,"op":"set_labour_total","labour_total":100},
		{"reference_id":3,"op":"set_labour_total","labour_total":100}
	],"expected_updated_at":{"1":null,"2":null,"3":null}}`
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/apply", payload, []string{permUpdate})
	if resp.Code != http.StatusOK {
		t.Fatalf("apply: got %d %s", resp.Code, resp.Body.String())
	}

	var body massUpdateApplyResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Results) != 3 {
		t.Fatalf("expected 3 results, got %d: %+v", len(body.Results), body.Results)
	}
	byRef := map[int32]MassUpdateApplyResult{}
	for _, r := range body.Results {
		byRef[r.ReferenceID] = r
	}
	if !byRef[1].Success {
		t.Fatalf("job 1 should succeed: %+v", byRef[1])
	}
	if byRef[2].Success || byRef[2].Error != "Job not found." {
		t.Fatalf("job 2 should fail with a message: %+v", byRef[2])
	}
	if byRef[3].Success || byRef[3].Error != "Job #3 was not found." {
		t.Fatalf("job 3 should fail validation: %+v", byRef[3])
	}
	// The failing job must not have blocked the others: job 1 was applied.
	if _, ok := stub.appliedOps[1]; !ok {
		t.Fatalf("job 1 apply was not attempted: %+v", stub.appliedOps)
	}
	// Job 3 never reaches the repository because validation fails first.
	if _, ok := stub.appliedOps[3]; ok {
		t.Fatalf("invalid job 3 should not reach apply")
	}
}

func TestMassUpdateApplyStaffForbidden(t *testing.T) {
	router := aiToolsRouter(t, massUpdateStub())
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/apply",
		`{"operations":[{"reference_id":1,"op":"set_labour_total","labour_total":1}]}`, []string{permStatusUpdate})
	if resp.Code != http.StatusForbidden {
		t.Fatalf("staff apply: got %d, want 403", resp.Code)
	}
}

func TestMassUpdatePreviewDedupesIdenticalOps(t *testing.T) {
	srv := mockLLMServer(t, `{"operations":[
		{"reference_id":123,"op":"add_line_item","item_name":"Shipping","unit_price":15},
		{"reference_id":123,"op":"add_line_item","item_name":" shipping ","unit_price":15.0},
		{"reference_id":123,"op":"add_line_item","item_name":"Shipping","unit_price":20},
		{"reference_id":1,"op":"add_line_item","item_name":"Shipping","unit_price":15}
	]}`)
	useMockLLM(t, srv)

	router := aiToolsRouter(t, massUpdateStub())
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/preview",
		`{"instruction":"add Shipping $15"}`, []string{permUpdate})
	if resp.Code != http.StatusOK {
		t.Fatalf("preview: got %d %s", resp.Code, resp.Body.String())
	}
	var body massUpdatePreviewResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	// The repeated "Shipping $15" on job 123 collapses; a different price or a
	// different job is a distinct op and stays.
	if len(body.Rows) != 3 {
		t.Fatalf("expected 3 rows after dedupe, got %d: %+v", len(body.Rows), body.Rows)
	}
}

func TestMassUpdateApplyDedupesIdenticalOps(t *testing.T) {
	stub := massUpdateStub()
	router := aiToolsRouter(t, stub)
	payload := `{"operations":[
		{"reference_id":1,"op":"add_line_item","item_name":"Shipping","unit_price":15},
		{"reference_id":1,"op":"add_line_item","item_name":"Shipping","unit_price":15},
		{"reference_id":1,"op":"set_labour_total","labour_total":100},
		{"reference_id":1,"op":"set_labour_total","labour_total":100}
	],"expected_updated_at":{"1":null}}`
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/apply", payload, []string{permUpdate})
	if resp.Code != http.StatusOK {
		t.Fatalf("apply: got %d %s", resp.Code, resp.Body.String())
	}
	ops := stub.appliedOps[1]
	if len(ops) != 2 {
		t.Fatalf("expected 2 de-duplicated ops applied, got %d: %+v", len(ops), ops)
	}
	adds := 0
	for _, op := range ops {
		if op.Op == massOpAddLineItem {
			adds++
		}
	}
	if adds != 1 {
		t.Fatalf("Shipping must be added exactly once, got %d", adds)
	}
}
