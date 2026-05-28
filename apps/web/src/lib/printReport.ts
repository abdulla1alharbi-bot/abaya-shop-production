/**
 * Generates a printable PDF for any report type by opening the formatted HTML
 * in a new window and triggering the browser's native print dialog.
 * Mirrors the printInvoice.ts pattern.
 */

function aed(fils: number): string {
  return `AED ${(fils / 100).toFixed(2)}`;
}

function formatDate(d: string | Date | undefined | null): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-GB");
  } catch {
    return String(d);
  }
}

function formatDateTime(d: string | Date | undefined | null): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-GB");
  } catch {
    return String(d);
  }
}

function shellHtml(opts: {
  shopName: string;
  vatNo: string;
  title: string;
  subtitle: string;
  body: string;
}): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>${opts.title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', 'Arial', sans-serif; font-size: 12px; color: #111; background: #fff; direction: rtl; }
    .page { max-width: 1000px; margin: 0 auto; padding: 18px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 12px; }
    .shop-name { font-size: 18px; font-weight: 800; }
    .shop-meta { font-size: 10px; color: #555; margin-top: 4px; }
    .report-title { text-align: left; }
    .report-title h2 { font-size: 16px; font-weight: 800; color: #1a1a1a; }
    .report-title .subtitle { font-size: 11px; color: #555; margin-top: 4px; }
    .summary-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; margin-bottom: 14px; }
    .card { border: 1px solid #ddd; border-radius: 6px; padding: 8px 10px; background: #fafafa; }
    .card .label { font-size: 10px; color: #666; }
    .card .value { font-size: 14px; font-weight: 700; margin-top: 2px; color: #111; }
    .card.green { border-color: #86efac; background: #f0fdf4; }
    .card.yellow { border-color: #fcd34d; background: #fffbeb; }
    .card.orange { border-color: #fdba74; background: #fff7ed; }
    .card.red { border-color: #fca5a5; background: #fef2f2; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 11px; }
    th { background: #111; color: #fff; padding: 6px 8px; font-weight: 600; font-size: 10px; }
    td { padding: 5px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    .text-start { text-align: start; }
    .text-end { text-align: end; }
    .text-center { text-align: center; }
    .font-bold { font-weight: 700; }
    .muted { color: #777; }
    tfoot td { background: #f5f5f5; font-weight: 700; border-top: 2px solid #111; }
    .footer { margin-top: 18px; border-top: 1px solid #ddd; padding-top: 8px; font-size: 10px; color: #888; text-align: center; }
    .badge { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: 700; }
    .badge.green { background: #dcfce7; color: #166534; }
    .badge.yellow { background: #fef9c3; color: #854d0e; }
    .badge.orange { background: #fed7aa; color: #9a3412; }
    .badge.red { background: #fee2e2; color: #991b1b; }
    @media print {
      body { font-size: 11px; }
      .page { padding: 6px; }
      @page { margin: 1cm; size: A4; }
      thead { display: table-header-group; }
      tr { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
<div class="page">
  <div class="header">
    <div>
      <div class="shop-name">${opts.shopName}</div>
      ${opts.vatNo ? `<div class="shop-meta">رقم التسجيل الضريبي / VAT TRN: ${opts.vatNo}</div>` : ""}
    </div>
    <div class="report-title" dir="rtl">
      <h2>${opts.title}</h2>
      <div class="subtitle">${opts.subtitle}</div>
      <div class="subtitle">تاريخ الطباعة: ${formatDateTime(new Date())}</div>
    </div>
  </div>
  ${opts.body}
  <div class="footer">
    ${opts.shopName} — تقرير داخلي | Generated on ${formatDateTime(new Date())}
  </div>
</div>
<script>window.onload = function() { setTimeout(function(){ window.print(); }, 100); }</script>
</body>
</html>`;
}

function openPrintWindow(html: string): void {
  const win = window.open("", "_blank", "width=1000,height=750");
  if (!win) {
    alert("يرجى السماح بفتح النوافذ المنبثقة لطباعة التقرير.");
    return;
  }
  win.document.write(html);
  win.document.close();
}

// ────────────────────────────────────────────────────────────────────────────
// Report payload types (match the API responses used in ReportsPage.tsx)
// ────────────────────────────────────────────────────────────────────────────

export type ReportRange = { from?: string; to?: string };

function rangeSubtitle(r: ReportRange): string {
  if (!r.from && !r.to) return "كل الفترات";
  return `من ${formatDate(r.from)} إلى ${formatDate(r.to)}`;
}

// ─── Receivables Aging ──────────────────────────────────────────────────────
export type ReceivablesPayload = {
  unpaidInvoices: Array<{
    id: string;
    invoiceNo: number;
    totalFils: number;
    paidFils: number;
    balanceFils: number;
    createdAt: string;
    daysSince: number;
    agingBucket: "current" | "31to60" | "61to90" | "over90";
    customer: { name: string; mobile: string } | null;
  }>;
  customersWithBalance: Array<{ id: string; name: string; mobile: string; balanceFils: number }>;
  agingTotals: { current: number; "31to60": number; "61to90": number; over90: number };
};

function printReceivables(
  data: ReceivablesPayload,
  range: ReportRange,
  shopName: string,
  vatNo: string,
): void {
  const totals = data.agingTotals;
  const grandTotal = totals.current + totals["31to60"] + totals["61to90"] + totals.over90;

  const cards = `
    <div class="summary-cards">
      <div class="card green"><div class="label">0 – 30 يوم</div><div class="value">${aed(totals.current)}</div></div>
      <div class="card yellow"><div class="label">31 – 60 يوم</div><div class="value">${aed(totals["31to60"])}</div></div>
      <div class="card orange"><div class="label">61 – 90 يوم</div><div class="value">${aed(totals["61to90"])}</div></div>
      <div class="card red"><div class="label">+90 يوم</div><div class="value">${aed(totals.over90)}</div></div>
    </div>`;

  const rows = data.unpaidInvoices
    .map((inv) => {
      const bucket =
        inv.agingBucket === "current"
          ? "green"
          : inv.agingBucket === "31to60"
            ? "yellow"
            : inv.agingBucket === "61to90"
              ? "orange"
              : "red";
      return `<tr>
        <td>#${inv.invoiceNo} <span class="muted">${inv.customer?.name ?? ""}</span></td>
        <td class="text-center"><span class="badge ${bucket}">${inv.daysSince}</span></td>
        <td class="text-end">${aed(inv.totalFils)}</td>
        <td class="text-end">${aed(inv.paidFils)}</td>
        <td class="text-end font-bold">${aed(inv.balanceFils)}</td>
      </tr>`;
    })
    .join("");

  const body = `
    ${cards}
    <h3 style="font-size:13px;margin-bottom:6px;">فواتير غير مسددة (${data.unpaidInvoices.length})</h3>
    <table>
      <thead><tr>
        <th class="text-start">فاتورة / عميل</th>
        <th class="text-center">أيام</th>
        <th class="text-end">الإجمالي</th>
        <th class="text-end">المدفوع</th>
        <th class="text-end">المتبقي</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="text-center muted">لا يوجد.</td></tr>'}</tbody>
      <tfoot><tr><td colspan="4" class="text-end">الإجمالي الكلي</td><td class="text-end">${aed(grandTotal)}</td></tr></tfoot>
    </table>`;

  openPrintWindow(
    shellHtml({ shopName, vatNo, title: "تقرير الذمم المستحقة (أعمار الديون)", subtitle: rangeSubtitle(range), body }),
  );
}

// ─── Sales / Invoices list ──────────────────────────────────────────────────
export type SalesPayload = {
  invoices: Array<{
    id: string;
    invoiceNo: number;
    createdAt: string;
    totalFils: number;
    paidFils: number;
    balanceFils: number;
    customer: { name: string; mobile: string } | null;
  }>;
  totals: { totalFils: number; paidFils: number; balanceFils: number; count: number };
};

function printSales(data: SalesPayload, range: ReportRange, shopName: string, vatNo: string): void {
  const t = data.totals;
  const cards = `
    <div class="summary-cards">
      <div class="card"><div class="label">عدد الفواتير</div><div class="value">${t.count}</div></div>
      <div class="card green"><div class="label">إجمالي المبيعات</div><div class="value">${aed(t.totalFils)}</div></div>
      <div class="card"><div class="label">المدفوع</div><div class="value">${aed(t.paidFils)}</div></div>
      <div class="card red"><div class="label">المتبقي</div><div class="value">${aed(t.balanceFils)}</div></div>
    </div>`;

  const rows = data.invoices
    .map(
      (inv) => `<tr>
      <td>#${inv.invoiceNo}</td>
      <td>${formatDate(inv.createdAt)}</td>
      <td>${inv.customer?.name ?? "—"}</td>
      <td class="text-end">${aed(inv.totalFils)}</td>
      <td class="text-end">${aed(inv.paidFils)}</td>
      <td class="text-end">${aed(inv.balanceFils)}</td>
    </tr>`,
    )
    .join("");

  const body = `
    ${cards}
    <table>
      <thead><tr>
        <th class="text-start">فاتورة</th>
        <th class="text-start">تاريخ</th>
        <th class="text-start">عميل</th>
        <th class="text-end">إجمالي</th>
        <th class="text-end">مدفوع</th>
        <th class="text-end">متبقي</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="text-center muted">لا يوجد.</td></tr>'}</tbody>
    </table>`;

  openPrintWindow(shellHtml({ shopName, vatNo, title: "تقرير المبيعات", subtitle: rangeSubtitle(range), body }));
}

// ─── Worker Wages ───────────────────────────────────────────────────────────
export type WagesPayload = {
  productionRows: Array<{
    workerId: string;
    name: string;
    qty: number;
    totalFils: number;
    entries: number;
  }>;
};

function printWages(data: WagesPayload, range: ReportRange, shopName: string, vatNo: string): void {
  const totalQty = data.productionRows.reduce((s, r) => s + r.qty, 0);
  const totalFils = data.productionRows.reduce((s, r) => s + r.totalFils, 0);

  const rows = data.productionRows
    .map(
      (r) => `<tr>
      <td class="font-bold">${r.name}</td>
      <td class="text-center">${r.entries}</td>
      <td class="text-center">${r.qty}</td>
      <td class="text-end font-bold">${aed(r.totalFils)}</td>
    </tr>`,
    )
    .join("");

  const body = `
    <div class="summary-cards">
      <div class="card"><div class="label">عدد العمال</div><div class="value">${data.productionRows.length}</div></div>
      <div class="card"><div class="label">إجمالي المهام</div><div class="value">${totalQty}</div></div>
      <div class="card green"><div class="label">إجمالي الأجور</div><div class="value">${aed(totalFils)}</div></div>
    </div>
    <table>
      <thead><tr>
        <th class="text-start">العامل</th>
        <th class="text-center">عدد المراحل</th>
        <th class="text-center">الكمية</th>
        <th class="text-end">إجمالي الأجر</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="4" class="text-center muted">لا يوجد.</td></tr>'}</tbody>
      <tfoot><tr><td colspan="3" class="text-end">الإجمالي</td><td class="text-end">${aed(totalFils)}</td></tr></tfoot>
    </table>`;

  openPrintWindow(shellHtml({ shopName, vatNo, title: "تقرير أجور العمال", subtitle: rangeSubtitle(range), body }));
}

// ─── Financial Activity ─────────────────────────────────────────────────────
export type FinancialPayload = {
  incomeFils: number;
  expensesFils: number;
  wagesFils: number;
  netFils: number;
  breakdown?: { paymentsFils?: number; otherIncomeFils?: number };
};

function printFinancial(data: FinancialPayload, range: ReportRange, shopName: string, vatNo: string): void {
  const netClass = data.netFils >= 0 ? "green" : "red";
  const body = `
    <div class="summary-cards">
      <div class="card green"><div class="label">الإيرادات</div><div class="value">${aed(data.incomeFils)}</div></div>
      <div class="card red"><div class="label">المصروفات</div><div class="value">${aed(data.expensesFils)}</div></div>
      <div class="card orange"><div class="label">أجور العمال</div><div class="value">${aed(data.wagesFils)}</div></div>
      <div class="card ${netClass}"><div class="label">صافي الربح/الخسارة</div><div class="value">${aed(data.netFils)}</div></div>
    </div>
    <table>
      <thead><tr><th class="text-start">البند</th><th class="text-end">المبلغ</th></tr></thead>
      <tbody>
        <tr><td>إجمالي الإيرادات</td><td class="text-end">${aed(data.incomeFils)}</td></tr>
        ${data.breakdown?.paymentsFils != null ? `<tr><td class="muted">— مدفوعات الفواتير</td><td class="text-end muted">${aed(data.breakdown.paymentsFils)}</td></tr>` : ""}
        ${data.breakdown?.otherIncomeFils != null ? `<tr><td class="muted">— إيرادات أخرى</td><td class="text-end muted">${aed(data.breakdown.otherIncomeFils)}</td></tr>` : ""}
        <tr><td>إجمالي المصروفات</td><td class="text-end">- ${aed(data.expensesFils)}</td></tr>
        <tr><td>إجمالي أجور العمال</td><td class="text-end">- ${aed(data.wagesFils)}</td></tr>
      </tbody>
      <tfoot><tr><td>صافي الربح/الخسارة</td><td class="text-end">${aed(data.netFils)}</td></tr></tfoot>
    </table>`;

  openPrintWindow(shellHtml({ shopName, vatNo, title: "تقرير النشاط المالي", subtitle: rangeSubtitle(range), body }));
}

// ─── Tailoring Orders ───────────────────────────────────────────────────────
export type TailoringPayload = {
  jobOrders: Array<{
    id: string;
    jobNo: number;
    productStyle: string;
    stage: string;
    dueDate: string;
    createdAt: string;
    customer: { name: string; mobile: string };
  }>;
  count: number;
};

const STAGE_AR: Record<string, string> = {
  NEW: "جديد",
  CUTTING: "قص",
  SEWING: "خياطة",
  EMBROIDERY: "تطريز",
  FINISHING: "تجهيز",
  INSPECTION: "فحص جودة",
  READY: "جاهز",
  DELIVERED: "تم التسليم",
  CANCELLED: "ملغى",
};

function printTailoring(data: TailoringPayload, range: ReportRange, shopName: string, vatNo: string): void {
  const rows = data.jobOrders
    .map(
      (j) => `<tr>
      <td>#${j.jobNo}</td>
      <td>${j.customer?.name ?? "—"}</td>
      <td>${j.productStyle}</td>
      <td class="text-center"><span class="badge yellow">${STAGE_AR[j.stage] ?? j.stage}</span></td>
      <td>${formatDate(j.createdAt)}</td>
      <td>${formatDate(j.dueDate)}</td>
    </tr>`,
    )
    .join("");

  const body = `
    <div class="summary-cards">
      <div class="card"><div class="label">عدد الطلبات</div><div class="value">${data.count}</div></div>
    </div>
    <table>
      <thead><tr>
        <th class="text-start">رقم</th>
        <th class="text-start">عميل</th>
        <th class="text-start">الموديل</th>
        <th class="text-center">المرحلة</th>
        <th class="text-start">إنشاء</th>
        <th class="text-start">تسليم</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="text-center muted">لا يوجد.</td></tr>'}</tbody>
    </table>`;

  openPrintWindow(shellHtml({ shopName, vatNo, title: "تقرير طلبات التفصيل", subtitle: rangeSubtitle(range), body }));
}

// ─── Most Requested Items ───────────────────────────────────────────────────
export type MostRequestedPayload = {
  items: Array<{
    productId: string;
    sku: string | null;
    name: string;
    categoryName: string;
    kind: "tailoring" | "retail";
    lineCount: number;
    invoiceCount: number;
    totalQty: number;
    totalSalesFils: number;
  }>;
};

function printMostRequested(
  data: MostRequestedPayload,
  range: ReportRange,
  shopName: string,
  vatNo: string,
): void {
  const totalSales = data.items.reduce((s, i) => s + i.totalSalesFils, 0);
  const rows = data.items
    .map(
      (i, idx) => `<tr>
      <td class="text-center font-bold">${idx + 1}</td>
      <td>${i.name}</td>
      <td class="muted">${i.sku ?? "—"}</td>
      <td>${i.categoryName}</td>
      <td class="text-center">${i.kind === "tailoring" ? "تفصيل" : "جاهز"}</td>
      <td class="text-center">${i.totalQty}</td>
      <td class="text-center">${i.invoiceCount}</td>
      <td class="text-end font-bold">${aed(i.totalSalesFils)}</td>
    </tr>`,
    )
    .join("");

  const body = `
    <div class="summary-cards">
      <div class="card"><div class="label">عدد الأصناف</div><div class="value">${data.items.length}</div></div>
      <div class="card green"><div class="label">إجمالي المبيعات</div><div class="value">${aed(totalSales)}</div></div>
    </div>
    <table>
      <thead><tr>
        <th class="text-center">ترتيب</th>
        <th class="text-start">الصنف</th>
        <th class="text-start">SKU</th>
        <th class="text-start">تصنيف</th>
        <th class="text-center">نوع</th>
        <th class="text-center">كمية</th>
        <th class="text-center">عدد الفواتير</th>
        <th class="text-end">المبيعات</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="8" class="text-center muted">لا يوجد.</td></tr>'}</tbody>
    </table>`;

  openPrintWindow(shellHtml({ shopName, vatNo, title: "الأكثر طلباً", subtitle: rangeSubtitle(range), body }));
}

// ────────────────────────────────────────────────────────────────────────────
// Public dispatcher
// ────────────────────────────────────────────────────────────────────────────

export type ReportType =
  | "receivables"
  | "sales"
  | "wages"
  | "financial"
  | "tailoring"
  | "most-requested";

export function printReport(
  type: ReportType,
  data: unknown,
  range: ReportRange,
  settings?: Record<string, string>,
): void {
  const shopName = settings?.shop_name || "Abaya Shop";
  const vatNo = settings?.vat_number || "";

  switch (type) {
    case "receivables":
      return printReceivables(data as ReceivablesPayload, range, shopName, vatNo);
    case "sales":
      return printSales(data as SalesPayload, range, shopName, vatNo);
    case "wages":
      return printWages(data as WagesPayload, range, shopName, vatNo);
    case "financial":
      return printFinancial(data as FinancialPayload, range, shopName, vatNo);
    case "tailoring":
      return printTailoring(data as TailoringPayload, range, shopName, vatNo);
    case "most-requested":
      return printMostRequested(data as MostRequestedPayload, range, shopName, vatNo);
  }
}
