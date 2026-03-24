import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { WorkOrderDetail } from "@/lib/api/generated/types";
import { markdownToPlainText } from "@/lib/markdown";
import { formatPhoneNumber } from "@/lib/phone";

function text(value: string | null | undefined) {
  return value && value.trim() ? value.trim() : "-";
}

function fullName(item: WorkOrderDetail) {
  const first = item.customer.first_name ?? "";
  const last = item.customer.last_name ?? "";
  const name = `${first} ${last}`.trim();
  return name || "-";
}

function address(item: WorkOrderDetail) {
  const parts = [item.customer.address_line_1, item.customer.address_line_2, item.customer.city, item.customer.province]
    .map((v) => (v ?? "").trim())
    .filter(Boolean);
  return parts.length ? parts.join(", ") : "-";
}

function parseLocalDate(value: string) {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const monthIndex = Number(dateOnly[2]) - 1;
    const day = Number(dateOnly[3]);
    return new Date(year, monthIndex, day);
  }

  const dateTime =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:Z|[+\-]\d{2}:?\d{2})?$/.exec(value);
  if (dateTime) {
    const year = Number(dateTime[1]);
    const monthIndex = Number(dateTime[2]) - 1;
    const day = Number(dateTime[3]);
    const hour = Number(dateTime[4]);
    const minute = Number(dateTime[5]);
    const second = Number(dateTime[6] ?? '0');
    const millisecond = Number((dateTime[7] ?? '0').padEnd(3, '0'));
    return new Date(year, monthIndex, day, hour, minute, second, millisecond);
  }

  return new Date(value);
}

function dateOnly(value: string | null) {
  if (!value) return "-";
  const d = parseLocalDate(value);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function money(value: number | null | undefined) {
  if (value === null || value === undefined) return "$0.00";
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value);
}

function parseLooseNumber(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.replace(/[^0-9.-]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseQuantity(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function calculatePartsTotal(item: WorkOrderDetail) {
  return item.line_items.reduce((sum, line) => {
    const lineTotal = parseLooseNumber(line.line_total_text);
    if (lineTotal !== null) {
      return sum + lineTotal;
    }
    const unitPrice = line.unit_price ?? 0;
    const quantity = parseQuantity(line.quantity_text) ?? 0;
    return sum + unitPrice * quantity;
  }, 0);
}

function pageHeight(doc: jsPDF) {
  return doc.internal.pageSize.getHeight();
}

function linesForWidth(doc: jsPDF, value: string | null | undefined, width: number) {
  return doc.splitTextToSize(markdownToPlainText(value), width);
}

function compactNoteLines(lines: string[]) {
  const trimmed = lines.map((line) => line.trimEnd());
  const withoutBlanks = trimmed.filter((line) => line.trim().length > 0);
  return withoutBlanks.length ? withoutBlanks : ["-"];
}

function labeledBoxHeight(doc: jsPDF, lines: string | string[], minHeight: number) {
  const titleToTextTop = 12;
  const bottomPadding = 4;
  const lineCount = Array.isArray(lines) ? Math.max(lines.length, 1) : Math.max(String(lines).split(/\r?\n/).length, 1);
  const lineHeightMm = (doc.getFontSize() * doc.getLineHeightFactor()) / doc.internal.scaleFactor;
  const textHeight = lineCount * lineHeightMm;
  return Math.max(minHeight, titleToTextTop + textHeight + bottomPadding);
}

function lineHeightMm(doc: jsPDF) {
  return (doc.getFontSize() * doc.getLineHeightFactor()) / doc.internal.scaleFactor;
}

type PaginatedBoxOptions = {
  title: string;
  lines: string[];
  startY: number;
  minHeight: number;
  pageBottomY: number;
  nextPageTopY: number;
  onAddPage: () => void;
};

function drawPaginatedLabeledBox(doc: jsPDF, options: PaginatedBoxOptions) {
  const titleToTextTop = 12;
  const bottomPadding = 4;
  const gapAfter = 7;
  const lineHeight = lineHeightMm(doc);

  let y = options.startY;
  let remaining = options.lines.length ? options.lines : ["-"];
  let firstChunk = true;

  while (remaining.length > 0) {
    const availableHeight = options.pageBottomY - y;
    if (availableHeight < options.minHeight) {
      options.onAddPage();
      y = options.nextPageTopY;
      firstChunk = false;
      continue;
    }

    const allRemainingHeight = labeledBoxHeight(doc, remaining, options.minHeight);
    let boxHeight = Math.min(allRemainingHeight, availableHeight);
    if (allRemainingHeight <= availableHeight) {
      boxHeight = Math.max(options.minHeight, allRemainingHeight);
    }

    const contentHeight = boxHeight - titleToTextTop - bottomPadding;
    const linesToDraw = Math.max(1, Math.floor(contentHeight / lineHeight));
    const chunk = remaining.slice(0, linesToDraw);
    remaining = remaining.slice(linesToDraw);

    doc.setLineWidth(0.3);
    doc.rect(14, y, 182, boxHeight);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(firstChunk ? options.title : `${options.title} (cont.)`, 16, y + 6);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(chunk, 16, y + 12);

    if (remaining.length === 0) {
      return y + boxHeight + gapAfter;
    }

    options.onAddPage();
    y = options.nextPageTopY;
    firstChunk = false;
  }

  return y + gapAfter;
}

function accessories(item: WorkOrderDetail) {
  return [
    `Remote Control: ${item.remote_control_qty}`,
    `Cables: ${item.cable_qty}`,
    `Cord: ${item.cord_qty}`,
    `DVDs/VHS: ${item.dvd_vhs_qty ?? 0}`,
    `Albums/CDs/Cassettes: ${item.album_cd_cassette_qty}`
  ].join(" | ");
}

function fitText(doc: jsPDF, value: string, maxWidth: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return "-";
  if (doc.getTextWidth(clean) <= maxWidth) return clean;
  let out = clean;
  while (out.length > 1 && doc.getTextWidth(`${out}...`) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}...`;
}

function lineField(doc: jsPDF, x: number, y: number, w: number, label: string, value: string) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  // Access-style field: value above the line, label below the line.
  doc.text(fitText(doc, value, w - 2), x + 1, y - 1.5);
  doc.line(x, y + 0.6, x + w, y + 0.6);
  doc.setFontSize(8.2);
  doc.text(label, x, y + 4.3);
}

function drawHeader(doc: jsPDF, title: string) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Humphreys Audio and Vintage Audio Repair", 14, 14);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text("16610 Bayview Ave., Unit #7, Newmarket ON   Ph: (416) 923-3777", 14, 19);
  doc.text("humphreys.repair@rogers.com/www.humphreysrepaircentre.com", 14, 23.5);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(title, 14, 31);
  doc.setLineWidth(0.5);
  doc.line(14, 34, 196, 34);
}

function drawCommon(doc: jsPDF, item: WorkOrderDetail, yStart: number) {
  const y = yStart;

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text(`Customer ID: ${item.reference_id}`, 14, y);
  doc.text(`Date Received: ${dateOnly(item.created_at)}`, 112, y);

  lineField(doc, 14, y + 13, 40, "First Name", text(item.customer.first_name));
  lineField(doc, 60, y + 13, 40, "Last Name", text(item.customer.last_name));
  lineField(doc, 106, y + 13, 86, "Address", address(item));

  lineField(doc, 14, y + 24, 40, "Apart/Suite / Entry Code", text(item.customer.address_line_2));
  lineField(doc, 60, y + 24, 40, "City", text(item.customer.city));
  lineField(doc, 106, y + 24, 86, "Email", text(item.customer.email));

  lineField(doc, 14, y + 35, 40, "Home Phone", text(formatPhoneNumber(item.customer.home_phone)));
  lineField(doc, 60, y + 35, 40, "Work Phone / Cell", text(formatPhoneNumber(item.customer.work_phone)));
  lineField(doc, 106, y + 35, 40, "Extension", text(item.customer.extension_text));
  lineField(doc, 152, y + 35, 40, "Other Remarks", text(item.other_remarks));

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.4);
  const accessoryRowY = y + 43;
  const accessoryColumns = [
    { label: "Cord", width: 22, labelOffset: 14 },
    { label: "Remote Control", width: 42, labelOffset: 15 },
    { label: "Albums/CDs/Cassettes", width: 52, labelOffset: 15 },
    { label: "DVDs/VHS", width: 35, labelOffset: 15 },
    { label: "Cables", width: 36, labelOffset: 15 }
  ];
  let colX = 14;
  accessoryColumns.forEach((col) => {
    doc.rect(colX, accessoryRowY, 12, 5);
    doc.text(fitText(doc, col.label, col.width - col.labelOffset), colX + col.labelOffset, accessoryRowY + 4);
    colX += col.width;
  });

  lineField(doc, 14, y + 57, 42, "Item", text(item.item_name));
  lineField(doc, 60, y + 57, 42, "Brand", item.brand_names.length ? item.brand_names.join(", ") : "-");
  lineField(doc, 106, y + 57, 42, "Model Number", text(item.model_number));
  lineField(doc, 152, y + 57, 42, "Serial Number", text(item.serial_number));

  return y + 66;
}

export function generateDropOffFormPdf(item: WorkOrderDetail) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  drawHeader(doc, "Customer Drop Off Form");

  const pageBottomY = pageHeight(doc) - 10;
  const nextPageTopY = 44;
  let y = drawCommon(doc, item, 44);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const problemLines = linesForWidth(doc, item.problem_description, 176);
  const workDoneLines = linesForWidth(doc, item.work_done, 176);
  const addDropoffPage = () => {
    doc.addPage();
    drawHeader(doc, "Customer Drop Off Form");
  };

  y = drawPaginatedLabeledBox(doc, {
    title: "Problem Description",
    lines: problemLines,
    startY: y,
    minHeight: 58,
    pageBottomY,
    nextPageTopY,
    onAddPage: addDropoffPage
  });

  y = drawPaginatedLabeledBox(doc, {
    title: "Work Done / Notes",
    lines: workDoneLines,
    startY: y,
    minHeight: 58,
    pageBottomY,
    nextPageTopY,
    onAddPage: addDropoffPage
  });

  doc.setFontSize(9);
  if (y > pageBottomY) {
    addDropoffPage();
  }
  doc.text(`Generated: ${new Date().toLocaleString("en-CA")}`, 14, 290);

  doc.save(`drop-off-form-${item.reference_id}.pdf`);
}

export function generatePickupFormPdf(item: WorkOrderDetail) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  drawHeader(doc, "Customer Pick Up Form");

  const y = drawCommon(doc, item, 44);
  const partsTotal = calculatePartsTotal(item);
  const subtotal = partsTotal + (item.delivery_total ?? 0) + (item.labour_total ?? 0);
  const hst = subtotal * 0.13;
  const total = subtotal + hst;
  const payable = total - (item.deposit ?? 0);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const notesLineHeightFactor = 1.08;
  const notesMinHeight = 12;
  const problemLines = compactNoteLines(linesForWidth(doc, item.problem_description, 84));
  const workDoneLines = compactNoteLines(linesForWidth(doc, item.work_done, 84));
  const notesLineHeightMm = (doc.getFontSize() * notesLineHeightFactor) / doc.internal.scaleFactor;
  const notesBoxHeightForLines = (lines: string[]) => {
    const titleToTextTop = 7;
    const bottomPadding = 1;
    const lineCount = Math.max(lines.length, 1);
    const textHeight = lineCount * notesLineHeightMm;
    return Math.max(notesMinHeight, titleToTextTop + textHeight + bottomPadding);
  };
  const problemBoxHeight = notesBoxHeightForLines(problemLines);
  const workDoneBoxHeight = notesBoxHeightForLines(workDoneLines);
  const notesRowHeight = Math.max(problemBoxHeight, workDoneBoxHeight);
  let notesTopY = y + 2;
  const lowerSectionHeight = 78;
  if (notesTopY + 8 + notesRowHeight + lowerSectionHeight > pageHeight(doc) - 10) {
    doc.addPage();
    drawHeader(doc, "Customer Pick Up Form");
    notesTopY = 40;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Problem Description", 14, notesTopY + 4.5);
  doc.text("Work Done", 108, notesTopY + 4.5);

  doc.setFont("helvetica", "normal");
  doc.rect(14, notesTopY + 6, 88, notesRowHeight);
  doc.rect(108, notesTopY + 6, 88, notesRowHeight);
  doc.setFontSize(10);
  doc.text(problemLines, 15, notesTopY + 10, { lineHeightFactor: notesLineHeightFactor });
  doc.text(workDoneLines, 109, notesTopY + 10, { lineHeightFactor: notesLineHeightFactor });

  const lineItemsTopY = notesTopY + 8 + notesRowHeight + 2;
  const rowLeftX = 14;
  const rowRightX = 196;
  const subtotalColumnWidth = 54;
  const rowGapX = 4;
  const tableWidth = rowRightX - rowLeftX - subtotalColumnWidth - rowGapX;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Line Items", rowLeftX, lineItemsTopY + 4);
  doc.text("Subtotal", rowRightX, lineItemsTopY + 4, { align: "right" });

  autoTable(doc, {
    startY: lineItemsTopY + 6,
    theme: "grid",
    head: [["Item", "Price", "Qty", "Total"]],
    body: item.line_items.length
      ? item.line_items.map((line) => [
          text(line.item_name),
          money(line.unit_price),
          text(line.quantity_text),
          text(line.line_total_text)
        ])
      : [["-", "$0.00", "-", "-"]],
    styles: { fontSize: 9, cellPadding: 0.9 },
    headStyles: { fillColor: [238, 238, 238], textColor: 0 },
    margin: { left: rowLeftX, right: 210 - rowLeftX - tableWidth },
    tableWidth,
    columnStyles: {
      0: { cellWidth: 70 },
      1: { cellWidth: 20 },
      2: { cellWidth: 12 },
      3: { cellWidth: 22 }
    }
  });

  let tableY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? lineItemsTopY + 40;
  const pricingY = lineItemsTopY + 10;
  const rowGap = 4.8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.4);
  doc.text(`Parts: ${money(partsTotal)}`, rowRightX, pricingY, { align: "right" });
  doc.text(`Delivery: ${money(item.delivery_total)}`, rowRightX, pricingY + rowGap, { align: "right" });
  doc.text(`Labour: ${money(item.labour_total)}`, rowRightX, pricingY + rowGap * 2, { align: "right" });
  doc.text(`Subtotal: ${money(subtotal)}`, rowRightX, pricingY + rowGap * 3, { align: "right" });
  doc.text(`HST (13%): ${money(hst)}`, rowRightX, pricingY + rowGap * 4, { align: "right" });
  doc.setFont("helvetica", "bold");
  doc.text(`Total: ${money(total)}`, rowRightX, pricingY + rowGap * 5, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.text(`Deposit: ${money(item.deposit)}`, rowRightX, pricingY + rowGap * 6, { align: "right" });
  doc.setFont("helvetica", "bold");
  doc.text(`Total Payable: ${money(payable)}`, rowRightX, pricingY + rowGap * 7, { align: "right" });
  doc.setFont("helvetica", "normal");
  const finalPaymentMethod = item.payment_method_names.length ? item.payment_method_names[item.payment_method_names.length - 1] : "-";
  doc.text(`Payment Method: ${finalPaymentMethod}`, rowRightX, pricingY + rowGap * 8, { align: "right" });

  const metadataY = Math.max(tableY, pricingY + rowGap * 9) + 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Technician(s): ${item.worker_names.length ? item.worker_names.join(", ") : "-"}`, 14, metadataY);
  doc.text(`Date Finished: ${dateOnly(item.updated_at)}`, 14, metadataY + 6);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Warranty: 1 month on replaced parts and labour.", 14, 290);

  doc.save(`pick-up-form-${item.reference_id}.pdf`);
}
