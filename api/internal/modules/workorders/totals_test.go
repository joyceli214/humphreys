package workorders

import (
	"humphreys/api/internal/domain"
	"math"
	"testing"
)

func discountPtr[T any](v T) *T { return &v }
func TestValidateLabourDiscount(t *testing.T) {
	for _, tc := range []struct {
		name          string
		kind          *string
		value, labour *float64
		valid         bool
	}{
		{"none", nil, nil, nil, true}, {"clear ignores value", nil, discountPtr(5.0), nil, true},
		{"percent", discountPtr("percent"), discountPtr(10.0), discountPtr(100.0), true},
		{"percent empty labour", discountPtr("percent"), discountPtr(10.0), nil, true},
		{"percent limit", discountPtr("percent"), discountPtr(100.0), nil, true},
		{"too high percent", discountPtr("percent"), discountPtr(101.0), nil, false},
		{"negative", discountPtr("amount"), discountPtr(-1.0), discountPtr(100.0), false},
		{"amount", discountPtr("amount"), discountPtr(100.0), discountPtr(100.0), true},
		{"exceeds labour", discountPtr("amount"), discountPtr(101.0), discountPtr(100.0), false},
		{"empty labour", discountPtr("amount"), discountPtr(0.0), nil, false},
		{"missing value", discountPtr("percent"), nil, nil, false},
		{"unknown type", discountPtr("none"), discountPtr(0.0), nil, false},
		{"nonfinite", discountPtr("amount"), discountPtr(math.Inf(1)), discountPtr(100.0), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := ValidateLabourDiscount(tc.kind, tc.value, tc.labour); (got == nil) != tc.valid {
				t.Fatalf("validation = %v", got)
			}
		})
	}
}
func TestCalculateTotals(t *testing.T) {
	for _, tc := range []struct {
		name   string
		labour *float64
		kind   *string
		value  *float64
		want   Totals
	}{
		{"percent", discountPtr(100.0), discountPtr("percent"), discountPtr(10.0), Totals{10, 90, 120, 15.6, 135.6, 130.6}},
		{"capped amount", discountPtr(100.0), discountPtr("amount"), discountPtr(150.0), Totals{100, 0, 30, 3.9, 33.9, 28.9}},
		{"none", discountPtr(100.0), nil, nil, Totals{0, 100, 130, 16.9, 146.9, 141.9}},
		{"empty labour", nil, discountPtr("amount"), discountPtr(10.0), Totals{0, 0, 30, 3.9, 33.9, 28.9}},
		{"rounding", discountPtr(10.05), discountPtr("percent"), discountPtr(10.0), Totals{1.01, 9.04, 39.04, 5.08, 44.12, 39.12}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := CalculateTotals(domain.WorkOrderDetail{PartsTotal: discountPtr(20.0), DeliveryTotal: discountPtr(10.0), LabourTotal: tc.labour, LabourDiscountType: tc.kind, LabourDiscountValue: tc.value, Deposit: 5})
			if got != tc.want {
				t.Fatalf("got %+v want %+v", got, tc.want)
			}
		})
	}
}
