import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export async function nextCustomerCode(prisma: Db): Promise<number> {
  const agg = await prisma.customer.aggregate({ _max: { code: true } });
  return (agg._max.code ?? 1000) + 1;
}

/** Invoice numbering starts here: the first invoice issued is FIRST_INVOICE_NO. */
const FIRST_INVOICE_NO = 33194;

/** Arbitrary fixed key for the invoice-number advisory lock (see nextInvoiceNo). */
const INVOICE_NO_LOCK_KEY = 427419;

export async function nextInvoiceNo(prisma: Db): Promise<number> {
  // Serialize number assignment within the caller's transaction so two
  // simultaneous checkouts can't read the same MAX and collide on the unique
  // invoiceNo. The xact lock is held until the surrounding transaction ends.
  await prisma.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(${INVOICE_NO_LOCK_KEY})`);
  const agg = await prisma.invoice.aggregate({ _max: { invoiceNo: true } });
  // Floor at FIRST_INVOICE_NO so numbering starts there even on a fresh DB
  // (or one with lower test invoices); increments normally once past it.
  return Math.max(agg._max.invoiceNo ?? 0, FIRST_INVOICE_NO - 1) + 1;
}

export async function nextJobNo(prisma: Db): Promise<number> {
  const agg = await prisma.jobOrder.aggregate({ _max: { jobNo: true } });
  return (agg._max.jobNo ?? 1000) + 1;
}

export async function nextRollCode(prisma: Db): Promise<string> {
  const rolls = await prisma.fabricRoll.findMany({ select: { rollCode: true } });
  let max = 0;
  for (const r of rolls) {
    const m = /^R-(\d+)$/.exec(r.rollCode);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `R-${String(max + 1).padStart(6, "0")}`;
}
