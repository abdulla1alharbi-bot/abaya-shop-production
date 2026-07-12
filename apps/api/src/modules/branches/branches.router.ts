import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/rbac.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../middleware/error.middleware.js";

export const branchesRouter = Router();
branchesRouter.use(authMiddleware);

branchesRouter.get(
  "/",
  requirePermission("pos.use", "dashboard.view"),
  asyncHandler(async (_req, res) => {
    const branches = await prisma.branch.findMany({ orderBy: { name: "asc" } });
    res.status(200).json({ success: true, data: branches });
  }),
);

const branchBody = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(500).optional(),
  phone: z.string().max(80).optional(),
  isDefault: z.boolean().optional(),
});

branchesRouter.post(
  "/",
  requirePermission("settings.manage"),
  validateBody(branchBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof branchBody>;
    const created = await prisma.$transaction(async (tx) => {
      if (body.isDefault) {
        await tx.branch.updateMany({ data: { isDefault: false } });
      }
      return tx.branch.create({
        data: {
          name: body.name.trim(),
          address: body.address?.trim(),
          phone: body.phone?.trim(),
          isDefault: body.isDefault ?? false,
        },
      });
    });
    res.status(201).json({ success: true, data: created });
  }),
);

branchesRouter.patch(
  "/:id",
  requirePermission("settings.manage"),
  validateBody(branchBody.partial()),
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<z.infer<typeof branchBody>>;
    const existing = await prisma.branch.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError(404, "Branch not found", "NOT_FOUND");
    const updated = await prisma.$transaction(async (tx) => {
      if (body.isDefault) {
        await tx.branch.updateMany({ data: { isDefault: false } });
      }
      return tx.branch.update({
        where: { id: existing.id },
        data: {
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body.address !== undefined ? { address: body.address?.trim() } : {}),
          ...(body.phone !== undefined ? { phone: body.phone?.trim() } : {}),
          ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
        },
      });
    });
    res.status(200).json({ success: true, data: updated });
  }),
);
