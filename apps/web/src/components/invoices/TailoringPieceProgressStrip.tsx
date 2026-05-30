import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PIPELINE_STAGE_KEYS } from "@abaya-shop/shared";
import { cn } from "@/lib/utils";
import {
  isPieceOverdueForInvoice,
  labelForWorkStageKey,
  pipelineProgress,
  stageKindClasses,
  stageStatusGlyph,
  workStageRowKind,
} from "@/lib/invoiceTailoringUi";
import type { WorkshopWorkStageRow } from "@/components/job-orders/WorkshopTaskSheet";

type JobLite = {
  stage: string;
  workStages: WorkshopWorkStageRow[];
  deliveredAt?: string | null;
};

const SEGMENTS = 8;

export function TailoringPieceProgressStrip({
  workStages,
  jobStage,
  job,
  invoiceDeliveryDateIso,
}: {
  workStages: WorkshopWorkStageRow[];
  jobStage: string;
  job: JobLite;
  invoiceDeliveryDateIso: string | null | undefined;
}) {
  const baseId = useId();
  const { t } = useTranslation();
  const sorted = useMemo(
    () => [...workStages].sort((a, b) => a.sortOrder - b.sortOrder),
    [workStages],
  );
  const pieceOverdue = isPieceOverdueForInvoice(job, invoiceDeliveryDateIso);
  const { pct, done, total } = pipelineProgress(sorted);
  const pipelineKeys = PIPELINE_STAGE_KEYS as readonly string[];
  const filledSeg = total > 0 ? Math.min(SEGMENTS, Math.round((pct / 100) * SEGMENTS)) : 0;

  const stages = useMemo(() => {
    return sorted
      .filter((row) => pipelineKeys.includes(row.stageKey as (typeof pipelineKeys)[number]))
      .map((row) => {
        const isDone = row.status === "DONE";
        const isCurrent = jobStage === row.stageKey;
        const isFuture = !isDone && !isCurrent;
        const kind = workStageRowKind(row, {
          isPipelineKey: true,
          isCurrent,
          isFuture,
          pieceOverdue,
        });
        return { row, kind, label: labelForWorkStageKey(row.stageKey) };
      });
  }, [sorted, jobStage, pieceOverdue, pipelineKeys]);

  if (stages.length === 0) return null;

  return (
    <div
      className="space-y-2 rounded-xl border border-border/70 bg-muted/20 p-3"
      role="region"
      aria-labelledby={`piece-progress-h-${baseId}`}
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <p
          id={`piece-progress-h-${baseId}`}
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {t("components.progressStrip")}
        </p>
        {total > 0 ? (
          <span className="text-xs font-mono text-muted-foreground tabular-nums" dir="ltr">
            {pct}%
          </span>
        ) : null}
      </div>
      {total > 0 ? (
        <div
          className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
          title={`${done} / ${total} مرحلة مكتملة`}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={cn(
              "h-full rounded-full transition-all",
              pieceOverdue && done < total ? "bg-red-500" : "bg-emerald-600",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
      {total > 0 ? (
        <div className="flex items-center gap-1" dir="ltr" aria-hidden>
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 flex-1 rounded-sm",
                i < filledSeg
                  ? pieceOverdue && filledSeg < SEGMENTS
                    ? "bg-red-500/90"
                    : "bg-emerald-600/90"
                  : "bg-zinc-300/80 dark:bg-zinc-600",
              )}
            />
          ))}
          <span className="shrink-0 ps-1 text-[10px] font-mono text-muted-foreground tabular-nums">{pct}%</span>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2 sm:gap-3">
        {stages.map(({ row, kind, label }) => (
          <span
            key={row.id}
            className={cn(
              "inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-medium",
              stageKindClasses(kind),
            )}
          >
            <span className="truncate" title={`${label} — ${kind}`}>
              {label} {stageStatusGlyph(kind)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
