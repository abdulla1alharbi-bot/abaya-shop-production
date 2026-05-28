import { JOB_STAGE_LABELS, PIPELINE_STAGE_KEYS } from "@abaya-shop/shared";
import { getTailoringItemBadge, type SimpleInvoiceBadge } from "@/lib/invoiceUiStatus";
import type { WorkshopWorkStageRow } from "@/components/job-orders/WorkshopTaskSheet";

export type StageUiKind = "done" | "in_progress" | "pending" | "overdue";

/**
 * For pipeline work-stage rows (aligned with JobProcessPieceTable row logic):
 * - done: مكتمل (أخضر)
 * - in_progress / overdue active piece: قيد التنفيذ (برتقالي) or متأخر (أحمر)
 * - pending / future: لم يبدأ (رمادي) — "لم يبدأ" rows use ❌ in the visual strip
 */
export function workStageRowKind(
  row: WorkshopWorkStageRow,
  o: { isPipelineKey: boolean; isCurrent: boolean; isFuture: boolean; pieceOverdue: boolean },
): StageUiKind {
  if (row.status === "DONE") return "done";
  if (o.isFuture) return "pending";
  if (o.pieceOverdue && o.isPipelineKey) return "overdue";
  if (o.isCurrent || row.status === "IN_PROGRESS") return "in_progress";
  return "pending";
}

export function stageKindClasses(kind: StageUiKind): string {
  switch (kind) {
    case "done":
      return "text-emerald-800 dark:text-emerald-200 border-emerald-300/80 bg-emerald-50/90 dark:border-emerald-800/60 dark:bg-emerald-950/45";
    case "in_progress":
      return "text-amber-900 dark:text-amber-100 border-amber-300/80 bg-amber-50/90 dark:border-amber-800/50 dark:bg-amber-950/35";
    case "overdue":
      return "text-red-900 dark:text-red-100 border-red-300/80 bg-red-50/90 dark:border-red-900/50 dark:bg-red-950/40";
    default:
      return "text-muted-foreground border-border/60 bg-muted/50 dark:bg-muted/30";
  }
}

/** Progress text icons (single-line) — matches spec: ✅ ⏳ ❌. */
export function stageStatusGlyph(kind: StageUiKind): string {
  switch (kind) {
    case "done":
      return "✅";
    case "in_progress":
      return "⏳";
    case "overdue":
      return "⚠️";
    default:
      return "❌";
  }
}

function startOfLocalDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

/**
 * True when the invoice has a delivery promise in the past and the job is not finished (ready/delivered).
 * Uses existing client data only (no new API).
 */
export function isPieceOverdueForInvoice(
  job: { stage: string; workStages: Array<{ status: string }>; deliveredAt?: string | null },
  invoiceDeliveryDateIso: string | null | undefined,
): boolean {
  if (!invoiceDeliveryDateIso) return false;
  if (job.deliveredAt || job.stage === "DELIVERED") return false;
  const badge = getTailoringItemBadge(job, { locale: "ar" });
  if (badge.key === "ready" || badge.key === "delivered") return false;
  const due = new Date(invoiceDeliveryDateIso);
  return startOfLocalDay(due) < startOfLocalDay(new Date());
}

export function lastUpdateFromWorkStages(stages: WorkshopWorkStageRow[]): string | null {
  let max = 0;
  for (const s of stages) {
    if (s.completedAt) max = Math.max(max, new Date(s.completedAt).getTime());
    if (s.assignedAt) max = Math.max(max, new Date(s.assignedAt).getTime());
  }
  return max > 0 ? new Date(max).toLocaleString() : null;
}

export function pipelineProgress(stages: WorkshopWorkStageRow[]): { done: number; total: number; pct: number } {
  const keys = new Set(PIPELINE_STAGE_KEYS as readonly string[]);
  const pipelineRows = stages.filter((s) => keys.has(s.stageKey));
  const done = pipelineRows.filter((r) => r.status === "DONE").length;
  const total = pipelineRows.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return { done, total, pct };
}

type PieceBucket = "complete" | "in_progress" | "overdue";

function badgeToBucket(badge: { key: SimpleInvoiceBadge }): PieceBucket {
  if (badge.key === "ready" || badge.key === "delivered") return "complete";
  return "in_progress";
}

export function summarizeInvoicePieces(
  jobs: Array<{
    stage: string;
    workStages: Array<{ status: string }>;
    deliveredAt?: string | null;
  }>,
  invoiceDeliveryDateIso: string | null | undefined,
): { complete: number; inProgress: number; overdue: number } {
  let complete = 0;
  let inProgress = 0;
  let overdue = 0;
  for (const job of jobs) {
    if (isPieceOverdueForInvoice(job, invoiceDeliveryDateIso)) {
      overdue += 1;
      continue;
    }
    const b = getTailoringItemBadge(job, { locale: "ar" });
    const bucket = badgeToBucket(b);
    if (bucket === "complete") complete += 1;
    else inProgress += 1;
  }
  return { complete, inProgress, overdue };
}

export function labelForWorkStageKey(key: string): string {
  return JOB_STAGE_LABELS[key] ?? key;
}
