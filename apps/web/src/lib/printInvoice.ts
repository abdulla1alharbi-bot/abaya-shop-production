/**
 * Generates a printable UAE VAT tax invoice in a new browser window and opens
 * the browser's native print dialog. Everything printed is in English, at the
 * owner's request (2026-11-22): the customer copy and the workshop sheets.
 * Text the seller typed (names, notes, item descriptions) prints as typed.
 *
 * Two layouts, chosen by the `invoice_paper` setting:
 *   - "receipt80" (default): 80mm thermal roll — the shop's counter printer.
 *   - "a4": full-page invoice.
 */

export type InvoicePaper = "receipt80" | "a4";

export function invoicePaperOf(settings?: Record<string, string>): InvoicePaper {
  return settings?.invoice_paper === "a4" ? "a4" : "receipt80";
}

function fils(f: number): string {
  return (f / 100).toFixed(2);
}

function aed(f: number): string {
  return `AED ${fils(f)}`;
}

/**
 * Every value that came from a user (customer name, notes, descriptions…) goes
 * through this. The print window shares the app's origin, so unescaped markup in
 * a customer name would run as script with the seller's session.
 */
function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type InvoiceItem = {
  id: string;
  description?: string | null;
  qty: number;
  unitFils: number;
  discountFils: number;
  totalFils: number;
  product?: { name?: string; nameAr?: string | null } | null;
};

type Payment = {
  id: string;
  method: string;
  amountFils: number;
  reference?: string | null;
  createdAt: string;
};

/** A tailoring piece — the shop copy is built from these. */
type JobOrder = {
  jobNo: number;
  productStyle?: string | null;
  customStyleText?: string | null;
  dueDate?: string | null;
  measurements?: string | null; // JSON snapshot taken at intake
  notes?: string | null;
};

type InvoiceData = {
  invoiceNo: number;
  createdAt: string;
  deliveryDate?: string | null;
  customer?: { name: string; mobile: string } | null;
  items: InvoiceItem[];
  payments: Payment[];
  subtotalFils: number;
  discountFils: number;
  vatFils: number;
  totalFils: number;
  paidFils: number;
  balanceFils: number;
  notes?: string | null;
  branch?: { name?: string; phone?: string | null; address?: string | null } | null;
  /** Sent by the API with the invoice, so roles without settings.view can print. */
  printSettings?: Record<string, string>;
  jobOrders?: JobOrder[];
};

/**
 * Drops the Arabic half of the app's own bilingual labels ("موديل / Model" →
 * "Model"), which the POS writes into item descriptions. Only an Arabic phrase
 * joined to the rest by a slash goes; other Arabic the seller typed stays.
 */
function englishOnly(text: string): string {
  const ar = "[\\u0600-\\u06FF][\\u0600-\\u06FF ]*";
  return text
    .replace(new RegExp(`${ar}\\s*/\\s*`, "g"), "")
    .replace(new RegExp(`\\s*/\\s*${ar}`, "g"), "")
    .trim();
}

function itemLabel(item: InvoiceItem): string {
  if (item.description) return englishOnly(item.description);
  if (item.product?.name) return item.product.name;
  if (item.product?.nameAr) return item.product.nameAr;
  return "—";
}

function qtyLabel(q: number): string {
  return q % 1 === 0 ? String(q) : q.toFixed(1);
}

function methodLabel(m: string): string {
  const map: Record<string, string> = { CASH: "Cash", TRANSFER: "Transfer", CARD: "Card" };
  return map[m] ?? m;
}

function formatDate(d: string): string {
  try {
    return new Date(d).toLocaleDateString("en-GB");
  } catch {
    return d;
  }
}

/** Delivery is an appointment, so the customer copy carries the hour too. */
function formatDateTime(d: string): string {
  try {
    const dt = new Date(d);
    return `${dt.toLocaleDateString("en-GB")} ${dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  } catch {
    return d;
  }
}

/**
 * Opens the (blank) print window. Call it synchronously inside the click handler,
 * before any `await`: browsers only allow popups while the click is still "fresh",
 * and fetching the invoice first could outlast that and get the window blocked.
 */
export function openPrintWindow(): Window | null {
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) {
    alert("يرجى السماح بفتح النوافذ المنبثقة لطباعة الفاتورة.\nPlease allow popups to print the invoice.");
    return null;
  }
  win.document.write(
    '<!DOCTYPE html><html dir="rtl"><body style="font-family:Arial,sans-serif;padding:24px;">جارٍ تجهيز الفاتورة… / Preparing invoice…</body></html>',
  );
  win.document.close();
  return win;
}

/**
 * Prints once the page (fonts) has loaded. A thermal driver cuts the
 * paper at the end of the job.
 */
const PRINT_ON_LOAD = "<script>window.onload = function () { window.focus(); window.print(); };</script>";

// ─── Shop copy ───────────────────────────────────────────────────────────────
// Printed right after the customer copy, on its own page (the thermal driver
// cuts between pages). It replaces the paper work-sheet the shop used to fill by
// hand: invoice no., dates, and each piece ordered with its own abaya outline,
// the measurements taken at the POS marked at their places, plus room for
// notes. Retail-only invoices have no work to note, so they print the customer
// copy alone.

/** Body fields are numbers from the POS; typed loosely since old snapshots vary. */
type Measurements = {
  sizeType?: string;
  standardSize?: string;
  fabricRollCode?: string;
  fabricName?: string;
  fabricColor?: string;
  colorNote?: string;
  shoulder?: unknown;
  chest?: unknown;
  waist?: unknown;
  hip?: unknown;
  length?: unknown;
  sleeve?: unknown;
};

function parseMeasurements(raw?: string | null): Measurements {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" ? (v as Measurements) : {};
  } catch {
    return {};
  }
}

/** Latest piece due date — what the customer was told when no invoice date is set. */
function latestDue(jobs: JobOrder[]): string | null {
  const dues = jobs.map((j) => j.dueDate).filter((d): d is string => Boolean(d));
  if (dues.length === 0) return null;
  return dues.reduce((a, b) => (new Date(b) > new Date(a) ? b : a));
}

/** A measurement as printed: "56", "56.5"; null when not taken. */
function measureText(v: unknown): string | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(Math.round(n * 100) / 100);
}

/** The sketch's SVG coordinate box: x, y, width, height. Labels are placed in it by percent. */
const SKETCH_BOX = { x: -50, y: -30, w: 352, h: 322 };

/** The words printed on the workshop sheet. */
const W = {
  copyTag: "WORKSHOP COPY",
  date: "Date",
  due: "Delivery",
  customer: "Customer",
  cashCustomer: "Cash customer",
  mobile: "Mobile",
  job: "Job",
  pieceDue: "Piece delivery",
  fabric: "Fabric",
  color: "Colour",
  readySize: "Ready size",
  workNotes: "Work notes",
  sleeve: "Sleeve L.",
  sleeveWidth: "Sleeve W.",
  armhole: "Armhole",
  waist: "Waist",
  hem: "Hem",
  length: "Length",
} as const;

/**
 * One measurement label, centred on point (x, y) of the sketch: "Waist 24", or
 * "Waist ____" for the worker to fill in when the seller left it empty. `stacked`
 * puts the number under the name, for the narrow spots at the sides.
 */
function sketchLabel(label: string, v: unknown, x: number, y: number, stacked = false): string {
  const t = measureText(v);
  const value = t ? `<b class="v">${esc(t)}</b>` : "____";
  const left = (((x - SKETCH_BOX.x) / SKETCH_BOX.w) * 100).toFixed(2);
  const top = (((y - SKETCH_BOX.y) / SKETCH_BOX.h) * 100).toFixed(2);
  return `<div class="lbl${stacked ? " stack" : ""}" style="left:${left}%;top:${top}%">${label}${stacked ? "<br />" : " "}${value}</div>`;
}

/**
 * The abaya outline from the shop's paper form (shoulders across the top, body
 * narrowing to the waist and flaring to the hem) with each measurement at its
 * place. The POS form's names map to: طول الكم = Sleeve L. (top bar),
 * عرض الكم = Sleeve W. (its end), باط = Armhole, خصر = Waist, وسع الذيل = Hem,
 * طول = Length (down the side).
 *
 * Plain solid paths with HTML labels over them. (A day when nothing printed was
 * once blamed on SVG text, dashes and markers; it turned out to be a stuck
 * Windows print queue on the counter PC.)
 */
function abayaSketch(m: Measurements): string {
  // Each dimension: the line, then a short tick across each end.
  const dims = [
    "M40 2 H220 M40 -4 V8 M220 -4 V8", // طول الكم, over the top bar
    "M28 12 V48 M22 12 H34 M22 48 H34", // عرض الكم, at the bar's end
    "M86 70 H174 M86 64 V76 M174 64 V76", // باط
    "M88 160 H172 M88 154 V166 M172 154 V166", // خصر
    "M34 274 H226 M34 268 V280 M226 268 V280", // وسع الذيل
    "M246 12 V286 M240 12 H252 M240 286 H252", // طول
  ].join(" ");
  const box = SKETCH_BOX;
  return `<div class="sketch">
    <svg viewBox="${box.x} ${box.y} ${box.w} ${box.h}" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#000">
      <path d="M40 12 H220 V48 H182 Q148 150 238 286 H22 Q112 150 78 48 H40 Z" stroke-width="2" />
      <path d="${dims}" stroke-width="1.2" />
    </svg>
    ${sketchLabel(W.sleeve, m.sleeve, 130, -16)}
    ${sketchLabel(W.sleeveWidth, m.chest, -14, 30, true)}
    ${sketchLabel(W.armhole, m.shoulder, 130, 98, true)}
    ${sketchLabel(W.waist, m.waist, 130, 180)}
    ${sketchLabel(W.hem, m.hip, 130, 258)}
    ${sketchLabel(W.length, m.length, 278, 149, true)}
  </div>`;
}

function jobSheetHtml(job: JobOrder, deliveryDate: string | null): string {
  const m = parseMeasurements(job.measurements);
  const fabric = [m.fabricRollCode, m.fabricName, m.fabricColor].filter(Boolean).join(" · ");
  const ownDue = job.dueDate && job.dueDate !== deliveryDate ? job.dueDate : null;
  return `
    <div class="job">
      <div class="row b"><span>${W.job}</span><span class="num">#${job.jobNo}</span></div>
      ${job.productStyle ? `<div class="job-style">${esc(englishOnly(job.productStyle))}</div>` : ""}
      ${ownDue ? `<div class="row"><span>${W.pieceDue}</span><span class="num">${formatDateTime(ownDue)}</span></div>` : ""}
      ${fabric ? `<div class="row"><span>${W.fabric}</span><span>${esc(fabric)}</span></div>` : ""}
      ${m.colorNote ? `<div class="row"><span>${W.color}</span><span>${esc(m.colorNote)}</span></div>` : ""}
      ${m.sizeType === "STANDARD" && m.standardSize ? `<div class="row b"><span>${W.readySize}</span><span>${esc(m.standardSize)}</span></div>` : ""}
      ${job.notes ? `<div class="job-notes">${esc(job.notes)}</div>` : ""}
      ${abayaSketch(m)}
    </div>`;
}

/** Shop copies per print: the seller picks 0–5 at the print button, default 1. */
export const SHOP_COPIES_DEFAULT = 1;
export const SHOP_COPIES_MAX = 5;

export function clampShopCopies(n: number | undefined): number {
  return typeof n === "number" && Number.isFinite(n)
    ? Math.min(SHOP_COPIES_MAX, Math.max(0, Math.round(n)))
    : SHOP_COPIES_DEFAULT;
}

/**
 * The shop copies, one page each. Several are printed when the work is split
 * across people (cutter, tailor, embroiderer), each keeping a sheet; they are
 * numbered so a missing one shows.
 */
function shopCopiesHtml(inv: InvoiceData, shopName: string, copies: number): string {
  const jobs = inv.jobOrders ?? [];
  if (jobs.length === 0 || copies <= 0) return "";
  return Array.from({ length: copies }, (_, i) => shopCopyHtml(inv, jobs, shopName, i + 1, copies)).join("");
}

function shopCopyHtml(inv: InvoiceData, jobs: JobOrder[], shopName: string, copyNo: number, copies: number): string {
  const delivery = inv.deliveryDate ?? latestDue(jobs);
  return `
<div class="shop-copy">
  <div class="c">
    <div class="shop">${esc(shopName)}</div>
    <div class="copy-tag">${W.copyTag}${copies > 1 ? ` <span class="num">${copyNo}/${copies}</span>` : ""}</div>
    <div class="inv-no num">#${inv.invoiceNo}</div>
  </div>
  <hr />
  <div class="row"><span>${W.date}</span><span class="num">${formatDate(inv.createdAt)}</span></div>
  <div class="row due"><span>${W.due}</span><span class="num">${delivery ? formatDateTime(delivery) : "________"}</span></div>
  <div class="row"><span>${W.customer}</span><span class="b">${esc(inv.customer?.name ?? W.cashCustomer)}</span></div>
  ${inv.customer?.mobile ? `<div class="row"><span>${W.mobile}</span><span class="num">${esc(inv.customer.mobile)}</span></div>` : ""}
  ${inv.notes ? `<div class="job-notes">${esc(inv.notes)}</div>` : ""}
  <hr />
  ${jobs.map((j) => jobSheetHtml(j, delivery)).join('<hr class="solid" />')}
  <hr class="solid" />
  <div class="notes-title">${W.workNotes}</div>
  <div class="write-line"></div><div class="write-line"></div><div class="write-line"></div><div class="write-line"></div>
</div>`;
}

/**
 * Self-contained so it prints the same under the receipt and the A4 layout.
 * Width follows the receipt body's content box (68mm) rather than a fixed 72mm:
 * a fixed 72mm stuck 2mm past the printable edge and the roll cut the left side
 * off (dates, sizes).
 */
const SHOP_COPY_CSS = `
    .shop-copy { break-before: page; page-break-before: always; width: 100%; max-width: 72mm; margin: 0 auto; padding-top: 3mm; font-size: 12px; line-height: 1.35; color: #000; }
    .shop-copy .c { text-align: center; }
    .shop-copy .b { font-weight: 700; }
    .shop-copy .shop { font-size: 15px; font-weight: 800; }
    .shop-copy .copy-tag { display: inline-block; margin: 4px 0 2px; padding: 1px 10px; border: 2px solid #000; font-weight: 900; font-size: 13px; }
    .shop-copy .inv-no { font-size: 26px; font-weight: 900; }
    .shop-copy hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
    .shop-copy hr.solid { border-top: 2px solid #000; margin: 8px 0; }
    .shop-copy .row { display: flex; justify-content: space-between; gap: 6px; }
    .shop-copy .row.due { font-size: 14px; font-weight: 900; }
    .shop-copy .num { direction: ltr; unicode-bidi: isolate; font-variant-numeric: tabular-nums; }
    .shop-copy .job-style { font-weight: 800; font-size: 13px; margin: 2px 0; word-break: break-word; }
    .shop-copy .job { break-inside: avoid; page-break-inside: avoid; }
    .shop-copy .sketch { position: relative; width: 100%; max-width: 66mm; margin: 6px auto 2px; }
    .shop-copy .sketch svg { display: block; width: 100%; height: auto; }
    .shop-copy .sketch .lbl { position: absolute; width: 26mm; margin: -2.4mm 0 0 -13mm; text-align: center; font-size: 11px; line-height: 1.2; white-space: nowrap; }
    .shop-copy .sketch .lbl.stack { margin-top: -4.6mm; }
    .shop-copy .sketch .v { font-size: 15px; font-weight: 900; }
    .shop-copy .notes-title { font-weight: 800; font-size: 11px; margin-top: 4px; }
    .shop-copy .job-notes { margin-top: 3px; padding: 3px 4px; border: 1px solid #000; font-size: 12px; font-weight: 700; word-break: break-word; }
    .shop-copy .write-line { height: 7mm; border-bottom: 1px dotted #000; }
    @media screen { .shop-copy { margin-top: 10mm; border-top: 3px double #999; } }
`;

type Ctx = {
  inv: InvoiceData;
  shopName: string;
  vatRate: string;
  vatNo: string;
  shopCopies: number;
};

function paymentStatusBadge(inv: InvoiceData): string {
  if (inv.balanceFils <= 0) return '<span class="badge badge-paid">Fully Paid</span>';
  if (inv.paidFils > 0) return '<span class="badge badge-partial">Partially Paid</span>';
  return '<span class="badge badge-unpaid">Unpaid</span>';
}

/** 80mm thermal roll: ~72mm printable, black only, one narrow column. */
function receiptHtml({ inv, shopName, vatRate, vatNo, shopCopies }: Ctx): string {
  const itemRows = inv.items
    .map(
      (item) => `
      <div class="item">
        <div class="item-name">${esc(itemLabel(item))}</div>
        <div class="row">
          <span class="num">${qtyLabel(item.qty)} × ${fils(item.unitFils)}${item.discountFils > 0 ? ` − ${fils(item.discountFils)}` : ""}</span>
          <span class="num b">${fils(item.totalFils)}</span>
        </div>
      </div>`,
    )
    .join("");

  const paymentRows = inv.payments
    .map(
      (p) => `
      <div class="row">
        <span>${methodLabel(p.method)}${p.reference ? ` <small>(${esc(p.reference)})</small>` : ""}</span>
        <span class="num">${fils(p.amountFils)}</span>
      </div>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="UTF-8" />
  <title>Tax Invoice ${inv.invoiceNo}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    @page { margin: 0; }
    html, body { background: #fff; }
    body {
      width: 72mm;
      margin: 0 auto;
      /* The roll printer clips about 3mm on the left; the extra left padding keeps
         the first characters of dates and amounts on the paper. */
      padding: 3mm 2mm 6mm 5mm;
      font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
      font-size: 12px;
      line-height: 1.35;
      color: #000;
      direction: ltr;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .c { text-align: center; }
    .b { font-weight: 700; }
    small { font-size: 10px; }
    .shop { font-size: 15px; font-weight: 800; }
    .meta { font-size: 11px; }
    .title { margin: 6px 0 2px; font-size: 13px; font-weight: 800; }
    .inv-no { font-size: 22px; font-weight: 900; }
    hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
    hr.solid { border-top: 2px solid #000; }
    .row { display: flex; justify-content: space-between; gap: 6px; }
    .num { direction: ltr; unicode-bidi: isolate; font-variant-numeric: tabular-nums; }
    .item { padding: 3px 0; border-bottom: 1px dotted #000; }
    .item:last-child { border-bottom: 0; }
    .item-name { font-weight: 700; word-break: break-word; }
    .section { font-size: 11px; font-weight: 800; margin-bottom: 2px; }
    .total { font-size: 15px; font-weight: 900; }
    .balance { font-size: 14px; font-weight: 900; }
    .badge { display: inline-block; margin-top: 4px; padding: 2px 8px; border: 1.5px solid #000; font-weight: 800; font-size: 11px; }
    .notes { margin-top: 4px; font-size: 11px; word-break: break-word; }
    .footer { font-size: 10px; margin-top: 6px; }
${SHOP_COPY_CSS}
  </style>
</head>
<body>
  <div class="c">
    <div class="shop">${esc(shopName)}</div>
    ${inv.branch?.name ? `<div class="meta">${esc(inv.branch.name)}</div>` : ""}
    ${inv.branch?.address ? `<div class="meta">${esc(inv.branch.address)}</div>` : ""}
    ${inv.branch?.phone ? `<div class="meta num">${esc(inv.branch.phone)}</div>` : ""}
    ${vatNo ? `<div class="meta">TRN: <span class="num">${esc(vatNo)}</span></div>` : ""}
    <div class="title">Tax Invoice</div>
    <div class="inv-no num">#${inv.invoiceNo}</div>
  </div>
  <hr />
  <div class="row"><span>Date</span><span class="num">${formatDateTime(inv.createdAt)}</span></div>
  ${inv.deliveryDate ? `<div class="row b"><span>Delivery</span><span class="num">${formatDateTime(inv.deliveryDate)}</span></div>` : ""}
  <div class="row"><span>Customer</span><span class="b">${esc(inv.customer?.name ?? "Cash customer")}</span></div>
  ${inv.customer?.mobile ? `<div class="row"><span>Mobile</span><span class="num">${esc(inv.customer.mobile)}</span></div>` : ""}
  <hr />
  ${itemRows || '<div class="c">—</div>'}
  <hr class="solid" />
  <div class="row"><span>Subtotal</span><span class="num">${fils(inv.subtotalFils)}</span></div>
  ${inv.discountFils > 0 ? `<div class="row"><span>Discount</span><span class="num">-${fils(inv.discountFils)}</span></div>` : ""}
  <div class="row"><span>VAT ${esc(vatRate)}%</span><span class="num">${fils(inv.vatFils)}</span></div>
  <div class="row total"><span>Total</span><span class="num">${aed(inv.totalFils)}</span></div>
  <hr />
  ${inv.payments.length > 0 ? `<div class="section">Payments</div>${paymentRows}` : ""}
  <div class="row b"><span>Paid</span><span class="num">${fils(inv.paidFils)}</span></div>
  ${inv.balanceFils > 0 ? `<div class="row balance"><span>Balance</span><span class="num">${aed(inv.balanceFils)}</span></div>` : ""}
  <div class="c">${paymentStatusBadge(inv)}</div>
  ${inv.notes ? `<div class="notes"><b>Notes:</b> ${esc(inv.notes)}</div>` : ""}
  <div class="c footer">
    Tax Invoice — United Arab Emirates<br/>
    Thank you for your visit
  </div>
${shopCopiesHtml(inv, shopName, shopCopies)}
${PRINT_ON_LOAD}
</body>
</html>`;
}

/** Full-page A4 invoice. */
function a4Html({ inv, shopName, vatRate, vatNo, shopCopies }: Ctx): string {
  const itemRows = inv.items
    .map(
      (item) => `
      <tr>
        <td class="text-start">${esc(itemLabel(item))}</td>
        <td class="text-center">${qtyLabel(item.qty)}</td>
        <td class="text-end">${aed(item.unitFils)}</td>
        <td class="text-end">${item.discountFils > 0 ? aed(item.discountFils) : "—"}</td>
        <td class="text-end font-bold">${aed(item.totalFils)}</td>
      </tr>`,
    )
    .join("");

  const paymentRows = inv.payments
    .map(
      (p) => `
      <tr>
        <td>${methodLabel(p.method)}</td>
        <td class="text-end">${aed(p.amountFils)}</td>
        <td class="text-muted">${esc(p.reference ?? "")}</td>
        <td class="text-muted">${formatDate(p.createdAt)}</td>
      </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Tax Invoice ${inv.invoiceNo}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', 'Arial', sans-serif;
      font-size: 13px;
      color: #111;
      background: #fff;
      direction: ltr;
    }
    .page { max-width: 750px; margin: 0 auto; padding: 24px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 16px; margin-bottom: 16px; }
    .shop-name { font-size: 22px; font-weight: 800; }
    .shop-meta { font-size: 11px; color: #555; margin-top: 4px; }
    .invoice-title { text-align: right; }
    .invoice-title h2 { font-size: 20px; font-weight: 800; color: #1a1a1a; }
    .invoice-title .inv-no { font-size: 28px; font-weight: 900; color: #000; letter-spacing: -1px; }
    .invoice-title .meta { font-size: 11px; color: #555; margin-top: 4px; }
    .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; padding: 12px; background: #f8f8f8; border-radius: 6px; }
    .party-label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    .party-name { font-weight: 700; font-size: 14px; }
    .party-meta { font-size: 12px; color: #555; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
    th { background: #111; color: #fff; padding: 8px 10px; font-size: 11px; font-weight: 600; }
    td { padding: 7px 10px; border-bottom: 1px solid #eee; vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    .text-start { text-align: start; }
    .text-end { text-align: end; }
    .text-center { text-align: center; }
    .text-muted { color: #777; font-size: 11px; }
    .font-bold { font-weight: 700; }
    .totals-box { margin-left: 0; margin-right: 0; }
    .totals-row { display: flex; justify-content: space-between; padding: 5px 10px; font-size: 13px; }
    .totals-row.total { font-size: 16px; font-weight: 800; border-top: 2px solid #111; margin-top: 4px; padding-top: 8px; }
    .totals-row.balance { color: #b45309; }
    .badge { display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; }
    .badge-paid { background: #dcfce7; color: #166534; }
    .badge-partial { background: #fef9c3; color: #854d0e; }
    .badge-unpaid { background: #fee2e2; color: #991b1b; }
    .section-title { font-size: 11px; font-weight: 700; color: #555; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
    .footer { margin-top: 24px; border-top: 1px solid #ddd; padding-top: 12px; font-size: 11px; color: #888; text-align: center; }
    @media print {
      body { font-size: 12px; }
      .page { padding: 10px; }
      @page { size: A4; margin: 1cm; }
    }
${SHOP_COPY_CSS}
  </style>
</head>
<body>
<div class="page">
  <div class="header">
    <div>
      <div class="shop-name">${esc(shopName)}</div>
      ${vatNo ? `<div class="shop-meta">VAT TRN: ${esc(vatNo)}</div>` : ""}
      ${inv.branch?.name ? `<div class="shop-meta">${esc(inv.branch.name)}</div>` : ""}
    </div>
    <div class="invoice-title">
      <h2>Tax Invoice</h2>
      <div class="inv-no">#${inv.invoiceNo}</div>
      <div class="meta">
        Date: ${formatDate(inv.createdAt)}<br/>
        ${inv.deliveryDate ? `Delivery: ${formatDateTime(inv.deliveryDate)}` : ""}
      </div>
    </div>
  </div>

  <div class="parties">
    <div>
      <div class="party-label">Supplier</div>
      <div class="party-name">${esc(shopName)}</div>
      ${vatNo ? `<div class="party-meta">TRN: ${esc(vatNo)}</div>` : ""}
    </div>
    <div>
      <div class="party-label">Customer</div>
      <div class="party-name">${esc(inv.customer?.name ?? "Cash Customer")}</div>
      ${inv.customer?.mobile ? `<div class="party-meta">${esc(inv.customer.mobile)}</div>` : ""}
    </div>
  </div>

  <div class="section-title">Line Items</div>
  <table>
    <thead>
      <tr>
        <th class="text-start" style="width:40%">Description</th>
        <th class="text-center" style="width:10%">Qty</th>
        <th class="text-end" style="width:18%">Unit</th>
        <th class="text-end" style="width:14%">Disc</th>
        <th class="text-end" style="width:18%">Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows || '<tr><td colspan="5" class="text-center text-muted">—</td></tr>'}
    </tbody>
  </table>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:16px;">
    <div>
      ${
        inv.payments.length > 0
          ? `<div class="section-title">Payments</div>
             <table>
               <thead><tr><th class="text-start">Method</th><th class="text-end">Amount</th><th>Reference</th><th>Date</th></tr></thead>
               <tbody>${paymentRows}</tbody>
             </table>`
          : '<div class="section-title">Payments</div><p class="text-muted" style="padding:8px;">No payments recorded</p>'
      }
      ${inv.notes ? `<div style="margin-top:8px;padding:8px;background:#f8f8f8;border-radius:4px;font-size:11px;"><strong>Notes:</strong> ${esc(inv.notes)}</div>` : ""}
    </div>

    <div class="totals-box">
      <div class="section-title">Totals</div>
      <div class="totals-row"><span>Subtotal</span><span>${aed(inv.subtotalFils)}</span></div>
      ${inv.discountFils > 0 ? `<div class="totals-row"><span>Discount</span><span>- ${aed(inv.discountFils)}</span></div>` : ""}
      <div class="totals-row"><span>VAT ${esc(vatRate)}%</span><span>${aed(inv.vatFils)}</span></div>
      <div class="totals-row total"><span>Total</span><span>${aed(inv.totalFils)}</span></div>
      <div class="totals-row"><span>Paid</span><span>${aed(inv.paidFils)}</span></div>
      ${
        inv.balanceFils > 0
          ? `<div class="totals-row balance"><span>Balance Due</span><span>${aed(inv.balanceFils)}</span></div>`
          : ""
      }
      <div style="margin-top:10px;text-align:center;">${paymentStatusBadge(inv)}</div>
    </div>
  </div>

  <div class="footer">
    This is a tax invoice issued in accordance with UAE Federal Tax Authority requirements.<br/>
    VAT Rate: ${esc(vatRate)}% | Currency: AED | Invoice No: ${inv.invoiceNo} | Date: ${formatDate(inv.createdAt)}
  </div>
</div>
${shopCopiesHtml(inv, shopName, shopCopies)}
${PRINT_ON_LOAD}
</body>
</html>`;
}

/**
 * Renders the invoice into `win` (or a newly opened window) and prints it.
 * Settings come from `data.printSettings` (sent by the API with the invoice);
 * `shopSettings` only fills in gaps for callers that already hold /settings.
 */
export async function printInvoice(
  data: Record<string, unknown>,
  shopSettings?: Record<string, string>,
  win?: Window | null,
  opts?: { shopCopies?: number },
): Promise<void> {
  const target = win ?? openPrintWindow();
  if (!target) return;

  const inv = data as unknown as InvoiceData;
  const s: Record<string, string> = { ...(shopSettings ?? {}), ...(inv.printSettings ?? {}) };
  const paper = invoicePaperOf(s);
  // One name only: the brand (shop_name, e.g. "PureDaimonds"); the Arabic name
  // is for WhatsApp signatures and only prints when no brand name is set.
  const shopName = s.shop_name?.trim() || s.shop_name_ar?.trim() || "Abaya Shop";
  const vatRate = s.vat_rate || "5";
  const vatNo = s.vat_number?.trim() || "";

  const ctx: Ctx = {
    inv,
    shopName,
    vatRate,
    vatNo,
    shopCopies: clampShopCopies(opts?.shopCopies),
  };
  const html = paper === "a4" ? a4Html(ctx) : receiptHtml(ctx);

  target.document.open();
  target.document.write(html);
  target.document.close();
}
