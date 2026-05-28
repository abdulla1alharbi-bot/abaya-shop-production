import { useId } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { lastUpdateFromWorkStages, labelForWorkStageKey } from "@/lib/invoiceTailoringUi";
import { formatAED } from "@/lib/money";
import type { WorkshopWorkStageRow } from "@/components/job-orders/WorkshopTaskSheet";
import { PIPELINE_STAGE_KEYS } from "@abaya-shop/shared";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pieceLabel: string;
  jobNo: number;
  productStyle: string;
  fabric: string;
  color: string;
  workStages: WorkshopWorkStageRow[];
  lineTotalFils: number | null;
  showMoney: boolean;
};

export function TailoringPieceQuickViewDialog({
  open,
  onOpenChange,
  pieceLabel,
  jobNo,
  productStyle,
  fabric,
  color,
  workStages,
  lineTotalFils,
  showMoney,
}: Props) {
  const uid = useId();
  const last = lastUpdateFromWorkStages(workStages);
  const keys = new Set(PIPELINE_STAGE_KEYS as readonly string[]);
  const stageRows = [...workStages]
    .filter((r) => keys.has(r.stageKey))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90vh,640px)] max-w-md overflow-y-auto" dir="rtl">
        <DialogHeader className="text-start">
          <DialogTitle>عرض القطعة — أمر العمل #{jobNo}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="font-medium leading-relaxed text-foreground">{pieceLabel}</p>
          <dl className="grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">الموديل (الستايل)</dt>
              <dd className="font-medium">{productStyle || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">القماش</dt>
              <dd className="font-medium">{fabric}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">اللون</dt>
              <dd className="font-medium">{color}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">آخر تحديث</dt>
              <dd>{last ?? "—"}</dd>
            </div>
            {showMoney && lineTotalFils != null ? (
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">إجمالي سطر التفصيل</dt>
                <dd className="font-mono font-semibold tabular-nums">{formatAED(lineTotalFils)}</dd>
              </div>
            ) : null}
          </dl>
          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">عامل لكل مرحلة (قراءة)</p>
            <ul className="space-y-1.5 text-xs">
              {stageRows.map((r) => (
                <li key={r.id} className="flex flex-wrap justify-between gap-2 border-b border-border/50 py-1.5 last:border-0" id={`${uid}-st-${r.id}`}>
                  <span className="text-muted-foreground">{labelForWorkStageKey(r.stageKey)}</span>
                  <span className="font-medium">{r.worker?.name ?? "—"}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
