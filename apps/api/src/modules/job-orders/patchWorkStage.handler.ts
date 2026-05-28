import type { Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { AppError } from "../../middleware/error.middleware.js";
import { PIPELINE_STAGE_KEYS, parseWageDefaults, wageForPipelineStage } from "./jobStageHelpers.js";

export const patchWorkStageBody = z.object({
  workerId: z.union([z.string(), z.null()]).optional(),
  wageFils: z.number().int().min(0).optional(),
  notes: z.string().optional().nullable(),
  /** Admin correction on DONE rows (ISO or datetime-local compatible). */
  completedAt: z.string().optional(),
});

/** Optional `wage` in AED — routes should map to `wageFils` before calling {@link patchWorkStageHandler}. */
export const patchWorkStageBodyWithOptionalWageAed = patchWorkStageBody.extend({
  wage: z.number().min(0).optional(),
});

export type PatchWorkStageBody = z.infer<typeof patchWorkStageBody>;

/**
 * PATCH job order work stage (planned worker/wage, in-progress edits, or admin correction on DONE).
 */
export async function patchWorkStageHandler(req: Request, res: Response): Promise<void> {
  const jobId = req.params.id;
  const stageKey = req.params.stageKey;
  if (!jobId || !stageKey) throw new AppError(400, "Missing job or stage", "VALIDATION_ERROR");
  const pipelineKeys = PIPELINE_STAGE_KEYS as readonly string[];
  if (!pipelineKeys.includes(stageKey)) throw new AppError(400, "Invalid stage", "VALIDATION_ERROR");

  const userId = req.user?.id;
  if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
  const perms = req.user?.permissions ?? [];
  const canUpdate = perms.includes("jobProcess.update");
  const canAssignWorkers = perms.includes("jobProcess.assignWorkers");
  const canAdminEdit = perms.includes("jobProcess.adminEdit");
  const canEditWage = perms.includes("jobProcess.editWage") || canAdminEdit;
  const canPatchNonDone = canUpdate || canAssignWorkers;

  const body = req.body as PatchWorkStageBody;
  const job = await prisma.jobOrder.findUnique({
    where: { id: jobId },
    include: { workStages: true, product: true },
  });
  if (!job) throw new AppError(404, "Job order not found", "NOT_FOUND");
  const row = job.workStages.find((s) => s.stageKey === stageKey);
  if (!row) throw new AppError(404, "Stage not found", "NOT_FOUND");

  if (row.status === "DONE") {
    if (canAssignWorkers && !canAdminEdit) {
      throw new AppError(403, "لا يمكن تعديل مرحلة مكتملة بهذا الدور", "FORBIDDEN");
    }
    if (!canAdminEdit) {
      throw new AppError(403, "تعديل المراحل المكتملة متاح للإدارة فقط", "FORBIDDEN");
    }

    const hasAny =
      body.workerId !== undefined ||
      body.wageFils !== undefined ||
      body.notes !== undefined ||
      body.completedAt !== undefined;
    if (!hasAny) {
      throw new AppError(400, "No changes", "VALIDATION_ERROR");
    }

    if (!row.workerId) {
      throw new AppError(400, "Completed stage has no worker — use reopen", "INVALID_STATE");
    }

    let nextWorkerId = row.workerId;
    let nextSnapshot = row.workerNameSnapshot;
    if (body.workerId !== undefined) {
      const wid = typeof body.workerId === "string" ? body.workerId.trim() : "";
      if (!wid) {
        throw new AppError(400, "Worker is required for a completed stage", "VALIDATION_ERROR");
      }
      const worker = await prisma.worker.findUnique({ where: { id: wid } });
      if (!worker) throw new AppError(404, "Worker not found", "NOT_FOUND");
      nextWorkerId = worker.id;
      nextSnapshot = worker.name;
    }

    const nextWageFils = body.wageFils !== undefined ? body.wageFils : row.wageFils;
    const mergedNotes = body.notes === undefined ? row.notes : body.notes;

    let nextCompletedAt: Date = row.completedAt ?? new Date();
    if (body.completedAt !== undefined) {
      const parsed = new Date(body.completedAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new AppError(400, "Invalid completedAt", "VALIDATION_ERROR");
      }
      nextCompletedAt = parsed;
    }

    const auditBits: string[] = [];
    if (body.workerId !== undefined && nextWorkerId !== row.workerId) {
      auditBits.push(`worker → ${nextSnapshot ?? nextWorkerId}`);
    }
    if (body.wageFils !== undefined && nextWageFils !== row.wageFils) {
      auditBits.push(`wage ${(row.wageFils / 100).toFixed(2)} → ${(nextWageFils / 100).toFixed(2)} AED`);
    }
    if (body.completedAt !== undefined) {
      auditBits.push(`completedAt corrected`);
    }
    if (body.notes !== undefined) {
      auditBits.push(`notes updated`);
    }
    const auditMsg =
      auditBits.length > 0
        ? `Admin correction: ${auditBits.join("; ")}`
        : "Admin correction (no field changes — check request)";

    const updated = await prisma.$transaction(async (tx) => {
      const ws = await tx.jobOrderWorkStage.update({
        where: { id: row.id },
        data: {
          workerId: nextWorkerId,
          workerNameSnapshot: nextSnapshot,
          wageFils: nextWageFils,
          notes: mergedNotes ?? undefined,
          completedAt: nextCompletedAt,
        },
        include: { worker: { select: { id: true, name: true, phone: true } } },
      });

      if (row.productionEntryId) {
        await tx.productionEntry.update({
          where: { id: row.productionEntryId },
          data: {
            workerId: nextWorkerId,
            rateFils: nextWageFils,
            totalFils: nextWageFils,
            date: nextCompletedAt,
            notes: mergedNotes ?? `Stage ${stageKey}`,
          },
        });
      }

      await tx.jobStageLog.create({
        data: {
          jobOrderId: job.id,
          stage: stageKey,
          changedById: userId,
          notes: auditMsg,
        },
      });

      return ws;
    });

    res.status(200).json({ success: true, data: updated });
    return;
  }

  if (!canPatchNonDone) {
    throw new AppError(403, "ليس لديك صلاحية لتحديث هذه المرحلة", "FORBIDDEN");
  }

  if (body.completedAt !== undefined && !canAdminEdit) {
    throw new AppError(403, "تعديل وقت الإنجاز متاح للإدارة فقط", "FORBIDDEN");
  }

  const settingsRows = await prisma.setting.findMany();
  const settingsMap = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));
  const wageDefaults = parseWageDefaults(settingsMap);

  /** Planned worker / wage on any PENDING row (current or future stage). Status stays PENDING. */
  if (row.status === "PENDING") {
    const data: Prisma.JobOrderWorkStageUpdateInput = {};
    if (body.workerId !== undefined) {
      const wid = typeof body.workerId === "string" ? body.workerId.trim() : "";
      if (!wid) {
        data.worker = { disconnect: true };
        data.workerNameSnapshot = null;
      } else {
        const worker = await prisma.worker.findUnique({ where: { id: wid } });
        if (!worker) throw new AppError(404, "Worker not found", "NOT_FOUND");
        data.worker = { connect: { id: worker.id } };
        data.workerNameSnapshot = worker.name;
      }
    }
    if (body.wageFils !== undefined) {
      if (!canEditWage && body.wageFils !== row.wageFils) {
        throw new AppError(403, "لا يمكن تعديل أجر المرحلة بدون صلاحية تعديل الأجور", "FORBIDDEN");
      }
      if (canEditWage) {
        data.wageFils = body.wageFils;
      }
    } else if (body.workerId !== undefined && row.wageFils <= 0) {
      data.wageFils = wageForPipelineStage(stageKey, job.product, wageDefaults);
    }
    if (body.notes !== undefined) {
      data.notes = body.notes;
    }
    if (Object.keys(data).length === 0) {
      throw new AppError(400, "No changes", "VALIDATION_ERROR");
    }

    const updated = await prisma.jobOrderWorkStage.update({
      where: { id: row.id },
      data,
      include: { worker: { select: { id: true, name: true, phone: true } } },
    });
    res.status(200).json({ success: true, data: updated });
    return;
  }

  /** IN_PROGRESS: only the active stage row is editable */
  if (job.stage !== stageKey) {
    throw new AppError(400, "Edit only the current active stage row", "WRONG_STAGE");
  }

  if (body.wageFils !== undefined && body.wageFils !== row.wageFils && !canEditWage) {
    throw new AppError(403, "لا يمكن تعديل أجر المرحلة بدون صلاحية تعديل الأجور", "FORBIDDEN");
  }
  const nextWageFils = body.wageFils !== undefined && canEditWage ? body.wageFils : row.wageFils;

  const data: Prisma.JobOrderWorkStageUpdateInput = {
    wageFils: nextWageFils,
    notes: body.notes === undefined ? row.notes : body.notes,
  };
  if (body.workerId !== undefined) {
    const wid = typeof body.workerId === "string" ? body.workerId.trim() : "";
    if (!wid) {
      throw new AppError(400, "Worker cannot be cleared while the stage is in progress", "VALIDATION_ERROR");
    }
    const worker = await prisma.worker.findUnique({ where: { id: wid } });
    if (!worker) throw new AppError(404, "Worker not found", "NOT_FOUND");
    data.worker = { connect: { id: worker.id } };
    data.workerNameSnapshot = worker.name;
  }

  const updated = await prisma.jobOrderWorkStage.update({
    where: { id: row.id },
    data,
    include: { worker: { select: { id: true, name: true, phone: true } } },
  });

  res.status(200).json({ success: true, data: updated });
}
