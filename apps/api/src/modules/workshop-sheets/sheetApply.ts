import type { Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../../middleware/error.middleware.js";
import { activateJobPipeline, loadWageDefaults } from "../job-orders/jobStageHelpers.js";
import { deductFabricOnCuttingComplete } from "../job-orders/fabricInventoryOnCutting.js";
import { notifyIfInvoiceFullyReady } from "../../utils/invoiceReadyNotify.js";
import type { ResolveResult } from "./sheetResolve.js";

/**
 * Writes an approved sheet: exactly the plan the owner reviewed, in ONE
 * transaction — the whole sheet is entered or nothing is.
 *
 * Each completed stage gets what pressing «تم» by hand gives it: a wage line
 * (ProductionEntry, dated on the sheet), the stage marked DONE with its worker
 * and wage, fabric deducted when cutting completes, and a stage log. Every
 * status read during review is re-checked under the transaction, so a stage
 * someone completed by hand in the meantime aborts the approval instead of
 * being paid twice.
 */

const conflict = (jobNo: number) =>
  new AppError(409, `القطعة #${jobNo} تغيّرت بعد القراءة — اضغط «تحقق» وراجعها مرة ثانية`, "SHEET_STALE");

export type ApplyResult = { linesApplied: number; totalFils: number; readyJobIds: string[]; notesWritten: number };

export async function applySheet(
  db: PrismaClient,
  args: { sheetId: string; userId: string; sheetLabel: string; plan: ResolveResult },
): Promise<ApplyResult> {
  const wageDefaults = await loadWageDefaults(db);
  const readyJobIds: string[] = [];
  let linesApplied = 0;
  let totalFils = 0;
  let notesWritten = 0;

  await db.$transaction(
    async (tx: Prisma.TransactionClient) => {
      for (const row of args.plan.rows) {
        if (row.status !== "ok" && row.status !== "warn") continue;
        // A free repair on a tailored abaya: a note on the invoice, no stage touched.
        if (row.freeRepair && !row.freeRepair.alreadyNoted && row.invoice) {
          const inv = await tx.invoice.findUnique({ where: { id: row.invoice.id }, select: { notes: true } });
          const current = inv?.notes ?? "";
          if (!current.includes(row.freeRepair.note)) {
            await tx.invoice.update({
              where: { id: row.invoice.id },
              data: { notes: current ? `${current}\n${row.freeRepair.note}` : row.freeRepair.note },
            });
            notesWritten += 1;
          }
        }
        for (const piece of row.pieces) {
          const job = await tx.jobOrder.findUnique({
            where: { id: piece.jobId },
            select: {
              id: true,
              jobNo: true,
              stage: true,
              productId: true,
              abayaModelId: true,
              abayaModel: { select: { productId: true } },
              _count: { select: { workStages: true } },
            },
          });
          if (!job) throw conflict(piece.jobNo);
          if (piece.needsPipeline) {
            if (job._count.workStages > 0) throw conflict(piece.jobNo);
            await activateJobPipeline(tx, {
              jobId: job.id,
              productId: job.productId ?? job.abayaModel?.productId ?? null,
              abayaModelId: job.abayaModelId,
              wageDefaults,
            });
          }

          const completedAt = new Date(piece.completedAt);
          const note = `ورقة الورشة ${args.sheetLabel}`;
          const logLines: string[] = [];

          for (const step of piece.steps) {
            if (step.kind === "EXTRA") {
              if (step.state !== "NEW" || !step.workerId) continue;
              await tx.productionEntry.create({
                data: {
                  workerId: step.workerId,
                  jobOrderId: job.id,
                  workType: step.work,
                  qty: 1,
                  rateFils: step.wageFils,
                  totalFils: step.wageFils,
                  date: completedAt,
                  notes: note,
                  workshopSheetId: args.sheetId,
                },
              });
              linesApplied += 1;
              totalFils += step.wageFils;
              logLines.push(`${step.work}: ${step.workerName} ${(step.wageFils / 100).toFixed(2)}`);
              continue;
            }

            if (step.state !== "NEW" && step.state !== "SKIP" && step.state !== "CLOSE") continue;
            const row0 = await tx.jobOrderWorkStage.findUnique({
              where: { jobOrderId_stageKey: { jobOrderId: job.id, stageKey: step.work } },
            });
            if (!row0 || row0.status === "DONE") throw conflict(piece.jobNo);

            if (step.state === "SKIP") {
              if (row0.workerId || row0.productionEntryId) throw conflict(piece.jobNo);
              await tx.jobOrderWorkStage.delete({ where: { id: row0.id } });
              logLines.push(`${step.work}: بدون`);
              continue;
            }

            // Claim: the row must still be in the state we just read (double-approve, two tabs).
            const claimed = await tx.jobOrderWorkStage.updateMany({
              where: { id: row0.id, status: row0.status },
              data: { status: row0.status },
            });
            if (claimed.count === 0) throw conflict(piece.jobNo);

            if (step.state === "CLOSE" || !step.workerId) {
              await tx.jobOrderWorkStage.update({
                where: { id: row0.id },
                data: {
                  status: "DONE",
                  isCompleted: true,
                  workerId: null,
                  wageFils: 0,
                  completedAt,
                  notes: `بدون عامل — ${note}`,
                },
              });
              logLines.push(`${step.work}: بدون عامل`);
              continue;
            }

            const entry = await tx.productionEntry.create({
              data: {
                workerId: step.workerId,
                jobOrderId: job.id,
                workType: step.work,
                qty: 1,
                rateFils: step.wageFils,
                totalFils: step.wageFils,
                date: completedAt,
                notes: note,
                workshopSheetId: args.sheetId,
              },
            });
            await tx.jobOrderWorkStage.update({
              where: { id: row0.id },
              data: {
                status: "DONE",
                isCompleted: true,
                workerId: step.workerId,
                wageFils: step.wageFils,
                workerNameSnapshot: step.workerName,
                assignedAt: row0.assignedAt ?? completedAt,
                completedAt,
                notes: note,
                productionEntryId: entry.id,
              },
            });
            await deductFabricOnCuttingComplete(tx, { jobOrderId: job.id, jobNo: job.jobNo, stageKey: step.work });
            linesApplied += 1;
            totalFils += step.wageFils;
            logLines.push(`${step.work}: ${step.workerName} ${(step.wageFils / 100).toFixed(2)}`);
          }

          // Where the piece stands now.
          const rows = await tx.jobOrderWorkStage.findMany({
            where: { jobOrderId: job.id },
            orderBy: { sortOrder: "asc" },
            select: { stageKey: true, status: true },
          });
          const next = rows.find((r) => r.status !== "DONE");
          const keepStage = job.stage === "DELIVERED" || job.stage === "READY";
          const newStage = keepStage ? job.stage : next ? next.stageKey : "READY";
          if (newStage !== job.stage) {
            await tx.jobOrder.update({ where: { id: job.id }, data: { stage: newStage } });
          }
          if (newStage === "READY" && job.stage !== "READY") readyJobIds.push(job.id);
          if (logLines.length || newStage !== job.stage) {
            await tx.jobStageLog.create({
              data: {
                jobOrderId: job.id,
                stage: newStage,
                changedById: args.userId,
                notes: `${note}: ${logLines.join(" · ")}${newStage !== job.stage ? ` → ${newStage}` : ""}`,
              },
            });
          }
        }
      }
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  for (const jobId of readyJobIds) await notifyIfInvoiceFullyReady(db, jobId);
  return { linesApplied, totalFils, readyJobIds, notesWritten };
}
