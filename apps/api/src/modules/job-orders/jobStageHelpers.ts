import type { Prisma, Product } from "@prisma/client";

/** Must match `PIPELINE_STAGE_KEYS` in `@abaya-shop/shared` / tailoring UI */
export const PIPELINE_STAGE_KEYS = ["CUTTING", "SEWING", "EMBROIDERY", "FINISHING"] as const;

/** Ordered subset from model JSON; falls back to full pipeline. */
export function resolvePipelineStageKeysFromModelJson(json: string | null | undefined): string[] {
  if (!json?.trim()) return [...PIPELINE_STAGE_KEYS];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [...PIPELINE_STAGE_KEYS];
    const pick = new Set(parsed.filter((k): k is string => typeof k === "string"));
    const ordered = PIPELINE_STAGE_KEYS.filter((k) => pick.has(k));
    return ordered.length > 0 ? [...ordered] : [...PIPELINE_STAGE_KEYS];
  } catch {
    return [...PIPELINE_STAGE_KEYS];
  }
}

export function initialPipelineStage(keys: string[]): string {
  if (keys.includes("CUTTING")) return "CUTTING";
  return keys[0] ?? "CUTTING";
}

export type StageDefaults = {
  cutting: number;
  sewing: number;
  embroidery: number;
  finishing: number;
};

export function parseWageDefaults(settings: Record<string, string>): StageDefaults {
  return {
    cutting: Math.max(0, parseInt(settings.default_cutting_wage_fils ?? "500", 10) || 500),
    sewing: Math.max(0, parseInt(settings.default_sewing_wage_fils ?? "2000", 10) || 2000),
    embroidery: Math.max(0, parseInt(settings.default_embroidery_wage_fils ?? "300", 10) || 300),
    finishing: Math.max(0, parseInt(settings.default_finishing_wage_fils ?? "500", 10) || 500),
  };
}

export function wageForPipelineStage(
  stageKey: string,
  product: Pick<Product, "cuttingWageFils" | "sewingWageFils" | "embroideryWageFils" | "finishingWageFils"> | null,
  defaults: StageDefaults,
): number {
  if (product) {
    if (stageKey === "CUTTING") return product.cuttingWageFils > 0 ? product.cuttingWageFils : defaults.cutting;
    if (stageKey === "SEWING") return product.sewingWageFils > 0 ? product.sewingWageFils : defaults.sewing;
    if (stageKey === "EMBROIDERY")
      return product.embroideryWageFils > 0 ? product.embroideryWageFils : defaults.embroidery;
    if (stageKey === "FINISHING")
      return product.finishingWageFils > 0 ? product.finishingWageFils : defaults.finishing;
  }
  if (stageKey === "CUTTING") return defaults.cutting;
  if (stageKey === "SEWING") return defaults.sewing;
  if (stageKey === "EMBROIDERY") return defaults.embroidery;
  if (stageKey === "FINISHING") return defaults.finishing;
  return 0;
}

/** Ordered stage keys as stored on the job (supports legacy 3-step pipelines). */
export function orderedPipelineKeys(
  workStages: Array<{ sortOrder: number; stageKey: string }>,
): string[] {
  return [...workStages].sort((a, b) => a.sortOrder - b.sortOrder).map((s) => s.stageKey);
}

/** Next job `stage` after completing `stageKey` (last pipeline step → INSPECTION for QA gate). */
export function nextStageAfterComplete(stageKey: string, orderedKeys: string[]): string {
  const i = orderedKeys.indexOf(stageKey);
  if (i < 0 || i >= orderedKeys.length - 1) return "INSPECTION";
  return orderedKeys[i + 1]!;
}

/** Inserts pipeline rows for a catalog product (default CUTTING → … → FINISHING). */
export async function createPipelineRowsForJob(
  tx: Prisma.TransactionClient,
  jobOrderId: string,
  product: Product,
  wageDefaults: StageDefaults,
  stageKeys: readonly string[] = PIPELINE_STAGE_KEYS,
): Promise<void> {
  let i = 0;
  for (const key of stageKeys) {
    if (!(PIPELINE_STAGE_KEYS as readonly string[]).includes(key)) continue;
    await tx.jobOrderWorkStage.create({
      data: {
        jobOrderId,
        stageKey: key,
        sortOrder: i,
        status: "PENDING",
        wageFils: wageForPipelineStage(key, product, wageDefaults),
      },
    });
    i += 1;
  }
}
