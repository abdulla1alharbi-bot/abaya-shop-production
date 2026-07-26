import type { PrismaClient } from "@prisma/client";
import { computeInvoiceFulfillment } from "./invoiceFulfillment.js";
import { noReadyNoticeWhere } from "./customerMessageQueue.js";
import { notify } from "./notify.js";

export const INVOICE_READY_TYPE = "INVOICE_READY";
export const INVOICE_NOT_NOTIFIED_TYPE = "INVOICE_CUSTOMER_NOT_NOTIFIED";

/** Sellers do the contacting; the manager watches that orders don't sit uncollected. */
const READY_ALERT_ROLES = ["SELLER", "MANAGER"] as const;
/** Escalation goes higher — the owner sees whether missed follow-ups are a pattern. */
const ESCALATION_ROLES = ["OWNER", "MANAGER"] as const;

/** Grace period between an invoice becoming ready and nagging about an uncontacted customer. */
export const NOT_NOTIFIED_ALERT_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Stamp `readyAt` and alert staff the FIRST time every tailoring piece on an invoice
 * is done. Piece-level completions stay silent: the customer should get one message
 * when her whole order is collectable, not one per abaya.
 *
 * Call after the stage-change transaction commits — it re-derives fulfillment from
 * the stored stages, so it is safe to call on any stage change.
 */
export async function notifyIfInvoiceFullyReady(db: PrismaClient, jobOrderId: string): Promise<void> {
  const job = await db.jobOrder.findUnique({
    where: { id: jobOrderId },
    select: { invoiceId: true },
  });
  if (!job?.invoiceId) return;

  const invoice = await db.invoice.findUnique({
    where: { id: job.invoiceId },
    select: {
      id: true,
      invoiceNo: true,
      isVoid: true,
      deliveredAt: true,
      readyAt: true,
      customer: { select: { name: true } },
      jobOrders: { select: { stage: true } },
    },
  });
  if (!invoice) return;
  if (computeInvoiceFulfillment(invoice, invoice.jobOrders) !== "READY_FOR_DELIVERY") return;
  if (invoice.readyAt) return;

  await db.invoice.update({ where: { id: invoice.id }, data: { readyAt: new Date() } });

  const customerPart = invoice.customer?.name ? ` — ${invoice.customer.name}` : "";
  const pieces = invoice.jobOrders.length;
  for (const role of READY_ALERT_ROLES) {
    await notify(db, {
      targetRole: role,
      type: INVOICE_READY_TYPE,
      title: "فاتورة جاهزة للتسليم بالكامل",
      message: `فاتورة #${invoice.invoiceNo}${customerPart} — اكتملت جميع القطع (${pieces}). أبلغ العميلة بالاستلام.`,
      link: `/invoices/${invoice.id}`,
    });
  }
}

/**
 * Alert on invoices ready for longer than the grace period whose customer was never
 * contacted. Piggybacks on the dashboard load like the low-stock alert does — the API
 * has no scheduler. Deduped per invoice by notification link.
 */
export async function alertUncontactedReadyInvoices(db: PrismaClient): Promise<void> {
  const cutoff = new Date(Date.now() - NOT_NOTIFIED_ALERT_AFTER_MS);
  const stale = await db.invoice.findMany({
    where: {
      isVoid: false,
      deliveredAt: null,
      readyAt: { not: null, lte: cutoff },
      ...noReadyNoticeWhere(),
    },
    select: {
      id: true,
      invoiceNo: true,
      readyAt: true,
      customer: { select: { name: true } },
    },
    take: 50,
  });
  if (stale.length === 0) return;

  const alreadyAlerted = new Set(
    (
      await db.notification.findMany({
        where: { type: INVOICE_NOT_NOTIFIED_TYPE, link: { in: stale.map((i) => `/invoices/${i.id}`) } },
        select: { link: true },
      })
    ).map((n) => n.link ?? ""),
  );

  for (const inv of stale) {
    const link = `/invoices/${inv.id}`;
    if (alreadyAlerted.has(link)) continue;
    const hours = Math.floor((Date.now() - inv.readyAt!.getTime()) / (60 * 60 * 1000));
    const customerPart = inv.customer?.name ? ` (${inv.customer.name})` : "";
    for (const role of ESCALATION_ROLES) {
      await notify(db, {
        targetRole: role,
        type: INVOICE_NOT_NOTIFIED_TYPE,
        title: "فاتورة جاهزة ولم تُبلَّغ العميلة",
        message: `فاتورة #${inv.invoiceNo}${customerPart} جاهزة منذ ${hours} ساعة ولم يسجّل أحد إبلاغ العميلة.`,
        link,
      });
    }
  }
}
