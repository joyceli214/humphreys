export type WorkOrderLayoutColumn = "left" | "right";

export type WorkOrderLayoutBlockID =
  | "ai_summary"
  | "work_notes"
  | "payment_breakdown"
  | "repair_logs"
  | "parts_order"
  | "equipment"
  | "customer"
  | "meta";

export type WorkOrderLayoutBlock = {
  id: WorkOrderLayoutBlockID;
  label: string;
  column: WorkOrderLayoutColumn;
};

export type WorkOrderLayout = {
  leftWidth: number;
  rightWidth: number;
  blocks: WorkOrderLayoutBlock[];
  mobileOrder: WorkOrderLayoutBlockID[];
};

export const WORK_ORDER_LAYOUT_BLOCK_LABELS: Record<WorkOrderLayoutBlockID, string> = {
  ai_summary: "AI Summary",
  work_notes: "Work Notes",
  payment_breakdown: "Payment Breakdown",
  repair_logs: "Repair Logs",
  parts_order: "Parts Order",
  equipment: "Equipment",
  customer: "Customer",
  meta: "Meta"
};

export const DEFAULT_WORK_ORDER_LAYOUT: WorkOrderLayout = {
  leftWidth: 7,
  rightWidth: 3,
  blocks: [
    { id: "ai_summary", label: WORK_ORDER_LAYOUT_BLOCK_LABELS.ai_summary, column: "left" },
    { id: "work_notes", label: WORK_ORDER_LAYOUT_BLOCK_LABELS.work_notes, column: "left" },
    { id: "payment_breakdown", label: WORK_ORDER_LAYOUT_BLOCK_LABELS.payment_breakdown, column: "left" },
    { id: "repair_logs", label: WORK_ORDER_LAYOUT_BLOCK_LABELS.repair_logs, column: "left" },
    { id: "parts_order", label: WORK_ORDER_LAYOUT_BLOCK_LABELS.parts_order, column: "left" },
    { id: "equipment", label: WORK_ORDER_LAYOUT_BLOCK_LABELS.equipment, column: "right" },
    { id: "customer", label: WORK_ORDER_LAYOUT_BLOCK_LABELS.customer, column: "right" },
    { id: "meta", label: WORK_ORDER_LAYOUT_BLOCK_LABELS.meta, column: "right" }
  ],
  mobileOrder: ["ai_summary", "work_notes", "payment_breakdown", "repair_logs", "parts_order", "equipment", "customer", "meta"]
};

export function normalizeWorkOrderLayout(value: unknown): WorkOrderLayout {
  if (!value || typeof value !== "object") return DEFAULT_WORK_ORDER_LAYOUT;
  const candidate = value as Partial<WorkOrderLayout>;
  const knownBlockIDs = new Set(DEFAULT_WORK_ORDER_LAYOUT.blocks.map((block) => block.id));
  const candidateBlocks = Array.isArray(candidate.blocks) ? candidate.blocks : [];
  const blocks: WorkOrderLayoutBlock[] = [];

  for (const block of candidateBlocks) {
    if (!block || typeof block !== "object") continue;
    const partial = block as Partial<WorkOrderLayoutBlock>;
    if (!partial.id || !knownBlockIDs.has(partial.id)) continue;
    if (blocks.some((existing) => existing.id === partial.id)) continue;
    blocks.push({
      id: partial.id,
      label: WORK_ORDER_LAYOUT_BLOCK_LABELS[partial.id],
      column: partial.column === "right" ? "right" : "left"
    });
  }

  for (const block of DEFAULT_WORK_ORDER_LAYOUT.blocks) {
    if (!blocks.some((existing) => existing.id === block.id)) {
      blocks.push(block);
    }
  }

  const leftWidth = Number.isFinite(candidate.leftWidth) ? Number(candidate.leftWidth) : DEFAULT_WORK_ORDER_LAYOUT.leftWidth;
  const rightWidth = Number.isFinite(candidate.rightWidth) ? Number(candidate.rightWidth) : DEFAULT_WORK_ORDER_LAYOUT.rightWidth;
  const candidateMobileOrder = Array.isArray(candidate.mobileOrder) ? candidate.mobileOrder : [];
  const mobileOrder: WorkOrderLayoutBlockID[] = [];

  for (const id of candidateMobileOrder) {
    if (typeof id !== "string" || !knownBlockIDs.has(id as WorkOrderLayoutBlockID)) continue;
    if (mobileOrder.includes(id as WorkOrderLayoutBlockID)) continue;
    mobileOrder.push(id as WorkOrderLayoutBlockID);
  }

  for (const id of DEFAULT_WORK_ORDER_LAYOUT.mobileOrder) {
    if (!mobileOrder.includes(id)) mobileOrder.push(id);
  }

  return {
    leftWidth: Math.min(9, Math.max(1, Math.round(leftWidth))),
    rightWidth: Math.min(9, Math.max(1, Math.round(rightWidth))),
    blocks,
    mobileOrder
  };
}
