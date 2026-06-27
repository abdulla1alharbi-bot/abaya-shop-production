import { prisma } from "../config/db.js";
import { logger } from "../utils/logger.js";

/**
 * Product categories the app relies on. "MODEL" is required by the abaya-model →
 * linked-product sync; "NORMAL" hosts the system tailoring-service line. The rest
 * mirror the POS abaya types so catalog products can be filed correctly.
 */
const PRODUCT_CATEGORIES = [
  "WALTER",
  "SHALIA",
  "GASHWA",
  "NICKAB",
  "MODEL",
  "EMBROIDERY",
  "H&T",
  "NORMAL",
] as const;

/** SKU of the service product every tailoring invoice line is attached to. */
const TAILORING_SERVICE_SKU = "SYS-TAILORING-LINE";

/**
 * Idempotently create the system records the app cannot function without.
 *
 * Runs on every boot so the app is self-healing regardless of whether the
 * (demo) seed ran. Purely additive: it only creates rows that are missing and
 * never edits existing user/business data — safe to run against a live DB.
 */
export async function ensureSystemDefaults(): Promise<void> {
  for (const name of PRODUCT_CATEGORIES) {
    await prisma.productCategory.upsert({ where: { name }, update: {}, create: { name } });
  }

  const normal = await prisma.productCategory.findFirst({ where: { name: "NORMAL" } });
  if (normal) {
    await prisma.product.upsert({
      where: { sku: TAILORING_SERVICE_SKU },
      update: {},
      create: {
        sku: TAILORING_SERVICE_SKU,
        name: "تفصيل — بند خدمة",
        nameAr: "تفصيل",
        categoryId: normal.id,
        costFils: 0,
        priceFils: 0,
        stockQty: 0,
        isService: true,
        isActive: true,
        cuttingWageFils: 500,
        sewingWageFils: 2000,
        embroideryWageFils: 300,
        finishingWageFils: 500,
      },
    });
  }

  logger.info("System defaults ensured", {
    categories: PRODUCT_CATEGORIES.length,
    tailoringServiceSku: TAILORING_SERVICE_SKU,
  });
}
