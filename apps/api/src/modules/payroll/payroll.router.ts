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
