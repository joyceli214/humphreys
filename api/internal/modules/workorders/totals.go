package workorders

import (
	"humphreys/api/internal/domain"
	"math"
)

type Totals struct {
	LabourDiscount float64 `json:"labour_discount"`
	NetLabour      float64 `json:"net_labour"`
	Subtotal       float64 `json:"subtotal"`
	HST            float64 `json:"hst"`
	Total          float64 `json:"total"`
	Payable        float64 `json:"payable"`
}

func round2(v float64) float64 { return math.Round((v+math.Copysign(1e-9, v))*100) / 100 }
func CalculateTotals(item domain.WorkOrderDetail) Totals {
	labour := round2(float64Value(item.LabourTotal))
	discount := 0.0
	if item.LabourDiscountType != nil && item.LabourDiscountValue != nil {
		discount = *item.LabourDiscountValue
		if *item.LabourDiscountType == "percent" {
			discount = round2(labour * discount / 100)
		}
		discount = round2(math.Max(0, math.Min(discount, math.Max(0, labour))))
	}
	net := round2(labour - discount)
	subtotal := round2(round2(float64Value(item.PartsTotal)) + round2(float64Value(item.DeliveryTotal)) + net)
	tax := round2(subtotal * .13)
	total := round2(subtotal + tax)
	return Totals{discount, net, subtotal, tax, total, round2(total - item.Deposit)}
}
