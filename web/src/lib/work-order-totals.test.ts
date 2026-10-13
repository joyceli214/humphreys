import { describe, expect, it } from "vitest";
import { workOrderTotals } from "./work-order-totals";
describe("work order totals", () => {
 it.each([
  ["percent", 100, "percent", 10, [10,90,120,15.6,135.6,130.6]],
  ["capped amount",100,"amount",150,[100,0,30,3.9,33.9,28.9]],
  ["none",100,null,null,[0,100,130,16.9,146.9,141.9]],
  ["empty labour",null,"amount",10,[0,0,30,3.9,33.9,28.9]],
  ["rounding",10.05,"percent",10,[1.01,9.04,39.04,5.08,44.12,39.12]],
 ] as const)("%s", (_name, labour, type, value, expected) => {
  const totals = workOrderTotals({parts_total:20,delivery_total:10,labour_total:labour,labour_discount_type:type,labour_discount_value:value,deposit:5});
  expect(Object.values(totals)).toEqual(expected);
 });
 it("does not clamp payable after deposit", () => {expect(workOrderTotals({deposit:10}).payable).toBe(-10);});
});
