/**
 * One-off repair for job orders on MIXED invoices (retail + tailoring lines).
 *
 * Before d52d3d5, allocateByLineShares forced the tailoring lines' shares to add up
 * to the WHOLE invoice total, so the last job on a mixed invoice also carried the
 * retail amount (e.g. 100 retail + 100 tailoring at 5% VAT: job total 210, not 105).
 * New invoices are correct; this recomputes the stored job figures on old ones with
 * the fixed allocation — exactly what syncInvoiceJobsFinancials does after a payment.
 *
 * Only job totalFils / paidFils / balanceFils / isPaid change. Invoices, payments
 * and customer balances are not touched. Pure-tailoring invoices are skipped.
 *
 *   Dry run (default, writes nothing):  tsx apps/api/src/scripts/fixMixedInvoiceJobs.ts
 *   Apply:                              tsx apps/api/src/scripts/fixMixedInvoiceJobs.ts --apply
 *
 * Take a database backup before --apply.
 */
import { prisma } from "../config/db.js";
import { allocateByLineShares } from "../utils/invoiceAllocation.js";
import { syncInvoiceJobsFinancials } from "../utils/invoiceJobSync.js";
import { lockInvoiceRow } from "../utils/invoiceLock.js";

const apply = process.argv.includes("--apply");
const aed = (fils: number) => (fils / 100).toFixed(2);

async function main(): Promise<void> {
  const invoices = await prisma.invoice.findMany({
    where: { isVoid: false, jobOrders: { some: { invoiceItemId: { not: null } } } },
    include: { items: true, jobOrders: { orderBy: { jobNo: "asc" } } },
    orderBy: { invoiceNo: "asc" },
  });

  let mixed = 0;
  let affected = 0;
  let jobsChanged = 0;
  let excessBalanceFils = 0;

  for (const inv of invoices) {
    const linked = inv.jobOrders.filter((j) => j.invoiceItemId);
    const linkedItemIds = new Set(linked.map((j) => j.invoiceItemId));
    // Mixed = at least one invoice line with no job order behind it (retail).
    if (!inv.items.some((it) => !linkedItemIds.has(it.id))) continue;
    if (inv.subtotalFils <= 0) continue;
    mixed++;

    const lineAmounts = linked.map((j) => inv.items.find((i) => i.id === j.invoiceItemId)?.totalFils ?? 0);
    const { shareTotal, sharePaid } = allocateByLineShares(lineAmounts, inv.subtotalFils, inv.totalFils, inv.paidFils);

    const changes = linked
      .map((j, i) => {
        const total = shareTotal[i] ?? 0;
        const paid = sharePaid[i] ?? 0;
        const balance = Math.max(0, total - paid);
        return { j, total, paid, balance };
      })
      .filter((c) => c.j.totalFils !== c.total || c.j.paidFils !== c.paid || c.j.balanceFils !== c.balance);
    if (changes.length === 0) continue;

    affected++;
    jobsChanged += changes.length;
    console.log(`Invoice #${inv.invoiceNo}  (invoice total ${aed(inv.totalFils)}, paid ${aed(inv.paidFils)})`);
    for (const c of changes) {
      excessBalanceFils += c.j.balanceFils - c.balance;
      console.log(
        `   job #${c.j.jobNo}: total ${aed(c.j.totalFils)} -> ${aed(c.total)}` +
          `   paid ${aed(c.j.paidFils)} -> ${aed(c.paid)}` +
          `   balance ${aed(c.j.balanceFils)} -> ${aed(c.balance)}`,
      );
    }

    if (apply) {
      await prisma.$transaction(async (tx) => {
        await lockInvoiceRow(tx, inv.id);
        await syncInvoiceJobsFinancials(tx, inv.id);
      });
    }
  }

  console.log("");
  console.log(`Invoices with jobs: ${invoices.length}   mixed: ${mixed}   needing a fix: ${affected}   jobs: ${jobsChanged}`);
  console.log(`Job balances overstated by: ${aed(excessBalanceFils)} AED in total`);
  console.log(apply ? "APPLIED." : "DRY RUN — nothing was written. Re-run with --apply to fix.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
