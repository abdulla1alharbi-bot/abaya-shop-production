import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export async function nextCustomerCode(prisma: Db): Promise<number> {
  const agg = await prisma.customer.aggregate({ _max: { code: true } });
  return (agg._max.code ?? 1000) + 1;
}

export async function nextInvoiceNo(prisma: Db): Promise<number> {
  const agg = await prisma.invoice.aggregate({ _max: { invoiceNo: true } });
  return (agg._max.invoiceNo ?? 10000) + 1;
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
