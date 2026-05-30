import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { getDefaultBranchId } from "../../config/shop.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/rbac.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../middleware/error.middleware.js";
import { prismaSkipTake, buildPaginatedMeta } from "../../utils/pagination.js";
import { parseActiveOnlyTrue, parseLowOnlyTrue, parsePageLimit, queryParamString } from "../../utils/queryParams.js";
import { nextRollCode } from "../../utils/counters.js";

export const fabricRollsRouter = Router();
fabricRollsRouter.use(authMiddleware);

fabricRollsRouter.get(
  "/",
  /** Inventory UI uses `fabrics.view`; POS fabric picker uses `pos.tailoring` only. */
  requirePermission("fabrics.view", "pos.tailoring"),
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const { page, limit } = parsePageLimit(q, { defaultLimit: 50 });
    const search = queryParamString(q, "q");
    const lowOnly = parseLowOnlyTrue(q);
    const activeOnly = parseActiveOnlyTrue(q);
    const pagination = { page, limit };
    const { skip, take } = prismaSkipTake(pagination);

    const searchWhere: Record<string, unknown> = search
      ? {
          OR: [
            { name: { contains: search } },
            { rollCode: { contains: search } },
            { color: { contains: search } },
            { type: { contains: search } },
          ],
        }
      : {};
    if (activeOnly) searchWhere.isActive = true;
    const categoryFilter = queryParamString(q, "category");
    if (categoryFilter === "FABRIC" || categoryFilter === "LACE") {
      searchWhere.category = categoryFilter;
    }

    const rolls = await prisma.fabricRoll.findMany({
      where: searchWhere as never,
      include: { branch: true },
      orderBy: { receivedAt: "desc" },
    });

    const filtered = lowOnly ? rolls.filter((r) => r.availableMeters <= r.lowStockAt) : rolls;

    const total = filtered.length;
    const pageRows = filtered.slice(skip, skip + take);

    res.status(200).json({
      success: true,
      data: { items: pageRows, meta: buildPaginatedMeta(total, pagination) },
    });
  }),
);

const rollBody = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  color: z.string().min(1),
  branchId: z.string().optional(),
  totalMeters: z.number().positive(),
  costPerMeter: z.number().int().min(0),
  lowStockAt: z.number().positive().optional(),
  isActive: z.boolean().optional(),
  category: z.enum(["FABRIC", "LACE"]).optional().default("FABRIC"),
  imageUrl: z.string().optional().nullable(),
});

fabricRollsRouter.post(
  "/",
  requirePermission("fabrics.create"),
  validateBody(rollBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof rollBody>;
    const branchId = body.branchId ?? (await getDefaultBranchId(prisma));
    const rollCode = await nextRollCode(prisma);
    const total = body.totalMeters;
    const roll = await prisma.fabricRoll.create({
      data: {
        rollCode,
        name: body.name.trim(),
        type: body.type.trim(),
        color: body.color.trim(),
        branchId,
        totalMeters: total,
        usedMeters: 0,
        availableMeters: total,
        costPerMeter: body.costPerMeter,
        lowStockAt: body.lowStockAt ?? 5,
        status: "FULL",
        isActive: body.isActive ?? true,
        category: body.category ?? "FABRIC",
        imageUrl: body.imageUrl ?? null,
      },
      include: { branch: true },
    });
    res.status(201).json({ success: true, data: roll });
  }),
);

fabricRollsRouter.get(
  "/:id",
  requirePermission("fabrics.view", "pos.tailoring"),
  asyncHandler(async (req, res) => {
    const roll = await prisma.fabricRoll.findUnique({
      where: { id: req.params.id },
      include: {
        branch: true,
        transactions: { orderBy: { createdAt: "desc" }, take: 100 },
      },
    });
    if (!roll) throw new AppError(404, "Fabric roll not found", "NOT_FOUND");
    res.status(200).json({ success: true, data: roll });
  }),
);

const rollBodyPartial = rollBody.partial();

fabricRollsRouter.patch(
  "/:id",
  requirePermission("fabrics.edit"),
  validateBody(rollBodyPartial),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof rollBodyPartial>;
    const id = req.params.id;
    const existing = await prisma.fabricRoll.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, "Fabric roll not found", "NOT_FOUND");

    let totalMeters = body.totalMeters ?? existing.totalMeters;
    const usedMeters = existing.usedMeters;
    if (totalMeters < usedMeters) {
      throw new AppError(400, "Total meters cannot be less than used meters", "INVALID_STOCK");
    }
    const availableMeters = totalMeters - usedMeters;

    const roll = await prisma.fabricRoll.update({
      where: { id },
      data: {
        name: body.name?.trim(),
        type: body.type?.trim(),
        color: body.color?.trim(),
        branchId: body.branchId,
        totalMeters,
        costPerMeter: body.costPerMeter,
        lowStockAt: body.lowStockAt,
        availableMeters,
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.category !== undefined ? { category: body.category } : {}),
        ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl } : {}),
      },
      include: { branch: true },
    });
    res.status(200).json({ success: true, data: roll });
  }),
);

const restockBody = z.object({
  meters: z.number().positive(),
  reason: z.string().optional(),
});

fabricRollsRouter.post(
  "/:id/restock",
  requirePermission("fabrics.edit"),
  validateBody(restockBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof restockBody>;
    const roll = await prisma.fabricRoll.findUnique({ where: { id: req.params.id } });
    if (!roll) throw new AppError(404, "Fabric roll not found", "NOT_FOUND");

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.fabricRoll.update({
        where: { id: roll.id },
        data: {
          totalMeters: { increment: body.meters },
          availableMeters: { increment: body.meters },
        },
      });
      await tx.fabricTransaction.create({
        data: {
          rollId: roll.id,
          type: "RESTOCK",
          meters: body.meters,
          reason: body.reason?.trim() || "وارد جديد",
        },
      });
      return u;
    });
    res.status(200).json({ success: true, data: updated });
  }),
);

fabricRollsRouter.delete(
  "/:id",
  requirePermission("fabrics.edit"),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const roll = await prisma.fabricRoll.findUnique({
      where: { id },
      include: { jobMaterials: true, productionBatches: true },
    });
    if (!roll) throw new AppError(404, "Fabric roll not found", "NOT_FOUND");
    if (roll.usedMeters > 0) {
      throw new AppError(400, "Cannot delete a roll that has been used in orders", "ROLL_IN_USE");
    }
    if (roll.jobMaterials.length > 0 || roll.productionBatches.length > 0) {
      throw new AppError(400, "Cannot delete a roll that is linked to orders", "ROLL_IN_USE");
    }
    await prisma.$transaction(async (tx) => {
      await tx.fabricTransaction.deleteMany({ where: { rollId: id } });
      await tx.fabricRoll.delete({ where: { id } });
    });
    res.status(200).json({ success: true });
  }),
);

const adjustBody = z.object({
  meters: z.number().positive(),
  reason: z.string().optional(),
});

fabricRollsRouter.post(
  "/:id/adjust",
  requirePermission("fabrics.edit"),
  validateBody(adjustBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof adjustBody>;
    const roll = await prisma.fabricRoll.findUnique({ where: { id: req.params.id } });
    if (!roll) throw new AppError(404, "Fabric roll not found", "NOT_FOUND");
    if (body.meters > roll.availableMeters) {
      throw new AppError(400, "Not enough available meters", "INSUFFICIENT_STOCK");
    }
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.fabricRoll.update({
        where: { id: roll.id },
        data: {
          usedMeters: { increment: body.meters },
          availableMeters: { decrement: body.meters },
        },
      });
      await tx.fabricTransaction.create({
        data: {
          rollId: roll.id,
          type: "ADJUST_OUT",
          meters: body.meters,
          reason: body.reason ?? "Manual adjustment",
        },
      });
      return u;
    });
    res.status(200).json({ success: true, data: updated });
  }),
);
