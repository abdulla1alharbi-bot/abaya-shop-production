import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/rbac.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { prismaSkipTake, buildPaginatedMeta } from "../../utils/pagination.js";
import { parsePageLimit } from "../../utils/queryParams.js";

export const incomeRouter = Router();
incomeRouter.use(authMiddleware);

incomeRouter.get(
  "/",
  requirePermission("reports.financial"),
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const { page, limit } = parsePageLimit(q, { defaultLimit: 20 });
    const pagination = { page, limit };
    const { skip, take } = prismaSkipTake(pagination);

    const [total, rows] = await Promise.all([
      prisma.income.count(),
      prisma.income.findMany({
        orderBy: { date: "desc" },
        skip,
        take,
      }),
    ]);

    res.status(200).json({
      success: true,
      data: { items: rows, meta: buildPaginatedMeta(total, pagination) },
    });
  }),
);

const incomeBody = z.object({
  amountFils: z.number().int().min(1),
  description: z.string().min(1),
  category: z.string().optional(),
  date: z.string().datetime().optional(),
});

incomeRouter.post(
  "/",
  requirePermission("reports.financial"),
  validateBody(incomeBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof incomeBody>;
    const row = await prisma.income.create({
      data: {
        amountFils: body.amountFils,
        description: body.description.trim(),
        category: body.category?.trim(),
        date: body.date ? new Date(body.date) : new Date(),
      },
    });
    res.status(201).json({ success: true, data: row });
  }),
);

const incomePartial = incomeBody.partial();

incomeRouter.patch(
  "/:id",
  requirePermission("reports.financial"),
  validateBody(incomePartial),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof incomePartial>;
    const row = await prisma.income.update({
      where: { id: req.params.id },
      data: {
        amountFils: body.amountFils ?? undefined,
        description: body.description?.trim(),
        category: body.category?.trim(),
        date: body.date ? new Date(body.date) : undefined,
      },
    });
    res.status(200).json({ success: true, data: row });
  }),
);

incomeRouter.delete(
  "/:id",
  requirePermission("reports.financial"),
  asyncHandler(async (req, res) => {
    await prisma.income.delete({ where: { id: req.params.id } });
    res.status(200).json({ success: true, data: { deleted: true } });
  }),
);
