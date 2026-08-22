import { PrismaClient } from "@prisma/client";

/**
 * One-off migration: clear the retired INSPECTION stage.
 *
 * The QA gate was removed (see `nextStageAfterComplete`) because nobody performed the
 * inspection, so finished pieces piled up behind it — 125 abayas with every stage
 * complete and every wage paid, none of them visible to the customer, because an
 * invoice only becomes "ready for delivery" once all of its jobs are READY.
 *
 * This moves those jobs to READY and stamps `readyAt` on any invoice that is now
 * fully finished, which is what puts the order into the daily "who do we message"
 * queue at /invoices/messages.
 *
 * Deliberately does NOT fire the per-invoice "ready" notifications: doing so for a
 * hundred invoices at once would bury every other alert, and the message queue is
 * the screen staff actually work from.
 *
 * Idempotent — a second run finds nothing and changes nothing.
 *
 * Usage:
 *   tsx apps/api/prisma/retire-inspection-stage.ts --dry-run
 *   tsx apps/api/prisma/retire-inspection-stage.ts
 */

const prisma = new PrismaClient();

const DRY_RUN = process.argv.includes("--dry-run");
const WORKSHOP_DONE = ["READY", "DELIVERED", "CONVERTED_TO_READY"];

async function main(): Promise<void> {
  console.log(DRY_RUN ? "=== DRY RUN — nothing will be written ===" : "=== APPLYING ===");

  const jobs = await prisma.jobOrder.findMany({
    where: { stage: "INSPECTION" },
    select: {
      id: true,
      jobNo: true,
      invoiceId: true,
      deliveredAt: true,
      invoice: { select: { id: true, invoiceNo: true, isVoid: true, deliveredAt: true, readyAt: true } },
    },
  });

  console.log(`jobs in INSPECTION: ${jobs.length}`);
  if (jobs.length === 0) {
    console.log("nothing to do.");
    return;
  }

  // Stage logs need a real user. Prefer the owner; fall back to any active account.
  const actor =
    (await prisma.user.findFirst({ where: { role: "OWNER", isActive: true }, select: { id: true } })) ??
    (await prisma.user.findFirst({ where: { isActive: true }, select: { id: true } }));
  if (!actor) throw new Error("No user to attribute the stage change to");

  const affectedInvoiceIds = [...new Set(jobs.map((j) => j.invoiceId).filter((v): v is string => Boolean(v)))];
  console.log(`invoices touched: ${affectedInvoiceIds.length}`);

  if (DRY_RUN) {
    for (const j of jobs.slice(0, 10)) {
      console.log(`  job #${j.jobNo} → READY (invoice #${j.invoice?.invoiceNo ?? "—"})`);
    }
    if (jobs.length > 10) console.log(`  … and ${jobs.length - 10} more`);
  } else {
    // One transaction per job keeps a failure from rolling back the whole batch;
    // the script is idempotent, so a partial run is safe to repeat.
    let done = 0;
    for (const job of jobs) {
      await prisma.$transaction([
        prisma.jobOrder.update({ where: { id: job.id }, data: { stage: "READY" } }),
        prisma.jobStageLog.create({
          data: {
            jobOrderId: job.id,
            stage: "READY",
            changedById: actor.id,
            notes: "أُلغيت مرحلة فحص الجودة — العمل مكتمل والقطعة جاهزة",
          },
        }),
        prisma.auditLog.create({
          data: {
            userId: actor.id,
            action: "QA_STAGE_RETIRED",
            entity: "JobOrder",
            entityId: job.id,
            oldValue: JSON.stringify({ stage: "INSPECTION", jobNo: job.jobNo }),
            newValue: JSON.stringify({ stage: "READY", jobNo: job.jobNo }),
          },
        }),
      ]);
      done += 1;
    }
    console.log(`moved to READY: ${done}`);
  }

  // Stamp readyAt on invoices that are now fully finished and were never stamped.
  const candidates = await prisma.invoice.findMany({
    where: {
      id: { in: affectedInvoiceIds },
      isVoid: false,
      deliveredAt: null,
      readyAt: null,
    },
    select: { id: true, invoiceNo: true, jobOrders: { select: { stage: true } } },
  });
  const nowReady = candidates.filter(
    (inv) => inv.jobOrders.length > 0 && inv.jobOrders.every((j) => WORKSHOP_DONE.includes(j.stage)),
  );

  console.log(`invoices becoming ready for delivery: ${nowReady.length}`);
  if (!DRY_RUN && nowReady.length > 0) {
    const stampedAt = new Date();
    await prisma.invoice.updateMany({
      where: { id: { in: nowReady.map((i) => i.id) } },
      data: { readyAt: stampedAt },
    });
    console.log(`stamped readyAt on ${nowReady.length} invoices at ${stampedAt.toISOString()}`);
    console.log("→ these now appear in /invoices/messages for the customer to be told.");
  }

  const remaining = await prisma.jobOrder.count({ where: { stage: "INSPECTION" } });
  console.log(`jobs left in INSPECTION: ${remaining}`);
}

main()
  .catch((err: unknown) => {
    console.error("FAILED:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
