import { Router } from "express";
import { prisma } from "../../config/db.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/rbac.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

export const abayaCatalogRouter = Router();
abayaCatalogRouter.use(authMiddleware);

/** POS / job forms: top-level abaya types with nested models (optional second picker). */
abayaCatalogRouter.get(
  "/",
  /** Tailoring POS: sellers have `pos.tailoring` but not `models.view` (no admin catalog page). */
  requirePermission("models.view", "pos.tailoring"),
  asyncHandler(async (_req, res) => {
    const types = await prisma.abayaType.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        models: {
          where: { isActive: true },
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            code: true,
            name: true,
            description: true,
            imageUrl: true,
            workflowStagesJson: true,
            defaultPriceFils: true,
            defaultFabricRollId: true,
            defaultDeliveryDays: true,
            cuttingWageFils: true,
            sewingWageFils: true,
            finishingWageFils: true,
            embroideryWageFils: true,
            productId: true,
            sortOrder: true,
            product: { select: { id: true, name: true, sku: true } },
            defaultFabricRoll: {
              select: { id: true, rollCode: true, name: true, color: true },
            },
          },
        },
      },
    });
    res.status(200).json({ success: true, data: { types } });
  }),
);
