import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/rbac.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { prismaSkipTake, buildPaginatedMeta } from "../../utils/pagination.js";
import { parseOptionalInt, parsePageLimit, queryParamString } from "../../utils/queryParams.js";

export const payrollRouter = Router();
payrollRouter.use(authMiddleware);

payrollRouter.get(
  "/",
  requirePermission("workers.wages"),
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const { page, limit } = parsePageLimit(q, { defaultLimit: 20 });
    const pagination = { page, limit };
    const { skip, take } = prismaSkipTake(pagination);

    const workerId = queryParamString(q, "workerId");
    const month = parseOptionalInt(q, "month");
    const year = parseOptionalInt(q, "year");
    const monthOk = month !== undefined && month >= 1 && month <= 12;
    const yearOk = year !== undefined && year >= 2000 && year <= 2100;

    const where = {
      ...(workerId ? { workerId } : {}),
      ...(monthOk && yearOk ? { month, year } : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.payroll.count({ where }),
      prisma.payroll.findMany({
        where,
        orderBy: [{ year: "desc" }, { month: "desc" }],
        skip,
        take,
        include: { worker: { select: { id: true, name: true, role: true } } },
      }),
    ]);

    res.status(200).json({
      success: true,
      data: { items: rows, meta: buildPaginatedMeta(total, pagination) },
    });
  }),
);

const payrollBody = z.object({
  workerId: z.string(),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000).max(2100),
  productionFils: z.number().int().min(0),
  bonusFils: z.number().int().min(0).optional(),
  deductionFils: z.number().int().min(0).optional(),
  advanceFils: z.number().int().min(0).optional(),
  isPaid: z.boolean().optional(),
  payMethod: z.string().optional(),
  notes: z.string().optional(),
});

const generateBody = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000).max(2100),
});

/**
 * Generate (or refresh) payroll rows for ALL active workers for a month:
 *   productionFils = sum of ProductionEntry in the month
 *   bonusFils      = positive balance adjustments in the month
 *   deductionFils  = negative balance adjustments in the month (abs)
 * Existing UNPAID rows for that month are recalculated; PAID rows are left alone.
 */
payrollRouter.post(
  "/generate",
  requirePermission("workers.wages"),
  validateBody(generateBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof generateBody>;
    const from = new Date(body.year, body.month - 1, 1, 0, 0, 0, 0);
    const to = new Date(body.year, body.month, 0, 23, 59, 59, 999);

    const [workers, prodByWorker, adjustments] = await Promise.all([
      prisma.worker.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
      prisma.productionEntry.groupBy({
        by: ["workerId"],
        _sum: { totalFils: true },
        where: { date: { gte: from, lte: to } },
      }),
      prisma.workerBalanceAdjustment.findMany({
        where: { createdAt: { gte: from, lte: to } },
        select: { workerId: true, amountFils: true },
      }),
    ]);

    const prodMap = new Map(prodByWorker.map((p) => [p.workerId, p._sum.totalFils ?? 0]));
    const bonusMap = new Map<string, number>();
    const dedMap = new Map<string, number>();
    for (const a of adjustments) {
      if (a.amountFils >= 0) bonusMap.set(a.workerId, (bonusMap.get(a.workerId) ?? 0) + a.amountFils);
      else dedMap.set(a.workerId, (dedMap.get(a.workerId) ?? 0) - a.amountFils);
    }

    let created = 0;
    let updated = 0;
    let skippedPaid = 0;
    let skippedEmpty = 0;

    for (const w of workers) {
      const productionFils = prodMap.get(w.id) ?? 0;
      const bonusFils = bonusMap.get(w.id) ?? 0;
      const deductionFils = dedMap.get(w.id) ?? 0;
      if (productionFils === 0 && bonusFils === 0 && deductionFils === 0) {
        skippedEmpty += 1;
        continue;
      }
      const netFils = productionFils + bonusFils - deductionFils;

      const existing = await prisma.payroll.findFirst({
        where: { workerId: w.id, month: body.month, year: body.year },
      });
      if (existing?.isPaid) {
        skippedPaid += 1;
        continue;
      }
      if (existing) {
        await prisma.payroll.update({
          where: { id: existing.id },
          data: {
            productionFils,
            bonusFils,
            deductionFils,
            netFils: netFils - existing.advanceFils,
          },
        });
        updated += 1;
      } else {
        await prisma.payroll.create({
          data: {
            workerId: w.id,
            month: body.month,
            year: body.year,
            productionFils,
            bonusFils,
            deductionFils,
            netFils,
            notes: "توليد تلقائي من سجلات الإنتاج",
          },
        });
        created += 1;
      }
    }

    res.status(200).json({
      success: true,
      data: { created, updated, skippedPaid, skippedEmpty, month: body.month, year: body.year },
    });
  }),
);

payrollRouter.post(
  "/",
  requirePermission("workers.wages"),
  validateBody(payrollBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof payrollBody>;
    const bonus = body.bonusFils ?? 0;
    const ded = body.deductionFils ?? 0;
    const adv = body.advanceFils ?? 0;
    const netFils = body.productionFils + bonus - ded - adv;
    const row = await prisma.payroll.create({
      data: {
        workerId: body.workerId,
        month: body.month,
        year: body.year,
        productionFils: body.productionFils,
        bonusFils: bonus,
        deductionFils: ded,
        advanceFils: adv,
        netFils,
        isPaid: body.isPaid ?? false,
        payMethod: body.payMethod,
        notes: body.notes?.trim(),
      },
      include: { worker: true },
    });
    res.status(201).json({ success: true, data: row });
  }),
);
