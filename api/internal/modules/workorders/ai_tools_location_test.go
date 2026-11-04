package workorders

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func locationPreviewRows(t *testing.T, stub *aiToolsStub, locationName string) []MassUpdatePreviewRow {
	t.Helper()
	payload := `{"operations":[{"reference_id":1,"op":"set_location","location_name":` +
		strconvQuote(locationName) + `}],"expected_updated_at":{"1":null}}`
	router := aiToolsRouter(t, stub)
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/apply", payload, []string{permUpdate})
	if resp.Code != http.StatusOK {
		t.Fatalf("apply: got %d %s", resp.Code, resp.Body.String())
	}
	var body massUpdateApplyResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	rows := make([]MassUpdatePreviewRow, 0, len(body.Results))
	for _, r := range body.Results {
		rows = append(rows, MassUpdatePreviewRow{ReferenceID: r.ReferenceID, Valid: r.Success, Error: r.Error})
	}
	return rows
}

func strconvQuote(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func multiFloorStub() *aiToolsStub {
	stub := massUpdateStub()
	stub.locations = []AILocationOption{
		{ID: 10, Shelf: "A", Floor: 1},
		{ID: 11, Shelf: "A", Floor: 2},
		{ID: 12, Shelf: "B", Floor: 0},
	}
	return stub
}

func TestMassUpdateLocationBareShelfAmbiguousRejected(t *testing.T) {
	stub := multiFloorStub()
	rows := locationPreviewRows(t, stub, "a")
	if len(rows) != 1 || rows[0].Valid {
		t.Fatalf("ambiguous bare shelf must be rejected: %+v", rows)
	}
	msg := rows[0].Error
	if !strings.Contains(msg, "ambiguous") || !strings.Contains(msg, "A-1") || !strings.Contains(msg, "A-2") {
		t.Fatalf("error should say ambiguous and list options, got %q", msg)
	}
	if _, ok := stub.appliedOps[1]; ok {
		t.Fatalf("ambiguous location must not be applied: %+v", stub.appliedOps[1])
	}
}

func TestMassUpdateLocationFullLabelResolves(t *testing.T) {
	stub := multiFloorStub()
	rows := locationPreviewRows(t, stub, " a-2 ")
	if len(rows) != 1 || !rows[0].Valid {
		t.Fatalf("full label should resolve: %+v", rows)
	}
	ops := stub.appliedOps[1]
	if len(ops) != 1 || ops[0].LocationID == nil || *ops[0].LocationID != 11 {
		t.Fatalf("expected location 11, got %+v", ops)
	}
}

func TestMassUpdateLocationUniqueBareShelfResolves(t *testing.T) {
	stub := multiFloorStub()
	rows := locationPreviewRows(t, stub, "B")
	if len(rows) != 1 || !rows[0].Valid {
		t.Fatalf("unique bare shelf should resolve: %+v", rows)
	}
	ops := stub.appliedOps[1]
	if len(ops) != 1 || ops[0].LocationID == nil || *ops[0].LocationID != 12 {
		t.Fatalf("expected location 12, got %+v", ops)
	}
}

func TestMassUpdateLocationPreviewAmbiguousMessage(t *testing.T) {
	srv := mockLLMServer(t, `{"operations":[{"reference_id":123,"op":"set_location","location_name":"A"}]}`)
	useMockLLM(t, srv)
	router := aiToolsRouter(t, multiFloorStub())
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/mass-update/preview",
		`{"instruction":"move 123 to shelf A"}`, []string{permUpdate})
	if resp.Code != http.StatusOK {
		t.Fatalf("preview: got %d %s", resp.Code, resp.Body.String())
	}
	var body massUpdatePreviewResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Rows) != 1 || body.Rows[0].Valid {
		t.Fatalf("expected one invalid row: %+v", body.Rows)
	}
	if want := `ambiguous location "A": specify one of A-1, A-2`; body.Rows[0].Error != want {
		t.Fatalf("error = %q, want %q", body.Rows[0].Error, want)
	}
}
