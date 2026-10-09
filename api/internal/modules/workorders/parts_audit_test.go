package workorders

import (
	"reflect"
	"testing"
)

func entry(action, field string, old, new *string) PartsAuditEntry {
	return PartsAuditEntry{Action: action, Field: strPtr(field), OldValue: old, NewValue: new}
}

func TestDiffPartsAudit(t *testing.T) {
	if got := diffPartsAudit("draft", "draft", 10, 10.001); len(got) != 0 {
		t.Fatalf("expected no rows, got %+v", got)
	}
	got := diffPartsAudit("approved", "ordered", 10, 12.5)
	if len(got) != 2 || got[1].Field != "status" || *got[1].Old != "approved" || *got[1].New != "ordered" ||
		got[0].Field != "total_price" || *got[0].Old != "10.00" || *got[0].New != "12.50" {
		t.Fatalf("unexpected rows %+v", got)
	}
}

func TestCreateDeleteAuditRows(t *testing.T) {
	c := createPartsAuditRows("approved", 5)
	if len(c) != 2 || c[0].Action != "create" || c[0].Old != nil || *c[0].New != "approved" || *c[1].New != "5.00" {
		t.Fatalf("bad create rows %+v", c)
	}
	d := deletePartsAuditRows("ordered", 7)
	if len(d) != 2 || d[0].Action != "delete" || d[0].New != nil || *d[0].Old != "ordered" || *d[1].Old != "7.00" {
		t.Fatalf("bad delete rows %+v", d)
	}
}

func TestComputePartsFlags(t *testing.T) {
	s := strPtr
	cases := []struct {
		name    string
		entries []PartsAuditEntry
		want    []string
	}{
		{"normal flow", []PartsAuditEntry{entry("create", "status", nil, s("draft")), entry("create", "total_price", nil, s("10.00")),
			entry("update", "total_price", s("10.00"), s("11.00")),
			entry("update", "status", s("draft"), s("waiting_approval")), entry("update", "status", s("waiting_approval"), s("approved"))}, []string{}},
		{"created approved", []PartsAuditEntry{entry("create", "status", nil, s("approved")), entry("create", "total_price", nil, s("10.00"))},
			[]string{PartsFlagApprovedWithoutReview}},
		{"price after approval", []PartsAuditEntry{entry("create", "status", nil, s("waiting_approval")),
			entry("update", "status", s("waiting_approval"), s("approved")), entry("update", "total_price", s("10.00"), s("99.00"))},
			[]string{PartsFlagPriceChangedAfterApproval}},
		{"both", []PartsAuditEntry{entry("create", "status", nil, s("approved")), entry("update", "status", s("approved"), s("ordered")),
			entry("update", "total_price", s("10.00"), s("99.00"))},
			[]string{PartsFlagApprovedWithoutReview, PartsFlagPriceChangedAfterApproval}},
		{"price reverted still warned", []PartsAuditEntry{entry("create", "status", nil, s("approved")),
			entry("update", "total_price", s("10.00"), s("99.00")), entry("update", "total_price", s("99.00"), s("10.00"))},
			[]string{PartsFlagApprovedWithoutReview, PartsFlagPriceChangedAfterApproval}},
		{"deletion does not warn", []PartsAuditEntry{entry("create", "status", nil, s("waiting_approval")),
			entry("update", "status", s("waiting_approval"), s("approved")), entry("delete", "total_price", s("10.00"), nil)}, []string{}},
		{"no-op price does not warn", []PartsAuditEntry{entry("create", "status", nil, s("waiting_approval")),
			entry("update", "status", s("waiting_approval"), s("approved")), entry("update", "total_price", s("10.00"), s("10.00"))}, []string{}},
		{"no history", nil, []string{}},
	}
	for _, tc := range cases {
		if got := ComputePartsFlags(tc.entries); !reflect.DeepEqual(got, tc.want) {
			t.Errorf("%s: got %v want %v", tc.name, got, tc.want)
		}
	}
}

func TestPartsFlagsUseWriteOrder(t *testing.T) {
	waiting := entry("create", "status", nil, strPtr("waiting_approval"))
	waiting.ID = 1
	price := entry("update", "total_price", strPtr("10.00"), strPtr("20.00"))
	price.ID = 2
	approval := entry("update", "status", strPtr("waiting_approval"), strPtr("approved"))
	approval.ID = 3
	entries := []PartsAuditEntry{approval, price, waiting}
	if got := ComputePartsFlags(entries); len(got) != 0 {
		t.Fatalf("price edited alongside first approval: %v", got)
	}
	if entries[0].ID != 3 {
		t.Fatal("flag computation mutated input history")
	}
	price.AfterApproval = true
	if got := ComputePartsFlags([]PartsAuditEntry{price}); !reflect.DeepEqual(got, []string{PartsFlagPriceChangedAfterApproval}) {
		t.Fatalf("preexisting approved request: %v", got)
	}
}
