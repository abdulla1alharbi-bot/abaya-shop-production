/**
 * Customer-facing WhatsApp templates.
 *
 * Deliberately Arabic regardless of the staff UI language — the recipient is the
 * customer, not the cashier. Only the message body lives here; "sending" is a human
 * tapping the wa.me link.
 *
 * Every message follows the shape the owner asked for, so the shop sounds the same
 * whatever the reason for writing:
 *
 *   1. السلام عليكم ورحمة الله وبركاته
 *   2. the shop's name          (identifies the sender — her phone may not have the number saved)
 *   3. the invoice and why we're writing
 *   4. شكراً لكم
 *
 * `balanceAed` is always a `formatAED()` string, which already carries the currency
 * ("AED 250.00") — never append درهم to it.
 */

const GREETING = "السلام عليكم ورحمة الله وبركاته";
const THANKS = "شكراً لكم.";

/** Build a wa.me click-to-chat link. Works on desktop (WhatsApp Web) and mobile (WhatsApp app). */
export function buildWhatsAppLink(phone: string, message: string): string {
  const cleaned = phone.replace(/\D/g, "");
  return `https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`;
}

/**
 * Assemble greeting → shop name → body lines → thanks, dropping anything empty.
 * The shop name comes from the `shop_name` setting; if the shop never filled it in,
 * the line is left out rather than sending a placeholder.
 */
function compose(shopName: string | undefined, bodyLines: string[]): string {
  return [GREETING, shopName?.trim() || null, ...bodyLines, THANKS]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

/**
 * "منذ ..." with the right Arabic form for the count. These messages are built as plain
 * strings (not through i18n, which owns the staff-facing plurals), so the CLDR forms
 * have to be spelled out here: 1 يوم · 2 يومين · 3–10 أيام · 11+ يوماً.
 */
function arabicDaysAgo(days: number): string {
  if (days <= 0) return "";
  if (days === 1) return " منذ يوم";
  if (days === 2) return " منذ يومين";
  const mod100 = days % 100;
  if (mod100 >= 3 && mod100 <= 10) return ` منذ ${days} أيام`;
  return ` منذ ${days} يوماً`;
}

export type ReadyMessageOptions = {
  /** Shop name from the `shop_name` setting — omitted from the message when unset. */
  shopName?: string;
  /** Formatted balance owed on collection; omit when nothing is due. */
  balanceAed?: string;
  /** Days the finished order has sat in the shop — only used by the reminder wording. */
  daysWaiting?: number;
  /** Second and later contacts get a nudge instead of repeating the first one. */
  isReminder?: boolean;
};

/** Sent once per invoice — only when every piece on it is ready, never per piece. */
export function orderReadyMessage(
  invoiceNo: number | string,
  pieceCount?: number,
  opts: ReadyMessageOptions = {},
): string {
  const extras = [
    // Piece count only on the first notice — a reminder already says "still ready".
    !opts.isReminder && pieceCount && pieceCount > 1 ? `جميع القطع (${pieceCount}) جاهزة.` : null,
    opts.balanceAed ? `المبلغ المتبقي عند الاستلام: ${opts.balanceAed}.` : null,
  ].filter((line): line is string => Boolean(line));

  const headline = opts.isReminder
    ? `تذكير: فاتورتك رقم ${invoiceNo} ما زالت جاهزة بانتظارك${arabicDaysAgo(opts.daysWaiting ?? 0)}.`
    : `فاتورتك رقم ${invoiceNo} جاهزة للاستلام.`;

  return compose(opts.shopName, [headline, ...extras]);
}

export function paymentReminderMessage(
  invoiceNo: number | string,
  balanceAed: string,
  opts: { shopName?: string; isReminder?: boolean } = {},
): string {
  const headline = opts.isReminder
    ? `نذكّركم بالرصيد المستحق ${balanceAed} على الفاتورة رقم ${invoiceNo}.`
    : `لديكم رصيد مستحق ${balanceAed} على الفاتورة رقم ${invoiceNo}.`;

  return compose(opts.shopName, [headline, "نأمل منكم التكرم بالتواصل لتسوية المبلغ."]);
}
