/**
 * One-off correction of payment rows that recorded more cash than they settled.
 *
 * Until the rounding cap, POST /invoices/:id/payments took any overpayment as
 * "rounding": the invoice settled correctly but the Payment row kept the full
 * amount. Production audit 2026-11-20 found AED 167,851.54 of such excess —
 * four invoice numbers typed into the amount box (33,488 AED on a 300 AED bill)
 * and ~170 payments saved twice seconds apart — inflating the dashboard, the
 * reports and shift cash.
 *
 * Each row whose excess is above MAX_PAYMENT_ROUNDING_FILS is trimmed to what it
 * actually settled (removed when that is nothing). Genuine rounding within the cap
 * is kept, per the owner's rule. Invoices, their balances, job figures and customer
 * balances are NOT touched — they were already right. Every change is written to
 * the audit log as PAYMENT_CORRECTED with the old and new amount.
 *
 * Skipped and listed for a human: void invoices, invoices with returns, and any
 * invoice whose payments, replayed in order, do not reproduce its paidFils.
 *
 *   Dry run (default, writes nothing):  tsx apps/api/src/scripts/fixPhantomPayments.ts
 *   Apply:                              tsx apps/api/src/scripts/fixPhantomPayments.ts --apply
 *
 * Take a database backup before --apply.
 */
import { prisma } from "../config/db.js";
import { lockInvoiceRow } from "../utils/invoiceLock.js";
import { planPaymentCorrections, type PaymentCorrection } from "../utils/phantomPayments.js";

const apply = process.argv.includes("--apply");
const aed = (fils: number) => (fils / 100).toFixed(2);

async function main(): Promise<void> {
  const owner = await prisma.user.findFirst({
    where: { role: "OWNER", isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, username: true },
  });
  if (!owner) throw new Error("No active OWNER user to attribute the audit entries to");

  const invoices = await prisma.invoice.findMany({
    where: { isVoid: false },
    select: {
      id: true,
      invoiceNo: true,
      totalFils: true,
      paidFils: true,
      _count: { select: { returns: true } },
      payments: { select: { id: true, method: true, amountFils: true, createdAt: true } },
    },
    orderBy: { invoiceNo: "asc" },
  });

  const allRows = await prisma.payment.aggregate({ _sum: { amountFils: true } });
  const allPaid = await prisma.invoice.aggregate({ where: { isVoid: false }, _sum: { paidFils: true } });
  console.log(`Payment rows total: ${aed(allRows._sum.amountFils ?? 0)} AED   invoices paid total: ${aed(allPaid._sum.paidFils ?? 0)} AED`);
  console.log("");

  const toFix: Array<{ id: string; invoiceNo: number; corrections: PaymentCorrection[] }> = [];
  const skipped: string[] = [];
  let removedFils = 0;
  let rowsTrimmed = 0;
  let rowsDeleted = 0;

  for (const inv of invoices) {
    const rowsSum = inv.payments.reduce((a, p) => a + p.amountFils, 0);
    if (rowsSum <= inv.paidFils) continue;
    if (inv._count.returns > 0) {
      skipped.push(`#${inv.invoiceNo}: has returns (rows ${aed(rowsSum)}, paid ${aed(inv.paidFils)})`);
      continue;
    }
    const corrections = planPaymentCorrections(inv.totalFils, inv.paidFils, inv.payments);
    if (corrections === null) {
      skipped.push(`#${inv.invoiceNo}: replay does not match paid (rows ${aed(rowsSum)}, paid ${aed(inv.paidFils)}, total ${aed(inv.totalFils)})`);
      continue;
    }
    if (corrections.length === 0) continue; // only genuine rounding
    toFix.push({ id: inv.id, invoiceNo: inv.invoiceNo, corrections });
    for (const c of corrections) {
      removedFils += c.fromFils - c.toFils;
      if (c.toFils === 0) rowsDeleted++;
      else rowsTrimmed++;
      const p = inv.payments.find((x) => x.id === c.paymentId)!;
      console.log(
        `#${inv.invoiceNo}  ${p.createdAt.toISOString().slice(0, 19)}  ${p.method}  ${aed(c.fromFils)} -> ${c.toFils === 0 ? "removed" : aed(c.toFils)}`,
      );
    }
  }

  console.log("");
  console.log(`Invoices to correct: ${toFix.length}   rows trimmed: ${rowsTrimmed}   rows removed: ${rowsDeleted}`);
  console.log(`Excess taken out of the payment rows: ${aed(removedFils)} AED`);
  if (skipped.length > 0) {
    console.log(`Skipped for a human look (${skipped.length}):`);
    for (const s of skipped) console.log(`   ${s}`);
  }

  if (!apply) {
    console.log("DRY RUN — nothing was written. Re-run with --apply to correct.");
    return;
  }

  let applied = 0;
  for (const inv of toFix) {
    await prisma.$transaction(async (tx) => {
      await lockInvoiceRow(tx, inv.id);
      for (const c of inv.corrections) {
        // Re-check under the lock: a row someone changed since the scan is left alone.
        const row = await tx.payment.findUnique({ where: { id: c.paymentId } });
        if (!row || row.invoiceId !== inv.id || row.amountFils !== c.fromFils) {
          console.log(`   #${inv.invoiceNo}: payment ${c.paymentId} changed since the scan — left alone`);
          continue;
        }
        if (c.toFils === 0) await tx.payment.delete({ where: { id: c.paymentId } });
        else await tx.payment.update({ where: { id: c.paymentId }, data: { amountFils: c.toFils } });
        await tx.auditLog.create({
          data: {
            userId: owner.id,
            action: "PAYMENT_CORRECTED",
            entity: "Invoice",
            entityId: inv.id,
            oldValue: JSON.stringify({ paymentId: row.id, method: row.method, amountFils: row.amountFils, createdAt: row.createdAt }),
            newValue: JSON.stringify({
              invoiceNo: inv.invoiceNo,
              amountFils: c.toFils,
              removed: c.toFils === 0,
              reason: "excess over the invoice balance beyond cash rounding (typo or double save) — audit 2026-11-20",
            }),
          },
        });
        applied++;
      }
    });
  }

  const after = await prisma.payment.aggregate({ _sum: { amountFils: true } });
  console.log(`APPLIED to ${applied} rows. Payment rows total now: ${aed(after._sum.amountFils ?? 0)} AED`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
