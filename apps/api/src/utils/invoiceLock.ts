import type { Prisma } from "@prisma/client";

/**
 * Row-lock an invoice for the rest of the transaction. Call it first, then read the
 * invoice: every money path (add/delete payment, return, void) reads paid/balance and
 * writes absolute values back, so two of them running at once — two cashiers, a
 * double-tap, two returns — would otherwise both read the same numbers and the later
 * write would silently undo the earlier one. The second transaction now waits here
 * and reads the committed result.
 */
export async function lockInvoiceRow(tx: Prisma.TransactionClient, invoiceId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
}

/**
 * What the customer has actually paid toward the invoice after returns.
 *
 * A return first cancels unpaid balance; any remainder is refunded — in cash (a
 * negative Payment row, which lowers paidFils) or as store credit (customer balance
 * only, paidFils untouched). Net of returns the invoice is worth `total - returns`,
 * and `balanceFils` is always what is still owed on that, so the difference is what
 * was paid and not yet given back. Without returns this is simply paidFils.
 */
export function effectivePaidFils(inv: { totalFils: number; balanceFils: number }, returnsFils: number): number {
  return Math.max(0, inv.totalFils - returnsFils - inv.balanceFils);
}
