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

function dateOnly(value: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function money(value: number | null | undefined) {
  if (value === null || value === undefined) return "$0.00";
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value);
}

function accessories(item: WorkOrderDetail) {
  return [
    `Remote Control: ${item.remote_control_qty}`,
    `Cables: ${item.cable_qty}`,
    `Cord: ${item.cord_qty}`,
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
  doc.setFontSize(11);
  // Access-style field: value above the line, label below the line.
  doc.text(fitText(doc, value, w - 2), x + 1, y - 1.2);
  doc.line(x, y + 0.6, x + w, y + 0.6);
  doc.text(label, x, y + 4.5);
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
  doc.rect(14, y + 40, 12, 5);
  doc.text("Location", 29, y + 44);
  doc.rect(58, y + 40, 12, 5);
  doc.text("Cord", 73, y + 44);
  doc.rect(102, y + 40, 12, 5);
  doc.text("Remote Control", 117, y + 44);

  doc.rect(14, y + 49, 12, 5);
  doc.text("Albums/CDs/Cassettes", 29, y + 53);
  doc.rect(74, y + 49, 12, 5);
  doc.text("DVDs/VHS", 91, y + 53);
  doc.rect(112, y + 49, 12, 5);
  doc.text("Cables", 127, y + 53);

  lineField(doc, 54, y + 58, 34, "Deposit", money(item.deposit));
  lineField(doc, 100, y + 58, 50, "Payment Method", item.payment_method_names.length ? item.payment_method_names.join(", ") : "-");

  doc.setLineWidth(0.8);
  doc.line(14, y + 66, 196, y + 66);

  lineField(doc, 14, y + 79, 46, "Item", text(item.item_name));
  lineField(doc, 64, y + 79, 40, "Brand", item.brand_names.length ? item.brand_names.join(", ") : "-");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(`Customer ID`, 112, y + 79);
  doc.text(String(item.reference_id), 150, y + 79);

  lineField(doc, 14, y + 91, 46, "Model Number", text(item.model_number));
  lineField(doc, 64, y + 91, 40, "Serial Number", text(item.serial_number));

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(fitText(doc, accessories(item), 180), 14, y + 100);

  return y + 102;
}

export function generateDropOffFormPdf(item: WorkOrderDetail) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  drawHeader(doc, "Customer Drop Off Form");

  const y = drawCommon(doc, item, 44);

  doc.setLineWidth(0.3);
  doc.rect(14, y, 182, 58);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Problem Description", 16, y + 6);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const problem = text(item.problem_description);
  doc.text(doc.splitTextToSize(problem, 176), 16, y + 12);

  const y2 = y + 65;
  doc.rect(14, y2, 182, 58);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Work Done / Notes", 16, y2 + 6);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const workDone = text(item.work_done);
  doc.text(doc.splitTextToSize(workDone, 176), 16, y2 + 12);

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

  const tableY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 40;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Problem Description", 14, tableY + 8);
  doc.text("Work Done", 108, tableY + 8);

  doc.setFont("helvetica", "normal");
  doc.rect(14, tableY + 10, 88, 44);
  doc.rect(108, tableY + 10, 88, 44);
  doc.setFontSize(10);
  doc.text(doc.splitTextToSize(text(item.problem_description), 84), 16, tableY + 16);
  doc.text(doc.splitTextToSize(text(item.work_done), 84), 110, tableY + 16);

  const totalsY = tableY + 62;
  doc.setFont("helvetica", "normal");
  doc.text(`Parts Total: ${money(item.parts_total)}`, 196, totalsY, { align: "right" });
  doc.text(`Pick Up / Delivery: ${money(item.delivery_total)}`, 196, totalsY + 7, { align: "right" });
  doc.text(`Labour Total: ${money(item.labour_total)}`, 196, totalsY + 14, { align: "right" });
  doc.text(`Deposit: ${money(item.deposit)}`, 196, totalsY + 21, { align: "right" });

  const total = (item.parts_total ?? 0) + (item.delivery_total ?? 0) + (item.labour_total ?? 0);
  const payable = total - (item.deposit ?? 0);
  doc.setFont("helvetica", "bold");
  doc.text(`Total: ${money(total)}`, 196, totalsY + 29, { align: "right" });
  doc.text(`Total Payable: ${money(payable)}`, 196, totalsY + 37, { align: "right" });

  doc.setFontSize(10);
  doc.text(`Technician(s): ${item.worker_names.length ? item.worker_names.join(", ") : "-"}`, 14, totalsY + 29);
  doc.text(`Date Finished: ${dateOnly(item.updated_at)}`, 14, totalsY + 36);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Warranty: 1 month on replaced parts and labour.", 14, 290);

  doc.save(`pick-up-form-${item.reference_id}.pdf`);
}
