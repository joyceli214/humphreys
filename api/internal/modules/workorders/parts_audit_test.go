package workorders

import (
	"humphreys/api/internal/domain"
	"reflect"
	"testing"
)

func entry(action, field string, old, new *string) PartsAuditEntry {
	return PartsAuditEntry{Action: action, Field: strPtr(field), OldValue: old, NewValue: new}
}

func TestDiffPartsAudit(t *testing.T) {
	old := domain.PartsPurchaseRequest{Status: "approved", TotalPrice: 10, Quantity: 1, ItemName: "Part", Source: "supplier"}
	updated := old
	updated.TotalPrice = 10.001
	if got := diffPartsAudit(old, updated); len(got) != 0 {
		t.Fatalf("rounded no-op: %+v", got)
	}
	updated = domain.PartsPurchaseRequest{Status: "ordered", TotalPrice: 12.5, Quantity: 2, ItemName: "New_part", Source: "online", SourceURL: strPtr("https://example.com/a_b")}
	got := diffPartsAudit(old, updated)
	want := []partsAuditRow{
		{Action: "update", Field: "total_price", Old: strPtr("10.00"), New: strPtr("12.50")},
		{Action: "update", Field: "quantity", Old: strPtr("1"), New: strPtr("2")},
		{Action: "update", Field: "item_name", Old: strPtr("Part"), New: strPtr("New_part")},
		{Action: "update", Field: "source", Old: strPtr("supplier"), New: strPtr("online")},
		{Action: "update", Field: "source_url", New: strPtr("https://example.com/a_b")},
		{Action: "update", Field: "status", Old: strPtr("approved"), New: strPtr("ordered")},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v want %+v", got, want)
	}
	cleared := updated
	cleared.SourceURL = nil
	got = diffPartsAudit(updated, cleared)
	if len(got) != 1 || got[0].New != nil || *got[0].Old != "https://example.com/a_b" {
		t.Fatalf("URL clearing: %+v", got)
	}
}

func TestCreateDeleteAuditRows(t *testing.T) {
	item := domain.PartsPurchaseRequest{Status: "approved", TotalPrice: 5, Quantity: 2, ItemName: "Part", Source: "supplier"}
	c, d := createPartsAuditRows(item), deletePartsAuditRows(item)
	if len(c) != 6 || len(d) != 6 {
		t.Fatalf("incomplete snapshots: %+v %+v", c, d)
	}
	for i := range c {
		if c[i].Action != "create" || c[i].Old != nil || d[i].Action != "delete" || d[i].New != nil || !sameAuditValue(c[i].New, d[i].Old) {
			t.Fatalf("snapshot mismatch: %+v %+v", c[i], d[i])
		}
	}
	if *c[1].New != "5.00" || *c[2].New != "2" || *c[3].New != "Part" || *c[4].New != "supplier" || c[5].New != nil {
		t.Fatalf("bad snapshot: %+v", c)
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
		{"draft price edit", []PartsAuditEntry{entry("create", "status", nil, s("draft")), entry("update", "total_price", s("10.00"), s("99.00"))}, []string{}},
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
