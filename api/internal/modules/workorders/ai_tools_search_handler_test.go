package workorders

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func searchStub() *aiToolsStub {
	jane := int64(1)
	created := time.Date(2026, 3, 2, 15, 0, 0, 0, time.UTC)
	orig := int32(100)
	return &aiToolsStub{
		statuses: searchStatuses(),
		searchRows: []AISearchRow{
			// Original job 100 with its warranty follow-up 140.
			{ReferenceID: 100, CustomerID: &jane, CustomerName: "Jane Doe", EquipmentName: "Receiver", BrandNames: []string{"Yamaha"}, ModelNumber: "RX-V671", SerialNumber: "S1", StatusName: "Picked Up", CreatedAt: &created, WarrantyJobIDs: []int32{140}, CustomerJobCount: 3},
			{ReferenceID: 140, CustomerID: &jane, CustomerName: "Jane Doe", EquipmentName: "Receiver", BrandNames: []string{"Yamaha"}, ModelNumber: "RX-V671", SerialNumber: "S1", StatusName: "In Progress", CreatedAt: &created, IsWarranty: true, OriginalJobID: &orig, WarrantyJobIDs: []int32{}, CustomerJobCount: 3},
			{ReferenceID: 150, CustomerID: &jane, CustomerName: "Jane Doe", EquipmentName: "Turntable", BrandNames: []string{}, ModelNumber: "PL-12D", StatusName: "Finished", CreatedAt: &created, WarrantyJobIDs: []int32{}, CustomerJobCount: 3},
		},
		searchTotal: 3,
	}
}

func decodeSearchResponse(t *testing.T, resp *httptest.ResponseRecorder) aiSearchResponse {
	t.Helper()
	if resp.Code != http.StatusOK {
		t.Fatalf("search: got %d %s", resp.Code, resp.Body.String())
	}
	var body aiSearchResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	return body
}

func TestAISearchWarrantyLinkingAndCustomerGroups(t *testing.T) {
	repo := searchStub()
	router := aiToolsRouter(t, repo)
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/search",
		`{"filters":{"customer_name":"Jane","statuses":["finished","In Progress"],"warranty":"only","include_linked":true,"min_units":2,"group_by":"customer","limit":500}}`,
		[]string{permUpdate})
	body := decodeSearchResponse(t, resp)

	f := repo.lastSearch
	if f == nil {
		t.Fatal("repository not called")
	}
	if f.CustomerName != "Jane" || f.Warranty != aiWarrantyOnly || !f.IncludeLinked || f.MinUnits != 2 || f.Limit != aiSearchMaxLimit {
		t.Fatalf("resolved filters wrong: %+v", *f)
	}
	if len(f.StatusIDs) != 2 || f.StatusIDs[0] != 2 || f.StatusIDs[1] != 1 {
		t.Fatalf("status ids = %v", f.StatusIDs)
	}

	if len(body.Rows) != 3 || body.Total != 3 {
		t.Fatalf("rows = %+v total=%d", body.Rows, body.Total)
	}
	follow := body.Rows[1]
	if !follow.IsWarranty || follow.OriginalJobID == nil || *follow.OriginalJobID != 100 {
		t.Fatalf("warranty follow-up not linked: %+v", follow)
	}
	if len(body.Rows[0].WarrantyJobIDs) != 1 || body.Rows[0].WarrantyJobIDs[0] != 140 {
		t.Fatalf("original job missing follow-up ids: %+v", body.Rows[0])
	}
	if body.GroupBy != aiGroupCustomer || len(body.Groups) != 1 || body.Groups[0].UnitCount != 3 || len(body.Groups[0].JobIDs) != 3 {
		t.Fatalf("customer groups = %+v", body.Groups)
	}
	raw := strings.ToLower(resp.Body.String())
	if strings.Contains(raw, "email") || strings.Contains(raw, "phone") {
		t.Fatalf("response leaks contact fields: %s", raw)
	}
}

func TestAISearchModelAndSerialGrouping(t *testing.T) {
	router := aiToolsRouter(t, searchStub())
	for _, tc := range []struct {
		groupBy    string
		wantGroups int
		firstLabel string
		firstJobs  int
	}{
		{aiGroupModel, 2, "RX-V671", 2},
		{aiGroupSerial, 1, "S1", 2},
		{aiGroupNone, 0, "", 0},
	} {
		resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/search",
			`{"filters":{"group_by":"`+tc.groupBy+`"}}`, []string{permUpdate})
		body := decodeSearchResponse(t, resp)
		if len(body.Groups) != tc.wantGroups {
			t.Fatalf("%s: groups = %+v", tc.groupBy, body.Groups)
		}
		if tc.wantGroups > 0 && (body.Groups[0].Label != tc.firstLabel || len(body.Groups[0].JobIDs) != tc.firstJobs) {
			t.Fatalf("%s: first group = %+v", tc.groupBy, body.Groups[0])
		}
	}
}

func TestAISearchRejectsBadFilters(t *testing.T) {
	router := aiToolsRouter(t, searchStub())
	for name, payload := range map[string]string{
		"unknown field":  `{"filters":{"sql":"DROP TABLE work_orders"}}`,
		"unknown status": `{"filters":{"statuses":["Teleported"]}}`,
		"bad warranty":   `{"filters":{"warranty":"sometimes"}}`,
		"not json":       `nope`,
	} {
		resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/search", payload, []string{permUpdate})
		if resp.Code != http.StatusBadRequest {
			t.Fatalf("%s: got %d %s", name, resp.Code, resp.Body.String())
		}
	}
}

func TestAISearchInterpretValid(t *testing.T) {
	var gotPrompt string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		gotPrompt = string(raw)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"model": "mock-model",
			"choices": []map[string]any{{"message": map[string]any{"content": "```json\n" +
				`{"filters":{"model":"RX-V671","statuses":["Finished"],"group_by":"serial","min_serial_jobs":2,"warranty":"any"},"explanation":"Jobs for model RX-V671 that are finished, grouped by serial, repeats only."}` +
				"\n```"}}},
		})
	}))
	t.Cleanup(srv.Close)
	useMockLLM(t, srv)

	router := aiToolsRouter(t, searchStub())
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/search/interpret",
		`{"question":"finished RX-V671 repeat repairs by serial"}`, []string{permUpdate})
	if resp.Code != http.StatusOK {
		t.Fatalf("interpret: got %d %s", resp.Code, resp.Body.String())
	}
	var body aiInterpretResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Filters.Model != "RX-V671" || body.Filters.GroupBy != aiGroupSerial || body.Filters.MinSerialJobs != 2 {
		t.Fatalf("filters = %+v", body.Filters)
	}
	if len(body.Filters.Statuses) != 1 || body.Filters.Statuses[0] != "Finished" {
		t.Fatalf("statuses = %v", body.Filters.Statuses)
	}
	if body.Explanation == "" || body.Model != "mock-model" {
		t.Fatalf("explanation/model missing: %+v", body)
	}
	if !strings.Contains(gotPrompt, "RX-V671 repeat repairs") || !strings.Contains(gotPrompt, "Picked Up") {
		t.Fatalf("prompt should carry question and status list: %s", gotPrompt)
	}
}

func TestAISearchInterpretRejectsBadLLMOutput(t *testing.T) {
	cases := map[string]struct {
		content string
		want    string
	}{
		"junk":             {`I'm sorry, I cannot help with that.`, "valid JSON"},
		"disallowed field": {`{"filters":{"customer_email":"a@b.c"},"explanation":"x"}`, `unsupported filter field \"customer_email\"`},
		"disallowed top":   {`{"filters":{},"sql":"DELETE FROM work_orders","explanation":"x"}`, `unexpected field \"sql\"`},
		"unknown status":   {`{"filters":{"statuses":["Teleported"]},"explanation":"x"}`, "Teleported"},
		"wrong type":       {`{"filters":{"min_units":"lots"},"explanation":"x"}`, "malformed"},
		"missing filters":  {`{"explanation":"x"}`, "filters"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			useMockLLM(t, mockLLMServer(t, tc.content))
			repo := searchStub()
			router := aiToolsRouter(t, repo)
			resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/search/interpret",
				`{"question":"anything"}`, []string{permUpdate})
			if resp.Code != http.StatusBadGateway {
				t.Fatalf("got %d %s", resp.Code, resp.Body.String())
			}
			if !strings.Contains(resp.Body.String(), tc.want) {
				t.Fatalf("error should mention %q: %s", tc.want, resp.Body.String())
			}
			if repo.lastSearch != nil {
				t.Fatal("interpret must never execute a search")
			}
		})
	}
}

func TestAISearchInterpretEmptyQuestion(t *testing.T) {
	useMockLLM(t, mockLLMServer(t, `{}`))
	router := aiToolsRouter(t, searchStub())
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/search/interpret", `{"question":"   "}`, []string{permUpdate})
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("got %d %s", resp.Code, resp.Body.String())
	}
}

func TestAISearchStaffForbidden(t *testing.T) {
	router := aiToolsRouter(t, searchStub())
	for _, path := range []string{"/ai-tools/search", "/ai-tools/search/interpret"} {
		if resp := partsAuditRequest(t, router, http.MethodPost, path, `{"question":"x","filters":{}}`,
			[]string{permRead, permStatusUpdate, permLocationUpdate}); resp.Code != http.StatusForbidden {
			t.Fatalf("staff %s: got %d, want 403", path, resp.Code)
		}
		if resp := partsAuditRequest(t, router, http.MethodPost, path, `{}`, nil); resp.Code != http.StatusUnauthorized {
			t.Fatalf("anon %s: got %d, want 401", path, resp.Code)
		}
	}
}
