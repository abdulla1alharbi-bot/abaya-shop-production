import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/rbac.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../middleware/error.middleware.js";
import { buildPaginatedMeta, prismaSkipTake } from "../../utils/pagination.js";
import { parseOptionalDate, parsePageLimit, queryParamString } from "../../utils/queryParams.js";
import {
  createPipelineRowsForJob,
  initialPipelineStage,
  parseWageDefaults,
  resolvePipelineStageKeysFromModelJson,
} from "../job-orders/jobStageHelpers.js";
import { reserveFabricForMaterial } from "../job-orders/fabricInventoryOnCutting.js";

export const productionRouter = Router();
productionRouter.use(authMiddleware);

const INTERNAL_CUSTOMER_MOBILE = "__internal_production__";
const INTERNAL_CUSTOMER_NAME = "إنتاج داخلي";
const BATCH_TYPE = {
  BATCH: "BATCH",
  SAMPLE: "SAMPLE",
} as const;

async function ensureInternalCustomerId() {
  const existing = await prisma.customer.findUnique({ where: { mobile: INTERNAL_CUSTOMER_MOBILE } });
  if (existing) return existing.id;
  const maxCode = await prisma.customer.aggregate({ _max: { code: true } });
  const nextCode = (maxCode._max.code ?? 999) + 1;
  const created = await prisma.customer.create({
    data: {
      code: nextCode,
      name: INTERNAL_CUSTOMER_NAME,
      mobile: INTERNAL_CUSTOMER_MOBILE,
    },
    select: { id: true },
  });
  return created.id;
}

async function nextBatchNo() {
  const m = await prisma.productionBatch.aggregate({ _max: { batchNo: true } });
  return (m._max.batchNo ?? 0) + 1;
}

const createProductionBody = z.object({
  modelId: z.string().min(1),
  quantity: z.number().int().min(1).max(500),
  fabricId: z.string().optional().nullable(),
  color: z.string().optional(),
  notes: z.string().optional(),
});

const createSampleBody = z.object({
  modelId: z.string().min(1),
  fabricId: z.string().optional().nullable(),
  color: z.string().optional(),
  notes: z.string().optional(),
});

async function createProductionBatch(args: {
  modelId: string;
  quantity: number;
  fabricId?: string | null;
  color?: string;
  notes?: string;
  userId: string;
  type: "BATCH" | "SAMPLE";
}) {
  const model = await prisma.abayaModel.findUnique({
    where: { id: args.modelId },
    include: { product: true },
  });
  if (!model) throw new AppError(404, "Model not found", "NOT_FOUND");
  if (!model.productId || !model.product) {
    throw new AppError(400, "Model must be linked to a product first", "VALIDATION_ERROR");
  }
  const linkedProduct = model.product;
  if (args.fabricId) {
    const roll = await prisma.fabricRoll.findUnique({ where: { id: args.fabricId } });
    if (!roll) throw new AppError(404, "Fabric roll not found", "NOT_FOUND");
  }

  const customerId = await ensureInternalCustomerId();
  const settingsRows = await prisma.setting.findMany();
  const settingsMap = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));
  const wageDefaults = parseWageDefaults(settingsMap);
  const stageKeys = resolvePipelineStageKeysFromModelJson(model.workflowStagesJson);
  const firstStage = initialPipelineStage(stageKeys);

  return prisma.$transaction(async (tx) => {
    const batchNo = await nextBatchNo();
    const pb = await tx.productionBatch.create({
      data: {
        batchNo,
        modelId: model.id,
        quantity: args.quantity,
        type: args.type,
        fabricId: args.fabricId ?? null,
        color: args.color?.trim() || null,
        notes: args.notes?.trim(),
        createdById: args.userId,
        status: "IN_PROGRESS",
      },
    });

    const jobs: string[] = [];
    const maxJob = await tx.jobOrder.aggregate({ _max: { jobNo: true } });
    let nextJobNo = (maxJob._max.jobNo ?? 0) + 1;

    for (let i = 0; i < args.quantity; i += 1) {
      const j = await tx.jobOrder.create({
        data: {
          jobNo: nextJobNo++,
          productionBatchId: pb.id,
          customerId,
          productId: model.productId,
          abayaModelId: model.id,
          abayaTypeId: model.abayaTypeId,
          productStyle: `${model.code} - ${model.name}`,
          stage: firstStage,
          priority: "NORMAL",
          dueDate: new Date(Date.now() + model.defaultDeliveryDays * 24 * 60 * 60 * 1000),
          notes: args.notes?.trim() || null,
          costFils: 0,
          totalFils: 0,
          paidFils: 0,
          balanceFils: 0,
          isPaid: true,
          invoiceId: null,
        },
      });
      await createPipelineRowsForJob(tx, j.id, linkedProduct, wageDefaults, stageKeys);
      if (args.fabricId) {
        const materialCostFils = await reserveFabricForMaterial(tx, args.fabricId, 1);
        await tx.jobOrderMaterial.create({
          data: {
            jobOrderId: j.id,
            rollId: args.fabricId,
            meters: 1,
            materialCostFils,
            fabricDeducted: false,
          },
        });
      }
      jobs.push(j.id);
    }
    return { ...pb, jobIds: jobs };
  });
}

productionRouter.post(
  "/",
  requirePermission("jobProcess.update", "readyMade.create"),
  validateBody(createProductionBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createProductionBody>;
    const userId = req.user?.id;
    if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    const batch = await createProductionBatch({
      modelId: body.modelId,
      quantity: body.quantity,
      fabricId: body.fabricId,
      color: body.color,
      notes: body.notes,
      userId,
      type: BATCH_TYPE.BATCH,
    });

    res.status(201).json({ success: true, data: batch });
  }),
);

productionRouter.post(
  "/samples",
  requirePermission("jobProcess.update", "readyMade.create"),
  validateBody(createSampleBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createSampleBody>;
    const userId = req.user?.id;
    if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    const batch = await createProductionBatch({
      modelId: body.modelId,
      quantity: 1,
      fabricId: body.fabricId,
      color: body.color,
      notes: body.notes,
      userId,
      type: BATCH_TYPE.SAMPLE,
    });
    res.status(201).json({ success: true, data: batch });
  }),
);

productionRouter.get(
  "/",
  requirePermission("jobProcess.view"),
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const { page, limit } = parsePageLimit(q, { defaultLimit: 40, maxLimit: 200 });
    const { skip, take } = prismaSkipTake({ page, limit });
    const from = parseOptionalDate(q, "from");
    const to = parseOptionalDate(q, "to");
    const modelId = queryParamString(q, "modelId");
    const type = queryParamString(q, "type");
    const where = {
      ...(modelId ? { modelId } : {}),
      ...(type ? { type } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.productionBatch.count({ where }),
      prisma.productionBatch.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: {
          model: {
            select: {
              id: true,
              code: true,
              name: true,
              abayaTypeId: true,
              defaultPriceFils: true,
              defaultDeliveryDays: true,
            },
          },
          fabric: { select: { id: true, rollCode: true, name: true, color: true } },
          jobs: { select: { id: true, stage: true } },
        },
      }),
    ]);

    const items = rows.map((r: (typeof rows)[number]) => {
      const completed = r.jobs.filter((j: (typeof r.jobs)[number]) =>
        ["READY", "DELIVERED", "CONVERTED_TO_READY"].includes(j.stage),
      ).length;
      const status = completed >= r.quantity ? "COMPLETED" : "IN_PROGRESS";
      return {
        ...r,
        status,
        completedQty: completed,
        primaryJobId: r.jobs[0]?.id ?? null,
      };
    });

    res.status(200).json({
      success: true,
      data: { items, meta: buildPaginatedMeta(total, { page, limit }) },
    });
  }),
);

