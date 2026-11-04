package workorders

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"humphreys/api/internal/domain"
)

func TestFindCatalogEntryCaseInsensitive(t *testing.T) {
	e, ok := findCatalogEntry("  belt   kit / SHIPPING ")
	if !ok || e.Name != "Belt Kit / Shipping" || e.UnitPrice != 32 || e.QuantityText != "1" {
		t.Fatalf("lookup failed: %+v ok=%v", e, ok)
	}
	if _, ok := findCatalogEntry("Flux capacitor"); ok {
		t.Fatal("unknown name should not match")
	}
}

func TestLineItemCatalogReturnsCopy(t *testing.T) {
	items := LineItemCatalog()
	if len(items) != 12 {
		t.Fatalf("expected 12 entries, got %d", len(items))
	}
	items[0].UnitPrice = 9999
	if LineItemCatalog()[0].UnitPrice == 9999 {
		t.Fatal("LineItemCatalog must return a copy")
	}
}

func TestLineItemCatalogEndpoint(t *testing.T) {
	router := aiToolsRouter(t, massUpdateStub())
	resp := partsAuditRequest(t, router, http.MethodGet, "/ai-tools/line-item-catalog", "", []string{permUpdate})
	if resp.Code != http.StatusOK {
		t.Fatalf("catalog: got %d %s", resp.Code, resp.Body.String())
	}
	var body struct {
		Items []LineItemCatalogEntry `json:"items"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Items) != len(lineItemCatalog) || body.Items[0].Name != lineItemCatalog[0].Name {
		t.Fatalf("unexpected items: %+v", body.Items)
	}
	if resp := partsAuditRequest(t, router, http.MethodGet, "/ai-tools/line-item-catalog", "", []string{permStatusUpdate}); resp.Code != http.StatusForbidden {
		t.Fatalf("staff: got %d, want 403", resp.Code)
	}
}

func TestMassUpdatePromptIncludesCatalog(t *testing.T) {
	p := buildMassUpdatePrompt("add a belt kit to 123", nil, nil)
	for _, want := range []string{
		"Line item catalog (typical prices)",
		"- Belt Kit / Shipping: unit_price 32, quantity_text 1",
		"- DFL / CA / IA / W / Supplies: unit_price 60, quantity_text 0.4",
		"- Capacitor Kit / Shipping: unit_price 77.7, quantity_text 1",
		"use the catalog name exactly",
	} {
		if !strings.Contains(p, want) {
			t.Fatalf("prompt missing %q:\n%s", want, p)
		}
	}
}

func moneyDetail() *domain.WorkOrderDetail {
	return &domain.WorkOrderDetail{
		ReferenceID: 7,
		LabourTotal: ptrFloat(200),
		LineItems: []domain.WorkOrderLineItem{
			{LineItemID: 1, ItemName: ptrStr("DFL/L/Supplies"), UnitPrice: ptrFloat(50), QuantityText: ptrStr("0.4"), LineTotalText: ptrStr("20.00")},
			{LineItemID: 2, ItemName: ptrStr("Belt"), UnitPrice: ptrFloat(10), QuantityText: ptrStr("two"), LineTotalText: ptrStr("20.00")},
			{LineItemID: 3, ItemName: ptrStr("Cartridge"), UnitPrice: ptrFloat(89.9), QuantityText: ptrStr("2"), LineTotalText: ptrStr("170.00")},
			{LineItemID: 4, ItemName: ptrStr("Odd"), UnitPrice: ptrFloat(12.5), QuantityText: ptrStr("2"), LineTotalText: ptrStr("n/a")},
		},
	}
}

func runMoneyOp(t *testing.T, op MassUpdateOp, detail *domain.WorkOrderDetail, override *float64) MassUpdatePreviewRow {
	t.Helper()
	row := MassUpdatePreviewRow{Operation: op, ReferenceID: op.ReferenceID}
	_, ok := applyOpToRow(&row, op, detail, map[string]AIStatusOption{"finished": {ID: 2, Name: "Finished"}}, newLocationLookup(nil), override)
	if !ok {
		t.Fatalf("op %+v should be valid: %s", op, row.Error)
	}
	return row
}

func TestAmountDeltaLabourTotal(t *testing.T) {
	row := runMoneyOp(t, MassUpdateOp{ReferenceID: 7, Op: massOpSetLabourTotal, LabourTotal: ptrFloat(150.556)}, moneyDetail(), nil)
	if row.AmountDelta != -49.44 {
		t.Fatalf("delta = %v, want -49.44", row.AmountDelta)
	}
}

func TestAmountDeltaLineItemPrice(t *testing.T) {
	// 60*0.4 - 50*0.4 = 24 - 20 = 4
	row := runMoneyOp(t, MassUpdateOp{ReferenceID: 7, Op: massOpSetLineItemPrice, LineItemID: ptrInt64(1), UnitPrice: ptrFloat(60)}, moneyDetail(), nil)
	if row.AmountDelta != 4 {
		t.Fatalf("delta = %v, want 4", row.AmountDelta)
	}
	// Non-numeric quantity keeps the stored total, so the delta is 0.
	row = runMoneyOp(t, MassUpdateOp{ReferenceID: 7, Op: massOpSetLineItemPrice, LineItemID: ptrInt64(2), UnitPrice: ptrFloat(16.5)}, moneyDetail(), nil)
	if row.AmountDelta != 0 {
		t.Fatalf("non-numeric qty delta = %v, want 0", row.AmountDelta)
	}
}

func TestAmountDeltaAddLineItem(t *testing.T) {
	row := runMoneyOp(t, MassUpdateOp{ReferenceID: 7, Op: massOpAddLineItem, ItemName: ptrStr("DFL/L/Supplies"), UnitPrice: ptrFloat(60), QuantityText: ptrStr("0.4")}, moneyDetail(), nil)
	if row.AmountDelta != 24 {
		t.Fatalf("delta = %v, want 24", row.AmountDelta)
	}
	row = runMoneyOp(t, MassUpdateOp{ReferenceID: 7, Op: massOpAddLineItem, ItemName: ptrStr("Belt"), UnitPrice: ptrFloat(16.5)}, moneyDetail(), nil)
	if row.AmountDelta != 16.5 {
		t.Fatalf("blank qty delta = %v, want 16.5", row.AmountDelta)
	}
	row = runMoneyOp(t, MassUpdateOp{ReferenceID: 7, Op: massOpAddLineItem, ItemName: ptrStr("Belt")}, moneyDetail(), nil)
	if row.AmountDelta != 0 {
		t.Fatalf("no price delta = %v, want 0", row.AmountDelta)
	}
	row = runMoneyOp(t, MassUpdateOp{ReferenceID: 7, Op: massOpAddLineItem, ItemName: ptrStr("Belt"), UnitPrice: ptrFloat(16.5), QuantityText: ptrStr("two")}, moneyDetail(), nil)
	if row.AmountDelta != 0 {
		t.Fatalf("non-numeric qty delta = %v, want 0", row.AmountDelta)
	}
}

func TestAmountDeltaRemoveLineItem(t *testing.T) {
	// Uses the stored line_total_text (170.00), not 89.9*2.
	row := runMoneyOp(t, MassUpdateOp{ReferenceID: 7, Op: massOpRemoveLineItem, LineItemID: ptrInt64(3)}, moneyDetail(), nil)
	if row.AmountDelta != -170 {
		t.Fatalf("delta = %v, want -170", row.AmountDelta)
	}
	// Non-numeric line_total_text falls back to unit price x quantity.
	row = runMoneyOp(t, MassUpdateOp{ReferenceID: 7, Op: massOpRemoveLineItem, LineItemID: ptrInt64(4)}, moneyDetail(), nil)
	if row.AmountDelta != -25 {
		t.Fatalf("fallback delta = %v, want -25", row.AmountDelta)
	}
}

func TestAmountDeltaLabourDiscount(t *testing.T) {
	// No discount -> 10% of 200 = 20 off.
	row := runMoneyOp(t, MassUpdateOp{ReferenceID: 7, Op: massOpSetLabourDiscount, DiscountType: ptrStr("percent"), DiscountValue: ptrFloat(10)}, moneyDetail(), nil)
	if row.AmountDelta != -20 {
		t.Fatalf("delta = %v, want -20", row.AmountDelta)
	}
	// Existing $30 off -> 10% of 200 = 20: total rises by 10.
	d := moneyDetail()
	d.LabourDiscountType = ptrStr("amount")
	d.LabourDiscountValue = ptrFloat(30)
	row = runMoneyOp(t, MassUpdateOp{ReferenceID: 7, Op: massOpSetLabourDiscount, DiscountType: ptrStr("percent"), DiscountValue: ptrFloat(10)}, d, nil)
	if row.AmountDelta != 10 {
		t.Fatalf("delta = %v, want 10", row.AmountDelta)
	}
	// Labour override (300) is used for the percent base.
	row = runMoneyOp(t, MassUpdateOp{ReferenceID: 7, Op: massOpSetLabourDiscount, DiscountType: ptrStr("percent"), DiscountValue: ptrFloat(10)}, moneyDetail(), ptrFloat(300))
	if row.AmountDelta != -30 {
		t.Fatalf("override delta = %v, want -30", row.AmountDelta)
	}
}

func TestAmountDeltaStatusZero(t *testing.T) {
	row := runMoneyOp(t, MassUpdateOp{ReferenceID: 7, Op: massOpSetStatus, StatusName: ptrStr("Finished")}, moneyDetail(), nil)
	if row.AmountDelta != 0 {
		t.Fatalf("delta = %v, want 0", row.AmountDelta)
	}
}
