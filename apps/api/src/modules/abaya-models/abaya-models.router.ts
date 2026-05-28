import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/db.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/rbac.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../middleware/error.middleware.js";
import { syncLinkedProductForAbayaModelId } from "../../utils/abayaModelProductSync.js";
import { queryParamString } from "../../utils/queryParams.js";

export { syncLinkedProductForAbayaModelId } from "../../utils/abayaModelProductSync.js";

export const abayaModelsAdminRouter = Router();
abayaModelsAdminRouter.use(authMiddleware);

abayaModelsAdminRouter.get(
  "/",
  requirePermission("models.view"),
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const abayaTypeCode = queryParamString(q, "abayaTypeCode");
    const category = queryParamString(q, "category");

    let where: Prisma.AbayaModelWhereInput | undefined;
    if (abayaTypeCode) {
      where = { abayaType: { code: abayaTypeCode } };
    } else if (category === "models") {
      where = { abayaType: { code: "MODEL" } };
    } else if (category === "embroidery") {
      where = { abayaType: { code: "EMBROIDERY" } };
    } else if (category === "other") {
      where = { abayaType: { code: { notIn: ["MODEL", "EMBROIDERY"] } } };
    }

    const rows = await prisma.abayaModel.findMany({
      ...(where ? { where } : {}),
      orderBy: [{ abayaType: { sortOrder: "asc" } }, { sortOrder: "asc" }, { code: "asc" }],
      include: {
        abayaType: { select: { id: true, code: true, labelAr: true } },
        product: { select: { id: true, sku: true } },
        defaultFabricRoll: { select: { id: true, rollCode: true, name: true, color: true } },
      },
    });
    res.status(200).json({ success: true, data: { items: rows } });
  }),
);

const createBody = z.object({
  abayaTypeId: z.string().min(1),
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  imageUrl: z.string().max(2000).optional().nullable(),
  workflowStagesJson: z.string().max(500).optional().nullable(),
  defaultPriceFils: z.number().int().min(0),
  defaultFabricRollId: z.string().min(1).nullable().optional(),
  defaultDeliveryDays: z.number().int().min(0).max(365).optional(),
  cuttingWageFils: z.number().int().min(0),
  sewingWageFils: z.number().int().min(0),
  finishingWageFils: z.number().int().min(0),
  embroideryWageFils: z.number().int().min(0),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

abayaModelsAdminRouter.post(
  "/",
  requirePermission("models.create"),
  validateBody(createBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createBody>;
    const type = await prisma.abayaType.findUnique({ where: { id: body.abayaTypeId } });
    if (!type) throw new AppError(400, "Abaya type not found", "NOT_FOUND");

    let fabricId: string | null = null;
    if (body.defaultFabricRollId) {
      const roll = await prisma.fabricRoll.findUnique({ where: { id: body.defaultFabricRollId } });
      if (!roll) throw new AppError(400, "Fabric roll not found", "NOT_FOUND");
      fabricId = roll.id;
    }

    const created = await prisma.abayaModel.create({
      data: {
        abayaTypeId: body.abayaTypeId,
        code: body.code.trim(),
        name: body.name.trim(),
        description: body.description?.trim() || null,
        imageUrl: body.imageUrl?.trim() || null,
        workflowStagesJson: body.workflowStagesJson?.trim() || null,
        defaultPriceFils: body.defaultPriceFils,
        defaultFabricRollId: fabricId,
        defaultDeliveryDays: body.defaultDeliveryDays ?? 7,
        cuttingWageFils: body.cuttingWageFils,
        sewingWageFils: body.sewingWageFils,
        finishingWageFils: body.finishingWageFils,
        embroideryWageFils: body.embroideryWageFils,
        sortOrder: body.sortOrder ?? 0,
        isActive: body.isActive ?? true,
      },
      include: { abayaType: true },
    });

    await syncLinkedProductForAbayaModelId(created.id);

    const full = await prisma.abayaModel.findUnique({
      where: { id: created.id },
      include: {
        abayaType: { select: { id: true, code: true, labelAr: true } },
        product: true,
        defaultFabricRoll: { select: { id: true, rollCode: true, name: true, color: true } },
      },
    });
    res.status(201).json({ success: true, data: full });
  }),
);

const patchBody = z.object({
  code: z.string().min(1).max(40).optional(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  imageUrl: z.string().max(2000).optional().nullable(),
  workflowStagesJson: z.string().max(500).optional().nullable(),
  defaultPriceFils: z.number().int().min(0).optional(),
  defaultFabricRollId: z.string().min(1).nullable().optional(),
  defaultDeliveryDays: z.number().int().min(0).max(365).optional(),
  cuttingWageFils: z.number().int().min(0).optional(),
  sewingWageFils: z.number().int().min(0).optional(),
  finishingWageFils: z.number().int().min(0).optional(),
  embroideryWageFils: z.number().int().min(0).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  abayaTypeId: z.string().optional(),
});

abayaModelsAdminRouter.patch(
  "/:id",
  requirePermission("models.edit"),
  validateBody(patchBody),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!id) throw new AppError(400, "Missing id", "BAD_REQUEST");
    const body = req.body as z.infer<typeof patchBody>;
    const existing = await prisma.abayaModel.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, "Model not found", "NOT_FOUND");

    if (body.abayaTypeId) {
      const t = await prisma.abayaType.findUnique({ where: { id: body.abayaTypeId } });
      if (!t) throw new AppError(400, "Abaya type not found", "NOT_FOUND");
    }

    if (body.defaultFabricRollId !== undefined && body.defaultFabricRollId !== null) {
      const roll = await prisma.fabricRoll.findUnique({ where: { id: body.defaultFabricRollId } });
      if (!roll) throw new AppError(400, "Fabric roll not found", "NOT_FOUND");
    }

    await prisma.abayaModel.update({
      where: { id },
      data: {
        ...(body.code !== undefined ? { code: body.code.trim() } : {}),
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.description !== undefined ? { description: body.description?.trim() || null } : {}),
        ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl?.trim() || null } : {}),
        ...(body.workflowStagesJson !== undefined
          ? { workflowStagesJson: body.workflowStagesJson?.trim() || null }
          : {}),
        ...(body.defaultPriceFils !== undefined ? { defaultPriceFils: body.defaultPriceFils } : {}),
        ...(body.defaultFabricRollId !== undefined
          ? { defaultFabricRollId: body.defaultFabricRollId }
          : {}),
        ...(body.defaultDeliveryDays !== undefined ? { defaultDeliveryDays: body.defaultDeliveryDays } : {}),
        ...(body.cuttingWageFils !== undefined ? { cuttingWageFils: body.cuttingWageFils } : {}),
        ...(body.sewingWageFils !== undefined ? { sewingWageFils: body.sewingWageFils } : {}),
        ...(body.finishingWageFils !== undefined ? { finishingWageFils: body.finishingWageFils } : {}),
        ...(body.embroideryWageFils !== undefined ? { embroideryWageFils: body.embroideryWageFils } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.abayaTypeId !== undefined ? { abayaTypeId: body.abayaTypeId } : {}),
      },
    });

    await syncLinkedProductForAbayaModelId(id);

    const full = await prisma.abayaModel.findUnique({
      where: { id },
      include: {
        abayaType: { select: { id: true, code: true, labelAr: true } },
        product: true,
        defaultFabricRoll: { select: { id: true, rollCode: true, name: true, color: true } },
      },
    });
    res.status(200).json({ success: true, data: full });
  }),
);

abayaModelsAdminRouter.delete(
  "/:id",
  requirePermission("models.delete"),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!id) throw new AppError(400, "Missing id", "BAD_REQUEST");
    const existing = await prisma.abayaModel.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, "Model not found", "NOT_FOUND");

    await prisma.abayaModel.update({
      where: { id },
      data: { isActive: false },
    });
    await syncLinkedProductForAbayaModelId(id);

    res.status(200).json({ success: true, data: { id, deactivated: true } });
  }),
);
