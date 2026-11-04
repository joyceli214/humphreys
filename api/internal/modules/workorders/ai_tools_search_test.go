package workorders

import (
	"strconv"
	"strings"
	"testing"
	"time"
)

func searchStatuses() []AIStatusOption {
	return []AIStatusOption{
		{ID: 1, Name: "In Progress", Group: "in_progress"},
		{ID: 2, Name: "Finished", Group: "completed"},
		{ID: 3, Name: "Picked Up", Group: "completed"},
	}
}

func TestNormalizeSearchFilters(t *testing.T) {
	cases := []struct {
		name    string
		in      AISearchFilters
		wantErr string
		check   func(t *testing.T, f aiResolvedSearchFilters)
	}{
		{name: "defaults", in: AISearchFilters{}, check: func(t *testing.T, f aiResolvedSearchFilters) {
			if f.Limit != aiSearchDefaultLimit || f.Offset != 0 || f.Warranty != aiWarrantyAny || f.GroupBy != aiGroupNone {
				t.Fatalf("bad defaults: %+v", f)
			}
		}},
		{name: "limit capped", in: AISearchFilters{Limit: 5000}, check: func(t *testing.T, f aiResolvedSearchFilters) {
			if f.Limit != aiSearchMaxLimit {
				t.Fatalf("limit = %d", f.Limit)
			}
		}},
		{name: "negative offset", in: AISearchFilters{Offset: -3}, wantErr: "offset"},
		{name: "status resolved case-insensitively", in: AISearchFilters{Statuses: []string{"finished", " Picked  Up "}}, check: func(t *testing.T, f aiResolvedSearchFilters) {
			if len(f.StatusIDs) != 2 || f.StatusIDs[0] != 2 || f.StatusIDs[1] != 3 {
				t.Fatalf("status ids = %v", f.StatusIDs)
			}
		}},
		{name: "unknown status", in: AISearchFilters{Statuses: []string{"Teleported"}}, wantErr: `unknown status "Teleported"`},
		{name: "bad warranty", in: AISearchFilters{Warranty: "maybe"}, wantErr: "warranty"},
		{name: "bad group_by", in: AISearchFilters{GroupBy: "color"}, wantErr: "group_by"},
		{name: "bad date", in: AISearchFilters{CreatedFrom: "03/11/2026"}, wantErr: "created_from"},
		{name: "reversed dates", in: AISearchFilters{CreatedFrom: "2026-05-01", CreatedTo: "2026-01-01"}, wantErr: "created_from"},
		{name: "negative min_units", in: AISearchFilters{MinUnits: -1}, wantErr: "min_units"},
		{name: "text trimmed and collapsed", in: AISearchFilters{Model: "  RX   V671 "}, check: func(t *testing.T, f aiResolvedSearchFilters) {
			if f.Model != "RX V671" {
				t.Fatalf("model = %q", f.Model)
			}
		}},
		{name: "overlong text", in: AISearchFilters{Text: strings.Repeat("a", 201)}, wantErr: "too long"},
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
			if tc.check != nil {
				tc.check(t, got)
			}
		})
	}
}

// TestBuildSearchSQLArgSafety ensures every user-supplied value travels as a
// bind argument and never appears inside the SQL text itself.
func TestBuildSearchSQLArgSafety(t *testing.T) {
	evil := `x'; DROP TABLE work_orders; --`
	cases := []struct {
		name     string
		f        aiResolvedSearchFilters
		wantSQL  []string
		wantArgs []any
	}{
		{name: "text", f: aiResolvedSearchFilters{Text: evil}, wantSQL: []string{"ILIKE $1"}, wantArgs: []any{"%x'; DROP TABLE work\\_orders; --%"}},
		{name: "customer", f: aiResolvedSearchFilters{CustomerName: evil}, wantSQL: []string{"full_name_search"}},
		{name: "model", f: aiResolvedSearchFilters{Model: evil}, wantSQL: []string{"wo.model_number"}},
		{name: "serial", f: aiResolvedSearchFilters{Serial: evil}, wantSQL: []string{"wo.serial_number"}},
		{name: "brand", f: aiResolvedSearchFilters{Brand: evil}, wantSQL: []string{"b.brand_name ILIKE"}},
		{name: "equipment", f: aiResolvedSearchFilters{Equipment: evil}, wantSQL: []string{"i.item_name"}},
		{name: "like wildcards escaped", f: aiResolvedSearchFilters{Model: "50%_off\\"}, wantArgs: []any{`%50\%\_off\\%`}},
		{name: "statuses", f: aiResolvedSearchFilters{StatusIDs: []int64{2, 3}}, wantSQL: []string{"wo.status_id = ANY($1::bigint[])"}, wantArgs: []any{[]int64{2, 3}}},
		{name: "dates", f: aiResolvedSearchFilters{CreatedFrom: "2026-01-01", CreatedTo: "2026-02-01"}, wantSQL: []string{">= $1::date", "<= $2::date"}, wantArgs: []any{"2026-01-01", "2026-02-01"}},
		{name: "min units", f: aiResolvedSearchFilters{MinUnits: 3}, wantSQL: []string{"HAVING COUNT(*) >= $1"}, wantArgs: []any{3}},
		{name: "min serial jobs", f: aiResolvedSearchFilters{MinSerialJobs: 2}, wantSQL: []string{"serial_number", "HAVING COUNT(*) >= $1"}, wantArgs: []any{2}},
		{name: "warranty only", f: aiResolvedSearchFilters{Warranty: aiWarrantyOnly}, wantSQL: []string{"(" + aiWarrantyPredicate + ")"}},
		{name: "warranty exclude", f: aiResolvedSearchFilters{Warranty: aiWarrantyExclude}, wantSQL: []string{"NOT (" + aiWarrantyPredicate + ")"}},
		{name: "include linked", f: aiResolvedSearchFilters{IncludeLinked: true}, wantSQL: []string{"w.original_job_id = m.reference_id", "w.reference_id = m.original_job_id"}},
		{name: "group by customer orders by customer", f: aiResolvedSearchFilters{GroupBy: aiGroupCustomer}, wantSQL: []string{"ORDER BY customer_name"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tc.f.Limit, tc.f.Offset = 25, 50
			if tc.f.Warranty == "" {
				tc.f.Warranty = aiWarrantyAny
			}
			sql, args := buildAISearchSQL(tc.f)
			if strings.Contains(sql, "DROP TABLE") || strings.Contains(sql, "50%") {
				t.Fatalf("user value leaked into SQL:\n%s", sql)
			}
			for _, want := range tc.wantSQL {
				if !strings.Contains(sql, want) {
					t.Fatalf("SQL missing %q:\n%s", want, sql)
				}
			}
			for i, want := range tc.wantArgs {
				if i >= len(args) || !argEqual(args[i], want) {
					t.Fatalf("arg %d = %#v, want %#v (all args %#v)", i, safeIndex(args, i), want, args)
				}
			}
			// Limit and offset are always the last two bind args.
			n := len(args)
			if n < 2 || args[n-2] != 25 || args[n-1] != 50 {
				t.Fatalf("limit/offset args = %#v", args)
			}
			if !strings.Contains(sql, "LIMIT $"+strconv.Itoa(n-1)+" OFFSET $"+strconv.Itoa(n)) {
				t.Fatalf("limit/offset placeholders wrong:\n%s", sql)
			}
			if strings.Contains(strings.ToLower(sql), "c.email") || strings.Contains(sql, "_phone") {
				t.Fatalf("search SQL must not select email/phone:\n%s", sql)
			}
		})
	}
}

func TestGroupSearchRows(t *testing.T) {
	cust := func(id int64) *int64 { return &id }
	created := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	rows := []AISearchRow{
		{ReferenceID: 10, CustomerID: cust(1), CustomerName: "Jane Doe", ModelNumber: "RX-V671", SerialNumber: "S1", CustomerJobCount: 4, CreatedAt: &created},
		{ReferenceID: 11, CustomerID: cust(1), CustomerName: "Jane Doe", ModelNumber: "rx-v671 ", SerialNumber: "s1", CustomerJobCount: 4},
		{ReferenceID: 12, CustomerID: cust(2), CustomerName: "Bob Ray", ModelNumber: "SX-780", SerialNumber: "", CustomerJobCount: 1},
		{ReferenceID: 13, CustomerID: nil, CustomerName: "Unknown", ModelNumber: "", SerialNumber: "S9"},
	}

	if got := groupSearchRows(rows, aiGroupNone); len(got) != 0 {
		t.Fatalf("none grouping returned %v", got)
	}

	byCustomer := groupSearchRows(rows, aiGroupCustomer)
	if len(byCustomer) != 2 {
		t.Fatalf("customer groups = %+v", byCustomer)
	}
	if byCustomer[0].Label != "Jane Doe" || byCustomer[0].UnitCount != 4 || len(byCustomer[0].JobIDs) != 2 {
		t.Fatalf("first customer group = %+v", byCustomer[0])
	}

	byModel := groupSearchRows(rows, aiGroupModel)
	if len(byModel) != 2 || byModel[0].Label != "RX-V671" || len(byModel[0].JobIDs) != 2 || byModel[0].UnitCount != 2 {
		t.Fatalf("model groups = %+v", byModel)
	}

	bySerial := groupSearchRows(rows, aiGroupSerial)
	if len(bySerial) != 2 || bySerial[0].JobIDs[0] != 10 || bySerial[0].JobIDs[1] != 11 {
		t.Fatalf("serial groups = %+v", bySerial)
	}
}

func argEqual(a, b any) bool {
	switch av := a.(type) {
	case []int64:
		bv, ok := b.([]int64)
		if !ok || len(av) != len(bv) {
			return false
		}
		for i := range av {
			if av[i] != bv[i] {
				return false
			}
		}
		return true
	default:
		return a == b
	}
}

func safeIndex(args []any, i int) any {
	if i < len(args) {
		return args[i]
	}
	return nil
}

