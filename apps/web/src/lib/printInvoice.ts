/**
 * Generates a printable UAE VAT tax invoice in a new browser window and opens
 * the browser's native print dialog.
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

function itemLabel(item: InvoiceItem): string {
  if (item.description) return item.description;
  if (item.product?.nameAr) return item.product.nameAr;
  if (item.product?.name) return item.product.name;
  return "—";
}

function qtyLabel(q: number): string {
  return q % 1 === 0 ? String(q) : q.toFixed(1);
}

function methodLabel(m: string): string {
  const map: Record<string, string> = { CASH: "كاش / Cash", TRANSFER: "تحويل / Transfer", CARD: "بطاقة / Card" };
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
// hand: invoice no., dates, the pieces ordered, and one blank abaya outline the
// worker writes the measurements on, plus room for notes. Retail-only invoices
// have no work to note, so they print the customer copy alone.

type Measurements = {
  sizeType?: string;
  standardSize?: string;
  fabricRollCode?: string;
  fabricName?: string;
  fabricColor?: string;
  colorNote?: string;
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

/**
 * The blank abaya outline from the shop's paper form: shoulders across the top,
 * body narrowing to the waist and flaring to the hem. Deliberately unlabeled:
 * the worker writes each measurement at its place by hand.
 */
const ABAYA_SKETCH = `<svg class="sketch" viewBox="0 0 260 300" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#000">
    <path d="M40 12 H220 V48 H182 Q148 150 238 286 H22 Q112 150 78 48 H40 Z" stroke-width="2" />
  </svg>`;

function jobSheetHtml(job: JobOrder, deliveryDate: string | null): string {
  const m = parseMeasurements(job.measurements);
  const fabric = [m.fabricRollCode, m.fabricName, m.fabricColor].filter(Boolean).join(" · ");
  const ownDue = job.dueDate && job.dueDate !== deliveryDate ? job.dueDate : null;
  return `
    <div class="job">
      <div class="row b"><span>قطعة / Job</span><span class="num">#${job.jobNo}</span></div>
      ${job.productStyle ? `<div class="job-style">${esc(job.productStyle)}</div>` : ""}
      ${ownDue ? `<div class="row"><span>تسليم القطعة</span><span class="num">${formatDateTime(ownDue)}</span></div>` : ""}
      ${fabric ? `<div class="row"><span>القماش</span><span>${esc(fabric)}</span></div>` : ""}
      ${m.colorNote ? `<div class="row"><span>اللون</span><span>${esc(m.colorNote)}</span></div>` : ""}
      ${m.sizeType === "STANDARD" && m.standardSize ? `<div class="row b"><span>مقاس جاهز</span><span>${esc(m.standardSize)}</span></div>` : ""}
      ${job.notes ? `<div class="job-notes">${esc(job.notes)}</div>` : ""}
    </div>`;
}

/** How many shop copies follow the customer copy (setting `shop_copies`, 0–5, default 1). */
export function shopCopiesOf(settings?: Record<string, string>): number {
  const n = parseInt(settings?.shop_copies ?? "", 10);
  return Number.isFinite(n) ? Math.min(5, Math.max(0, n)) : 1;
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
    <div class="copy-tag">نسخة المحل / Shop copy${copies > 1 ? ` <span class="num">${copyNo}/${copies}</span>` : ""}</div>
    <div class="inv-no num">#${inv.invoiceNo}</div>
  </div>
  <hr />
  <div class="row"><span>Date / التاريخ</span><span class="num">${formatDate(inv.createdAt)}</span></div>
  <div class="row due"><span>D.Date / التسليم</span><span class="num">${delivery ? formatDateTime(delivery) : "________"}</span></div>
  <div class="row"><span>العميل</span><span class="b">${esc(inv.customer?.name ?? "عميل نقدي")}</span></div>
  ${inv.customer?.mobile ? `<div class="row"><span>الجوال</span><span class="num">${esc(inv.customer.mobile)}</span></div>` : ""}
  ${inv.notes ? `<div class="job-notes">${esc(inv.notes)}</div>` : ""}
  <hr />
  ${jobs.map((j) => jobSheetHtml(j, delivery)).join('<hr />')}
  <hr class="solid" />
  ${ABAYA_SKETCH}
  <div class="notes-title">ملاحظات على الشغل / Work notes</div>
  <div class="write-line"></div><div class="write-line"></div><div class="write-line"></div><div class="write-line"></div>
</div>`;
}

/** Self-contained so it prints the same under the receipt and the A4 layout. */
const SHOP_COPY_CSS = `
    .shop-copy { break-before: page; page-break-before: always; width: 72mm; margin: 0 auto; padding-top: 3mm; font-size: 12px; line-height: 1.35; color: #000; }
    .shop-copy .c { text-align: center; }
    .shop-copy .b { font-weight: 700; }
    .shop-copy .shop { font-size: 17px; font-weight: 800; }
    .shop-copy .copy-tag { display: inline-block; margin: 4px 0 2px; padding: 1px 10px; border: 2px solid #000; font-weight: 900; font-size: 13px; }
    .shop-copy .inv-no { font-size: 26px; font-weight: 900; }
    .shop-copy hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
    .shop-copy hr.solid { border-top: 2px solid #000; margin: 8px 0; }
    .shop-copy .row { display: flex; justify-content: space-between; gap: 6px; }
    .shop-copy .row.due { font-size: 14px; font-weight: 900; }
    .shop-copy .num { direction: ltr; unicode-bidi: isolate; font-variant-numeric: tabular-nums; }
    .shop-copy .job-style { font-weight: 800; font-size: 13px; margin: 2px 0; word-break: break-word; }
    .shop-copy .sketch { display: block; width: 62mm; height: auto; margin: 6px auto; }
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
  if (inv.balanceFils <= 0) return '<span class="badge badge-paid">مدفوع بالكامل / Fully Paid</span>';
  if (inv.paidFils > 0) return '<span class="badge badge-partial">مدفوع جزئياً / Partially Paid</span>';
  return '<span class="badge badge-unpaid">غير مدفوع / Unpaid</span>';
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
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>فاتورة ضريبية رقم ${inv.invoiceNo}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    @page { margin: 0; }
    html, body { background: #fff; }
    body {
      width: 72mm;
      margin: 0 auto;
      padding: 3mm 2mm 6mm;
      font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
      font-size: 12px;
      line-height: 1.35;
      color: #000;
      direction: rtl;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .c { text-align: center; }
    .b { font-weight: 700; }
    small { font-size: 10px; }
    .shop { font-size: 17px; font-weight: 800; }
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
    <div class="title">فاتورة ضريبية / Tax Invoice</div>
    <div class="inv-no num">#${inv.invoiceNo}</div>
  </div>
  <hr />
  <div class="row"><span>التاريخ / Date</span><span class="num">${formatDateTime(inv.createdAt)}</span></div>
  ${inv.deliveryDate ? `<div class="row b"><span>موعد التسليم / Delivery</span><span class="num">${formatDateTime(inv.deliveryDate)}</span></div>` : ""}
  <div class="row"><span>العميل / Customer</span><span class="b">${esc(inv.customer?.name ?? "عميل نقدي")}</span></div>
  ${inv.customer?.mobile ? `<div class="row"><span>الجوال / Mobile</span><span class="num">${esc(inv.customer.mobile)}</span></div>` : ""}
  <hr />
  ${itemRows || '<div class="c">—</div>'}
  <hr class="solid" />
  <div class="row"><span>المجموع الفرعي / Subtotal</span><span class="num">${fils(inv.subtotalFils)}</span></div>
  ${inv.discountFils > 0 ? `<div class="row"><span>خصم / Discount</span><span class="num">-${fils(inv.discountFils)}</span></div>` : ""}
  <div class="row"><span>ضريبة ${esc(vatRate)}% / VAT</span><span class="num">${fils(inv.vatFils)}</span></div>
  <div class="row total"><span>الإجمالي / Total</span><span class="num">${aed(inv.totalFils)}</span></div>
  <hr />
  ${inv.payments.length > 0 ? `<div class="section">المدفوعات / Payments</div>${paymentRows}` : ""}
  <div class="row b"><span>المدفوع / Paid</span><span class="num">${fils(inv.paidFils)}</span></div>
  ${inv.balanceFils > 0 ? `<div class="row balance"><span>المتبقي / Balance</span><span class="num">${aed(inv.balanceFils)}</span></div>` : ""}
  <div class="c">${paymentStatusBadge(inv)}</div>
  ${inv.notes ? `<div class="notes"><b>ملاحظات:</b> ${esc(inv.notes)}</div>` : ""}
  <div class="c footer">
    فاتورة ضريبية — الإمارات العربية المتحدة<br/>
    شكراً لزيارتكم / Thank you
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
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>فاتورة ضريبية رقم ${inv.invoiceNo}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', 'Arial', sans-serif;
      font-size: 13px;
      color: #111;
      background: #fff;
      direction: rtl;
    }
    .page { max-width: 750px; margin: 0 auto; padding: 24px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 16px; margin-bottom: 16px; }
    .shop-name { font-size: 22px; font-weight: 800; }
    .shop-meta { font-size: 11px; color: #555; margin-top: 4px; }
    .invoice-title { text-align: left; }
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
      ${vatNo ? `<div class="shop-meta">رقم التسجيل الضريبي / VAT TRN: ${esc(vatNo)}</div>` : ""}
      ${inv.branch?.name ? `<div class="shop-meta">${esc(inv.branch.name)}</div>` : ""}
    </div>
    <div class="invoice-title" dir="ltr">
      <h2>فاتورة ضريبية / Tax Invoice</h2>
      <div class="inv-no">#${inv.invoiceNo}</div>
      <div class="meta">
        التاريخ: ${formatDate(inv.createdAt)}<br/>
        ${inv.deliveryDate ? `موعد التسليم: ${formatDateTime(inv.deliveryDate)}` : ""}
      </div>
    </div>
  </div>

  <div class="parties">
    <div>
      <div class="party-label">المورد / Supplier</div>
      <div class="party-name">${esc(shopName)}</div>
      ${vatNo ? `<div class="party-meta">TRN: ${esc(vatNo)}</div>` : ""}
    </div>
    <div dir="ltr" style="text-align:left;">
      <div class="party-label">العميل / Customer</div>
      <div class="party-name">${esc(inv.customer?.name ?? "عميل نقدي / Cash Customer")}</div>
      ${inv.customer?.mobile ? `<div class="party-meta">${esc(inv.customer.mobile)}</div>` : ""}
    </div>
  </div>

  <div class="section-title">البنود / Line Items</div>
  <table>
    <thead>
      <tr>
        <th class="text-start" style="width:40%">الصنف / Description</th>
        <th class="text-center" style="width:10%">الكمية / Qty</th>
        <th class="text-end" style="width:18%">سعر الوحدة / Unit</th>
        <th class="text-end" style="width:14%">خصم / Disc</th>
        <th class="text-end" style="width:18%">المجموع / Total</th>
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
          ? `<div class="section-title">المدفوعات / Payments</div>
             <table>
               <thead><tr><th class="text-start">طريقة / Method</th><th class="text-end">المبلغ / Amount</th><th>مرجع</th><th>تاريخ</th></tr></thead>
               <tbody>${paymentRows}</tbody>
             </table>`
          : '<div class="section-title">المدفوعات / Payments</div><p class="text-muted" style="padding:8px;">لا توجد دفعات مسجّلة</p>'
      }
      ${inv.notes ? `<div style="margin-top:8px;padding:8px;background:#f8f8f8;border-radius:4px;font-size:11px;"><strong>ملاحظات:</strong> ${esc(inv.notes)}</div>` : ""}
    </div>

    <div class="totals-box">
      <div class="section-title">الإجماليات / Totals</div>
      <div class="totals-row"><span>المجموع الفرعي / Subtotal</span><span>${aed(inv.subtotalFils)}</span></div>
      ${inv.discountFils > 0 ? `<div class="totals-row"><span>خصم / Discount</span><span>- ${aed(inv.discountFils)}</span></div>` : ""}
      <div class="totals-row"><span>ضريبة القيمة المضافة ${esc(vatRate)}% / VAT</span><span>${aed(inv.vatFils)}</span></div>
      <div class="totals-row total"><span>الإجمالي / Total</span><span>${aed(inv.totalFils)}</span></div>
      <div class="totals-row"><span>المدفوع / Paid</span><span>${aed(inv.paidFils)}</span></div>
      ${
        inv.balanceFils > 0
          ? `<div class="totals-row balance"><span>الرصيد المستحق / Balance Due</span><span>${aed(inv.balanceFils)}</span></div>`
          : ""
      }
      <div style="margin-top:10px;text-align:center;">${paymentStatusBadge(inv)}</div>
    </div>
  </div>

  <div class="footer">
    هذه فاتورة ضريبية صادرة وفق متطلبات الهيئة الاتحادية للضرائب — الإمارات العربية المتحدة<br/>
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

  const ctx: Ctx = { inv, shopName, vatRate, vatNo, shopCopies: shopCopiesOf(s) };
  const html = paper === "a4" ? a4Html(ctx) : receiptHtml(ctx);

  target.document.open();
  target.document.write(html);
  target.document.close();
}
