package workorders

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
)

func TestParseJobNumberQuery(t *testing.T) {
	cases := []struct {
		in   string
		want []int32 // nil = not a job-number query
	}{
		{"31200", []int32{31200}},
		{"  31200  ", []int32{31200}},
		{"#31200", []int32{31200}},
		{"job 31200", []int32{31200}},
		{"Job #31200", []int32{31200}},
		{"JOB#31200", []int32{31200}},
		{"jobs 31200, 31201", []int32{31200, 31201}},
		{"jobs #31200, #31201 and 31202", []int32{31200, 31201, 31202}},
		{"jobs 31200 31201 31200", []int32{31200, 31201}},
		{"job number 31200", []int32{31200}},
		{"Job Number #31200", []int32{31200}},
		{"job no. 31200", []int32{31200}},
		{"31200, 31201", []int32{31200, 31201}},
		{"show me job 31200", nil},
		{"job 31200 for Jane", nil},
		{"RX-V671", nil},
		{"model 31200", nil},
		{"serial 31200", nil},
		{"jobs", nil},
		{"", nil},
		{"0", nil},
		{"#", nil},
		{"99999999999", nil}, // overflows int32
		{"jobs from 2026", nil},
	}
	for _, tc := range cases {
		t.Run(tc.in, func(t *testing.T) {
			got, ok := parseJobNumberQuery(tc.in)
			if tc.want == nil {
				if ok {
					t.Fatalf("%q should not match, got %v", tc.in, got)
				}
				return
			}
			if !ok || len(got) != len(tc.want) {
				t.Fatalf("%q: got %v ok=%v, want %v", tc.in, got, ok, tc.want)
			}
			for i := range got {
				if int32(got[i]) != tc.want[i] {
					t.Fatalf("%q: got %v, want %v", tc.in, got, tc.want)
				}
			}
		})
	}

	many := make([]string, aiSearchMaxJobIDs+1)
	for i := range many {
		many[i] = strconv.Itoa(1000 + i)
	}
	if _, ok := parseJobNumberQuery("jobs " + strings.Join(many, ", ")); ok {
		t.Fatal("more than max job ids should not take the shortcut")
	}
}

func TestNormalizeSearchFiltersJobFields(t *testing.T) {
	tooMany := make([]int, aiSearchMaxJobIDs+1)
	for i := range tooMany {
		tooMany[i] = i + 1
	}
	dupes := make([]int, 0, 2*aiSearchMaxJobIDs)
	for i := 0; i < aiSearchMaxJobIDs; i++ {
		dupes = append(dupes, i+1, i+1)
	}
	cases := []struct {
		name    string
		in      AISearchFilters
		wantErr string
		check   func(t *testing.T, f aiResolvedSearchFilters)
	}{
		{name: "job ids deduped in order", in: AISearchFilters{JobIDs: []int{31201, 31200, 31201}}, check: func(t *testing.T, f aiResolvedSearchFilters) {
			if len(f.JobIDs) != 2 || f.JobIDs[0] != 31201 || f.JobIDs[1] != 31200 {
				t.Fatalf("job ids = %v", f.JobIDs)
			}
			if got := f.toFilters().JobIDs; len(got) != 2 || got[0] != 31201 {
				t.Fatalf("toFilters job ids = %v", got)
			}
		}},
		{name: "dupes count once toward cap", in: AISearchFilters{JobIDs: dupes}, check: func(t *testing.T, f aiResolvedSearchFilters) {
			if len(f.JobIDs) != aiSearchMaxJobIDs {
				t.Fatalf("len = %d", len(f.JobIDs))
			}
		}},
		{name: "zero job id", in: AISearchFilters{JobIDs: []int{0}}, wantErr: "job_ids"},
		{name: "negative job id", in: AISearchFilters{JobIDs: []int{-5}}, wantErr: "job_ids"},
		{name: "huge job id", in: AISearchFilters{JobIDs: []int{1 << 40}}, wantErr: "job_ids"},
		{name: "too many job ids", in: AISearchFilters{JobIDs: tooMany}, wantErr: "too many job_ids"},
		{name: "suffix ok", in: AISearchFilters{JobSuffix: " 200 "}, check: func(t *testing.T, f aiResolvedSearchFilters) {
			if f.JobSuffix != "200" || f.toFilters().JobSuffix != "200" {
				t.Fatalf("suffix = %q", f.JobSuffix)
			}
		}},
		{name: "suffix non-digit", in: AISearchFilters{JobSuffix: "2%0"}, wantErr: "job_suffix"},
		{name: "suffix with hash", in: AISearchFilters{JobSuffix: "#200"}, wantErr: "job_suffix"},
		{name: "suffix too long", in: AISearchFilters{JobSuffix: strings.Repeat("1", aiSearchMaxJobSuffix+1)}, wantErr: "job_suffix"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := normalizeSearchFilters(tc.in, searchStatuses())
			if tc.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("err = %v, want containing %q", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			tc.check(t, got)
		})
	}
}

func TestBuildSearchSQLJobFields(t *testing.T) {
	f := aiResolvedSearchFilters{JobIDs: []int32{31200, 31201}, JobSuffix: "200", Warranty: aiWarrantyAny, GroupBy: aiGroupNone, Limit: 10}
	sql, args := buildAISearchSQL(f)
	for _, want := range []string{
		"wo.reference_id = ANY($1::int[])",
		"wo.reference_id::text LIKE '%' || $2",
		"ORDER BY wo.created_at DESC NULLS LAST, wo.reference_id DESC",
	} {
		if !strings.Contains(sql, want) {
			t.Fatalf("SQL missing %q:\n%s", want, sql)
		}
	}
	if strings.Contains(sql, "31200") || strings.Contains(sql, "'200'") {
		t.Fatalf("job values leaked into SQL:\n%s", sql)
	}
	ids, ok := args[0].([]int32)
	if !ok || len(ids) != 2 || ids[0] != 31200 || ids[1] != 31201 {
		t.Fatalf("arg 0 = %#v", args[0])
	}
	if args[1] != "200" {
		t.Fatalf("arg 1 = %#v", args[1])
	}
}

func TestAISearchInterpretJobNumberSkipsLLM(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		_ = json.NewEncoder(w).Encode(map[string]any{"model": "mock", "choices": []map[string]any{
			{"message": map[string]any{"content": `{"filters":{"model":"31200"},"explanation":"x"}`}},
		}})
	}))
	t.Cleanup(srv.Close)
	useMockLLM(t, srv)

	repo := searchStub()
	router := aiToolsRouter(t, repo)
	for _, q := range []string{"31200", "job #31200", "jobs 31200, 31201", "job number 31200"} {
		resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/search/interpret",
			`{"question":"`+q+`"}`, []string{permUpdate})
		if resp.Code != http.StatusOK {
			t.Fatalf("%q: got %d %s", q, resp.Code, resp.Body.String())
		}
		var body aiInterpretResponse
		if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		f := body.Filters
		if len(f.JobIDs) == 0 || f.JobIDs[0] != 31200 {
			t.Fatalf("%q: job ids = %v", q, f.JobIDs)
		}
		if f.Text != "" || f.Model != "" || f.Serial != "" || f.CustomerName != "" || f.JobSuffix != "" {
			t.Fatalf("%q: only job_ids should be set: %+v", q, f)
		}
		if !strings.Contains(body.Explanation, "31200") {
			t.Fatalf("%q: explanation = %q", q, body.Explanation)
		}
	}
	if n := calls.Load(); n != 0 {
		t.Fatalf("LLM called %d times for job-number questions", n)
	}
	if repo.lastSearch != nil {
		t.Fatal("interpret must never execute a search")
	}

	// A normal question still goes to the LLM.
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/search/interpret",
		`{"question":"receivers from job 31200's customer"}`, []string{permUpdate})
	if resp.Code != http.StatusOK || calls.Load() != 1 {
		t.Fatalf("non-job question: code=%d calls=%d %s", resp.Code, calls.Load(), resp.Body.String())
	}
}

func TestAISearchInterpretJobNumberWorksWithoutAIKey(t *testing.T) {
	t.Setenv("OPENROUTER_API_KEY", "")
	router := aiToolsRouter(t, searchStub())
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/search/interpret",
		`{"question":"#31200"}`, []string{permUpdate})
	if resp.Code != http.StatusOK {
		t.Fatalf("got %d %s", resp.Code, resp.Body.String())
	}
}

func TestAISearchAcceptsJobFields(t *testing.T) {
	repo := searchStub()
	router := aiToolsRouter(t, repo)
	resp := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/search",
		`{"filters":{"job_ids":[31200,31200],"job_suffix":"200"}}`, []string{permUpdate})
	body := decodeSearchResponse(t, resp)
	if repo.lastSearch == nil || len(repo.lastSearch.JobIDs) != 1 || repo.lastSearch.JobSuffix != "200" {
		t.Fatalf("resolved = %+v", repo.lastSearch)
	}
	if len(body.Filters.JobIDs) != 1 || body.Filters.JobSuffix != "200" {
		t.Fatalf("echoed filters = %+v", body.Filters)
	}
	bad := partsAuditRequest(t, router, http.MethodPost, "/ai-tools/search",
		`{"filters":{"job_suffix":"20' OR 1=1"}}`, []string{permUpdate})
	if bad.Code != http.StatusBadRequest {
		t.Fatalf("bad suffix: got %d", bad.Code)
	}
}
