import { AxiosError } from "axios";
import { MAX_PAYMENT_ROUNDING_FILS } from "@abaya-shop/shared";
import i18n from "@/i18n";
import { api } from "./api";
import { formatAED } from "./money";

/**
 * Why this amount can't be saved against this balance, or null when it can.
 * Mirrors the server's cap so a mistyped amount (an invoice number keyed into
 * the amount box) is stopped before it leaves the screen.
 */
export function overpayBlockMessage(amountFils: number, balanceFils: number): string | null {
  if (amountFils - Math.max(0, balanceFils) <= MAX_PAYMENT_ROUNDING_FILS) return null;
  return i18n.t("invoices.quickSettle.overpayTooLarge", {
    amount: formatAED(amountFils),
    due: formatAED(Math.max(0, balanceFils)),
    max: formatAED(MAX_PAYMENT_ROUNDING_FILS),
  });
}

/** Small cash rounding above the balance is allowed, but the seller confirms it first. */
export function overpayConfirmMessage(amountFils: number, balanceFils: number): string | null {
  const excess = amountFils - balanceFils;
  if (excess <= 0 || excess > MAX_PAYMENT_ROUNDING_FILS) return null;
  return i18n.t("invoices.quickSettle.confirmOverpay", {
    amount: formatAED(amountFils),
    due: formatAED(balanceFils),
    excess: formatAED(excess),
  });
}

function isRepeatPaymentError(err: unknown): boolean {
  return (
    err instanceof AxiosError &&
    err.response?.status === 409 &&
    (err.response.data as { error?: { code?: string } })?.error?.code === "REPEAT_PAYMENT"
  );
}

/**
 * Records one payment. When the server says the same amount was just saved on
 * this invoice — the usual sign of a second tap — the seller has to confirm it
 * is really a second payment. Resolves false when they say it was not.
 */
export async function postInvoicePayment(
  invoiceId: string,
  payment: { method: string; amountFils: number },
): Promise<boolean> {
  const send = (confirmRepeat: boolean) =>
    api.post(`/invoices/${invoiceId}/payments`, {
      payments: [payment],
      ...(confirmRepeat ? { confirmRepeat: true } : {}),
    });
  try {
    await send(false);
    return true;
  } catch (err) {
    if (!isRepeatPaymentError(err)) throw err;
    if (!window.confirm(i18n.t("invoices.quickSettle.confirmRepeat", { amount: formatAED(payment.amountFils) }))) {
      return false;
    }
    await send(true);
    return true;
  }
}
