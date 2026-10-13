type TotalsInput = {
 parts_total?: number | null; delivery_total?: number | null; labour_total?: number | null; deposit?: number;
 labour_discount_type?: "percent" | "amount" | null; labour_discount_value?: number | null;
};
const round2 = (value: number) => Math.round((value + Math.sign(value) * 1e-9) * 100) / 100;
export function workOrderTotals(item: TotalsInput) {
 const labour = round2(item.labour_total ?? 0);
 let labourDiscount = 0;
 if (item.labour_discount_type && item.labour_discount_value != null) {
  labourDiscount = item.labour_discount_type === "percent" ? round2(labour * item.labour_discount_value / 100) : item.labour_discount_value;
  labourDiscount = round2(Math.max(0, Math.min(labourDiscount, Math.max(0, labour))));
 }
 const netLabour = round2(labour - labourDiscount);
 const subtotal = round2(round2(item.parts_total ?? 0) + round2(item.delivery_total ?? 0) + netLabour);
 const hst = round2(subtotal * .13);
 const total = round2(subtotal + hst);
 return { labourDiscount, netLabour, subtotal, hst, total, payable: round2(total - (item.deposit ?? 0)) };
}
