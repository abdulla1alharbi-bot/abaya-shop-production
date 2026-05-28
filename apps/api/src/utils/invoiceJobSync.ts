import type { Prisma } from "@prisma/client";
import { allocateByLineShares } from "./invoiceAllocation.js";

/** After invoice paidFils/totalFils change, update linked job orders' financial fields. */
export async function syncInvoiceJobsFinancials(
  tx: Prisma.TransactionClient,
  invoiceId: string,
): Promise<void> {
  const inv = await tx.invoice.findUnique({
    where: { id: invoiceId },
    include: { items: true },
  });
  if (!inv || inv.isVoid) return;

  const jobs = await tx.jobOrder.findMany({
    where: { invoiceId },
    orderBy: { jobNo: "asc" },
  });
  if (jobs.length === 0) return;

  const S = inv.subtotalFils;
  const T = inv.totalFils;
  const P = inv.paidFils;
  if (S <= 0) return;

  const linked = jobs.filter((j) => j.invoiceItemId);
  if (linked.length === 0) return;

  const lineAmounts = linked.map((j) => {
    const item = inv.items.find((i) => i.id === j.invoiceItemId);
    return item?.totalFils ?? 0;
  });

  const { shareTotal, sharePaid } = allocateByLineShares(lineAmounts, S, T, P);
  for (let i = 0; i < linked.length; i++) {
    const job = linked[i];
    if (!job) continue;
    const st = shareTotal[i] ?? 0;
    const sp = sharePaid[i] ?? 0;
    const bal = st - sp;
    await tx.jobOrder.update({
      where: { id: job.id },
      data: {
        totalFils: st,
        paidFils: sp,
        balanceFils: Math.max(0, bal),
        isPaid: bal <= 0,
      },
    });
  }
}
