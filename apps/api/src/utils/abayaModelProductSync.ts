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
