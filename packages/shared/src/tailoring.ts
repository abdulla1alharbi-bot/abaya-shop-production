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
  FINISHING: "تجهيز",
  INSPECTION: "فحص الجودة",
  READY: "جاهز",
  DELIVERED: "تم التسليم",
  CANCELLED: "ملغى",
  RECEIVED: "جديد",
};

/** Work types for assignments & labor (stored as enum-like strings in DB) */
export const WORK_TYPES = [
  "CUTTING",
  "SEWING",
  "SEW_BASIC",
  "SEW_LINING",
  "HAND_EMBROIDERY",
  "MACHINE_EMBROIDERY",
  "FINISHING",
  "CUSTOM",
] as const;

export const WORK_TYPE_LABELS: Record<string, string> = {
  CUTTING: "قص",
  SEWING: "خياطة",
  SEW_BASIC: "خياطة أساسية",
  SEW_LINING: "بطانة",
  HAND_EMBROIDERY: "تطريز يدوي",
  MACHINE_EMBROIDERY: "تطريز ماكينة",
  FINISHING: "تجهيز",
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
