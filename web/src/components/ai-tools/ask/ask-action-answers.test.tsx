import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskPartsChange } from "@/lib/ai-tools/types";
const mocks = vi.hoisted(() => ({
 updatePartsPurchaseRequest: vi.fn(), createPartsPurchaseRequest: vi.fn(), getCompleteJobStatusTarget: vi.fn(),
 listWorkOrderStatuses: vi.fn(), updateWorkOrderStatus: vi.fn(), createWorkOrder: vi.fn(), updateWorkOrderWorkNotes: vi.fn(),
 createBrand: vi.fn(), createItem: vi.fn(), listDropdownManagement: vi.fn()
}));
vi.mock("@/lib/api/client", () => ({apiClient: mocks, APIError: class extends Error { constructor(message: string, public status: number) { super(message); } }}));
import { CompleteJobAnswer, InvoiceAnswer, PartsCreateAnswer } from "./ask-action-answers";
import { PartsChangeAnswer } from "./ask-skill-answers";
const ch = (id = 501, extra: Partial<AskPartsChange> = {}): AskPartsChange => ({parts_purchase_request_id:id, reference_id:275, item_name:"Belt", quantity:1, source:"supplier", old_status:"approved", new_status:"ordered", old_price:0, new_price:4.5, old_source_url:null, new_source_url:null, updated_at:"2026-11-14T01:00:00Z",valid:true,...extra});
beforeEach(() => { vi.resetAllMocks(); mocks.getCompleteJobStatusTarget.mockResolvedValue({status_id:20}); mocks.updateWorkOrderStatus.mockResolvedValue({}); mocks.listDropdownManagement.mockResolvedValue({items:[]}); });
afterEach(cleanup);
describe("Ask finish previews and existing Apply paths", () => {
 it("applies only checked valid invoice rows, surfacing stale failures", async () => {
  mocks.updatePartsPurchaseRequest.mockRejectedValue(Object.assign(new Error("stale"),{status:409}));
  render(<InvoiceAnswer preview={{invoice_number:"INV-7781",lines:[{text:"Belt",price:4.5,match:"matched",change:ch()},{text:"Switch",price:7,match:"matched",change:ch(502)},{text:"Roller",price:12,match:"matched",change:ch(503,{valid:false,error:"Needs approval"})},{text:"Cap",price:null,match:"ambiguous",candidates:[{parts_purchase_request_id:9,reference_id:275,item_name:"Cap",quantity:1,status:"approved",total_price:0}]}]}} />);
  expect(screen.getByText(/INV-7781/)).toBeInTheDocument(); expect(mocks.updatePartsPurchaseRequest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("Apply invoice line 2")); fireEvent.click(screen.getByRole("button",{name:"Apply"}));
  expect(await screen.findByText(/changed after the preview/)).toBeInTheDocument(); expect(mocks.updatePartsPurchaseRequest).toHaveBeenCalledTimes(1);
  expect(mocks.updatePartsPurchaseRequest).toHaveBeenCalledWith(275,501,expect.objectContaining({status:"ordered",total_price:4.5,updated_at:ch().updated_at}));
 });
 it("approves then orders with the returned timestamp and price", async () => {
  mocks.updatePartsPurchaseRequest.mockResolvedValueOnce({updated_at:"fresh"}).mockResolvedValueOnce({});
  render(<PartsChangeAnswer preview={{action:"approve_order",changes:[ch(601,{old_status:"waiting_approval",via_status:"approved"})]}} reply="" />);
  fireEvent.click(screen.getByRole("button",{name:"Apply"})); await screen.findByText(/1 parts request updated/);
  expect(mocks.updatePartsPurchaseRequest.mock.calls.map(c=>c[2])).toEqual([expect.objectContaining({status:"approved",updated_at:ch().updated_at,total_price:4.5}),expect.objectContaining({status:"ordered",updated_at:"fresh",total_price:4.5})]);
 });
 it("stops after failed approval", async () => {
  mocks.updatePartsPurchaseRequest.mockRejectedValue(new Error("denied"));
  render(<PartsChangeAnswer preview={{action:"approve_order",changes:[ch(601,{via_status:"approved"})]}} reply="" />);
  fireEvent.click(screen.getByRole("button",{name:"Apply"})); await screen.findByText(/denied/); expect(mocks.updatePartsPurchaseRequest).toHaveBeenCalledTimes(1);
 });
 it("creates a parts request only on Apply", async () => {
  mocks.createPartsPurchaseRequest.mockResolvedValue({parts_purchase_request_id:99});
  render(<PartsCreateAnswer preview={{reference_id:275,item_name:"L6",quantity:2,total_price:3.5,source:"online",source_url:null,status:"waiting_approval",preset_match:true}} />);
  expect(screen.getByText("L6")).toBeInTheDocument(); expect(mocks.createPartsPurchaseRequest).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button",{name:"Apply"}));
  await screen.findByText(/Request 99 created/); expect(mocks.createPartsPurchaseRequest).toHaveBeenCalledWith(275,{item_name:"L6",quantity:2,total_price:3.5,source:"online",source_url:null,status:"waiting_approval"});
 });
 it("completes through the button target and status PATCH, skipping already rows", async () => {
  render(<CompleteJobAnswer preview={{target_status_id:20,target_status_name:"Finished",target_source:"setting",jobs:[{reference_id:275,current_status_id:9,current_status_name:"Received",already:false},{reference_id:276,current_status_id:20,current_status_name:"Finished",already:true}]}} />);
  expect(screen.getByText(/same as the Complete Job button/i)).toBeInTheDocument(); expect(mocks.updateWorkOrderStatus).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button",{name:"Apply"}));
  await screen.findByText(/Job #275 completed/); expect(mocks.getCompleteJobStatusTarget).toHaveBeenCalled(); expect(mocks.updateWorkOrderStatus).toHaveBeenCalledTimes(1); expect(mocks.updateWorkOrderStatus).toHaveBeenCalledWith(275,{status_id:20});
 });
 it("requires a fresh completion preview if the setting changed", async () => {
  mocks.getCompleteJobStatusTarget.mockResolvedValue({status_id:21});
  render(<CompleteJobAnswer preview={{target_status_id:20,target_status_name:"Finished",target_source:"setting",jobs:[{reference_id:275,current_status_id:9,current_status_name:"Received",already:false}]}} />);
  fireEvent.click(screen.getByRole("button",{name:"Apply"})); await screen.findByText(/target changed/); expect(mocks.updateWorkOrderStatus).not.toHaveBeenCalled();
 });
});

describe("completion fallbacks", () => {
 it("uses the first completed-group status when the button setting is absent", async () => {
  mocks.getCompleteJobStatusTarget.mockResolvedValue({status_id:null});
  mocks.listWorkOrderStatuses.mockResolvedValue({items:[{id:19,label:"Finishing"},{id:20,label:"Finished",status_group:"completed"}]});
  render(<CompleteJobAnswer preview={{target_status_id:20,target_status_name:"Finished",target_source:"completed_group",jobs:[{reference_id:275,current_status_id:9,current_status_name:"Received",already:false}]}} />);
  fireEvent.click(screen.getByRole("button",{name:"Apply"})); await screen.findByText(/Job #275 completed/);
  expect(mocks.updateWorkOrderStatus).toHaveBeenCalledWith(275,{status_id:20});
 });
});
