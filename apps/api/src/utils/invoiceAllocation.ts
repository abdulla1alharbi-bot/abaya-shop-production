/** Allocate invoice totals/payments across line amounts (e.g. tailoring lines) proportionally to invoice subtotal. */

export function fixRoundingSum(parts: number[], target: number): void {
  const diff = target - parts.reduce((a, b) => a + b, 0);
  if (diff !== 0 && parts.length > 0) {
    const last = parts[parts.length - 1];
    if (last !== undefined) parts[parts.length - 1] = last + diff;
  }
}

/**
 * Each line i with amount L_i (part of invoice subtotal S) receives:
 *   share of total = T * L_i / S
 *   share of paid  = P * L_i / S
 */
export function allocateByLineShares(
  lineAmounts: number[],
  invoiceSubtotal: number,
  invoiceTotal: number,
  paidTotal: number,
): { shareTotal: number[]; sharePaid: number[] } {
  if (lineAmounts.length === 0 || invoiceSubtotal <= 0) {
    return { shareTotal: [], sharePaid: [] };
  }
  const shareTotal = lineAmounts.map((L) => Math.round((invoiceTotal * L) / invoiceSubtotal));
  const sharePaid = lineAmounts.map((L) => Math.round((paidTotal * L) / invoiceSubtotal));
  fixRoundingSum(shareTotal, invoiceTotal);
  fixRoundingSum(sharePaid, paidTotal);
  return { shareTotal, sharePaid };
}
