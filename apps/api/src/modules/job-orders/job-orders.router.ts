import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/db.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { requireAllPermissions, requirePermission } from "../../middleware/rbac.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../middleware/error.middleware.js";
import { prismaSkipTake, buildPaginatedMeta } from "../../utils/pagination.js";
import { parsePageLimit, parseOptionalDate, queryParamString } from "../../utils/queryParams.js";
import { nextJobNo } from "../../utils/counters.js";
import {
  PIPELINE_STAGE_KEYS,
  createPipelineRowsForJob,
  initialPipelineStage,
  nextStageAfterComplete,
  orderedPipelineKeys,
  parseWageDefaults,
  resolvePipelineStageKeysFromModelJson,
  wageForPipelineStage,
} from "./jobStageHelpers.js";
import {
  deductFabricOnCuttingComplete,
  isCuttingWorkStageDone,
  patchJobOrderMaterialFabric,
  reserveFabricForMaterial,
  restoreAllDeductedMaterialsForJob,
  restoreFabricOnCuttingReopen,
} from "./fabricInventoryOnCutting.js";
import { isWorkerRequest, redactJobOrderDetailForWorker } from "../../utils/workerFinancialRedaction.js";
import {
  patchWorkStageBody,
  patchWorkStageBodyWithOptionalWageAed,
  patchWorkStageHandler,
} from "./patchWorkStage.handler.js";

export const jobOrdersRouter = Router();
jobOrdersRouter.use(authMiddleware);

function isWorkshopSupervisorRestricted(perms: string[]): boolean {
  return perms.includes("jobProcess.assignWorkers") && !perms.includes("jobProcess.adminEdit");
}

const UNCLAIMED_DEFAULT_DAYS = 120;
const CONVERTED_READY_STAGE = "CONVERTED_TO_READY";

function trimSafe(v: string | null | undefined): string {
  return (v ?? "").trim();
}

async function markDisplaySampleActive(args: {
  tx: Prisma.TransactionClient;
  job: {
    id: string;
    jobNo: number;
    abayaModelId?: string | null;
    productionBatch?: {
      type?: string;
    } | null;
  };
}): Promise<void> {
  const { tx, job } = args;
  if (job.productionBatch?.type !== "SAMPLE") return;
  if (!job.abayaModelId) return;
  await tx.abayaModel.update({
    where: { id: job.abayaModelId },
    data: { hasActiveDisplaySample: true, latestDisplaySampleAt: new Date() },
  });
}

jobOrdersRouter.get(
  "/",
  requirePermission("jobProcess.view"),
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const { page, limit } = parsePageLimit(q, { defaultLimit: 80, maxLimit: 500 });
    const search = queryParamString(q, "q");
    const stage = queryParamString(q, "stage");
    const customerId = queryParamString(q, "customerId");
    const workerId = queryParamString(q, "workerId");
    const paymentStatus = queryParamString(q, "paymentStatus");
    const overdueOnly = queryParamString(q, "overdue") === "true";
    const openOnly = queryParamString(q, "open") === "true";
    const dueBefore = parseOptionalDate(q, "dueBefore");
    const dueAfter = parseOptionalDate(q, "dueAfter");

    const pagination = { page, limit };
    const { skip, take } = prismaSkipTake(pagination);

    const and: Prisma.JobOrderWhereInput[] = [];

    if (search) {
      and.push({
        OR: [
          { productStyle: { contains: search } },
          { customer: { name: { contains: search } } },
          { customer: { mobile: { contains: search } } },
        ],
      });
    }
    if (stage) and.push({ stage });
    if (customerId) and.push({ customerId });
    if (workerId) {
      and.push({
        OR: [
          { assignments: { some: { workerId } } },
          { workStages: { some: { workerId } } },
        ],
      });
    }

    if (paymentStatus === "paid") and.push({ balanceFils: { lte: 0 } });
    if (paymentStatus === "unpaid") and.push({ paidFils: { equals: 0 } });
    if (paymentStatus === "partial") {
      and.push({ paidFils: { gt: 0 }, balanceFils: { gt: 0 } });
    }

    if (overdueOnly) {
      const today = new Date();
      const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      and.push({
        dueDate: { lt: startOfToday },
        stage: { notIn: ["DELIVERED", CONVERTED_READY_STAGE] },
      });
    }

    // Active workshop jobs only — excludes finished/cancelled so the board's
    // page budget isn't consumed by historical orders.
    if (openOnly) {
      and.push({ stage: { notIn: ["DELIVERED", CONVERTED_READY_STAGE, "CANCELLED"] } });
    }

    if (dueBefore) and.push({ dueDate: { lte: dueBefore } });
    if (dueAfter) and.push({ dueDate: { gte: dueAfter } });

    const where: Prisma.JobOrderWhereInput = and.length > 0 ? { AND: and } : {};

    const [total, rows] = await Promise.all([
      prisma.jobOrder.count({ where }),
      prisma.jobOrder.findMany({
        where,
        orderBy: { dueDate: "asc" },
        skip,
        take,
        include: {
          customer: { select: { id: true, name: true, mobile: true, code: true } },
          assignments: { include: { worker: { select: { id: true, name: true } } } },
          workStages: {
            orderBy: { sortOrder: "asc" },
            include: { worker: { select: { id: true, name: true } } },
          },
          materials: { include: { roll: { select: { id: true, rollCode: true, name: true, color: true, type: true } } } },
        },
      }),
    ]);

    res.status(200).json({
      success: true,
      data: { items: rows, meta: buildPaginatedMeta(total, pagination) },
    });
  }),
);

jobOrdersRouter.get(
  "/conversions",
  requirePermission("readyMade.view", "jobProcess.view", "invoices.view"),
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const { page, limit } = parsePageLimit(q, { defaultLimit: 40, maxLimit: 200 });
    const pagination = { page, limit };
    const { skip, take } = prismaSkipTake(pagination);
    const from = parseOptionalDate(q, "from");
    const to = parseOptionalDate(q, "to");
    const model = queryParamString(q, "model")?.trim();
    const customer = queryParamString(q, "customer")?.trim();
    const saleStatus = queryParamString(q, "saleStatus")?.trim().toLowerCase(); // all | available | sold

    const where: Prisma.ConversionLogWhereInput = {
      ...(from || to ? { convertedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      ...(model ? { model: { contains: model } } : {}),
      ...(customer ? { customerName: { contains: customer } } : {}),
      ...(saleStatus === "sold"
        ? { readyProduct: { invoiceItems: { some: { invoice: { isVoid: false } } } } }
        : saleStatus === "available"
          ? { readyProduct: { invoiceItems: { none: { invoice: { isVoid: false } } } } }
          : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.conversionLog.count({ where }),
      prisma.conversionLog.findMany({
        where,
        orderBy: { convertedAt: "desc" },
        skip,
        take,
        include: {
          invoice: { select: { id: true, invoiceNo: true } },
          job: { select: { id: true, jobNo: true, stage: true, isConvertedToReady: true } },
          readyProduct: { select: { id: true, sku: true, name: true, stockQty: true, isActive: true } },
        },
      }),
    ]);

    const soldItems = rows.length
      ? await prisma.invoiceItem.findMany({
          where: {
            productId: { in: rows.map((r) => r.readyProductId) },
            invoice: { isVoid: false },
          },
          select: {
            productId: true,
            invoice: { select: { id: true, invoiceNo: true, createdAt: true } },
          },
          orderBy: { invoice: { createdAt: "asc" } },
        })
      : [];

    const soldByProduct = new Map<
      string,
      { sold: true; soldAt: string; soldInvoiceId: string; soldInvoiceNo: number }
    >();
    for (const it of soldItems) {
      if (soldByProduct.has(it.productId)) continue;
      soldByProduct.set(it.productId, {
        sold: true,
        soldAt: it.invoice.createdAt.toISOString(),
        soldInvoiceId: it.invoice.id,
        soldInvoiceNo: it.invoice.invoiceNo,
      });
    }

    const items = rows.map((r) => {
      const soldInfo = soldByProduct.get(r.readyProductId);
      return {
        ...r,
        saleStatus: soldInfo ? "SOLD" : "AVAILABLE",
        soldAt: soldInfo?.soldAt ?? null,
        soldInvoiceId: soldInfo?.soldInvoiceId ?? null,
        soldInvoiceNo: soldInfo?.soldInvoiceNo ?? null,
      };
    });

    res.status(200).json({
      success: true,
      data: {
        items,
        meta: buildPaginatedMeta(total, pagination),
        summary: {
          convertedCount: total,
          availableCount: items.filter((i) => i.saleStatus === "AVAILABLE").length,
          soldCount: items.filter((i) => i.saleStatus === "SOLD").length,
        },
      },
    });
  }),
);

const materialSchema = z.object({
  rollId: z.string(),
  meters: z.number().positive(),
});

const assignmentSchema = z.object({
  workerId: z.string(),
  workType: z.string().min(1),
});

const createBody = z.object({
  customerId: z.string(),
  productId: z.string().optional(),
  productStyle: z.string().min(1),
  stage: z.string().optional(),
  priority: z.string().optional(),
  dueDate: z.string().datetime(),
  fabricSource: z.string().optional(),
  measurements: z.string().optional(),
  notes: z.string().optional(),
  costFils: z.number().int().min(0),
  totalFils: z.number().int().min(0),
  paidFils: z.number().int().min(0),
  materials: z.array(materialSchema).default([]),
  assignments: z.array(assignmentSchema).default([]),
  abayaTypeId: z.string().optional(),
  abayaModelId: z.string().optional(),
  customStyleText: z.string().optional().nullable(),
});

jobOrdersRouter.post(
  "/",
  requireAllPermissions("invoices.create", "pos.tailoring"),
  validateBody(createBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createBody>;
    const userId = req.user?.id;
    if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

    const balanceFils = body.totalFils - body.paidFils;
    const jobNo = await nextJobNo(prisma);

    const settingsRows = await prisma.setting.findMany();
    const settingsMap = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));
    const wageDefaults = parseWageDefaults(settingsMap);

    const job = await prisma.$transaction(async (tx) => {
      const productRow = body.productId
        ? await tx.product.findUnique({ where: { id: body.productId } })
        : null;
      if (body.productId && !productRow) {
        throw new AppError(400, "Product not found", "NOT_FOUND");
      }

      let pipelineKeys = resolvePipelineStageKeysFromModelJson(null);
      if (body.abayaModelId) {
        const am = await tx.abayaModel.findUnique({ where: { id: body.abayaModelId } });
        if (am) pipelineKeys = resolvePipelineStageKeysFromModelJson(am.workflowStagesJson);
      }

      const initialStage = productRow ? initialPipelineStage(pipelineKeys) : (body.stage ?? "NEW");

      const j = await tx.jobOrder.create({
        data: {
          jobNo,
          customerId: body.customerId,
          productId: productRow?.id,
          productStyle: body.productStyle.trim(),
          stage: initialStage,
          priority: body.priority ?? "NORMAL",
          dueDate: new Date(body.dueDate),
          fabricSource: body.fabricSource ?? "STOCK",
          measurements: body.measurements,
          notes: body.notes?.trim(),
          costFils: body.costFils,
          totalFils: body.totalFils,
          paidFils: body.paidFils,
          balanceFils,
          isPaid: balanceFils <= 0,
          deliveredAt: initialStage === "DELIVERED" ? new Date() : null,
          ...(body.abayaTypeId ? { abayaTypeId: body.abayaTypeId } : {}),
          ...(body.abayaModelId ? { abayaModelId: body.abayaModelId } : {}),
          ...(body.customStyleText?.trim() ? { customStyleText: body.customStyleText.trim() } : {}),
        },
      });

      if (productRow) {
        await createPipelineRowsForJob(tx, j.id, productRow, wageDefaults, pipelineKeys);
      }

      await tx.jobStageLog.create({
        data: {
          jobOrderId: j.id,
          stage: j.stage,
          changedById: userId,
          notes: "Created",
        },
      });

      for (const m of body.materials) {
        const materialCostFils = await reserveFabricForMaterial(tx, m.rollId, m.meters);
        await tx.jobOrderMaterial.create({
          data: {
            jobOrderId: j.id,
            rollId: m.rollId,
            meters: m.meters,
            materialCostFils,
            fabricDeducted: false,
          },
        });
      }

      if (!productRow) {
        for (const a of body.assignments) {
          await tx.jobAssignment.create({
            data: {
              jobOrderId: j.id,
              workerId: a.workerId,
              workType: a.workType,
            },
          });
        }
      }

      if (balanceFils > 0) {
        await tx.customer.update({
          where: { id: body.customerId },
          data: { balanceFils: { increment: balanceFils } },
        });
      }

      return tx.jobOrder.findUnique({
        where: { id: j.id },
        include: {
          customer: true,
          product: true,
          materials: { include: { roll: true } },
          assignments: { include: { worker: true } },
          workStages: {
            orderBy: { sortOrder: "asc" },
            include: { worker: { select: { id: true, name: true, phone: true } } },
          },
        },
      });
    });

    res.status(201).json({ success: true, data: job });
  }),
);

const addAssignmentBody = z.object({
  workerId: z.string(),
  workType: z.string().min(1),
});

jobOrdersRouter.post(
  "/:id/assignments",
  requirePermission("jobProcess.assignWorkers"),
  validateBody(addAssignmentBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof addAssignmentBody>;
    const jobId = req.params.id;
    const job = await prisma.jobOrder.findUnique({ where: { id: jobId } });
    if (!job) throw new AppError(404, "Job order not found", "NOT_FOUND");

    const row = await prisma.jobAssignment.create({
      data: {
        jobOrderId: job.id,
        workerId: body.workerId,
        workType: body.workType.trim(),
      },
      include: { worker: { select: { id: true, name: true, phone: true } } },
    });

    res.status(201).json({ success: true, data: row });
  }),
);

jobOrdersRouter.delete(
  "/:id/assignments/:assignmentId",
  requirePermission("jobProcess.assignWorkers"),
  asyncHandler(async (req, res) => {
    const jobId = req.params.id;
    const assignmentId = req.params.assignmentId;
    const existing = await prisma.jobAssignment.findFirst({
      where: { id: assignmentId, jobOrderId: jobId },
    });
    if (!existing) throw new AppError(404, "Assignment not found", "NOT_FOUND");
    await prisma.jobAssignment.delete({ where: { id: assignmentId } });
    res.status(200).json({ success: true, data: { deleted: true } });
  }),
);

const assignStageBody = z.object({
  workerId: z.string().min(1),
  wageFils: z.number().int().min(0).optional(),
  notes: z.string().optional(),
});

const completeStageBody = z.object({
  completedAt: z.string().datetime().optional(),
  notes: z.string().optional(),
});

/** Single request: assign default worker + complete when PENDING, or complete when IN_PROGRESS (invoice job process). */
const completeOneClickBody = z.object({
  workerId: z.string().optional(),
  wageFils: z.number().int().min(0).optional(),
  /** Parsed with `new Date()` in handler — avoids strict Zod datetime rejecting some clients. */
  completedAt: z.string().optional(),
  notes: z.string().optional(),
});

const initPipelineBody = z.object({
  productId: z.string().min(1),
});

jobOrdersRouter.post(
  "/:id/work-stages/:stageKey/assign",
  requirePermission("jobProcess.assignWorkers"),
  validateBody(assignStageBody),
  asyncHandler(async (req, res) => {
    const jobId = req.params.id;
    const stageKey = req.params.stageKey;
    if (!jobId || !stageKey) {
      throw new AppError(400, "Missing job or stage", "VALIDATION_ERROR");
    }
    const pipelineKeys = PIPELINE_STAGE_KEYS as readonly string[];
    if (!pipelineKeys.includes(stageKey)) {
      throw new AppError(400, "Invalid stage", "VALIDATION_ERROR");
    }
    const userId = req.user?.id;
    if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    const body = req.body as z.infer<typeof assignStageBody>;
    const perms = req.user?.permissions ?? [];
    const canEditWage = perms.includes("jobProcess.editWage") || perms.includes("jobProcess.adminEdit");

    const settingsRows = await prisma.setting.findMany();
    const settingsMap = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));
    const wageDefaults = parseWageDefaults(settingsMap);

    const job = await prisma.jobOrder.findUnique({
      where: { id: jobId },
      include: {
        workStages: { orderBy: { sortOrder: "asc" } },
        product: true,
      },
    });
    if (!job) throw new AppError(404, "Job order not found", "NOT_FOUND");
    if (job.workStages.length === 0) {
      throw new AppError(400, "This job has no automatic pipeline stages", "NO_PIPELINE");
    }
    if (job.stage !== stageKey) {
      throw new AppError(400, "Assign worker only for the current active stage", "WRONG_STAGE");
    }

    const row = job.workStages.find((s) => s.stageKey === stageKey);
    if (!row) throw new AppError(404, "Stage not found", "NOT_FOUND");
    if (row.status === "DONE") {
      throw new AppError(400, "Stage already completed", "ALREADY_DONE");
    }
    if (row.status === "IN_PROGRESS") {
      throw new AppError(400, "Worker already assigned — complete or contact admin", "ALREADY_ASSIGNED");
    }

    const worker = await prisma.worker.findUnique({ where: { id: body.workerId } });
    if (!worker) throw new AppError(404, "Worker not found", "NOT_FOUND");

    const baseWage = wageForPipelineStage(stageKey, job.product, wageDefaults);
    if (body.wageFils !== undefined && !canEditWage && body.wageFils !== baseWage) {
      throw new AppError(403, "لا يمكن تعديل أجر المرحلة بدون صلاحية تعديل الأجور", "FORBIDDEN");
    }
    const wageFils = body.wageFils !== undefined && canEditWage ? body.wageFils : baseWage;
    const notesLine = body.notes?.trim();

    const updated = await prisma.$transaction(async (tx) => {
      const ws = await tx.jobOrderWorkStage.update({
        where: { id: row.id },
        data: {
          workerId: worker.id,
          wageFils,
          status: "IN_PROGRESS",
          assignedAt: new Date(),
          workerNameSnapshot: worker.name,
          notes: notesLine ?? undefined,
        },
        include: { worker: { select: { id: true, name: true, phone: true } } },
      });

      await tx.jobStageLog.create({
        data: {
          jobOrderId: job.id,
          stage: stageKey,
          changedById: userId,
          notes: `Worker assigned: ${worker.name} (${(wageFils / 100).toFixed(2)} AED)`,
        },
      });

      return ws;
    });

    res.status(200).json({ success: true, data: updated });
  }),
);

jobOrdersRouter.post(
  "/:id/work-stages/:stageKey/complete",
  requirePermission("jobProcess.complete"),
  validateBody(completeStageBody),
  asyncHandler(async (req, res) => {
    const jobId = req.params.id;
    const stageKey = req.params.stageKey;
    if (!jobId || !stageKey) {
      throw new AppError(400, "Missing job or stage", "VALIDATION_ERROR");
    }
    const pipelineKeys = PIPELINE_STAGE_KEYS as readonly string[];
    if (!pipelineKeys.includes(stageKey)) {
      throw new AppError(400, "Invalid stage", "VALIDATION_ERROR");
    }
    const userId = req.user?.id;
    if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    const body = req.body as z.infer<typeof completeStageBody>;

    const existing = await prisma.jobOrder.findUnique({
      where: { id: jobId },
      include: {
        workStages: true,
        product: true,
        customer: { select: { name: true } },
        productionBatch: {
          select: {
            type: true,
            color: true,
            model: { select: { code: true, name: true } },
            fabric: { select: { name: true, color: true } },
          },
        },
      },
    });
    if (!existing) throw new AppError(404, "Job order not found", "NOT_FOUND");
    if (existing.workStages.length === 0) {
      throw new AppError(400, "This job has no automatic pipeline stages", "NO_PIPELINE");
    }
    if (existing.stage !== stageKey) {
      throw new AppError(400, "Complete only the current active stage", "WRONG_STAGE");
    }

    const row = existing.workStages.find((s) => s.stageKey === stageKey);
    if (!row) throw new AppError(404, "Stage not found", "NOT_FOUND");
    if (row.status !== "IN_PROGRESS" || !row.workerId) {
      throw new AppError(400, "Assign a worker before completing this stage", "NOT_READY");
    }

    const orderedKeys = orderedPipelineKeys(existing.workStages);
    const nextStage = nextStageAfterComplete(stageKey, orderedKeys);
    const completedAt = body.completedAt ? new Date(body.completedAt) : new Date();
    const mergedNotes =
      body.notes !== undefined ? (body.notes.trim() ? body.notes.trim() : null) : row.notes;

    const data = await prisma.$transaction(async (tx) => {
      const pe = await tx.productionEntry.create({
        data: {
          workerId: row.workerId!,
          jobOrderId: existing.id,
          workType: stageKey,
          qty: 1,
          rateFils: row.wageFils,
          totalFils: row.wageFils,
          notes: mergedNotes ?? `Stage ${stageKey}`,
          date: completedAt,
        },
      });

      await tx.jobOrderWorkStage.update({
        where: { id: row.id },
        data: {
          status: "DONE",
          isCompleted: true,
          completedAt,
          notes: mergedNotes ?? undefined,
          productionEntryId: pe.id,
        },
      });

      await deductFabricOnCuttingComplete(tx, {
        jobOrderId: existing.id,
        jobNo: existing.jobNo,
        stageKey,
      });

      if (
        nextStage === "READY" &&
        existing.productionBatchId &&
        existing.productionBatch?.type !== "SAMPLE" &&
        existing.productId &&
        !existing.productionStockAddedAt
      ) {
        await tx.product.update({
          where: { id: existing.productId },
          data: { stockQty: { increment: 1 } },
        });
      }
      const isDisplaySampleCompleted = nextStage === "READY" && existing.productionBatch?.type === "SAMPLE";
      const finalStage = nextStage;

      const j = await tx.jobOrder.update({
        where: { id: existing.id },
        data: {
          stage: finalStage,
          ...(nextStage === "READY" &&
          existing.productionBatchId &&
          existing.productionBatch?.type !== "SAMPLE" &&
          existing.productId &&
          !existing.productionStockAddedAt
            ? { productionStockAddedAt: new Date() }
            : {}),
        },
      });

      if (isDisplaySampleCompleted) {
        await markDisplaySampleActive({
          tx,
          job: {
            id: existing.id,
            jobNo: existing.jobNo,
            abayaModelId: existing.abayaModelId,
            productionBatch: existing.productionBatch,
          },
        });
      }

      await tx.jobStageLog.create({
        data: {
          jobOrderId: existing.id,
          stage: finalStage,
          changedById: userId,
          notes: `Stage ${stageKey} marked done → ${finalStage}`,
        },
      });

      return tx.jobOrder.findUnique({
        where: { id: j.id },
        include: {
          customer: true,
          product: true,
          materials: { include: { roll: true } },
          assignments: { include: { worker: true } },
          workStages: {
            orderBy: { sortOrder: "asc" },
            include: { worker: { select: { id: true, name: true, phone: true } } },
          },
          stages: {
            orderBy: { createdAt: "desc" },
            take: 20,
            include: { changedBy: { select: { id: true, name: true, username: true } } },
          },
        },
      });
    });

    res.status(200).json({ success: true, data });
  }),
);

jobOrdersRouter.post(
  "/:id/work-stages/:stageKey/complete-one-click",
  requirePermission("jobProcess.complete"),
  validateBody(completeOneClickBody),
  asyncHandler(async (req, res) => {
    const jobId = req.params.id;
    const stageKey = req.params.stageKey;
    if (!jobId || !stageKey) {
      throw new AppError(400, "Missing job or stage", "VALIDATION_ERROR");
    }
    const pipelineKeys = PIPELINE_STAGE_KEYS as readonly string[];
    if (!pipelineKeys.includes(stageKey)) {
      throw new AppError(400, "Invalid stage", "VALIDATION_ERROR");
    }
    const userId = req.user?.id;
    if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    const body = req.body as z.infer<typeof completeOneClickBody>;
    const perms = req.user?.permissions ?? [];
    const canEditWage = perms.includes("jobProcess.editWage") || perms.includes("jobProcess.adminEdit");
    const clientWageOverride = canEditWage ? body.wageFils : undefined;

    const settingsRows = await prisma.setting.findMany();
    const settingsMap = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));
    const wageDefaults = parseWageDefaults(settingsMap);

    const existing = await prisma.jobOrder.findUnique({
      where: { id: jobId },
      include: {
        workStages: true,
        product: true,
        customer: { select: { name: true } },
        productionBatch: {
          select: {
            type: true,
            color: true,
            model: { select: { code: true, name: true } },
            fabric: { select: { name: true, color: true } },
          },
        },
      },
    });
    if (!existing) throw new AppError(404, "Job order not found", "NOT_FOUND");
    if (existing.workStages.length === 0) {
      throw new AppError(400, "This job has no automatic pipeline stages", "NO_PIPELINE");
    }
    if (existing.stage !== stageKey) {
      throw new AppError(400, "Complete only the current active stage", "WRONG_STAGE");
    }

    const row = existing.workStages.find((s) => s.stageKey === stageKey);
    if (!row) throw new AppError(404, "Stage not found", "NOT_FOUND");
    if (row.status === "DONE") {
      throw new AppError(400, "Stage already completed", "ALREADY_DONE");
    }

    const orderedKeys = orderedPipelineKeys(existing.workStages);
    const nextStage = nextStageAfterComplete(stageKey, orderedKeys);

    let completedAt = new Date();
    if (body.completedAt) {
      const parsed = new Date(body.completedAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new AppError(400, "Invalid completedAt", "VALIDATION_ERROR");
      }
      completedAt = parsed;
    }

    const resolvedWorkerId = (body.workerId?.trim() || row.workerId?.trim() || "").trim();
    if (row.status === "PENDING" && !resolvedWorkerId) {
      throw new AppError(400, "Please select a worker first", "WORKER_REQUIRED");
    }

    const data = await prisma.$transaction(async (tx) => {
      let effectiveRow = row;
      let mergedNotes =
        body.notes !== undefined ? (body.notes.trim() ? body.notes.trim() : null) : row.notes;

      if (row.status === "PENDING") {
        const worker = await tx.worker.findUnique({ where: { id: resolvedWorkerId } });
        if (!worker) throw new AppError(404, "Worker not found", "NOT_FOUND");

        const baseWage = wageForPipelineStage(stageKey, existing.product, wageDefaults);
        const wageFils =
          clientWageOverride !== undefined
            ? clientWageOverride
            : row.wageFils > 0
              ? row.wageFils
              : baseWage;
        const notesLine = mergedNotes?.trim();

        effectiveRow = await tx.jobOrderWorkStage.update({
          where: { id: row.id },
          data: {
            workerId: worker.id,
            wageFils,
            status: "IN_PROGRESS",
            assignedAt: new Date(),
            workerNameSnapshot: worker.name,
            notes: notesLine ?? undefined,
          },
          include: { worker: { select: { id: true, name: true, phone: true } } },
        });

        await tx.jobStageLog.create({
          data: {
            jobOrderId: existing.id,
            stage: stageKey,
            changedById: userId,
            notes: `Worker assigned: ${worker.name} (${(wageFils / 100).toFixed(2)} AED)`,
          },
        });
      } else if (row.status === "IN_PROGRESS") {
        if (!row.workerId) {
          throw new AppError(400, "Please select a worker first", "NOT_READY");
        }
        mergedNotes =
          body.notes !== undefined ? (body.notes.trim() ? body.notes.trim() : null) : row.notes;
      } else {
        throw new AppError(400, "Stage cannot be completed from this state", "INVALID_STATE");
      }

      const pe = await tx.productionEntry.create({
        data: {
          workerId: effectiveRow.workerId!,
          jobOrderId: existing.id,
          workType: stageKey,
          qty: 1,
          rateFils: effectiveRow.wageFils,
          totalFils: effectiveRow.wageFils,
          notes: mergedNotes ?? `Stage ${stageKey}`,
          date: completedAt,
        },
      });

      await tx.jobOrderWorkStage.update({
        where: { id: row.id },
        data: {
          status: "DONE",
          isCompleted: true,
          completedAt,
          notes: mergedNotes ?? undefined,
          productionEntryId: pe.id,
        },
      });

      await deductFabricOnCuttingComplete(tx, {
        jobOrderId: existing.id,
        jobNo: existing.jobNo,
        stageKey,
      });

      if (
        nextStage === "READY" &&
        existing.productionBatchId &&
        existing.productionBatch?.type !== "SAMPLE" &&
        existing.productId &&
        !existing.productionStockAddedAt
      ) {
        await tx.product.update({
          where: { id: existing.productId },
          data: { stockQty: { increment: 1 } },
        });
      }
      const isDisplaySampleCompleted = nextStage === "READY" && existing.productionBatch?.type === "SAMPLE";
      const finalStage = nextStage;

      const j = await tx.jobOrder.update({
        where: { id: existing.id },
        data: {
          stage: finalStage,
          ...(nextStage === "READY" &&
          existing.productionBatchId &&
          existing.productionBatch?.type !== "SAMPLE" &&
          existing.productId &&
          !existing.productionStockAddedAt
            ? { productionStockAddedAt: new Date() }
            : {}),
        },
      });

      if (isDisplaySampleCompleted) {
        await markDisplaySampleActive({
          tx,
          job: {
            id: existing.id,
            jobNo: existing.jobNo,
            abayaModelId: existing.abayaModelId,
            productionBatch: existing.productionBatch,
          },
        });
      }

      await tx.jobStageLog.create({
        data: {
          jobOrderId: existing.id,
          stage: finalStage,
          changedById: userId,
          notes: `Stage ${stageKey} marked done → ${finalStage}`,
        },
      });

      return tx.jobOrder.findUnique({
        where: { id: j.id },
        include: {
          customer: true,
          product: true,
          materials: { include: { roll: true } },
          assignments: { include: { worker: true } },
          workStages: {
            orderBy: { sortOrder: "asc" },
            include: { worker: { select: { id: true, name: true, phone: true } } },
          },
          stages: {
            orderBy: { createdAt: "desc" },
            take: 20,
            include: { changedBy: { select: { id: true, name: true, username: true } } },
          },
        },
      });
    });

    res.status(200).json({ success: true, data });
  }),
);

jobOrdersRouter.patch(
  "/:id/work-stages/:stageKey",
  requirePermission("jobProcess.update", "jobProcess.assignWorkers", "jobProcess.adminEdit"),
  validateBody(patchWorkStageBody),
  asyncHandler(patchWorkStageHandler),
);

/** Resolve work stage by row id (cuid) — same body as PATCH …/work-stages/:stageKey; supports `wage` in AED. */
jobOrdersRouter.patch(
  "/work-stages/by-id/:workStageId",
  requirePermission("jobProcess.update", "jobProcess.assignWorkers", "jobProcess.adminEdit"),
  validateBody(patchWorkStageBodyWithOptionalWageAed),
  asyncHandler(async (req, res) => {
    const { workStageId } = req.params;
    if (!workStageId) throw new AppError(400, "Missing work stage id", "VALIDATION_ERROR");
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

jobOrdersRouter.post(
  "/:id/work-stages/:stageKey/reopen",
  requirePermission("jobProcess.adminEdit", "jobProcess.reopenStage"),
  asyncHandler(async (req, res) => {
    const jobId = req.params.id;
    const stageKey = req.params.stageKey;
    if (!jobId || !stageKey) throw new AppError(400, "Missing job or stage", "VALIDATION_ERROR");
    const userId = req.user?.id;
    if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

    const pipelineKeys = PIPELINE_STAGE_KEYS as readonly string[];
    if (!pipelineKeys.includes(stageKey)) throw new AppError(400, "Invalid stage", "VALIDATION_ERROR");

    const job = await prisma.jobOrder.findUnique({
      where: { id: jobId },
      include: { workStages: { orderBy: { sortOrder: "asc" } } },
    });
    if (!job) throw new AppError(404, "Job order not found", "NOT_FOUND");
    const orderedKeys = orderedPipelineKeys(job.workStages);
    const row = job.workStages.find((s) => s.stageKey === stageKey);
    if (!row) throw new AppError(404, "Stage not found", "NOT_FOUND");
    if (row.status !== "DONE") throw new AppError(400, "Stage is not completed", "NOT_DONE");

    const idx = orderedKeys.indexOf(stageKey);
    const laterDone = job.workStages.some((s) => {
      const j = orderedKeys.indexOf(s.stageKey);
      return j > idx && s.status === "DONE";
    });
    if (laterDone) {
      throw new AppError(400, "Reopen later stages before this one", "INVALID_ORDER");
    }

    const data = await prisma.$transaction(async (tx) => {
      if (row.productionEntryId) {
        await tx.productionEntry.delete({ where: { id: row.productionEntryId } });
      }
      await tx.jobOrderWorkStage.update({
        where: { id: row.id },
        data: {
          status: "IN_PROGRESS",
          isCompleted: false,
          completedAt: null,
          productionEntryId: null,
        },
      });
      await restoreFabricOnCuttingReopen(tx, {
        jobOrderId: job.id,
        jobNo: job.jobNo,
        stageKey,
      });
      await tx.jobOrder.update({
        where: { id: job.id },
        data: { stage: stageKey },
      });
      await tx.jobStageLog.create({
        data: {
          jobOrderId: job.id,
          stage: stageKey,
          changedById: userId,
          notes: `Stage ${stageKey} reopened for correction`,
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: "STAGE_REOPEN",
          entity: "JobOrder",
          entityId: job.id,
          oldValue: JSON.stringify({ stage: stageKey, status: "DONE" }),
          newValue: JSON.stringify({ stage: stageKey, status: "IN_PROGRESS", jobNo: job.jobNo }),
        },
      });
      return tx.jobOrder.findUnique({
        where: { id: job.id },
        include: {
          customer: true,
          product: true,
          materials: { include: { roll: true } },
          assignments: { include: { worker: true } },
          workStages: {
            orderBy: { sortOrder: "asc" },
            include: { worker: { select: { id: true, name: true, phone: true } } },
          },
          stages: {
            orderBy: { createdAt: "desc" },
            take: 20,
            include: { changedBy: { select: { id: true, name: true, username: true } } },
          },
        },
      });
    });

    res.status(200).json({ success: true, data });
  }),
);

jobOrdersRouter.post(
  "/:id/init-pipeline",
  requirePermission("jobProcess.update"),
  validateBody(initPipelineBody),
  asyncHandler(async (req, res) => {
    const jobId = req.params.id;
    const userId = req.user?.id;
    if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    const perms = req.user?.permissions ?? [];
    if (isWorkshopSupervisorRestricted(perms)) {
      throw new AppError(403, "هذا الدور لا يسمح بتهيئة مسار المراحل", "FORBIDDEN");
    }
    const body = req.body as z.infer<typeof initPipelineBody>;

    const settingsRows = await prisma.setting.findMany();
    const settingsMap = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));
    const wageDefaults = parseWageDefaults(settingsMap);

    const data = await prisma.$transaction(async (tx) => {
      const job = await tx.jobOrder.findUnique({
        where: { id: jobId },
        include: { workStages: true },
      });
      if (!job) throw new AppError(404, "Job order not found", "NOT_FOUND");
      if (job.workStages.length > 0) {
        throw new AppError(400, "Job already has pipeline stages", "ALREADY_EXISTS");
      }
      const productRow = await tx.product.findUnique({ where: { id: body.productId } });
      if (!productRow) throw new AppError(404, "Product not found", "NOT_FOUND");

      let pipelineKeys = resolvePipelineStageKeysFromModelJson(null);
      if (job.abayaModelId) {
        const am = await tx.abayaModel.findUnique({ where: { id: job.abayaModelId } });
        if (am) pipelineKeys = resolvePipelineStageKeysFromModelJson(am.workflowStagesJson);
      }
      await createPipelineRowsForJob(tx, job.id, productRow, wageDefaults, pipelineKeys);
      const stage0 = initialPipelineStage(pipelineKeys);
      const j = await tx.jobOrder.update({
        where: { id: job.id },
        data: { productId: productRow.id, stage: stage0 },
      });
      await tx.jobStageLog.create({
        data: {
          jobOrderId: j.id,
          stage: stage0,
          changedById: userId,
          notes: `Pipeline linked to product ${productRow.name}`,
        },
      });
      return tx.jobOrder.findUnique({
        where: { id: j.id },
        include: {
          customer: true,
          product: true,
          materials: { include: { roll: true } },
          assignments: { include: { worker: true } },
          workStages: {
            orderBy: { sortOrder: "asc" },
            include: { worker: { select: { id: true, name: true, phone: true } } },
          },
          stages: {
            orderBy: { createdAt: "desc" },
            take: 20,
            include: { changedBy: { select: { id: true, name: true, username: true } } },
          },
        },
      });
    });

    res.status(200).json({ success: true, data });
  }),
);

jobOrdersRouter.get(
  "/:id",
  requirePermission("jobProcess.view"),
  asyncHandler(async (req, res) => {
    const job = await prisma.jobOrder.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        product: true,
        invoice: {
          select: {
            id: true,
            invoiceNo: true,
            totalFils: true,
            paidFils: true,
            balanceFils: true,
            createdAt: true,
          },
        },
        invoiceItem: { select: { id: true, description: true, totalFils: true } },
        measurement: true,
        materials: { include: { roll: true } },
        assignments: { include: { worker: true } },
        workStages: {
          orderBy: { sortOrder: "asc" },
          include: { worker: { select: { id: true, name: true, phone: true } } },
        },
        stages: {
          orderBy: { createdAt: "desc" },
          take: 100,
          include: { changedBy: { select: { id: true, name: true, username: true } } },
        },
      },
    });
    if (!job) throw new AppError(404, "Job order not found", "NOT_FOUND");

    const productionEntries = await prisma.productionEntry.findMany({
      where: { jobOrderId: req.params.id },
      include: { worker: { select: { id: true, name: true } } },
      orderBy: { date: "desc" },
    });
    const laborCostFils = productionEntries.reduce((a, e) => a + e.totalFils, 0);

    // Phase 3 F1: real cost breakdown
    const fabricCostFils = job.materials.reduce((a, m) => a + (m.materialCostFils ?? 0), 0);
    const totalCostFils = fabricCostFils + laborCostFils;
    const salePriceFils = job.totalFils;
    const grossMarginFils = salePriceFils - totalCostFils;
    const marginPercent = salePriceFils > 0 ? (grossMarginFils / salePriceFils) * 100 : 0;

    const costBreakdown = {
      fabricCostFils,
      laborCostFils,
      totalCostFils,
      salePriceFils,
      grossMarginFils,
      marginPercent,
      fabricLines: job.materials.map((m) => ({
        materialId: m.id,
        rollCode: m.roll.rollCode,
        rollName: m.roll.name,
        meters: m.meters,
        costPerMeterFils: m.roll.costPerMeter ?? 0,
        materialCostFils: m.materialCostFils ?? 0,
      })),
      laborLines: productionEntries.map((e) => ({
        entryId: e.id,
        workerName: e.worker?.name ?? "—",
        workType: e.workType,
        qty: e.qty,
        totalFils: e.totalFils,
      })),
    };

    const data = {
      ...job,
      productionEntries,
      laborCostFils,
      totalCostFils,
      costBreakdown,
    };
    res.status(200).json({
      success: true,
      data: isWorkerRequest(req)
        ? redactJobOrderDetailForWorker(data as unknown as Record<string, unknown>)
        : data,
    });
  }),
);

const patchMaterialBody = z
  .object({
    rollId: z.string().optional(),
    meters: z.number().positive().optional(),
  })
  .refine((d) => d.rollId !== undefined || d.meters !== undefined, {
    message: "Provide rollId and/or meters",
  });

jobOrdersRouter.post(
  "/:id/mark-ready",
  requirePermission("jobProcess.markReady"),
  asyncHandler(async (req, res) => {
    const jobId = req.params.id;
    const userId = req.user?.id;
    if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

    const job = await prisma.jobOrder.findUnique({ where: { id: jobId } });
    if (!job) throw new AppError(404, "Job order not found", "NOT_FOUND");

    const blocked = ["READY", "DELIVERED", "CANCELLED", CONVERTED_READY_STAGE];
    if (blocked.includes(job.stage)) {
      throw new AppError(400, "لا يمكن تحويل الطلب في هذه الحالة", "INVALID_STATE");
    }

    await prisma.$transaction([
      prisma.jobOrder.update({
        where: { id: job.id },
        data: { stage: "READY" },
      }),
      prisma.jobStageLog.create({
        data: {
          jobOrderId: job.id,
          stage: "READY",
          changedById: userId,
          notes: "تم التحويل إلى جاهز يدوياً",
        },
      }),
    ]);

    res.status(200).json({ success: true });
  }),
);

const qaInspectBody = z.object({
  result: z.enum(["PASS", "FAIL"]),
  failReason: z.string().optional(),
  reopenStage: z.enum(["CUTTING", "SEWING", "EMBROIDERY", "FINISHING"]).optional(),
});

jobOrdersRouter.post(
  "/:id/qa-inspect",
  requirePermission("jobProcess.inspect"),
  validateBody(qaInspectBody),
  asyncHandler(async (req, res) => {
    const jobId = req.params.id;
    const userId = req.user?.id;
    if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    const body = req.body as z.infer<typeof qaInspectBody>;

    const job = await prisma.jobOrder.findUnique({ where: { id: jobId } });
    if (!job) throw new AppError(404, "Job order not found", "NOT_FOUND");
    if (job.stage !== "INSPECTION") {
      throw new AppError(400, "طلب العمل ليس في مرحلة فحص الجودة", "INVALID_STATE");
    }

    if (body.result === "PASS") {
      await prisma.$transaction([
        prisma.jobOrder.update({ where: { id: job.id }, data: { stage: "READY" } }),
        prisma.jobStageLog.create({
          data: { jobOrderId: job.id, stage: "READY", changedById: userId, notes: "تم اجتياز فحص الجودة ✓" },
        }),
        prisma.auditLog.create({
          data: {
            userId,
            action: "QA_PASSED",
            entity: "JobOrder",
            entityId: job.id,
            oldValue: JSON.stringify({ stage: "INSPECTION", jobNo: job.jobNo }),
            newValue: JSON.stringify({ stage: "READY", jobNo: job.jobNo }),
          },
        }),
      ]);
      return res.status(200).json({ success: true, stage: "READY" });
    }

    // FAIL — reopen specified stage
    const targetStage = body.reopenStage ?? "FINISHING";
    const failNote = body.failReason?.trim() || "رُفض في فحص الجودة";

    await prisma.$transaction(async (tx) => {
      // Reopen the target work stage
      const workStage = await tx.jobOrderWorkStage.findFirst({
        where: { jobOrderId: job.id, stageKey: targetStage },
      });
      if (workStage) {
        await tx.jobOrderWorkStage.update({
          where: { id: workStage.id },
          data: { status: "PENDING", completedAt: null },
        });
      }
      await tx.jobOrder.update({ where: { id: job.id }, data: { stage: targetStage } });
      await tx.jobStageLog.create({
        data: { jobOrderId: job.id, stage: targetStage, changedById: userId, notes: `QA فشل — ${failNote}` },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: "QA_FAILED",
          entity: "JobOrder",
          entityId: job.id,
          oldValue: JSON.stringify({ stage: "INSPECTION", jobNo: job.jobNo }),
          newValue: JSON.stringify({ stage: targetStage, failReason: failNote, jobNo: job.jobNo }),
        },
      });
    });

    return res.status(200).json({ success: true, stage: targetStage });
  }),
);

const cancelJobBody = z.object({
  reason: z.string().optional(),
});

const convertToReadyBody = z.object({
  notes: z.string().optional(),
  unclaimedDays: z.number().int().min(30).max(730).optional(),
});

jobOrdersRouter.post(
  "/:id/convert-to-ready",
  requirePermission("jobProcess.update", "jobProcess.adminEdit", "readyMade.create"),
  validateBody(convertToReadyBody),
  asyncHandler(async (req, res) => {
    const jobId = req.params.id;
    const userId = req.user?.id;
    if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    const body = req.body as z.infer<typeof convertToReadyBody>;

    const existing = await prisma.jobOrder.findUnique({
      where: { id: jobId },
      include: {
        customer: { select: { id: true, name: true } },
        invoice: { select: { id: true, invoiceNo: true, deliveredAt: true } },
        invoiceItem: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                nameAr: true,
                categoryId: true,
                costFils: true,
                priceFils: true,
              },
            },
          },
        },
        materials: {
          include: { roll: { select: { id: true, name: true, color: true, rollCode: true } } },
        },
      },
    });
    if (!existing) throw new AppError(404, "Job order not found", "NOT_FOUND");
    if (existing.deliveredAt || existing.stage === "DELIVERED") {
      throw new AppError(400, "Delivered item cannot be converted", "INVALID_STATE");
    }
    if (existing.stage === "CANCELLED") {
      throw new AppError(400, "Cancelled job cannot be converted", "INVALID_STATE");
    }
    if (existing.stage === CONVERTED_READY_STAGE) {
      throw new AppError(400, "Item already converted to ready stock", "ALREADY_DONE");
    }

    const now = new Date();
    const unclaimedDays = body.unclaimedDays ?? UNCLAIMED_DEFAULT_DAYS;
    const ageMs = now.getTime() - existing.createdAt.getTime();
    const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
    const isUnclaimed = !existing.deliveredAt && ageDays >= unclaimedDays;

    const model = trimSafe(existing.productStyle) || "Tailoring Piece";
    const firstMat = existing.materials[0];
    const fabric = firstMat?.roll?.name ?? "—";
    const color = firstMat?.roll?.color ?? "—";
    const sizeRaw = trimSafe(existing.measurements);
    const sizeLabel = sizeRaw.length > 120 ? `${sizeRaw.slice(0, 120)}…` : sizeRaw || "—";
    const extraNotes = trimSafe(body.notes) || trimSafe(existing.notes);

    const fallbackCategory = await prisma.productCategory.findFirst({
      where: { OR: [{ name: "Converted Tailoring" }, { name: "جاهز من التفصيل" }] },
      select: { id: true, name: true },
    });

    const categoryId =
      existing.invoiceItem?.product?.categoryId ??
      fallbackCategory?.id ??
      (
        await prisma.productCategory.create({
          data: { name: "Converted Tailoring", nameAr: "جاهز من التفصيل" },
          select: { id: true },
        })
      ).id;

    const readyProduct = await prisma.$transaction(async (tx) => {
      const sku = `CV-${existing.jobNo}-${Date.now().toString().slice(-6)}`;
      const product = await tx.product.create({
        data: {
          sku,
          name: model,
          nameAr: `محول من تفصيل #${existing.jobNo}`,
          categoryId,
          costFils: existing.invoiceItem?.unitFils ?? existing.costFils ?? 0,
          priceFils: existing.invoiceItem?.unitFils ?? existing.totalFils ?? 0,
          stockQty: 1,
          isActive: true,
          isService: false,
          createdFromInvoiceId: existing.invoice?.id ?? null,
          createdFromInvoiceNo: existing.invoice?.invoiceNo ?? null,
          createdFromJobId: existing.id,
          createdFromJobNo: existing.jobNo,
        },
      });

      const conversionNoteBits = [
        `Converted to ready stock product sku=${sku}`,
        `model=${model}`,
        `fabric=${fabric}`,
        `color=${color}`,
        `size=${sizeLabel}`,
        extraNotes ? `notes=${extraNotes}` : "",
        isUnclaimed ? `unclaimedDays=${ageDays}` : "",
      ].filter(Boolean);

      await tx.jobOrder.update({
        where: { id: existing.id },
        data: {
          stage: CONVERTED_READY_STAGE,
          isConvertedToReady: true,
          convertedAt: now,
          convertedReadyProductId: product.id,
          notes: [trimSafe(existing.notes), conversionNoteBits.join(" | ")].filter(Boolean).join("\n"),
        },
      });

      await tx.conversionLog.create({
        data: {
          invoiceId: existing.invoice?.id ?? null,
          jobId: existing.id,
          readyProductId: product.id,
          model,
          customerName: existing.customer.name,
          convertedAt: now,
          notes: extraNotes || null,
        },
      });

      await tx.jobStageLog.create({
        data: {
          jobOrderId: existing.id,
          stage: CONVERTED_READY_STAGE,
          changedById: userId,
          notes: `تم تحويل القطعة إلى جاهز${isUnclaimed ? ` (غير مستلمة منذ ${ageDays} يوم)` : ""}`,
        },
      });

      return product;
    });

    res.status(200).json({
      success: true,
      data: {
        converted: true,
        jobId: existing.id,
        jobNo: existing.jobNo,
        invoiceId: existing.invoice?.id ?? null,
        invoiceNo: existing.invoice?.invoiceNo ?? null,
        unclaimed: isUnclaimed,
        ageDays,
        readyProduct: {
          id: readyProduct.id,
          sku: readyProduct.sku,
          name: readyProduct.name,
          nameAr: readyProduct.nameAr,
          stockQty: readyProduct.stockQty,
        },
        convertedAt: now.toISOString(),
        copiedFields: {
          model,
          fabric,
          color,
          size: sizeLabel,
          notes: extraNotes || null,
        },
      },
    });
  }),
);

jobOrdersRouter.post(
  "/:id/cancel",
  requirePermission("jobProcess.adminEdit"),
  validateBody(cancelJobBody),
  asyncHandler(async (req, res) => {
    const jobId = req.params.id;
    const userId = req.user?.id;
    if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    const body = req.body as z.infer<typeof cancelJobBody>;

    const existing = await prisma.jobOrder.findUnique({
      where: { id: jobId },
      include: { workStages: true, materials: true },
    });
    if (!existing) throw new AppError(404, "Job order not found", "NOT_FOUND");
    if (existing.stage === "DELIVERED") {
      throw new AppError(400, "Cannot cancel a delivered job", "INVALID_STATE");
    }
    if (existing.stage === "CANCELLED") {
      throw new AppError(400, "Job already cancelled", "ALREADY_CANCELLED");
    }

    const data = await prisma.$transaction(async (tx) => {
      await restoreAllDeductedMaterialsForJob(tx, {
        jobOrderId: existing.id,
        jobNo: existing.jobNo,
        reason: "[CANCEL] job cancelled — fabric restored",
      });
      const j = await tx.jobOrder.update({
        where: { id: existing.id },
        data: { stage: "CANCELLED" },
      });
      await tx.jobStageLog.create({
        data: {
          jobOrderId: j.id,
          stage: "CANCELLED",
          changedById: userId,
          notes: body.reason?.trim() ?? "Job cancelled",
        },
      });
      return tx.jobOrder.findUnique({
        where: { id: j.id },
        include: {
          customer: true,
          product: true,
          materials: { include: { roll: true } },
          workStages: {
            orderBy: { sortOrder: "asc" },
            include: { worker: { select: { id: true, name: true, phone: true } } },
          },
        },
      });
    });

    res.status(200).json({ success: true, data });
  }),
);

jobOrdersRouter.patch(
  "/:id/materials/:materialId",
  requirePermission("jobProcess.update", "jobProcess.adminEdit"),
  validateBody(patchMaterialBody),
  asyncHandler(async (req, res) => {
    const jobId = req.params.id;
    const materialId = req.params.materialId as string;
    if (!materialId) throw new AppError(400, "Missing material id", "VALIDATION_ERROR");
    const userId = req.user?.id;
    if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    const body = req.body as z.infer<typeof patchMaterialBody>;
    const perms = req.user?.permissions ?? [];
    if (isWorkshopSupervisorRestricted(perms)) {
      throw new AppError(403, "هذا الدور لا يسمح بتعديل خامات القماش", "FORBIDDEN");
    }
    const canUpdate = perms.includes("jobProcess.update");
    const canAdmin = perms.includes("jobProcess.adminEdit");

    const existing = await prisma.jobOrder.findUnique({
      where: { id: jobId },
      include: { workStages: true, materials: true },
    });
    if (!existing) throw new AppError(404, "Job order not found", "NOT_FOUND");
    const m = existing.materials.find((x) => x.id === materialId);
    if (!m) throw new AppError(404, "Material line not found", "NOT_FOUND");

    const cuttingDone = isCuttingWorkStageDone(existing.workStages);
    if (cuttingDone && m.fabricDeducted && !canAdmin) {
      throw new AppError(403, "تعديل القماش بعد القص يتطلب صلاحية إدارية", "FORBIDDEN");
    }
    if (!(cuttingDone && m.fabricDeducted) && !canUpdate) {
      throw new AppError(403, "ليس لديك صلاحية لتحديث القماش", "FORBIDDEN");
    }

    const data = await prisma.$transaction(async (tx) => {
      await patchJobOrderMaterialFabric(tx, {
        materialId,
        jobOrderId: existing.id,
        jobNo: existing.jobNo,
        workStages: existing.workStages,
        body,
      });
      return tx.jobOrder.findUnique({
        where: { id: existing.id },
        include: {
          materials: { include: { roll: true } },
          workStages: {
            orderBy: { sortOrder: "asc" },
            include: { worker: { select: { id: true, name: true, phone: true } } },
          },
        },
      });
    });

    res.status(200).json({ success: true, data });
  }),
);

const patchBody = z.object({
  stage: z.string().optional(),
  priority: z.string().optional(),
  dueDate: z.string().datetime().optional(),
  notes: z.string().optional().nullable(),
  costFils: z.number().int().min(0).optional(),
  totalFils: z.number().int().min(0).optional(),
  paidFils: z.number().int().min(0).optional(),
  productStyle: z.string().min(1).optional(),
  measurements: z.string().optional().nullable(),
});

jobOrdersRouter.patch(
  "/:id",
  requirePermission("jobProcess.update"),
  validateBody(patchBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof patchBody>;
    const userId = req.user?.id;
    if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    const perms = req.user?.permissions ?? [];
    if (isWorkshopSupervisorRestricted(perms)) {
      throw new AppError(403, "هذا الدور لا يسمح بتعديل بيانات أو أسعار الطلب", "FORBIDDEN");
    }

    const existing = await prisma.jobOrder.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError(404, "Job order not found", "NOT_FOUND");

    const totalFils = body.totalFils ?? existing.totalFils;
    const paidFils = body.paidFils ?? existing.paidFils;
    const balanceFils = totalFils - paidFils;
    const paidDelta = paidFils - existing.paidFils;

    const nextStage = body.stage ?? existing.stage;
    let deliveredAt: Date | null | undefined;
    if (body.stage !== undefined) {
      deliveredAt = body.stage === "DELIVERED" ? new Date() : null;
    }

    const job = await prisma.$transaction(async (tx) => {
      const j = await tx.jobOrder.update({
        where: { id: existing.id },
        data: {
          stage: body.stage,
          priority: body.priority,
          dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
          notes: body.notes === null ? null : body.notes?.trim(),
          costFils: body.costFils,
          totalFils,
          paidFils,
          balanceFils,
          isPaid: balanceFils <= 0,
          productStyle: body.productStyle?.trim(),
          measurements: body.measurements === null ? null : body.measurements,
          ...(body.stage !== undefined ? { deliveredAt } : {}),
        },
      });

      if (!existing.invoiceId && paidDelta !== 0 && existing.customerId) {
        await tx.customer.update({
          where: { id: existing.customerId },
          data: { balanceFils: { decrement: paidDelta } },
        });
      }

      if (body.stage !== undefined && body.stage !== existing.stage) {
        await tx.jobStageLog.create({
          data: {
            jobOrderId: j.id,
            stage: nextStage,
            changedById: userId,
          },
        });
      }

      return tx.jobOrder.findUnique({
        where: { id: j.id },
        include: {
          customer: true,
          product: true,
          materials: { include: { roll: true } },
          assignments: { include: { worker: true } },
          workStages: {
            orderBy: { sortOrder: "asc" },
            include: { worker: { select: { id: true, name: true, phone: true } } },
          },
          stages: {
            orderBy: { createdAt: "desc" },
            take: 100,
            include: { changedBy: { select: { id: true, name: true, username: true } } },
          },
        },
      });
    });

    res.status(200).json({ success: true, data: job });
  }),
);
