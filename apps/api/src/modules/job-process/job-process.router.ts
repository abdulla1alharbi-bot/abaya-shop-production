import { Router } from "express";
import { prisma } from "../../config/db.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/rbac.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../middleware/error.middleware.js";
import {
  patchWorkStageBodyWithOptionalWageAed,
  patchWorkStageHandler,
} from "../job-orders/patchWorkStage.handler.js";

/**
 * Alias routes for job process row updates (work stage row id = JobOrderWorkStage.id).
 * Canonical: PATCH /api/job-orders/:jobId/work-stages/:stageKey
 */
export const jobProcessRouter = Router();
jobProcessRouter.use(authMiddleware);

jobProcessRouter.patch(
  "/:workStageId",
  requirePermission("jobProcess.update", "jobProcess.assignWorkers", "jobProcess.adminEdit"),
  validateBody(patchWorkStageBodyWithOptionalWageAed),
  asyncHandler(async (req, res) => {
    const { workStageId } = req.params;
    if (!workStageId) throw new AppError(400, "Missing id", "VALIDATION_ERROR");
    const ws = await prisma.jobOrderWorkStage.findUnique({ where: { id: workStageId } });
    if (!ws) throw new AppError(404, "Work stage not found", "NOT_FOUND");
    const body = req.body as Record<string, unknown> & { wage?: number; wageFils?: number };
    if (body.wage != null && body.wageFils == null) {
      body.wageFils = Math.round(body.wage * 100);
    }
    delete body.wage;
    Object.assign(req.params as Record<string, string>, {
      id: ws.jobOrderId,
      stageKey: ws.stageKey,
    });
    await patchWorkStageHandler(req, res);
  }),
);

/**
 * Phase 3 F8: Workshop capacity view — per-worker active assignments + workshop totals.
 */
jobProcessRouter.get(
  "/workshop/capacity",
  requirePermission("jobProcess.view"),
  asyncHandler(async (_req, res) => {
    const FINISHED = ["READY", "DELIVERED", "CANCELLED", "CONVERTED_TO_READY"];
    const startOfToday = (() => {
      const d = new Date();
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    })();

    const [allActiveJobs, allWorkers, activeStages] = await Promise.all([
      prisma.jobOrder.findMany({
        where: { stage: { notIn: FINISHED } },
        select: { id: true, stage: true, dueDate: true, deliveredAt: true, createdAt: true },
      }),
      prisma.worker.findMany({
        where: { isActive: true },
        select: { id: true, name: true, isActive: true, role: true },
        orderBy: { name: "asc" },
      }),
      prisma.jobOrderWorkStage.findMany({
        where: {
          status: { not: "DONE" },
          jobOrder: { stage: { notIn: FINISHED } },
          workerId: { not: null },
        },
        select: {
          id: true,
          stageKey: true,
          status: true,
          workerId: true,
          jobOrder: { select: { id: true, jobNo: true, dueDate: true, createdAt: true } },
        },
      }),
    ]);

    const overallTotalActive = allActiveJobs.length;
    const overallTotalReady = await prisma.jobOrder.count({ where: { stage: "READY" } });
    const overallTotalOverdue = allActiveJobs.filter(
      (j) => j.dueDate && j.dueDate < startOfToday && !j.deliveredAt,
    ).length;
    const overallTotalInInspection = allActiveJobs.filter((j) => j.stage === "INSPECTION").length;

    const byWorker = new Map<
      string,
      {
        workerId: string;
        name: string;
        role: string;
        activeStages: Array<{
          jobNo: number;
          stageKey: string;
          dueDate: string | null;
          isOverdue: boolean;
        }>;
        backlogCount: number;
        oldestJobAgeDays: number;
      }
    >();

    for (const w of allWorkers) {
      byWorker.set(w.id, {
        workerId: w.id,
        name: w.name,
        role: w.role,
        activeStages: [],
        backlogCount: 0,
        oldestJobAgeDays: 0,
      });
    }

    for (const s of activeStages) {
      if (!s.workerId) continue;
      const entry = byWorker.get(s.workerId);
      if (!entry) continue;
      const dueDate = s.jobOrder.dueDate;
      const isOverdue = Boolean(dueDate && dueDate < startOfToday);
      entry.activeStages.push({
        jobNo: s.jobOrder.jobNo,
        stageKey: s.stageKey,
        dueDate: dueDate?.toISOString() ?? null,
        isOverdue,
      });
      entry.backlogCount += 1;
      const ageDays = Math.floor((Date.now() - s.jobOrder.createdAt.getTime()) / (24 * 60 * 60 * 1000));
      if (ageDays > entry.oldestJobAgeDays) entry.oldestJobAgeDays = ageDays;
    }

    res.status(200).json({
      success: true,
      data: {
        overall: {
          totalActive: overallTotalActive,
          totalReady: overallTotalReady,
          totalOverdue: overallTotalOverdue,
          totalInInspection: overallTotalInInspection,
        },
        perWorker: [...byWorker.values()].sort((a, b) => b.backlogCount - a.backlogCount),
      },
    });
  }),
);
