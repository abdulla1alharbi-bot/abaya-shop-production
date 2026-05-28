import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/rbac.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../middleware/error.middleware.js";
import { prismaSkipTake, buildPaginatedMeta } from "../../utils/pagination.js";
import { parseDateRangeOrDefault, parsePageLimit, parseOptionalDate, queryParamString } from "../../utils/queryParams.js";

export const workersRouter = Router();
workersRouter.use(authMiddleware);
const COMPLETED_WAGE_JOB_STAGES = ["READY", "DELIVERED"] as const;

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

workersRouter.get(
  "/defaults/piece-rates",
  requirePermission("workers.view", "pos.tailoring", "jobProcess.update"),
  asyncHandler(async (_req, res) => {
    const rates = await prisma.pieceRate.findMany({
      where: { workerId: null, isDefault: true },
      orderBy: { workType: "asc" },
    });
    res.status(200).json({ success: true, data: rates });
  }),
);

/** Aggregate earnings / payouts / due per worker (productivity & payroll). Query: from, to, workerId, workType */
workersRouter.get(
  "/summary",
  requirePermission("workers.wages"),
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const from = parseOptionalDate(q, "from");
    const toStart = parseOptionalDate(q, "to");
    const to = toStart ? endOfDay(toStart) : undefined;
    const workerIdFilter = queryParamString(q, "workerId");
    const workTypeFilter = queryParamString(q, "workType");

    const hasRange = Boolean(from && to);

    const workers = await prisma.worker.findMany({
      where: workerIdFilter ? { id: workerIdFilter } : {},
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true, isActive: true, phone: true },
    });

    const items = await Promise.all(
      workers.map(async (w) => {
        const prodWhere = {
          workerId: w.id,
          ...(hasRange && from && to ? { date: { gte: from, lte: to } } : {}),
          ...(workTypeFilter ? { workType: workTypeFilter } : {}),
        };
        const [earnedAgg, taskCount, paidAgg, adjAgg] = await Promise.all([
          prisma.productionEntry.aggregate({
            where: prodWhere,
            _sum: { totalFils: true },
          }),
          prisma.productionEntry.count({ where: prodWhere }),
          prisma.workerPayout.aggregate({
            where: {
              workerId: w.id,
              ...(hasRange && from && to ? { paidAt: { gte: from, lte: to } } : {}),
            },
            _sum: { amountFils: true },
          }),
          prisma.workerBalanceAdjustment.aggregate({
            where: {
              workerId: w.id,
              ...(hasRange && from && to ? { createdAt: { gte: from, lte: to } } : {}),
            },
            _sum: { amountFils: true },
          }),
        ]);

        const earnedFils = earnedAgg._sum.totalFils ?? 0;
        const payoutFils = paidAgg._sum.amountFils ?? 0;
        const adjustmentFils = adjAgg._sum.amountFils ?? 0;
        // When filtering by work type, show production-only productivity; financial columns would mix concepts.
        const productivityOnly = Boolean(workTypeFilter);
        const dueFils = productivityOnly
          ? earnedFils
          : earnedFils + adjustmentFils - payoutFils;

        return {
          workerId: w.id,
          name: w.name,
          role: w.role,
          phone: w.phone,
          isActive: w.isActive,
          earnedFils,
          payoutFils: productivityOnly ? 0 : payoutFils,
          adjustmentFils: productivityOnly ? 0 : adjustmentFils,
          dueFils,
          taskCount,
          productivityOnly,
        };
      }),
    );

    res.status(200).json({
      success: true,
      data: {
        items,
        from: from?.toISOString() ?? null,
        to: to?.toISOString() ?? null,
      },
    });
  }),
);

workersRouter.get(
  "/",
  requirePermission("workers.view"),
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const { page, limit } = parsePageLimit(q, { defaultLimit: 20, maxLimit: 500 });
    const search = queryParamString(q, "q");
    const activeOnly = queryParamString(q, "activeOnly") === "true";
    const pagination = { page, limit };
    const { skip, take } = prismaSkipTake(pagination);
    const where = {
      ...(search
        ? {
            OR: [{ name: { contains: search } }, { phone: { contains: search } }],
          }
        : {}),
      ...(activeOnly ? { isActive: true } : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.worker.count({ where }),
      prisma.worker.findMany({
        where,
        orderBy: { name: "asc" },
        skip,
        take,
        include: {
          pieceRates: true,
        },
      }),
    ]);

    res.status(200).json({
      success: true,
      data: { items: rows, meta: buildPaginatedMeta(total, pagination) },
    });
  }),
);

const workerBody = z.object({
  name: z.string().min(1),
  nationality: z.string().optional(),
  passportNo: z.string().optional(),
  phone: z.string().optional(),
  role: z.string().min(1),
  specializations: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  joinDate: z.string().datetime().optional(),
});

workersRouter.post(
  "/",
  requirePermission("workers.create"),
  validateBody(workerBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof workerBody>;
    const worker = await prisma.worker.create({
      data: {
        name: body.name.trim(),
        nationality: body.nationality?.trim(),
        passportNo: body.passportNo?.trim(),
        phone: body.phone?.trim(),
        role: body.role.trim(),
        specializations: body.specializations?.trim() || null,
        notes: body.notes?.trim() || null,
        isActive: body.isActive ?? true,
        joinDate: body.joinDate ? new Date(body.joinDate) : undefined,
      },
    });
    res.status(201).json({ success: true, data: worker });
  }),
);

const payoutBody = z.object({
  amountFils: z.number().int().min(1),
  method: z.string().optional(),
  notes: z.string().optional(),
  paidAt: z.string().datetime().optional(),
});

const adjustmentBody = z.object({
  amountFils: z.number().int(),
  reason: z.string().min(1),
});

workersRouter.get(
  "/:id/assignments",
  requirePermission("workers.view"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.jobAssignment.findMany({
      where: { workerId: req.params.id },
      orderBy: { assignedAt: "desc" },
      include: {
        jobOrder: {
          select: {
            id: true,
            jobNo: true,
            productStyle: true,
            stage: true,
            dueDate: true,
            invoiceId: true,
            customer: { select: { name: true, mobile: true } },
          },
        },
      },
    });
    res.status(200).json({ success: true, data: rows });
  }),
);

workersRouter.get(
  "/:id/balance",
  requirePermission("workers.wages"),
  asyncHandler(async (req, res) => {
    const wid = req.params.id;
    const [earned, paid, adj] = await Promise.all([
      prisma.productionEntry.aggregate({
        where: {
          workerId: wid,
          jobOrder: { stage: { in: [...COMPLETED_WAGE_JOB_STAGES] } },
        },
        _sum: { totalFils: true },
      }),
      prisma.workerPayout.aggregate({
        where: { workerId: wid },
        _sum: { amountFils: true },
      }),
      prisma.workerBalanceAdjustment.aggregate({
        where: { workerId: wid },
        _sum: { amountFils: true },
      }),
    ]);
    const earnedFils = earned._sum.totalFils ?? 0;
    const payoutFils = paid._sum.amountFils ?? 0;
    const adjustmentFils = adj._sum.amountFils ?? 0;
    const dueFils = earnedFils + adjustmentFils - payoutFils;
    res.status(200).json({
      success: true,
      data: { earnedFils, payoutFils, adjustmentFils, dueFils },
    });
  }),
);

workersRouter.get(
  "/:id/payouts",
  requirePermission("workers.wages"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.workerPayout.findMany({
      where: { workerId: req.params.id },
      orderBy: { paidAt: "desc" },
    });
    res.status(200).json({ success: true, data: rows });
  }),
);

workersRouter.post(
  "/:id/payouts",
  requirePermission("workers.wages"),
  validateBody(payoutBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof payoutBody>;
    const wid = req.params.id;
    if (!wid) throw new AppError(400, "Missing worker id", "VALIDATION_ERROR");
    const w = await prisma.worker.findUnique({ where: { id: wid } });
    if (!w) throw new AppError(404, "Worker not found", "NOT_FOUND");
    const row = await prisma.workerPayout.create({
      data: {
        workerId: wid,
        amountFils: body.amountFils,
        method: body.method?.trim(),
        notes: body.notes?.trim(),
        paidAt: body.paidAt ? new Date(body.paidAt) : new Date(),
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user?.id ?? "system",
        action: "WORKER_PAYOUT",
        entity: "WorkerPayout",
        entityId: row.id,
        newValue: JSON.stringify({ workerId: wid, workerName: w.name, amountFils: body.amountFils, method: body.method }),
      },
    });

    res.status(201).json({ success: true, data: row });
  }),
);

workersRouter.delete(
  "/:id/payouts/:payoutId",
  requirePermission("workers.wages"),
  asyncHandler(async (req, res) => {
    const r = await prisma.workerPayout.deleteMany({
      where: { id: req.params.payoutId, workerId: req.params.id },
    });
    if (r.count === 0) throw new AppError(404, "Payout not found", "NOT_FOUND");
    res.status(200).json({ success: true, data: { deleted: true } });
  }),
);

workersRouter.get(
  "/:id/adjustments",
  requirePermission("workers.wages"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.workerBalanceAdjustment.findMany({
      where: { workerId: req.params.id },
      orderBy: { createdAt: "desc" },
    });
    res.status(200).json({ success: true, data: rows });
  }),
);

workersRouter.post(
  "/:id/adjustments",
  requirePermission("workers.wages"),
  validateBody(adjustmentBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof adjustmentBody>;
    const wid = req.params.id;
    if (!wid) throw new AppError(400, "Missing worker id", "VALIDATION_ERROR");
    const w = await prisma.worker.findUnique({ where: { id: wid } });
    if (!w) throw new AppError(404, "Worker not found", "NOT_FOUND");
    const row = await prisma.workerBalanceAdjustment.create({
      data: {
        workerId: wid,
        amountFils: body.amountFils,
        reason: body.reason.trim(),
      },
    });
    res.status(201).json({ success: true, data: row });
  }),
);

workersRouter.get(
  "/:id",
  requirePermission("workers.view"),
  asyncHandler(async (req, res) => {
    const worker = await prisma.worker.findUnique({
      where: { id: req.params.id },
      include: {
        pieceRates: true,
        payrolls: { orderBy: [{ year: "desc" }, { month: "desc" }], take: 24 },
        payouts: { orderBy: { paidAt: "desc" }, take: 100 },
        balanceAdjustments: { orderBy: { createdAt: "desc" }, take: 100 },
        productions: {
          take: 200,
          orderBy: { date: "desc" },
          include: {
            jobOrder: {
              select: { id: true, jobNo: true, productStyle: true, stage: true, invoiceId: true },
            },
          },
        },
        assignments: {
          take: 100,
          orderBy: { assignedAt: "desc" },
          include: {
            jobOrder: {
              select: {
                id: true,
                jobNo: true,
                productStyle: true,
                stage: true,
                dueDate: true,
                invoiceId: true,
                customer: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!worker) throw new AppError(404, "Worker not found", "NOT_FOUND");

    const [earned, paid, adj] = await Promise.all([
      prisma.productionEntry.aggregate({
        where: {
          workerId: worker.id,
          jobOrder: { stage: { in: [...COMPLETED_WAGE_JOB_STAGES] } },
        },
        _sum: { totalFils: true },
      }),
      prisma.workerPayout.aggregate({
        where: { workerId: worker.id },
        _sum: { amountFils: true },
      }),
      prisma.workerBalanceAdjustment.aggregate({
        where: { workerId: worker.id },
        _sum: { amountFils: true },
      }),
    ]);
    const earnedFils = earned._sum.totalFils ?? 0;
    const payoutFils = paid._sum.amountFils ?? 0;
    const adjustmentFils = adj._sum.amountFils ?? 0;
    const dueFils = earnedFils + adjustmentFils - payoutFils;

    res.status(200).json({
      success: true,
      data: {
        ...worker,
        balance: { earnedFils, payoutFils, adjustmentFils, dueFils },
      },
    });
  }),
);

const workerBodyPartial = workerBody.partial();

workersRouter.patch(
  "/:id",
  requirePermission("workers.edit"),
  validateBody(workerBodyPartial),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof workerBodyPartial>;
    const id = req.params.id;
    const worker = await prisma.worker.update({
      where: { id },
      data: {
        name: body.name?.trim(),
        nationality: body.nationality?.trim(),
        passportNo: body.passportNo?.trim(),
        phone: body.phone?.trim(),
        role: body.role?.trim(),
        specializations: body.specializations === null ? null : body.specializations?.trim(),
        notes: body.notes === null ? null : body.notes?.trim(),
        isActive: body.isActive,
        joinDate: body.joinDate ? new Date(body.joinDate) : undefined,
      },
    });
    res.status(200).json({ success: true, data: worker });
  }),
);

const pieceRateBody = z.object({
  workType: z.string().min(1),
  rateFils: z.number().int().min(0),
});

const productionBody = z.object({
  jobOrderId: z.string().optional().nullable(),
  workType: z.string().min(1),
  qty: z.number().int().min(1),
  rateFils: z.number().int().min(0),
  date: z.string().datetime().optional(),
  notes: z.string().optional(),
});

workersRouter.post(
  "/:id/production-entries",
  requirePermission("workers.edit"),
  validateBody(productionBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof productionBody>;
    const totalFils = body.qty * body.rateFils;
    const wid = req.params.id;
    if (!wid) throw new AppError(400, "Missing worker id", "VALIDATION_ERROR");
    const entry = await prisma.productionEntry.create({
      data: {
        workerId: wid,
        jobOrderId: body.jobOrderId ?? null,
        workType: body.workType,
        qty: body.qty,
        rateFils: body.rateFils,
        totalFils,
        date: body.date ? new Date(body.date) : new Date(),
        notes: body.notes?.trim(),
      },
    });
    res.status(201).json({ success: true, data: entry });
  }),
);

workersRouter.post(
  "/:id/piece-rates",
  requirePermission("workers.edit"),
  validateBody(pieceRateBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof pieceRateBody>;
    const rate = await prisma.pieceRate.create({
      data: {
        workerId: req.params.id,
        workType: body.workType,
        rateFils: body.rateFils,
        isDefault: false,
      },
    });
    res.status(201).json({ success: true, data: rate });
  }),
);

workersRouter.delete(
  "/:id/piece-rates/:rateId",
  requirePermission("workers.edit"),
  asyncHandler(async (req, res) => {
    await prisma.pieceRate.deleteMany({
      where: { id: req.params.rateId, workerId: req.params.id },
    });
    res.status(200).json({ success: true, data: { deleted: true } });
  }),
);

workersRouter.get(
  "/:id/earnings",
  requirePermission("workers.view"),
  asyncHandler(async (req, res) => {
    const { from: fromD, to: toD } = parseDateRangeOrDefault(req.query as Record<string, unknown>);
    const entries = await prisma.productionEntry.findMany({
      where: {
        workerId: req.params.id,
        date: { gte: fromD, lte: toD },
      },
      orderBy: { date: "desc" },
    });
    const totalFils = entries.reduce((a, e) => a + e.totalFils, 0);
    res.status(200).json({
      success: true,
      data: { entries, totalFils, from: fromD.toISOString(), to: toD.toISOString() },
    });
  }),
);
