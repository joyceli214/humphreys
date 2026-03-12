import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { WorkOrderDetail } from "@/lib/api/generated/types";

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
  return doc.splitTextToSize(text(value), width);
}

function labeledBoxHeight(doc: jsPDF, lines: string | string[], minHeight: number) {
  const titleToTextTop = 12;
  const bottomPadding = 4;
  const lineCount = Array.isArray(lines) ? Math.max(lines.length, 1) : Math.max(String(lines).split(/\r?\n/).length, 1);
  const lineHeightMm = (doc.getFontSize() * doc.getLineHeightFactor()) / doc.internal.scaleFactor;
  const textHeight = lineCount * lineHeightMm;
  return Math.max(minHeight, titleToTextTop + textHeight + bottomPadding);
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

  lineField(doc, 14, y + 35, 40, "Home Phone", text(item.customer.home_phone));
  lineField(doc, 60, y + 35, 40, "Work Phone / Cell", text(item.customer.work_phone));
  lineField(doc, 106, y + 35, 40, "Extension", text(item.customer.extension_text));

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.rect(14, y + 43, 12, 5);
  doc.text("Location", 29, y + 47);
  doc.rect(58, y + 43, 12, 5);
  doc.text("Cord", 73, y + 47);
  doc.rect(102, y + 43, 12, 5);
  doc.text("Remote Control", 117, y + 47);

  doc.rect(14, y + 52, 12, 5);
  doc.text("Albums/CDs/Cassettes", 29, y + 56);
  doc.rect(74, y + 52, 12, 5);
  doc.text("DVDs/VHS", 91, y + 56);
  doc.rect(112, y + 52, 12, 5);
  doc.text("Cables", 127, y + 56);

  lineField(doc, 54, y + 61, 34, "Deposit", money(item.deposit));
  lineField(doc, 100, y + 61, 50, "Payment Method", item.payment_method_names.length ? item.payment_method_names.join(", ") : "-");

  doc.setLineWidth(0.8);
  doc.line(14, y + 70, 196, y + 70);

  lineField(doc, 14, y + 83, 46, "Item", text(item.item_name));
  lineField(doc, 64, y + 83, 40, "Brand", item.brand_names.length ? item.brand_names.join(", ") : "-");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(`Customer ID`, 112, y + 83);
  doc.text(String(item.reference_id), 150, y + 83);

  lineField(doc, 14, y + 95, 46, "Model Number", text(item.model_number));
  lineField(doc, 64, y + 95, 40, "Serial Number", text(item.serial_number));

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(fitText(doc, accessories(item), 180), 14, y + 104);

  return y + 106;
}

export function generateDropOffFormPdf(item: WorkOrderDetail) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  drawHeader(doc, "Customer Drop Off Form");

  const y = drawCommon(doc, item, 44);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const problemLines = linesForWidth(doc, item.problem_description, 176);
  const workDoneLines = linesForWidth(doc, item.work_done, 176);
  const problemBoxHeight = labeledBoxHeight(doc, problemLines, 58);
  const workDoneBoxHeight = labeledBoxHeight(doc, workDoneLines, 58);

  doc.setLineWidth(0.3);
  doc.rect(14, y, 182, problemBoxHeight);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Problem Description", 16, y + 6);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(problemLines, 16, y + 12);

  const y2 = y + problemBoxHeight + 7;
  doc.rect(14, y2, 182, workDoneBoxHeight);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Work Done / Notes", 16, y2 + 6);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(workDoneLines, 16, y2 + 12);

  doc.setFontSize(9);
  doc.text(`Generated: ${new Date().toLocaleString("en-CA")}`, 14, 290);

  doc.save(`drop-off-form-${item.reference_id}.pdf`);
}

export function generatePickupFormPdf(item: WorkOrderDetail) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  drawHeader(doc, "Customer Pick Up Form");

  const y = drawCommon(doc, item, 44);

  autoTable(doc, {
    startY: y + 2,
    theme: "grid",
    head: [["Item", "Price", "Quantity", "Total"]],
    body: item.line_items.length
      ? item.line_items.map((line) => [
          text(line.item_name),
          money(line.unit_price),
          text(line.quantity_text),
          text(line.line_total_text)
        ])
      : [["-", "$0.00", "-", "-"]],
    styles: { fontSize: 9, cellPadding: 1.8 },
    headStyles: { fillColor: [238, 238, 238], textColor: 0 },
    margin: { left: 14, right: 14 }
  });

  let tableY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 40;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const problemLines = linesForWidth(doc, item.problem_description, 84);
  const workDoneLines = linesForWidth(doc, item.work_done, 84);
  const notesBoxHeight = Math.max(
    labeledBoxHeight(doc, problemLines, 44),
    labeledBoxHeight(doc, workDoneLines, 44)
  );
  const detailSectionHeight = 17 + notesBoxHeight;
  const totalsSectionHeight = 45;
  const sectionGap = 8;
  const needsNewPage = tableY + sectionGap + detailSectionHeight + totalsSectionHeight > pageHeight(doc) - 10;
  if (needsNewPage) {
    doc.addPage();
    drawHeader(doc, "Customer Pick Up Form");
    tableY = 34;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Problem Description", 14, tableY + 7);
  doc.text("Work Done", 108, tableY + 7);

  doc.setFont("helvetica", "normal");
  doc.rect(14, tableY + 9, 88, notesBoxHeight);
  doc.rect(108, tableY + 9, 88, notesBoxHeight);
  doc.setFontSize(10);
  doc.text(problemLines, 16, tableY + 15);
  doc.text(workDoneLines, 110, tableY + 15);

  const totalsY = tableY + 17 + notesBoxHeight;
  const partsTotal = calculatePartsTotal(item);
  const subtotal = partsTotal + (item.delivery_total ?? 0) + (item.labour_total ?? 0);
  const hst = subtotal * 0.13;
  const total = subtotal + hst;
  const payable = total - (item.deposit ?? 0);
  doc.setFont("helvetica", "normal");
  doc.text(`Parts Total: ${money(partsTotal)}`, 196, totalsY, { align: "right" });
  doc.text(`Pick Up / Delivery: ${money(item.delivery_total)}`, 196, totalsY + 7, { align: "right" });
  doc.text(`Labour Total: ${money(item.labour_total)}`, 196, totalsY + 14, { align: "right" });
  doc.text(`HST (13%): ${money(hst)}`, 196, totalsY + 21, { align: "right" });
  doc.text(`Deposit: ${money(item.deposit)}`, 196, totalsY + 28, { align: "right" });

  doc.setFont("helvetica", "bold");
  doc.text(`Total: ${money(total)}`, 196, totalsY + 36, { align: "right" });
  doc.text(`Total Payable: ${money(payable)}`, 196, totalsY + 43, { align: "right" });

  doc.setFontSize(10);
  doc.text(`Technician(s): ${item.worker_names.length ? item.worker_names.join(", ") : "-"}`, 14, totalsY + 36);
  doc.text(`Date Finished: ${dateOnly(item.updated_at)}`, 14, totalsY + 43);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Warranty: 1 month on replaced parts and labour.", 14, 290);

  doc.save(`pick-up-form-${item.reference_id}.pdf`);
}
