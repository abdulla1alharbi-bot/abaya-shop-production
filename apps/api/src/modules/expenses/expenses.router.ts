import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/rbac.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { prismaSkipTake, buildPaginatedMeta } from "../../utils/pagination.js";
import { parsePageLimit } from "../../utils/queryParams.js";

export const expensesRouter = Router();
expensesRouter.use(authMiddleware);

expensesRouter.get(
  "/categories",
  requirePermission("expenses.view"),
  asyncHandler(async (_req, res) => {
    const categories = await prisma.expenseCategory.findMany({ orderBy: { name: "asc" } });
    res.status(200).json({ success: true, data: categories });
  }),
);

expensesRouter.get(
  "/",
  requirePermission("expenses.view"),
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const { page, limit } = parsePageLimit(q, { defaultLimit: 20 });
    const pagination = { page, limit };
    const { skip, take } = prismaSkipTake(pagination);

    const [total, rows] = await Promise.all([
      prisma.expense.count(),
      prisma.expense.findMany({
        orderBy: { date: "desc" },
        skip,
        take,
        include: { category: true },
      }),
    ]);

    res.status(200).json({
      success: true,
      data: { items: rows, meta: buildPaginatedMeta(total, pagination) },
    });
  }),
);

const expenseBody = z.object({
  categoryId: z.string(),
  amountFils: z.number().int().min(1),
  description: z.string().min(1),
  notes: z.string().optional(),
  date: z.string().datetime().optional(),
  paidBy: z.string().optional(),
});

expensesRouter.post(
  "/",
  requirePermission("expenses.create"),
  validateBody(expenseBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof expenseBody>;
    const expense = await prisma.expense.create({
      data: {
        categoryId: body.categoryId,
        amountFils: body.amountFils,
        description: body.description.trim(),
        notes: body.notes?.trim() || null,
        date: body.date ? new Date(body.date) : new Date(),
        paidBy: body.paidBy?.trim(),
      },
      include: { category: true },
    });
    res.status(201).json({ success: true, data: expense });
  }),
);

const expenseBodyPartial = expenseBody.partial();

expensesRouter.patch(
  "/:id",
  requirePermission("expenses.edit"),
  validateBody(expenseBodyPartial),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof expenseBodyPartial>;
    const expense = await prisma.expense.update({
      where: { id: req.params.id },
      data: {
        categoryId: body.categoryId,
        amountFils: body.amountFils,
        description: body.description?.trim(),
        notes: body.notes !== undefined ? (body.notes?.trim() || null) : undefined,
        date: body.date ? new Date(body.date) : undefined,
        paidBy: body.paidBy?.trim(),
      },
      include: { category: true },
    });
    res.status(200).json({ success: true, data: expense });
  }),
);

expensesRouter.delete(
  "/:id",
  requirePermission("expenses.delete"),
  asyncHandler(async (req, res) => {
    await prisma.expense.delete({ where: { id: req.params.id } });
    res.status(200).json({ success: true, data: { deleted: true } });
  }),
);
