import { MAX_PAYMENT_ROUNDING_FILS } from "@abaya-shop/shared";

export type PaymentRowForReplay = { id: string; amountFils: number; createdAt: Date };

export type PaymentCorrection = {
  paymentId: string;
  fromFils: number;
  /** What this row actually settled. 0 means the row settled nothing and is removed. */
  toFils: number;
};

/**
 * Replays an invoice's payments in the order the server took them and finds the
 * rows whose excess over what was still owed is more than cash rounding.
 *
 * Before the rounding cap, POST /invoices/:id/payments accepted any overpayment:
 * only the outstanding part settled the invoice, the whole amount stayed on the
 * Payment row. A mistyped invoice number (33,488 on a 300 bill) or the same
 * payment saved twice therefore left the invoice correct but inflated every
 * collections report. Trimming each such row to what it settled makes the rows
 * add up to what the invoice says was paid, without touching the invoice, its
 * balance or the customer's balance.
 *
 * Returns null when the replay does not reproduce the invoice's paidFils — the
 * invoice was changed some other way and needs a human look, not a script.
 */
export function planPaymentCorrections(
  totalFils: number,
  paidFils: number,
  payments: PaymentRowForReplay[],
): PaymentCorrection[] | null {
  const ordered = [...payments].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  let outstanding = totalFils;
  let settledSum = 0;
  const corrections: PaymentCorrection[] = [];
  for (const p of ordered) {
    if (p.amountFils <= 0) return null; // refund rows only exist with returns; not this repair's business
    const settled = Math.min(p.amountFils, Math.max(0, outstanding));
    outstanding -= settled;
    settledSum += settled;
    if (p.amountFils - settled > MAX_PAYMENT_ROUNDING_FILS) {
      corrections.push({ paymentId: p.id, fromFils: p.amountFils, toFils: settled });
    }
  }
  if (settledSum !== paidFils) return null;
  return corrections;
}
