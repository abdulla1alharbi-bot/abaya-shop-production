import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/rbac.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../middleware/error.middleware.js";
import { prismaSkipTake, buildPaginatedMeta } from "../../utils/pagination.js";
import { parseActiveOnlyTrue, parsePageLimit, parseRetailOnlyTrue, queryParamString } from "../../utils/queryParams.js";

export const productsRouter = Router();
productsRouter.use(authMiddleware);

productsRouter.get(
  "/categories",
  requirePermission("readyMade.view"),
  asyncHandler(async (_req, res) => {
    const categories = await prisma.productCategory.findMany({ orderBy: { name: "asc" } });
    res.status(200).json({ success: true, data: categories });
  }),
);

productsRouter.get(
  "/",
  requirePermission("readyMade.view"),
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const { page, limit } = parsePageLimit(q, { defaultLimit: 50 });
    const pagination = { page, limit };
    const { skip, take } = prismaSkipTake(pagination);
    const search = queryParamString(q, "q");
    const categoryId = queryParamString(q, "categoryId");
    const activeOnly = parseActiveOnlyTrue(q);
    const retailOnly = parseRetailOnlyTrue(q);
    const where: Record<string, unknown> = {};
    if (activeOnly) where.isActive = true;
    if (retailOnly) where.isService = false;
    if (retailOnly) where.isSample = false;
    if (categoryId) where.categoryId = categoryId;
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { sku: { contains: search } },
        { barcode: { contains: search } },
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.product.count({ where: where as never }),
      prisma.product.findMany({
        where: where as never,
        orderBy: { name: "asc" },
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

const productBody = z.object({
  sku: z.string().min(1),
  barcode: z.string().optional(),
  name: z.string().min(1),
  nameAr: z.string().optional(),
  categoryId: z.string().min(1),
  costFils: z.number().int().min(0),
  priceFils: z.number().int().min(0),
  stockQty: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  isService: z.boolean().optional(),
  catalogImageUrl: z.string().max(2000).optional().nullable(),
  /** Tailoring pipeline default wages (fils) */
  cuttingWageFils: z.number().int().min(0).optional(),
  sewingWageFils: z.number().int().min(0).optional(),
  finishingWageFils: z.number().int().min(0).optional(),
  embroideryWageFils: z.number().int().min(0).optional(),
});

productsRouter.post(
  "/",
  requirePermission("readyMade.create"),
  validateBody(productBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof productBody>;
    const exists = await prisma.product.findUnique({ where: { sku: body.sku } });
    if (exists) throw new AppError(409, "SKU already exists", "DUPLICATE");
    if (body.barcode) {
      const bc = await prisma.product.findUnique({ where: { barcode: body.barcode } });
      if (bc) throw new AppError(409, "Barcode already exists", "DUPLICATE");
    }
    const product = await prisma.product.create({
      data: {
        sku: body.sku.trim(),
        barcode: body.barcode?.trim(),
        name: body.name.trim(),
        nameAr: body.nameAr?.trim(),
        categoryId: body.categoryId,
        costFils: body.costFils,
        priceFils: body.priceFils,
        stockQty: body.stockQty ?? 0,
        isActive: body.isActive ?? true,
        isService: body.isService ?? false,
        catalogImageUrl: body.catalogImageUrl?.trim() || null,
        cuttingWageFils: body.cuttingWageFils,
        sewingWageFils: body.sewingWageFils,
        finishingWageFils: body.finishingWageFils,
        embroideryWageFils: body.embroideryWageFils,
      },
      include: { category: true },
    });
    res.status(201).json({ success: true, data: product });
  }),
);

productsRouter.get(
  "/:id",
  requirePermission("readyMade.view"),
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: { category: true, images: true },
    });
    if (!product) throw new AppError(404, "Product not found", "NOT_FOUND");
    res.status(200).json({ success: true, data: product });
  }),
);

const productBodyPartial = productBody.partial();

productsRouter.patch(
  "/:id",
  requirePermission("readyMade.edit"),
  validateBody(productBodyPartial),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof productBodyPartial>;
    const id = req.params.id;
    if (body.sku) {
      const clash = await prisma.product.findFirst({ where: { sku: body.sku, NOT: { id } } });
      if (clash) throw new AppError(409, "SKU already exists", "DUPLICATE");
    }
    if (body.barcode) {
      const clash = await prisma.product.findFirst({ where: { barcode: body.barcode, NOT: { id } } });
      if (clash) throw new AppError(409, "Barcode already exists", "DUPLICATE");
    }
    const product = await prisma.product.update({
      where: { id },
      data: {
        sku: body.sku?.trim(),
        barcode: body.barcode?.trim(),
        name: body.name?.trim(),
        nameAr: body.nameAr?.trim(),
        categoryId: body.categoryId,
        costFils: body.costFils,
        priceFils: body.priceFils,
        stockQty: body.stockQty,
        isActive: body.isActive,
        isService: body.isService,
        catalogImageUrl:
          body.catalogImageUrl !== undefined ? body.catalogImageUrl?.trim() || null : undefined,
        cuttingWageFils: body.cuttingWageFils,
        sewingWageFils: body.sewingWageFils,
        finishingWageFils: body.finishingWageFils,
        embroideryWageFils: body.embroideryWageFils,
      },
      include: { category: true },
    });
    res.status(200).json({ success: true, data: product });
  }),
);

productsRouter.delete(
  "/:id",
  requirePermission("readyMade.delete"),
  asyncHandler(async (req, res) => {
    await prisma.product.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.status(200).json({ success: true, data: { deleted: true } });
  }),
);
