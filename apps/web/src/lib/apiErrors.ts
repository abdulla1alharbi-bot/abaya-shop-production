import { AxiosError } from "axios";
import i18n from "@/i18n";
import { formatAED } from "./money";

/** Reads `{ error: { message } }` from API error responses. */
export function getApiErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (err instanceof AxiosError && err.response?.data && typeof err.response.data === "object") {
    const d = err.response.data as { error?: { message?: string; code?: string; currentBalance?: number; creditLimit?: number } };
    if (d.error?.code === "CREDIT_LIMIT_EXCEEDED") {
      const bal = d.error.currentBalance != null ? formatAED(d.error.currentBalance) : "—";
      const lim = d.error.creditLimit != null ? formatAED(d.error.creditLimit) : "—";
      return i18n.t("errors.creditLimitExceeded", { balance: bal, limit: lim });
    }
    if (typeof d.error?.message === "string" && d.error.message.length > 0) return d.error.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export function isCreditLimitError(err: unknown): boolean {
  return (
    err instanceof AxiosError &&
    err.response?.status === 409 &&
    (err.response.data as { error?: { code?: string } })?.error?.code === "CREDIT_LIMIT_EXCEEDED"
  );
}

export function isNotFoundError(err: unknown): boolean {
  return err instanceof AxiosError && err.response?.status === 404;
}

export function isServerError(err: unknown): boolean {
  return err instanceof AxiosError && (err.response?.status ?? 0) >= 500;
}
