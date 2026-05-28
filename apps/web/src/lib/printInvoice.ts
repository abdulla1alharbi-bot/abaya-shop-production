/**
 * Generates a printable UAE VAT tax invoice in a new browser window.
 * Opens the browser's native print dialog.
 */

function fils(f: number): string {
  return (f / 100).toFixed(2);
}

function aed(f: number): string {
  return `AED ${fils(f)}`;
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
  branch?: { name?: string } | null;
};

function itemLabel(item: InvoiceItem): string {
  if (item.description) return item.description;
  if (item.product?.nameAr) return item.product.nameAr;
  if (item.product?.name) return item.product.name;
  return "—";
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

export function printInvoice(data: Record<string, unknown>, shopSettings?: Record<string, string>): void {
  const inv = data as unknown as InvoiceData;
  const shopName = shopSettings?.shop_name || "Abaya Shop";
  const vatRate = shopSettings?.vat_rate || "5";
  const vatNo = shopSettings?.vat_number || "";

  const itemRows = inv.items
    .map(
      (item) => `
      <tr>
        <td class="text-start">${itemLabel(item)}</td>
        <td class="text-center">${item.qty % 1 === 0 ? item.qty : item.qty.toFixed(1)}</td>
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
        <td class="text-muted">${p.reference ?? ""}</td>
        <td class="text-muted">${formatDate(p.createdAt)}</td>
      </tr>`,
    )
    .join("");

  const html = `<!DOCTYPE html>
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
      @page { margin: 1cm; }
    }
  </style>
</head>
<body>
<div class="page">
  <div class="header">
    <div>
      <div class="shop-name">${shopName}</div>
      ${vatNo ? `<div class="shop-meta">رقم التسجيل الضريبي / VAT TRN: ${vatNo}</div>` : ""}
      ${inv.branch?.name ? `<div class="shop-meta">${inv.branch.name}</div>` : ""}
    </div>
    <div class="invoice-title" dir="ltr">
      <h2>فاتورة ضريبية / Tax Invoice</h2>
      <div class="inv-no">#${inv.invoiceNo}</div>
      <div class="meta">
        التاريخ: ${formatDate(inv.createdAt)}<br/>
        ${inv.deliveryDate ? `موعد التسليم: ${formatDate(inv.deliveryDate)}` : ""}
      </div>
    </div>
  </div>

  <div class="parties">
    <div>
      <div class="party-label">المورد / Supplier</div>
      <div class="party-name">${shopName}</div>
      ${vatNo ? `<div class="party-meta">TRN: ${vatNo}</div>` : ""}
    </div>
    <div dir="ltr" style="text-align:left;">
      <div class="party-label">العميل / Customer</div>
      <div class="party-name">${inv.customer?.name ?? "عميل نقدي / Cash Customer"}</div>
      ${inv.customer?.mobile ? `<div class="party-meta">${inv.customer.mobile}</div>` : ""}
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
      ${inv.notes ? `<div style="margin-top:8px;padding:8px;background:#f8f8f8;border-radius:4px;font-size:11px;"><strong>ملاحظات:</strong> ${inv.notes}</div>` : ""}
    </div>

    <div class="totals-box">
      <div class="section-title">الإجماليات / Totals</div>
      <div class="totals-row"><span>المجموع الفرعي / Subtotal</span><span>${aed(inv.subtotalFils)}</span></div>
      ${inv.discountFils > 0 ? `<div class="totals-row"><span>خصم / Discount</span><span>- ${aed(inv.discountFils)}</span></div>` : ""}
      <div class="totals-row"><span>ضريبة القيمة المضافة ${vatRate}% / VAT</span><span>${aed(inv.vatFils)}</span></div>
      <div class="totals-row total"><span>الإجمالي / Total</span><span>${aed(inv.totalFils)}</span></div>
      <div class="totals-row"><span>المدفوع / Paid</span><span>${aed(inv.paidFils)}</span></div>
      ${
        inv.balanceFils > 0
          ? `<div class="totals-row balance"><span>الرصيد المستحق / Balance Due</span><span>${aed(inv.balanceFils)}</span></div>`
          : ""
      }
      <div style="margin-top:10px;text-align:center;">
        ${
          inv.balanceFils <= 0
            ? '<span class="badge badge-paid">مدفوع بالكامل / Fully Paid</span>'
            : inv.paidFils > 0
              ? '<span class="badge badge-partial">مدفوع جزئياً / Partially Paid</span>'
              : '<span class="badge badge-unpaid">غير مدفوع / Unpaid</span>'
        }
      </div>
    </div>
  </div>

  <div class="footer">
    هذه فاتورة ضريبية صادرة وفق متطلبات الهيئة الاتحادية للضرائب — الإمارات العربية المتحدة<br/>
    This is a tax invoice issued in accordance with UAE Federal Tax Authority requirements.<br/>
    VAT Rate: ${vatRate}% | Currency: AED | Invoice No: ${inv.invoiceNo} | Date: ${formatDate(inv.createdAt)}
  </div>
</div>
<script>window.onload = function() { window.print(); }</script>
</body>
</html>`;

  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) {
    alert("يرجى السماح بفتح النوافذ المنبثقة لطباعة الفاتورة.\nPlease allow popups to print the invoice.");
    return;
  }
  win.document.write(html);
  win.document.close();
}
