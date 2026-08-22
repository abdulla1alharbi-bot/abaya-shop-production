import { JOB_STAGE_LABELS } from "@abaya-shop/shared";
import type { DailyReport } from "./dailyReport.js";

/**
 * Renders the nightly report as an Arabic, right-to-left email.
 *
 * Written as inline-styled tables on purpose: Gmail and the iOS Mail app strip
 * <style> blocks and ignore flexbox, so anything fancier arrives as a stack of
 * unstyled text on the one device the owner actually reads it on — the phone.
 * A plain-text alternative goes out alongside it for notification previews.
 */

const METHOD_LABELS: Record<string, string> = {
  CASH: "كاش",
  CARD: "بطاقة",
  TRANSFER: "تحويل",
};

const AR_DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const AR_MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

function money(fils: number, currency: string): string {
  const sign = fils < 0 ? "-" : "";
  const abs = Math.abs(fils);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const cents = String(abs % 100).padStart(2, "0");
  return `${sign}${whole}.${cents} ${currency}`;
}

/** `2026-08-22` → `السبت 22 أغسطس 2026`. Formatted by hand so no ICU locale data is needed. */
function arabicDate(dateKey: string): string {
  const [y = 0, m = 1, d = 1] = dateKey.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  return `${AR_DAYS[at.getUTCDay()]} ${d} ${AR_MONTHS[m - 1]} ${y}`;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function dailyReportSubject(report: DailyReport): string {
  const name = report.shopName ? `${report.shopName} — ` : "";
  return `${name}تقرير يوم ${report.dateKey}: تفصيل ${money(report.sales.tailoring.totalFils, report.currency)} · مقبوض ${money(report.collections.totalFils, report.currency)}`;
}

const FONT = "'Segoe UI', Tahoma, Arial, sans-serif";

function headline(label: string, value: string, hint: string, accent: string): string {
  return `
    <td width="50%" style="padding:6px;" valign="top">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
        <tr><td style="padding:14px 16px;border-top:3px solid ${accent};border-radius:10px 10px 0 0;">
          <div style="font-size:12px;color:#6b7280;">${esc(label)}</div>
          <div style="font-size:22px;font-weight:700;color:#111827;padding-top:4px;" dir="ltr">${esc(value)}</div>
          <div style="font-size:12px;color:#6b7280;padding-top:4px;">${esc(hint)}</div>
        </td></tr>
      </table>
    </td>`;
}

function sectionTitle(text: string): string {
  return `<tr><td style="padding:22px 6px 8px;font-size:15px;font-weight:700;color:#111827;">${esc(text)}</td></tr>`;
}

function rowsTable(rows: Array<[string, string]>): string {
  const body = rows
    .map(
      ([label, value], i) => `
        <tr style="background:${i % 2 ? "#fafafa" : "#ffffff"};">
          <td style="padding:9px 14px;font-size:13px;color:#374151;">${esc(label)}</td>
          <td style="padding:9px 14px;font-size:13px;color:#111827;font-weight:600;text-align:left;" dir="ltr">${esc(value)}</td>
        </tr>`,
    )
    .join("");
  return `
    <tr><td style="padding:0 6px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
        ${body}
      </table>
    </td></tr>`;
}

function invoicesTable(report: DailyReport): string {
  if (report.invoices.length === 0) {
    return rowsTable([["فواتير اليوم", "لا توجد فواتير"]]);
  }
  const head = `
    <tr style="background:#f3f4f6;">
      <th align="right" style="padding:8px 10px;font-size:12px;color:#6b7280;font-weight:600;">الفاتورة</th>
      <th align="right" style="padding:8px 10px;font-size:12px;color:#6b7280;font-weight:600;">الزبونة</th>
      <th align="left"  style="padding:8px 10px;font-size:12px;color:#6b7280;font-weight:600;">الإجمالي</th>
      <th align="left"  style="padding:8px 10px;font-size:12px;color:#6b7280;font-weight:600;">مدفوع</th>
      <th align="left"  style="padding:8px 10px;font-size:12px;color:#6b7280;font-weight:600;">متبقي</th>
    </tr>`;
  const body = report.invoices
    .map(
      (inv, i) => `
      <tr style="background:${i % 2 ? "#fafafa" : "#ffffff"};">
        <td style="padding:8px 10px;font-size:13px;color:#111827;" dir="ltr" align="right">#${inv.invoiceNo}</td>
        <td style="padding:8px 10px;font-size:13px;color:#374151;">${esc(inv.customerName ?? "—")}</td>
        <td style="padding:8px 10px;font-size:13px;color:#111827;text-align:left;" dir="ltr">${esc(money(inv.totalFils, report.currency))}</td>
        <td style="padding:8px 10px;font-size:13px;color:#047857;text-align:left;" dir="ltr">${esc(money(inv.paidFils, report.currency))}</td>
        <td style="padding:8px 10px;font-size:13px;color:${inv.balanceFils > 0 ? "#b45309" : "#6b7280"};text-align:left;" dir="ltr">${esc(money(inv.balanceFils, report.currency))}</td>
      </tr>`,
    )
    .join("");
  const more = report.invoicesTruncated
    ? `<tr><td colspan="5" style="padding:8px 10px;font-size:12px;color:#6b7280;">… وباقي فواتير اليوم (${report.sales.invoiceCount} إجمالاً) في التطبيق.</td></tr>`
    : "";
  return `
    <tr><td style="padding:0 6px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
        ${head}${body}${more}
      </table>
    </td></tr>`;
}

export function renderDailyReportHtml(report: DailyReport): string {
  const c = report.currency;
  const s = report.sales;
  const col = report.collections;
  const w = report.workshop;

  const methodRows: Array<[string, string]> =
    col.byMethod.length > 0
      ? col.byMethod.map(
          (m) => [`${METHOD_LABELS[m.method] ?? m.method} (${m.count} عملية)`, money(m.totalFils, c)] as [string, string],
        )
      : [["لم تُسجَّل أي دفعة اليوم", money(0, c)]];

  const stageRows: Array<[string, string]> =
    w.byStage.length > 0
      ? w.byStage.map(
          (st) =>
            [`${JOB_STAGE_LABELS[st.stageKey] ?? st.stageKey} — ${st.count} قطعة`, money(st.wagesFils, c)] as [
              string,
              string,
            ],
        )
      : [["لم تُنجَز أي مرحلة اليوم", money(0, c)]];

  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:16px 0;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl" style="max-width:640px;font-family:${FONT};">

  <tr><td style="padding:0 6px 4px;">
    <div style="font-size:19px;font-weight:700;color:#111827;">${esc(report.shopName ?? "تقرير آخر اليوم")}</div>
    <div style="font-size:13px;color:#6b7280;padding-top:2px;">تقرير آخر اليوم · ${esc(arabicDate(report.dateKey))}</div>
  </td></tr>

  <tr><td style="padding:10px 0 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        ${headline("تفصيل اليوم", money(s.tailoring.totalFils, c), `${s.tailoring.pieces} قطعة تفصيل`, "#7c3aed")}
        ${headline("المقبوض من الزبائن", money(col.totalFils, c), `${col.count} دفعة`, "#047857")}
      </tr>
      <tr>
        ${headline("جاهز (بيع مباشر)", money(s.readyMade.totalFils, c), `${s.readyMade.pieces} قطعة`, "#0369a1")}
        ${headline("أجور الورشة اليوم", money(w.wagesFils, c), `${w.stagesCompleted} مرحلة منجزة`, "#b45309")}
      </tr>
    </table>
  </td></tr>

  ${sectionTitle("المبيعات المسجّلة اليوم")}
  ${rowsTable([
    ["عدد الفواتير", String(s.invoiceCount)],
    ["إجمالي الفواتير", money(s.totalFils, c)],
    ["منها تفصيل", `${money(s.tailoring.totalFils, c)} · ${s.tailoring.pieces} قطعة`],
    ["منها جاهز", `${money(s.readyMade.totalFils, c)} · ${s.readyMade.pieces} قطعة`],
    ["مدفوع على فواتير اليوم", money(s.paidFils, c)],
    ["متبقٍ على فواتير اليوم", money(s.balanceFils, c)],
  ])}

  ${sectionTitle("المقبوضات (ما دخل الصندوق فعلاً)")}
  ${rowsTable([
    ["إجمالي المقبوض", money(col.totalFils, c)],
    ["عربون / دفعات على فواتير اليوم", money(col.depositsFils, c)],
    ["تحصيل على فواتير سابقة (استلام/سداد)", money(col.settlementsFils, c)],
    ...methodRows,
  ])}

  ${sectionTitle("شغل الورشة")}
  ${rowsTable([
    ["قطع دخلت التفصيل اليوم", String(w.newJobs)],
    ["مراحل أُنجزت", String(w.stagesCompleted)],
    ["أجور تلك المراحل", money(w.wagesFils, c)],
    ["طلبات أصبحت جاهزة", String(w.ordersReady)],
    ["قطع سُلِّمت للزبائن", String(w.piecesDelivered)],
    ...stageRows,
  ])}

  ${sectionTitle("المصروفات والصافي")}
  ${rowsTable([
    ["مصروفات اليوم", `${money(report.expenses.totalFils, c)} · ${report.expenses.count} بند`],
    ["صافي الحركة النقدية (مقبوض − مصروف)", money(report.netFils, c)],
    ["إجمالي المتبقي على الزبائن (كل الفواتير)", `${money(report.outstanding.totalFils, c)} · ${report.outstanding.invoiceCount} فاتورة`],
  ])}

  ${sectionTitle("فواتير اليوم")}
  ${invoicesTable(report)}

  <tr><td style="padding:18px 6px 6px;font-size:11px;color:#9ca3af;line-height:1.7;">
    التقرير يُحتسب بتوقيت ${esc(report.timeZone)} من منتصف الليل إلى منتصف الليل، ويطابق شاشة «اليوم» في التطبيق.
    الفواتير الملغاة غير محسوبة. «أجور الورشة» هي أجور المراحل المنجزة اليوم على طلبات وصلت مرحلة جاهز أو مُسلَّم.
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

export function renderDailyReportText(report: DailyReport): string {
  const c = report.currency;
  const s = report.sales;
  const col = report.collections;
  const w = report.workshop;
  const lines = [
    `${report.shopName ?? "تقرير آخر اليوم"} — ${arabicDate(report.dateKey)}`,
    "",
    `تفصيل اليوم: ${money(s.tailoring.totalFils, c)} (${s.tailoring.pieces} قطعة)`,
    `جاهز: ${money(s.readyMade.totalFils, c)} (${s.readyMade.pieces} قطعة)`,
    `إجمالي فواتير اليوم: ${money(s.totalFils, c)} عبر ${s.invoiceCount} فاتورة — متبقٍ ${money(s.balanceFils, c)}`,
    "",
    `المقبوض من الزبائن: ${money(col.totalFils, c)} (${col.count} دفعة)`,
    `  عربون/دفعات على فواتير اليوم: ${money(col.depositsFils, c)}`,
    `  تحصيل على فواتير سابقة: ${money(col.settlementsFils, c)}`,
    ...col.byMethod.map((m) => `  ${METHOD_LABELS[m.method] ?? m.method}: ${money(m.totalFils, c)}`),
    "",
    `شغل الورشة: ${w.stagesCompleted} مرحلة منجزة بأجور ${money(w.wagesFils, c)}`,
    `  قطع جديدة: ${w.newJobs} · طلبات جاهزة: ${w.ordersReady} · مُسلَّم: ${w.piecesDelivered}`,
    ...w.byStage.map((st) => `  ${JOB_STAGE_LABELS[st.stageKey] ?? st.stageKey}: ${st.count} قطعة — ${money(st.wagesFils, c)}`),
    "",
    `المصروفات: ${money(report.expenses.totalFils, c)} (${report.expenses.count} بند)`,
    `صافي الحركة النقدية: ${money(report.netFils, c)}`,
    `إجمالي المتبقي على الزبائن: ${money(report.outstanding.totalFils, c)} على ${report.outstanding.invoiceCount} فاتورة`,
  ];
  return lines.join("\n");
}
