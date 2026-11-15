import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskCreateJobPreview, AskPartsChange } from "@/lib/ai-tools/types";
const mocks = vi.hoisted(() => ({
 updatePartsPurchaseRequest: vi.fn(), createPartsPurchaseRequest: vi.fn(), getCompleteJobStatusTarget: vi.fn(),
 listWorkOrderStatuses: vi.fn(), updateWorkOrderStatus: vi.fn(), createWorkOrder: vi.fn(), updateWorkOrderWorkNotes: vi.fn(),
 createBrand: vi.fn(), createItem: vi.fn(), listDropdownManagement: vi.fn()
}));
vi.mock("@/lib/api/client", () => ({apiClient: mocks, APIError: class extends Error { constructor(message: string, public status: number) { super(message); } }}));
import { CompleteJobAnswer, CreateJobAnswer, InvoiceAnswer, PartsCreateAnswer } from "./ask-action-answers";
import { PartsChangeAnswer } from "./ask-skill-answers";
const ch = (id = 501, extra: Partial<AskPartsChange> = {}): AskPartsChange => ({parts_purchase_request_id:id, reference_id:275, item_name:"Belt", quantity:1, source:"supplier", old_status:"approved", new_status:"ordered", old_price:0, new_price:4.5, old_source_url:null, new_source_url:null, updated_at:"2026-11-14T01:00:00Z",valid:true,...extra});
const job: AskCreateJobPreview = {customer_mode:"new",customer_id:null,customer:{name:"Pat Example",home_phone:"4165550199",work_phone:"",email:"pat@example.com",address_line_1:"64 Bramalea Rd",address_line_2:"1412",city:"Brampton",province:"Ontario",postal_code:"L6T 2W8"},brand_id:31,brand_name:"Sony",brand_new:false,item_id:11,item_name:"Receiver",item_new:false,model_number:"STR-DH190",serial_number:"12345",problem_description:"No sound",status_id:9,status_name:"Received",status_is_default:true,job_type_id:1,job_type_name:"Repair",deposit:90.4,deposit_payment_method_id:41,deposit_payment_method_name:"Cash",quote:80,notes:["quote × 1.13"]};
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
 it("creates a job then saves symptoms using work notes and shows parsed fields", async () => {
  mocks.createWorkOrder.mockResolvedValue({reference_id:31353,status_id:9,payment_method_ids:[41]}); mocks.updateWorkOrderWorkNotes.mockResolvedValue({});
  render(<CreateJobAnswer preview={job} />); expect(screen.getByText("64 Bramalea Rd")).toBeInTheDocument(); expect(screen.getByText("1412")).toBeInTheDocument(); expect(mocks.createWorkOrder).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Apply"})); await screen.findByText(/Job #31353 created/);
  expect(mocks.createWorkOrder).toHaveBeenCalledWith(expect.objectContaining({creation_mode:"new_job",new_customer:job.customer,brand_ids:[31],item_id:11,job_type_id:1,deposit:90.4,deposit_payment_method_id:41}));
  expect(mocks.updateWorkOrderWorkNotes).toHaveBeenCalledWith(31353,{problem_description:"No sound",worker_ids:[],work_done:null,payment_method_ids:[41]});
 });
 it("does not create a duplicate after a work notes failure", async () => {
  mocks.createWorkOrder.mockResolvedValue({reference_id:31353,status_id:9,payment_method_ids:[]}); mocks.updateWorkOrderWorkNotes.mockRejectedValueOnce(new Error("notes failed")).mockResolvedValueOnce({});
  render(<CreateJobAnswer preview={job} />); fireEvent.click(screen.getByRole("button",{name:"Apply"})); await screen.findByText(/notes failed/);
  fireEvent.click(screen.getByRole("button",{name:"Apply"})); await screen.findByText(/Job #31353 created/); expect(mocks.createWorkOrder).toHaveBeenCalledTimes(1);
 });
 it("reuses the create page catalog actions for new names", async () => {
  mocks.createBrand.mockResolvedValue({id:32,label:"Marantz"}); mocks.createItem.mockResolvedValue({id:12,label:"Tuner"}); mocks.createWorkOrder.mockResolvedValue({reference_id:31354,status_id:9,payment_method_ids:[]}); mocks.updateWorkOrderWorkNotes.mockResolvedValue({});
  render(<CreateJobAnswer preview={{...job,brand_new:true,brand_id:null,brand_name:"Marantz",item_new:true,item_id:null,item_name:"Tuner"}} />);
  fireEvent.click(screen.getByRole("button",{name:"Apply"})); await screen.findByText(/Job #31354 created/);
  expect(mocks.createBrand).toHaveBeenCalledWith("Marantz"); expect(mocks.createItem).toHaveBeenCalledWith("Tuner"); expect(mocks.createWorkOrder).toHaveBeenCalledWith(expect.objectContaining({brand_ids:[32],item_id:12}));
 });
 it("honours frozen catalog dropdowns", async () => {
  mocks.listDropdownManagement.mockResolvedValue({items:[{key:"brands",is_frozen:true}]});
  render(<CreateJobAnswer preview={{...job,brand_new:true,brand_id:null,brand_name:"Marantz"}} />); fireEvent.click(screen.getByRole("button",{name:"Apply"})); await screen.findByText(/frozen/); expect(mocks.createBrand).not.toHaveBeenCalled(); expect(mocks.createWorkOrder).not.toHaveBeenCalled();
 });
 it("cancel leaves a new job unsaved", () => { render(<CreateJobAnswer preview={job} />); fireEvent.click(screen.getByRole("button",{name:"Cancel"})); expect(screen.getByText(/Nothing was changed/)).toBeInTheDocument(); expect(mocks.createWorkOrder).not.toHaveBeenCalled(); });
});

describe("completion fallbacks and explicit creation status", () => {
 it("uses the first completed-group status when the button setting is absent", async () => {
  mocks.getCompleteJobStatusTarget.mockResolvedValue({status_id:null});
  mocks.listWorkOrderStatuses.mockResolvedValue({items:[{id:19,label:"Finishing"},{id:20,label:"Finished",status_group:"completed"}]});
  render(<CompleteJobAnswer preview={{target_status_id:20,target_status_name:"Finished",target_source:"completed_group",jobs:[{reference_id:275,current_status_id:9,current_status_name:"Received",already:false}]}} />);
  fireEvent.click(screen.getByRole("button",{name:"Apply"})); await screen.findByText(/Job #275 completed/);
  expect(mocks.updateWorkOrderStatus).toHaveBeenCalledWith(275,{status_id:20});
 });
 it("applies an explicit job status through the existing status endpoint after creation", async () => {
  mocks.createWorkOrder.mockResolvedValue({reference_id:31353,status_id:9,payment_method_ids:[]}); mocks.updateWorkOrderWorkNotes.mockResolvedValue({});
  render(<CreateJobAnswer preview={{...job,status_id:8,status_name:"On Test",status_is_default:false}} />);
  fireEvent.click(screen.getByRole("button",{name:"Apply"})); await screen.findByText(/Job #31353 created/);
  expect(mocks.updateWorkOrderStatus).toHaveBeenCalledWith(31353,{status_id:8});
 });
});
