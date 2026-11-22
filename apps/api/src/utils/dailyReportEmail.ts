import type { DailyReport } from "./dailyReport.js";
import type { SalesDayKind } from "./salesDay.js";

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
  return `${name}تقرير يوم ${report.dateKey}: دخل اليوم ${money(report.collections.totalFils, report.currency)}`;
}

const FONT = "'Segoe UI', Tahoma, Arial, sans-serif";

const KIND: Record<SalesDayKind, { label: string; bg: string; fg: string }> = {
  NEW: { label: "طلبية جديدة", bg: "#e0e7ff", fg: "#3730a3" },
  DELIVERY: { label: "ديلفري", bg: "#ffedd5", fg: "#9a3412" },
  OLD_PAYMENT: { label: "فاتورة قديمة", bg: "#fef3c7", fg: "#92400e" },
};

/** Amount without the currency, for the table cells: "1,058.00". */
function amount(fils: number): string {
  return money(fils, "").trim();
}

function methodsLine(report: DailyReport): string {
  const by = new Map(report.collections.byMethod.map((m) => [m.method, m.totalFils]));
  return ["CASH", "CARD", "TRANSFER"].map((m) => `${METHOD_LABELS[m]} ${amount(by.get(m) ?? 0)}`).join(" · ");
}

function splitBox(label: string, fils: number, bg: string, border: string): string {
  return `
    <td width="33%" style="padding:3px;" valign="top">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg};border:2px solid ${border};border-radius:10px;">
        <tr><td align="center" style="padding:8px 4px;">
          <div style="font-size:11px;font-weight:700;color:#111827;line-height:1.3;">${esc(label)}</div>
          <div style="font-size:16px;font-weight:800;color:#111827;padding-top:3px;" dir="ltr">${esc(amount(fils))}</div>
        </td></tr>
      </table>
    </td>`;
}

function rowsTable(report: DailyReport): string {
  if (report.rows.length === 0) {
    return `<tr><td style="padding:14px 6px;font-size:13px;color:#6b7280;">ما فيه فواتير ولا مبالغ اليوم.</td></tr>`;
  }
  const th = (text: string, align: "right" | "left") =>
    `<th align="${align}" style="padding:7px 5px;font-size:11px;color:#6b7280;font-weight:600;border-bottom:1px solid #e5e7eb;">${text}</th>`;
  const body = report.rows
    .map((r) => {
      const k = KIND[r.kind];
      return `
      <tr>
        <td style="padding:7px 5px;font-size:12px;color:#111827;border-bottom:1px solid #f3f4f6;" dir="ltr" align="right">#${r.invoiceNo}</td>
        <td style="padding:7px 5px;border-bottom:1px solid #f3f4f6;"><span style="font-size:10.5px;font-weight:700;background:${k.bg};color:${k.fg};padding:1px 6px;border-radius:5px;white-space:nowrap;">${k.label}</span></td>
        <td style="padding:7px 5px;font-size:12px;color:#374151;text-align:left;border-bottom:1px solid #f3f4f6;" dir="ltr">${esc(amount(r.totalFils))}</td>
        <td style="padding:7px 5px;font-size:12px;text-align:left;border-bottom:1px solid #f3f4f6;${r.receivedFils ? "font-weight:800;color:#111827;" : "color:#a1a1aa;"}" dir="ltr">${esc(amount(r.receivedFils))}</td>
        <td style="padding:7px 5px;font-size:12px;color:#374151;text-align:left;border-bottom:1px solid #f3f4f6;" dir="ltr">${esc(amount(r.balanceFils))}</td>
      </tr>`;
    })
    .join("");
  const more =
    report.rowCount > report.rows.length
      ? `<tr><td colspan="5" style="padding:7px 5px;font-size:11px;color:#6b7280;">… وباقي الفواتير (${report.rowCount} إجمالاً) في تقرير المبيعات بالتطبيق.</td></tr>`
      : "";
  return `
    <tr><td style="padding:12px 6px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>${th("الفاتورة", "right")}${th("النوع", "right")}${th("الإجمالي", "left")}${th("دخل", "left")}${th("الباقي", "left")}</tr>
        ${body}${more}
        <tr>
          <td colspan="3" style="padding:8px 5px;font-size:12.5px;font-weight:800;border-top:2px solid #111827;">المجموع (${report.rowCount} فاتورة)</td>
          <td style="padding:8px 5px;font-size:12.5px;font-weight:800;border-top:2px solid #111827;text-align:left;" dir="ltr">${esc(amount(report.collections.totalFils))}</td>
          <td style="border-top:2px solid #111827;"></td>
        </tr>
      </table>
    </td></tr>`;
}

export function renderDailyReportHtml(report: DailyReport): string {
  const c = report.currency;
  const col = report.collections;
  const w = report.workshop;

  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:12px 0;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl" style="max-width:560px;font-family:${FONT};background:#ffffff;border-radius:14px;">

  <tr><td style="padding:14px 12px 0;">
    <div style="font-size:18px;font-weight:700;color:#111827;">تقرير آخر اليوم</div>
    <div style="font-size:12.5px;color:#6b7280;padding-top:2px;">${esc(report.shopName ? `${report.shopName} · ` : "")}${esc(arabicDate(report.dateKey))}</div>
  </td></tr>

  <tr><td style="padding:12px 9px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ecfdf5;border:2px solid #10b981;border-radius:12px;">
      <tr><td align="center" style="padding:12px;">
        <div style="font-size:13px;font-weight:700;color:#111827;">💵 المبلغ اللي دخل اليوم</div>
        <div style="font-size:30px;font-weight:900;color:#111827;" dir="ltr">${esc(money(col.totalFils, c))}</div>
        <div style="font-size:12px;color:#374151;padding-top:2px;">${esc(methodsLine(report))}</div>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:6px 6px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        ${splitBox("🧾 طلبيات جديدة", col.newFils, "#eef2ff", "#6366f1")}
        ${splitBox("📦 ديلفري", col.deliveryFils, "#fff7ed", "#f97316")}
        ${splitBox("💳 دفعات على فواتير قديمة", col.oldPaymentFils, "#fffbeb", "#f59e0b")}
      </tr>
    </table>
  </td></tr>

  ${rowsTable(report)}

  <tr><td style="padding:14px 9px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px dashed #d1d5db;border-radius:10px;">
      <tr><td style="padding:8px 10px;font-size:12.5px;color:#111827;line-height:1.9;">
        <div style="font-size:11px;font-weight:700;color:#6b7280;">معلومات إضافية</div>
        🧵 الورشة: ${w.stagesCompleted} مرحلة انتهت · أجور ${esc(money(w.wagesFils, c))}<br>
        🧾 المصروفات: ${esc(money(report.expenses.totalFils, c))}${report.expenses.count ? ` (${report.expenses.count} بند)` : ""}<br>
        ⏳ الباقي على كل العملاء: ${esc(money(report.outstanding.totalFils, c))} على ${report.outstanding.invoiceCount} فاتورة
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:12px 12px 14px;font-size:11px;color:#9ca3af;line-height:1.7;">
    اليوم يُحسب بتوقيت ${esc(report.timeZone)} من منتصف الليل إلى منتصف الليل، ويطابق تقرير المبيعات في التطبيق.
    «ديلفري» = فاتورة قديمة انسلّمت اليوم. «فاتورة قديمة» = دفعة على فاتورة قديمة بدون تسليم.
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

export function renderDailyReportText(report: DailyReport): string {
  const c = report.currency;
  const col = report.collections;
  const w = report.workshop;
  const lines = [
    `${report.shopName ?? "تقرير آخر اليوم"} — ${arabicDate(report.dateKey)}`,
    "",
    `المبلغ اللي دخل اليوم: ${money(col.totalFils, c)}`,
    `  ${methodsLine(report)}`,
    `  طلبيات جديدة: ${money(col.newFils, c)}`,
    `  ديلفري: ${money(col.deliveryFils, c)}`,
    `  دفعات على فواتير قديمة: ${money(col.oldPaymentFils, c)}`,
    "",
    ...report.rows.map(
      (r) =>
        `#${r.invoiceNo} · ${KIND[r.kind].label} · إجمالي ${amount(r.totalFils)} · دخل ${amount(r.receivedFils)} · باقي ${amount(r.balanceFils)}`,
    ),
    ...(report.rowCount > report.rows.length ? [`… وباقي الفواتير (${report.rowCount} إجمالاً) في التطبيق`] : []),
    "",
    `الورشة: ${w.stagesCompleted} مرحلة انتهت · أجور ${money(w.wagesFils, c)}`,
    `المصروفات: ${money(report.expenses.totalFils, c)}`,
    `الباقي على كل العملاء: ${money(report.outstanding.totalFils, c)} على ${report.outstanding.invoiceCount} فاتورة`,
  ];
  return lines.join("\n");
}
