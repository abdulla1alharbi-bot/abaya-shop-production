/**
 * The owner's view of a day's (or period's) sales, shared by the sales report
 * and the nightly email so the two always agree: every invoice that brought
 * money in, or was issued or delivered in the period, each tagged
 *   NEW         issued in the period (طلبية جديدة)
 *   DELIVERY    issued before, delivered in the period (ديلفري)
 *   OLD_PAYMENT issued before, paid in the period without delivery (دفعة على فاتورة قديمة)
 * Money counted is the payments taken in the period, the same rows the
 * financial-activity report counts as income.
 */

export type SalesDayKind = "NEW" | "DELIVERY" | "OLD_PAYMENT";

export type SalesDayInvoice = {
  id: string;
  invoiceNo: number;
  createdAt: Date;
  deliveredAt: Date | null;
  totalFils: number;
  balanceFils: number;
  customer: { name: string; mobile: string } | null;
};

export type SalesDayRow = {
  invoiceId: string;
  invoiceNo: number;
  customer: { name: string; mobile: string } | null;
  createdAt: string;
  deliveredAt: string | null;
  totalFils: number;
  balanceFils: number;
  receivedFils: number;
  kind: SalesDayKind;
};

/** The invoice fields `buildSalesDay` needs, as a Prisma `select`. */
export const SALES_DAY_INVOICE_SELECT = {
  id: true,
  invoiceNo: true,
  createdAt: true,
  deliveredAt: true,
  totalFils: true,
  balanceFils: true,
  customer: { select: { name: true, mobile: true } },
} as const;

/**
 * `from` is inclusive; `to` is the period's end (callers pass either an
 * inclusive end or an exclusive one; delivery only compares against it, and a
 * delivery at exactly the boundary instant does not happen in practice).
 */
export function buildSalesDay(input: {
  from: Date;
  to: Date;
  issued: SalesDayInvoice[];
  delivered: SalesDayInvoice[];
  payments: Array<{ amountFils: number; invoice: SalesDayInvoice }>;
}): { rows: SalesDayRow[]; newFils: number; deliveryFils: number; oldPaymentFils: number } {
  const { from, to } = input;
  const byId = new Map<string, SalesDayRow>();
  const rowFor = (inv: SalesDayInvoice): SalesDayRow => {
    let row = byId.get(inv.id);
    if (!row) {
      const deliveredInPeriod = inv.deliveredAt !== null && inv.deliveredAt >= from && inv.deliveredAt <= to;
      row = {
        invoiceId: inv.id,
        invoiceNo: inv.invoiceNo,
        customer: inv.customer,
        createdAt: inv.createdAt.toISOString(),
        deliveredAt: inv.deliveredAt?.toISOString() ?? null,
        totalFils: inv.totalFils,
        balanceFils: inv.balanceFils,
        receivedFils: 0,
        kind: inv.createdAt >= from ? "NEW" : deliveredInPeriod ? "DELIVERY" : "OLD_PAYMENT",
      };
      byId.set(inv.id, row);
    }
    return row;
  };
  for (const inv of input.issued) rowFor(inv);
  for (const inv of input.delivered) rowFor(inv);
  for (const p of input.payments) rowFor(p.invoice).receivedFils += p.amountFils;

  const order: Record<SalesDayKind, number> = { NEW: 0, DELIVERY: 1, OLD_PAYMENT: 2 };
  const rows = [...byId.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.invoiceNo - b.invoiceNo);
  const sum = (k: SalesDayKind) => rows.filter((r) => r.kind === k).reduce((s, r) => s + r.receivedFils, 0);
  return { rows, newFils: sum("NEW"), deliveryFils: sum("DELIVERY"), oldPaymentFils: sum("OLD_PAYMENT") };
}
