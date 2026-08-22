import { prisma } from "../config/db.js";
import { AppError } from "../middleware/error.middleware.js";

function productSkuForModel(modelId: string): string {
  const compact = modelId.replace(/-/g, "");
  return `ABY-M-${compact.slice(0, 20)}`;
}

/** Keeps a service Product in sync for workshop pipeline wages + default price. */
export async function syncLinkedProductForAbayaModelId(modelId: string): Promise<void> {
  const model = await prisma.abayaModel.findUnique({
    where: { id: modelId },
    include: { abayaType: true },
  });
  if (!model) return;

  const cat = await prisma.productCategory.findFirst({ where: { name: "MODEL" } });
  if (!cat) {
    throw new AppError(500, "Product category MODEL missing. Run seed.", "CONFIG");
  }

  const sku = productSkuForModel(model.id);
  const displayName = `${model.name} (${model.code})`;

  const product = await prisma.product.upsert({
    where: { sku },
    create: {
      sku,
      name: displayName,
      nameAr: model.name,
      categoryId: cat.id,
      costFils: 0,
      priceFils: model.defaultPriceFils,
      stockQty: 0,
      isService: true,
      isActive: model.isActive,
      cuttingWageFils: model.cuttingWageFils,
      sewingWageFils: model.sewingWageFils,
      finishingWageFils: model.finishingWageFils,
      embroideryWageFils: model.embroideryWageFils,
    },
    update: {
      name: displayName,
      nameAr: model.name,
      priceFils: model.defaultPriceFils,
      isActive: model.isActive,
      cuttingWageFils: model.cuttingWageFils,
      sewingWageFils: model.sewingWageFils,
      finishingWageFils: model.finishingWageFils,
      embroideryWageFils: model.embroideryWageFils,
    },
  });

  if (model.productId !== product.id) {
    await prisma.abayaModel.update({
      where: { id: modelId },
      data: { productId: product.id },
    });
  }
}

/** How many model syncs to have in flight at once. */
const SYNC_BATCH = 10;

/**
 * Repair pass over the whole catalogue, used at seed/boot time.
 *
 * The seed used to await `syncLinkedProductForAbayaModelId` once per model, and
 * each of those is three or four round trips — around 300 sequential queries on
 * every container start, for 81 models that almost never changed. Batching keeps
 * the exact same work and the same result, just not one query at a time.
 */
export async function syncLinkedProductsForAllModels(): Promise<number> {
  const models = await prisma.abayaModel.findMany({ select: { id: true } });
  for (let i = 0; i < models.length; i += SYNC_BATCH) {
    const batch = models.slice(i, i + SYNC_BATCH);
    await Promise.all(batch.map((m) => syncLinkedProductForAbayaModelId(m.id)));
  }
  return models.length;
}
