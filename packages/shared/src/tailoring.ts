/** Invoice hub operational status (computed server-side; keep in sync with API) */
export type InvoiceFulfillmentStatus =
  | "VOID"
  | "DELIVERED"
  | "READY_FOR_DELIVERY"
  | "IN_WORKSHOP"
  | "NO_TAILORING";

/** Stages that use automatic per-model wages + worker assignment (sequential) */
export const PIPELINE_STAGE_KEYS = ["CUTTING", "SEWING", "EMBROIDERY", "FINISHING"] as const;
export type PipelineStageKey = (typeof PIPELINE_STAGE_KEYS)[number];

/** Job pipeline stages for tailoring orders (production → delivery) */
export const JOB_STAGES = [
  "NEW",
  "CUTTING",
  "SEWING",
  "EMBROIDERY",
  "FINISHING",
  /**
   * RETIRED — nothing routes here any more; finishing the last pipeline stage goes
   * straight to READY. Kept as a valid value so historical jobs and their stage logs
   * still render. See `nextStageAfterComplete`.
   */
  "INSPECTION",
  "READY",
  "DELIVERED",
  "CANCELLED",
] as const;
export type JobStage = (typeof JOB_STAGES)[number];

/** UI labels (short) — Arabic-first for shop screens */
export const JOB_STAGE_LABELS: Record<string, string> = {
  NEW: "جديد",
  CUTTING: "قص",
  SEWING: "خياطة",
  EMBROIDERY: "تطريز",
  FINISHING: "الشغل اليدوي",
  INSPECTION: "فحص الجودة",
  READY: "جاهز",
  DELIVERED: "تم التسليم",
  CANCELLED: "ملغى",
  RECEIVED: "جديد",
};

/** English stage labels — canonical workshop names (CUTTING/TAILORING/HANDWORK/EMBROIDERY). */
export const JOB_STAGE_LABELS_EN: Record<string, string> = {
  NEW: "New",
  CUTTING: "Cutting",
  SEWING: "Tailoring",
  EMBROIDERY: "Embroidery",
  FINISHING: "Handwork",
  INSPECTION: "Quality Check",
  READY: "Ready",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  RECEIVED: "New",
};

/** Locale-aware stage label; falls back to the Arabic map, then the raw key. */
export function jobStageLabel(stage: string, lang: "ar" | "en" = "ar"): string {
  const map = lang === "en" ? JOB_STAGE_LABELS_EN : JOB_STAGE_LABELS;
  return map[stage] ?? JOB_STAGE_LABELS[stage] ?? stage;
}

/** Work types for assignments & labor (stored as enum-like strings in DB) */
export const WORK_TYPES = [
  "CUTTING",
  "SEWING",
  "SEW_BASIC",
  "SEW_LINING",
  "HAND_EMBROIDERY",
  "MACHINE_EMBROIDERY",
  "FINISHING",
  "ARI",
  "PUSSOS",
  "CUSTOM",
] as const;

/**
 * Workshop work that is NOT a pipeline stage: only some pieces get it, so it
 * never blocks a piece from becoming READY. Recorded as a ProductionEntry on
 * the job (its wage counts like any stage wage) — see the job's «شغل إضافي».
 * The shop's own names, kept as written on the workshop sheet.
 */
export const EXTRA_WORK_TYPES = ["ARI", "PUSSOS"] as const;
export type ExtraWorkType = (typeof EXTRA_WORK_TYPES)[number];

export function isExtraWorkType(workType: string): workType is ExtraWorkType {
  return (EXTRA_WORK_TYPES as readonly string[]).includes(workType);
}

export const WORK_TYPE_LABELS: Record<string, string> = {
  CUTTING: "قص",
  SEWING: "خياطة",
  SEW_BASIC: "خياطة أساسية",
  SEW_LINING: "بطانة",
  HAND_EMBROIDERY: "تطريز يدوي",
  MACHINE_EMBROIDERY: "تطريز ماكينة",
  FINISHING: "الشغل اليدوي",
  ARI: "ARI",
  PUSSOS: "PUSSOS",
  CUSTOM: "أخرى",
};

/** Common abaya / dress types for POS tailoring flow */
export const ABAYA_TYPES = [
  { id: "WALTER", label: "Walter / ولف" },
  { id: "SHALIA", label: "Shalia / شاليه" },
  { id: "GASHWA", label: "Gashwa / قشوة" },
  { id: "NICKAB", label: "Nickab / نقاب" },
  { id: "MODEL", label: "Model / موديل" },
  { id: "EMBROIDERY", label: "Embroidery / تطريز" },
  { id: "CUSTOM", label: "Custom / تفصيل حسب الطلب" },
] as const;

/**
 * Reading hints sent to Claude with every workshop-sheet photo (setting
 * `sheet_reader_hints` overrides them; the Settings card shows these when it is
 * empty). The owner's own rules from the 2026-11 discussion.
 */
export const DEFAULT_SHEET_READER_HINTS = [
  '"Ari" or "Baniyas" written where a name goes means the worker whose job is ARI (his card is "Ari baniyas").',
  '"Jakir", "Jalin", "Shakil" mean Sakil. "Robel", "Rokel" mean Rubel. "Hasom" means Hasam. "Shajhan", "Shazhan", "Shajahan" mean Sahajahan. "Sodan", "Sobar" mean Sobur. "Mahbob" means mahboob.',
  "Aman and Imran look alike in this handwriting — when unsure which one, set confidence to low.",
  "MODEL column words: W = تعديل (alteration), Shda = سادة (plain abaya), Sela = شيلة (shayla), Nikab = نقاب.",
  'A long horizontal stroke after a number is just a line, not a 7 ("12——" is 12, "2——" is 2).',
  "A crossed-out name or number does not count; the value written next to or above it replaces it.",
  '"3P", "5P", "11-P" before an invoice number is the number of pieces; the amount on that line is the total for all of them.',
].join("\n");
