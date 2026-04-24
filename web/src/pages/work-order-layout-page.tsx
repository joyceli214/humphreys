"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { ArrowDown, ArrowLeftRight, ArrowUp, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { apiClient } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/auth-context";
import { useAlerts } from "@/lib/alerts/alert-context";
import {
  DEFAULT_WORK_ORDER_LAYOUT,
  type WorkOrderLayout,
  type WorkOrderLayoutBlock,
  type WorkOrderLayoutBlockID,
  type WorkOrderLayoutColumn,
  normalizeWorkOrderLayout
} from "@/lib/work-order-layout";

function moveBlockInColumn(blocks: WorkOrderLayoutBlock[], id: string, column: WorkOrderLayoutColumn, direction: -1 | 1) {
  const columnItems = blocks.filter((block) => block.column === column);
  const index = columnItems.findIndex((block) => block.id === id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= columnItems.length) return blocks;
  const nextColumnItems = [...columnItems];
  const [block] = nextColumnItems.splice(index, 1);
  nextColumnItems.splice(nextIndex, 0, block);
  let columnIndex = 0;
  return blocks.map((current) => {
    if (current.column !== column) return current;
    const nextBlock = nextColumnItems[columnIndex];
    columnIndex += 1;
    return nextBlock;
  });
}

function moveBlockToColumn(blocks: WorkOrderLayoutBlock[], id: string, column: WorkOrderLayoutColumn) {
  const index = blocks.findIndex((block) => block.id === id);
  if (index < 0) return blocks;
  const next = blocks.filter((block) => block.id !== id);
  const block = blocks[index];
  const lastColumnIndex = next.reduce((lastIndex, current, currentIndex) => (current.column === column ? currentIndex : lastIndex), -1);
  const insertIndex = lastColumnIndex >= 0 ? lastColumnIndex + 1 : next.length;
  next.splice(insertIndex, 0, { ...block, column });
  return next;
}

function moveMobileBlock(ids: WorkOrderLayoutBlockID[], id: WorkOrderLayoutBlockID, direction: -1 | 1) {
  const index = ids.indexOf(id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return ids;
  const next = [...ids];
  const [blockID] = next.splice(index, 1);
  next.splice(nextIndex, 0, blockID);
  return next;
}

function columnBlocks(layout: WorkOrderLayout, column: WorkOrderLayoutColumn) {
  return layout.blocks.filter((block) => block.column === column);
}

function PreviewField({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      <div className="min-h-9 rounded-md border border-border bg-slate-50 px-2 py-2 text-sm text-slate-700">{value}</div>
    </div>
  );
}

function PreviewTextArea({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      <div className="min-h-24 rounded-md border border-border bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700">{children}</div>
    </div>
  );
}

function PreviewTable({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto rounded-md border border-border">{children}</div>;
}

function blockPreview(id: WorkOrderLayoutBlockID) {
  if (id === "customer") {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PreviewField label="Name" value="Maya Chen" />
        <PreviewField label="Email" value="maya.chen@example.com" />
        <PreviewField label="Home Phone" value="(416) 555-0184" />
        <PreviewField label="Work Phone" value="(905) 555-0142" />
        <PreviewField label="Extension" value="204" />
        <PreviewField label="Address" value="44 King Street W" />
        <PreviewField label="Address 2" value="Unit 1202" />
        <PreviewField label="City" value="Toronto" />
        <PreviewField label="Province" value="ON" />
      </div>
    );
  }

  if (id === "equipment") {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PreviewField label="Status" value="Received" />
        <PreviewField label="Job Type" value="Repair" />
        <PreviewField label="Location" value="B-3" />
        <PreviewField label="Item" value="Integrated Amplifier" />
        <PreviewField label="Brands" value="Marantz" />
        <PreviewField label="Model" value="PM6007" />
        <PreviewField label="Serial" value="MZ04291" />
        <PreviewField label="Remote Control" value="1" />
        <PreviewField label="Cable" value="0" />
        <PreviewField label="Cord" value="1" />
        <PreviewField label="DVD/VHS" value="0" />
        <PreviewField label="Album/CD/Cassette" value="0" />
        <PreviewField label="Other Remarks" value="Customer included original box." wide />
      </div>
    );
  }

  if (id === "work_notes") {
    return (
      <div className="space-y-3">
        <PreviewField label="Technicians" value="Alex R., Priya S." />
        <PreviewTextArea label="Problem Description">
          Left channel cuts out after warmup. Volume pot is noisy and customer reports intermittent protection mode.
        </PreviewTextArea>
        <PreviewTextArea label="Work Done">
          Cleaned controls, inspected solder joints, replaced two filter capacitors, bench tested for 45 minutes.
        </PreviewTextArea>
        <PreviewField label="Updated" value="Apr 24, 2026" />
      </div>
    );
  }

  if (id === "payment_breakdown") {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <PreviewField label="Deposit Payment Method" value="Credit Card" />
          <PreviewField label="Final Payment Method" value="Debit" />
          <PreviewField label="Parts" value="$84.00" />
          <PreviewField label="Delivery" value="$0.00" />
          <PreviewField label="Labour" value="$120.00" />
          <PreviewField label="Subtotal" value="$204.00" />
          <PreviewField label="HST (13%)" value="$26.52" />
          <PreviewField label="Total" value="$230.52" />
          <PreviewField label="Deposit" value="$50.00" />
          <PreviewField label="Total Payable" value="$180.52" />
        </div>
        <PreviewTable>
          <Table className="min-w-[520px]">
            <thead>
              <tr>
                <Th>Parts Item</Th>
                <Th>Unit Price</Th>
                <Th>Qty</Th>
                <Th>Subtotal</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td>Filter capacitor</Td>
                <Td>$18.00</Td>
                <Td>2</Td>
                <Td>$36.00</Td>
              </tr>
              <tr>
                <Td>Speaker relay</Td>
                <Td>$48.00</Td>
                <Td>1</Td>
                <Td>$48.00</Td>
              </tr>
            </tbody>
          </Table>
        </PreviewTable>
      </div>
    );
  }

  if (id === "repair_logs") {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-border bg-slate-50 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Apr 24, 2026</p>
            <span className="rounded-full bg-slate-200 px-2 py-1 text-xs text-slate-700">1.5 hrs</span>
          </div>
          <p className="text-sm leading-6 text-slate-700">Tested output stage and cleaned controls. Channel dropout reproduced after warmup.</p>
        </div>
        <div className="rounded-md border border-border bg-slate-50 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Apr 25, 2026</p>
            <span className="rounded-full bg-slate-200 px-2 py-1 text-xs text-slate-700">2 hrs</span>
          </div>
          <p className="text-sm leading-6 text-slate-700">Replaced capacitors and completed bench test with speakers connected.</p>
        </div>
      </div>
    );
  }

  if (id === "parts_order") {
    return (
      <PreviewTable>
        <Table className="min-w-[760px]">
          <thead>
            <tr>
              <Th>Item</Th>
              <Th>Qty</Th>
              <Th>Source</Th>
              <Th>Status</Th>
              <Th>Total</Th>
              <Th>URL</Th>
              <Th>User</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td>Speaker relay</Td>
              <Td>1</Td>
              <Td>supplier</Td>
              <Td>ordered</Td>
              <Td>$48.00</Td>
              <Td>Open</Td>
              <Td>Alex R.</Td>
            </tr>
            <tr>
              <Td>Faceplate knob</Td>
              <Td>1</Td>
              <Td>online</Td>
              <Td>waiting approval</Td>
              <Td>$22.00</Td>
              <Td>Open</Td>
              <Td>Priya S.</Td>
            </tr>
          </tbody>
        </Table>
      </PreviewTable>
    );
  }

  if (id === "ai_summary") {
    return (
      <PreviewTextArea label="Summary">
        Amplifier has an intermittent left-channel fault likely related to ageing caps and relay contacts. Parts are available and repair is in progress.
      </PreviewTextArea>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <PreviewField label="Created At" value="Apr 22, 2026" />
      <PreviewField label="Updated At" value="Apr 24, 2026" />
      <PreviewField label="Status Updated At" value="Apr 24, 2026" />
      <PreviewField label="Status" value="Received" />
    </div>
  );
}

function PreviewBlock({
  block,
  column,
  index,
  count,
  onMove,
  onSwitchColumn,
  mode = "desktop"
}: {
  block: WorkOrderLayoutBlock;
  column?: WorkOrderLayoutColumn;
  index: number;
  count: number;
  onMove: (direction: -1 | 1) => void;
  onSwitchColumn?: () => void;
  mode?: "desktop" | "mobile";
}) {
  return (
    <article className="rounded-lg border border-border bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">{block.label}</h3>
          <p className="text-xs text-muted-foreground">
            {mode === "mobile" ? `Mobile position ${index + 1}` : column === "left" ? "Left column" : "Right column"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" className="h-9 w-9 p-0" aria-label={`Move ${block.label} up`} disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-9 w-9 p-0" aria-label={`Move ${block.label} down`} disabled={index === count - 1} onClick={() => onMove(1)}>
            <ArrowDown className="h-4 w-4" />
          </Button>
          {onSwitchColumn && (
            <Button type="button" variant="outline" size="sm" className="h-9 w-9 p-0" aria-label={`Move ${block.label} to ${column === "left" ? "right" : "left"} column`} onClick={onSwitchColumn}>
              <ArrowLeftRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      {blockPreview(block.id)}
    </article>
  );
}

export default function WorkOrderLayoutPage() {
  const { user } = useAuth();
  const alerts = useAlerts();
  const [layout, setLayout] = useState<WorkOrderLayout>(DEFAULT_WORK_ORDER_LAYOUT);
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      setLayout(DEFAULT_WORK_ORDER_LAYOUT);
      return;
    }
    apiClient
      .getWorkOrderLayoutPreference()
      .then((res) => {
        if (!cancelled) setLayout(normalizeWorkOrderLayout(res.value));
      })
      .catch((err) => {
        if (!cancelled) {
          setLayout(DEFAULT_WORK_ORDER_LAYOUT);
          alerts.error("Failed to load layout", err instanceof Error ? err.message : "Request failed");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const leftBlocks = useMemo(() => columnBlocks(layout, "left"), [layout]);
  const rightBlocks = useMemo(() => columnBlocks(layout, "right"), [layout]);
  const blocksByID = useMemo(() => new Map(layout.blocks.map((block) => [block.id, block])), [layout.blocks]);

  const updateWidth = (key: "leftWidth" | "rightWidth", value: string) => {
    const parsed = Number.parseInt(value, 10);
    setLayout((prev) => ({
      ...prev,
      [key]: Number.isFinite(parsed) ? Math.min(9, Math.max(1, parsed)) : prev[key]
    }));
  };

  const save = () => {
    if (!user?.id) return;
    apiClient
      .saveWorkOrderLayoutPreference(normalizeWorkOrderLayout(layout))
      .then((res) => {
        setLayout(normalizeWorkOrderLayout(res.value));
        alerts.success("Work order layout saved");
      })
      .catch((err) => {
        alerts.error("Failed to save layout", err instanceof Error ? err.message : "Request failed");
      });
  };

  const reset = () => {
    if (!user?.id) return;
    apiClient
      .saveWorkOrderLayoutPreference(DEFAULT_WORK_ORDER_LAYOUT)
      .then((res) => {
        setLayout(normalizeWorkOrderLayout(res.value));
        alerts.success("Work order layout reset");
      })
      .catch((err) => {
        alerts.error("Failed to reset layout", err instanceof Error ? err.message : "Request failed");
      });
  };

  const renderColumnPreview = (column: WorkOrderLayoutColumn, blocks: WorkOrderLayoutBlock[]) => (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-white px-4 py-3">
        <div>
          <h2 className="font-semibold">{column === "left" ? "Left Column" : "Right Column"}</h2>
          <span className="text-xs text-muted-foreground">{blocks.length} blocks</span>
        </div>
        <div className="w-28">
          <label className="mb-1 block text-sm text-muted-foreground">{column === "left" ? "Left width" : "Right width"}</label>
          <Input
            type="number"
            min={1}
            max={9}
            value={column === "left" ? layout.leftWidth : layout.rightWidth}
            onChange={(event) => updateWidth(column === "left" ? "leftWidth" : "rightWidth", event.target.value)}
          />
        </div>
      </div>
      {blocks.map((block, index) => (
        <PreviewBlock
          key={block.id}
          block={block}
          column={column}
          index={index}
          count={blocks.length}
          onMove={(direction) => setLayout((prev) => ({ ...prev, blocks: moveBlockInColumn(prev.blocks, block.id, column, direction) }))}
          onSwitchColumn={() =>
            setLayout((prev) => ({
              ...prev,
              blocks: moveBlockToColumn(prev.blocks, block.id, column === "left" ? "right" : "left")
            }))
          }
        />
      ))}
    </div>
  );

  const renderMobilePreview = () => (
    <div className="min-w-0 space-y-4">
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-white px-4 py-3">
        <div>
          <h2 className="font-semibold">Mobile Order</h2>
          <p className="text-xs text-muted-foreground">This controls the stacked order on phones and narrow screens.</p>
        </div>
        <span className="text-xs text-muted-foreground">{layout.mobileOrder.length} blocks</span>
      </div>
      {layout.mobileOrder.map((blockID, index) => {
        const block = blocksByID.get(blockID);
        if (!block) return null;
        return (
          <PreviewBlock
            key={block.id}
            block={block}
            index={index}
            count={layout.mobileOrder.length}
            mode="mobile"
            onMove={(direction) =>
              setLayout((prev) => ({
                ...prev,
                mobileOrder: moveMobileBlock(prev.mobileOrder, block.id, direction)
              }))
            }
          />
        );
      })}
    </div>
  );

  return (
    <section className="min-w-0 space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Work Order Layout</h1>
          <p className="text-sm text-muted-foreground">Customize your own work order detail layout.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end xl:justify-end">
          <div className="flex rounded-md border border-border bg-white p-1">
            <Button
              type="button"
              variant={previewMode === "desktop" ? "default" : "ghost"}
              size="sm"
              onClick={() => setPreviewMode("desktop")}
            >
              Desktop
            </Button>
            <Button
              type="button"
              variant={previewMode === "mobile" ? "default" : "ghost"}
              size="sm"
              onClick={() => setPreviewMode("mobile")}
            >
              Mobile
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={reset}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset
            </Button>
            <Button type="button" onClick={save}>
              <Save className="mr-2 h-4 w-4" />
              Save Layout
            </Button>
          </div>
        </div>
      </div>

      {previewMode === "mobile" ? (
        <div className="mx-auto w-full max-w-[430px] rounded-[28px] border border-border bg-slate-200 p-3 shadow-sm">
          <div className="rounded-[20px] bg-background p-3">
            {renderMobilePreview()}
          </div>
        </div>
      ) : (
        <div
          className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,var(--wo-left))_minmax(0,var(--wo-right))]"
          style={{
            "--wo-left": `${layout.leftWidth}fr`,
            "--wo-right": `${layout.rightWidth}fr`
          } as CSSProperties}
        >
          {renderColumnPreview("left", leftBlocks)}
          {renderColumnPreview("right", rightBlocks)}
        </div>
      )}
    </section>
  );
}
