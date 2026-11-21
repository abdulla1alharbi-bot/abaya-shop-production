import type { Router } from "express";
import { z } from "zod";
import { EXTRA_WORK_TYPES, isExtraWorkType } from "@abaya-shop/shared";
import { prisma } from "../../config/db.js";
import { requirePermission } from "../../middleware/rbac.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../middleware/error.middleware.js";

/**
 * «شغل إضافي» on a piece: ARI / PUSSOS work that only some pieces get.
 *
 * Deliberately NOT pipeline stages — a stage must be completed before the piece
 * can be READY, and most pieces never get ARI or PUSSOS. Each line is a plain
 * ProductionEntry linked to the job, so the worker's balance, payroll and every
 * wage report count it exactly like a stage wage (wage rule: earned on its date).
 *
 * The wage is typed by hand (there is no per-model default for this work), so
 * changing these lines needs the same right as changing a stage wage.
 */

const WAGE_EDIT_PERMS = ["jobProcess.editWage", "jobProcess.adminEdit"] as const;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_WAGE_FILS = 1_000_000; // 10,000 AED — a typo guard, far above any real piece wage

const extraWorkBody = z.object({
  workType: z.enum(EXTRA_WORK_TYPES),
  workerId: z.string().min(1),
  amountFils: z.number().int().min(0).max(MAX_WAGE_FILS),
  /** When the work was done (defaults to now). */
  date: z.string().optional(),
  notes: z.string().max(500).optional(),
});

const extraWorkPatchBody = extraWorkBody.partial();

function parseWorkDate(raw: string | undefined, fallback: Date): Date {
  if (raw === undefined || raw === "") return fallback;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new AppError(400, "تاريخ غير صحيح", "VALIDATION_ERROR");
  if (d.getTime() > Date.now() + MAX_FUTURE_SKEW_MS) {
    throw new AppError(400, "التاريخ في المستقبل", "DATE_IN_FUTURE");
  }
  return d;
}

const entrySelect = {
  id: true,
  workType: true,
  totalFils: true,
  date: true,
  notes: true,
  workerId: true,
  worker: { select: { id: true, name: true } },
} as const;

async function loadJobOrThrow(jobId: string) {
  const job = await prisma.jobOrder.findUnique({
    where: { id: jobId },
    select: { id: true, jobNo: true, stage: true },
  });
  if (!job) throw new AppError(404, "Job order not found", "NOT_FOUND");
  return job;
}

async function loadExtraEntryOrThrow(jobId: string, entryId: string) {
  const entry = await prisma.productionEntry.findUnique({
    where: { id: entryId },
    select: { id: true, jobOrderId: true, workType: true, workerId: true, totalFils: true },
  });
  // Only extra-work lines are editable here — a stage wage line belongs to its
  // stage (reopen / correct the stage instead), so it is treated as not found.
  if (!entry || entry.jobOrderId !== jobId || !isExtraWorkType(entry.workType)) {
    throw new AppError(404, "Extra work line not found", "NOT_FOUND");
  }
  return entry;
}

async function assertWorkerExists(workerId: string) {
  const worker = await prisma.worker.findUnique({ where: { id: workerId }, select: { id: true, name: true } });
  if (!worker) throw new AppError(404, "Worker not found", "NOT_FOUND");
  return worker;
}

const aed = (fils: number) => (fils / 100).toFixed(2);

export function registerExtraWorkRoutes(router: Router): void {
  router.get(
    "/:id/extra-work",
    requirePermission("jobProcess.view"),
    asyncHandler(async (req, res) => {
      const jobId = req.params.id!;
      await loadJobOrThrow(jobId);
      const items = await prisma.productionEntry.findMany({
        where: { jobOrderId: jobId, workType: { in: [...EXTRA_WORK_TYPES] } },
        select: entrySelect,
        orderBy: [{ date: "asc" }, { id: "asc" }],
      });
      res.status(200).json({ success: true, data: items });
    }),
  );

  router.post(
    "/:id/extra-work",
    requirePermission(...WAGE_EDIT_PERMS),
    validateBody(extraWorkBody),
    asyncHandler(async (req, res) => {
      const jobId = req.params.id!;
      const userId = req.user?.id;
      if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
      const body = req.body as z.infer<typeof extraWorkBody>;
      const job = await loadJobOrThrow(jobId);
      if (job.stage === "CANCELLED") {
        throw new AppError(400, "لا يمكن إضافة شغل على قطعة ملغاة", "JOB_CANCELLED");
      }
      const worker = await assertWorkerExists(body.workerId);
      const date = parseWorkDate(body.date, new Date());
      const notes = body.notes?.trim() || null;

      const created = await prisma.$transaction(async (tx) => {
        const entry = await tx.productionEntry.create({
          data: {
            workerId: worker.id,
            jobOrderId: job.id,
            workType: body.workType,
            qty: 1,
            rateFils: body.amountFils,
            totalFils: body.amountFils,
            date,
            notes,
          },
          select: entrySelect,
        });
        await tx.jobStageLog.create({
          data: {
            jobOrderId: job.id,
            stage: job.stage,
            changedById: userId,
            notes: `Extra work ${body.workType}: ${worker.name} (${aed(body.amountFils)} AED)`,
          },
        });
        return entry;
      });

      res.status(201).json({ success: true, data: created });
    }),
  );

  router.patch(
    "/:id/extra-work/:entryId",
    requirePermission(...WAGE_EDIT_PERMS),
    validateBody(extraWorkPatchBody),
    asyncHandler(async (req, res) => {
      const jobId = req.params.id!;
      const entryId = req.params.entryId!;
      const userId = req.user?.id;
      if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
      const body = req.body as z.infer<typeof extraWorkPatchBody>;
      const job = await loadJobOrThrow(jobId);
      const before = await loadExtraEntryOrThrow(jobId, entryId);
      const worker = body.workerId ? await assertWorkerExists(body.workerId) : null;

      const updated = await prisma.$transaction(async (tx) => {
        const entry = await tx.productionEntry.update({
          where: { id: before.id },
          data: {
            ...(body.workType ? { workType: body.workType } : {}),
            ...(worker ? { workerId: worker.id } : {}),
            ...(body.amountFils !== undefined
              ? { rateFils: body.amountFils, totalFils: body.amountFils, qty: 1 }
              : {}),
            ...(body.date !== undefined ? { date: parseWorkDate(body.date, new Date()) } : {}),
            ...(body.notes !== undefined ? { notes: body.notes.trim() || null } : {}),
          },
          select: entrySelect,
        });
        await tx.jobStageLog.create({
          data: {
            jobOrderId: job.id,
            stage: job.stage,
            changedById: userId,
            notes: `Extra work corrected: ${entry.workType} ${entry.worker.name} (${aed(before.totalFils)} → ${aed(entry.totalFils)} AED)`,
          },
        });
        return entry;
      });

      res.status(200).json({ success: true, data: updated });
    }),
  );

  router.delete(
    "/:id/extra-work/:entryId",
    requirePermission(...WAGE_EDIT_PERMS),
    asyncHandler(async (req, res) => {
      const jobId = req.params.id!;
      const entryId = req.params.entryId!;
      const userId = req.user?.id;
      if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
      const job = await loadJobOrThrow(jobId);
      const entry = await loadExtraEntryOrThrow(jobId, entryId);

      await prisma.$transaction(async (tx) => {
        await tx.productionEntry.delete({ where: { id: entry.id } });
        await tx.jobStageLog.create({
          data: {
            jobOrderId: job.id,
            stage: job.stage,
            changedById: userId,
            notes: `Extra work removed: ${entry.workType} (${aed(entry.totalFils)} AED)`,
          },
        });
      });

      res.status(200).json({ success: true, data: { id: entry.id } });
    }),
  );
}
