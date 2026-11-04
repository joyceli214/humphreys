package workorders

import (
	"strconv"
	"strings"

	"humphreys/api/internal/domain"
)

// lineAmount is unit price x quantity as the work order page computes it, or
// ok=false when the quantity is not numeric.
func lineAmount(unitPrice float64, quantityText *string) (float64, bool) {
	text := massUpdateLineTotalText(unitPrice, quantityText)
	if text == nil {
		return 0, false
	}
	v, err := strconv.ParseFloat(*text, 64)
	if err != nil {
		return 0, false
	}
	return v, true
}

// labourTotalDelta is the change in labour charged.
func labourTotalDelta(current, next float64) float64 {
	return round2(next - current)
}

// lineItemPriceDelta is the change in a line's total after a price change. A
// non-numeric quantity keeps the stored line total, so the delta is 0.
func lineItemPriceDelta(line domain.WorkOrderLineItem, newPrice float64) float64 {
	newAmt, ok := lineAmount(newPrice, line.QuantityText)
	if !ok {
		return 0
	}
	oldAmt, _ := lineAmount(float64Value(line.UnitPrice), line.QuantityText)
	return round2(newAmt - oldAmt)
}

// addLineItemDelta is the new line's amount (0 without a price or with a
// non-numeric quantity).
func addLineItemDelta(unitPrice *float64, quantityText *string) float64 {
	if unitPrice == nil {
		return 0
	}
	amt, _ := lineAmount(*unitPrice, quantityText)
	return round2(amt)
}

// removeLineItemDelta is minus the line's current total: the stored
// line_total_text when numeric, else unit price x quantity, else 0.
func removeLineItemDelta(line domain.WorkOrderLineItem) float64 {
	if t := strings.TrimSpace(stringValue(line.LineTotalText)); t != "" {
		if v, err := strconv.ParseFloat(t, 64); err == nil {
			return round2(-v)
		}
	}
	if line.UnitPrice != nil {
		if amt, ok := lineAmount(*line.UnitPrice, line.QuantityText); ok {
			return round2(-amt)
		}
	}
	return 0
}

// discountAmount is the money taken off labour by a discount.
func discountAmount(kind *string, value *float64, labour float64) float64 {
	if kind == nil || value == nil {
		return 0
	}
	switch strings.ToLower(strings.TrimSpace(*kind)) {
	case "percent":
		return labour * *value / 100
	case "amount":
		return *value
	default:
		return 0
	}
}

// labourDiscountDelta is the change in the job total from replacing the
// current discount: a bigger discount lowers the total.
func labourDiscountDelta(detail *domain.WorkOrderDetail, kind string, value float64, labour float64) float64 {
	oldAmt := discountAmount(detail.LabourDiscountType, detail.LabourDiscountValue, labour)
	newAmt := discountAmount(&kind, &value, labour)
	return round2(-(newAmt - oldAmt))
}
