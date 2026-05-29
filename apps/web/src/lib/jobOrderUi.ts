import { JOB_STAGE_LABELS, WORK_TYPE_LABELS } from "@abaya-shop/shared";

/** Simplified workflow for shop floor UI (maps to backend stages). */
export type SimpleJobStatus = "new" | "in_progress" | "ready" | "delivered";

export const SIMPLE_STATUS_LABELS_AR: Record<SimpleJobStatus, string> = {
  new: "جديد",
  in_progress: "قيد التنفيذ",
  ready: "جاهز",
  delivered: "تم التسليم",
};

export const SIMPLE_STATUS_KEYS: Record<SimpleJobStatus, string> = {
  new: "status.job.new",
  in_progress: "status.job.in_progress",
  ready: "status.job.ready",
  delivered: "status.job.delivered",
};

export function normalizeJobStage(s: string): string {
  if (s === "RECEIVED") return "NEW";
  return s;
}

export function toSimpleStatus(stage: string): SimpleJobStatus {
  const n = normalizeJobStage(stage);
  if (n === "DELIVERED") return "delivered";
  if (n === "READY") return "ready";
  if (n === "NEW") return "new";
  if (n === "CUTTING" || n === "SEWING" || n === "FINISHING") return "in_progress";
  return "new";
}

export function simpleStatusBadgeClass(s: SimpleJobStatus): string {
  switch (s) {
    case "new":
      return "bg-sky-100 text-sky-950 dark:bg-sky-950/50 dark:text-sky-100";
    case "in_progress":
      return "bg-amber-100 text-amber-950 dark:bg-amber-950/50 dark:text-amber-100";
    case "ready":
      return "bg-emerald-100 text-emerald-950 dark:bg-emerald-950/50 dark:text-emerald-100";
    case "delivered":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-muted";
  }
}

/** Backend stage to send when user taps a simple action */
export function stageForStartWork(): "CUTTING" {
  return "CUTTING";
}
export function stageForMarkReady(): "READY" {
  return "READY";
}
export function stageForMarkDelivered(): "DELIVERED" {
  return "DELIVERED";
}

export function canStartWork(stage: string): boolean {
  return normalizeJobStage(stage) === "NEW";
}
export function canMarkReady(stage: string): boolean {
  const n = normalizeJobStage(stage);
  return n === "CUTTING" || n === "SEWING" || n === "FINISHING";
}
export function canMarkDelivered(stage: string): boolean {
  return normalizeJobStage(stage) === "READY";
}

export function paymentStatusLabel(balanceFils: number, paidFils: number): {
  key: "paid" | "unpaid" | "partial";
  label: string;
  i18nKey: string;
} {
  if (balanceFils <= 0) return { key: "paid", label: "مدفوع", i18nKey: "status.payment.paid" };
  if (paidFils <= 0) return { key: "unpaid", label: "غير مدفوع", i18nKey: "status.payment.unpaid" };
  return { key: "partial", label: "جزئي", i18nKey: "status.payment.partial" };
}

export function stageLabel(stage: string): string {
  return JOB_STAGE_LABELS[stage] ?? stage;
}

export function workTypeLabel(workType: string): string {
  return WORK_TYPE_LABELS[workType] ?? workType;
}

export function fabricSummary(
  materials: Array<{ meters: number; roll: { rollCode: string; name: string; color: string } }>,
): string {
  if (!materials?.length) return "—";
  return materials
    .map((m) => `${m.roll.rollCode} ${m.roll.color} (${m.meters}م)`)
    .join(" · ");
}
