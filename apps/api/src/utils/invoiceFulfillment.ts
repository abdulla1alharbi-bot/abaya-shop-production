import type { JobOrder, Prisma } from "@prisma/client";

/** High-level status for operational invoice hub UI */
export type InvoiceFulfillmentStatus =
  | "VOID"
  | "DELIVERED"
  | "READY_FOR_DELIVERY"
  | "IN_WORKSHOP"
  | "NO_TAILORING";

const WORKSHOP_DONE_STAGES = new Set(["READY", "DELIVERED", "CONVERTED_TO_READY"]);

/**
 * Derive fulfillment from invoice + linked tailoring jobs.
 * A tailoring "item" is operationally done when its job stage is READY / DELIVERED /
 * CONVERTED_TO_READY (piece moved to ready-made stock).
 */
export function computeInvoiceFulfillment(
  invoice: { isVoid: boolean; deliveredAt: Date | null },
  jobs: Pick<JobOrder, "stage">[],
): InvoiceFulfillmentStatus {
  if (invoice.isVoid) return "VOID";
  if (invoice.deliveredAt) return "DELIVERED";
  if (jobs.length === 0) return "NO_TAILORING";
  const allWorkshopDone = jobs.every((j) => WORKSHOP_DONE_STAGES.has(j.stage));
  if (allWorkshopDone) return "READY_FOR_DELIVERY";
  return "IN_WORKSHOP";
}

/**
 * Prisma filter: invoice is not void, not delivered at invoice level, and workshop work is done
 * (no tailoring lines, or every job is READY/DELIVERED/CONVERTED_TO_READY).
 * Matches `READY_FOR_DELIVERY` | `NO_TAILORING`
 * from {@link computeInvoiceFulfillment} for non-void, non-delivered invoices.
 */
export function invoiceReadyForDeliveryWhere(): Prisma.InvoiceWhereInput {
  return {
    isVoid: false,
    deliveredAt: null,
    OR: [
      { jobOrders: { none: {} } },
      {
        AND: [
          { jobOrders: { some: {} } },
          { jobOrders: { every: { stage: { in: ["READY", "DELIVERED", "CONVERTED_TO_READY"] } } } },
        ],
      },
    ],
  };
}

export function canMarkInvoiceDelivered(
  invoice: { isVoid: boolean; deliveredAt: Date | null },
  jobs: Pick<JobOrder, "stage">[],
): { ok: true } | { ok: false; reason: string } {
  if (invoice.isVoid) return { ok: false, reason: "الفاتورة ملغاة" };
  if (invoice.deliveredAt) return { ok: false, reason: "تم تسليم الفاتورة مسبقاً" };
  if (jobs.length === 0) return { ok: true };
  const pending = jobs.filter((j) => !WORKSHOP_DONE_STAGES.has(j.stage));
  if (pending.length > 0) {
    return { ok: false, reason: "يوجد تفصيل لم يكتمل في الورشة بعد" };
  }
  return { ok: true };
}
