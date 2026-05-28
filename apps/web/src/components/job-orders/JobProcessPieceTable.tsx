import { useEffect, useMemo, useState } from "react";
import { isAxiosError } from "axios";
import { Check } from "lucide-react";
import { JOB_STAGE_LABELS, PIPELINE_STAGE_KEYS } from "@abaya-shop/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { formatAED } from "@/lib/money";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";
import { Input } from "@/components/ui/input";
import {
  fromLocalDatetimeValue,
  toLocalDatetimeValue,
  type WorkshopWorkStageRow,
} from "./WorkshopTaskSheet";
import { stageKindClasses, workStageRowKind } from "@/lib/invoiceTailoringUi";

type Props = {
  jobId: string;
  jobNo: number;
  productStyle: string;
  jobStage: string;
  /** When true, hide invoice line selling totals (e.g. Worker role). */
  hideInvoiceLinePricing?: boolean;
  /** `invoice`: clearer rows, colors, and borders for the invoice detail page. */
  layoutVariant?: "default" | "invoice";
  /** When delivery date is past and the piece is not finished (UI hint only; same as invoice progress strip). */
  pieceOverdue?: boolean;
  invoiceLine?: {
    totalFils: number;
    description?: string | null;
    qty: number;
    unitFils: number;
  } | null;
  product?: {
    name: string;
    cuttingWageFils?: number;
    sewingWageFils?: number;
    embroideryWageFils?: number;
    finishingWageFils?: number;
  } | null;
  workStages: WorkshopWorkStageRow[];
  onInvalidateExtras?: () => void;
};

function apiErrorMessage(err: unknown): string {
  if (isAxiosError(err) && err.response?.data && typeof err.response.data === "object") {
    const d = err.response.data as { error?: { message?: string } };
    if (d.error?.message) return d.error.message;
  }
  if (err instanceof Error) return err.message;
  return "Request failed";
}

/**
 * Invoice job process: per-row worker dropdown + checkbox for the active stage.
 * PATCH saves planned worker on PENDING rows; POST `complete-one-click` completes the current stage.
 */
export function JobProcessPieceTable({
  jobId,
  jobNo,
  productStyle,
  jobStage,
  hideInvoiceLinePricing = false,
  invoiceLine,
  product: linkedProduct,
  workStages,
  onInvalidateExtras,
  layoutVariant = "default",
  pieceOverdue = false,
}: Props) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  /** OWNER / MANAGER / ADMIN — includes `jobProcess.adminEdit` when role defaults apply */
  const isJobProcessAdmin = can("jobProcess.adminEdit");
  const canComplete = can("jobProcess.complete");
  const canEditWage = can("jobProcess.editWage") || can("jobProcess.adminEdit");
  const canReopen = can("jobProcess.adminEdit") || can("jobProcess.reopenStage");

  const [initProductId, setInitProductId] = useState("");
  /** Per-stage selected worker (synced with server + optimistic). */
  const [workerByStage, setWorkerByStage] = useState<Record<string, string>>({});
  const [completionError, setCompletionError] = useState<string | null>(null);

  const { data: workers } = useQuery({
    queryKey: ["workers", "job-process-piece"],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { items: Array<{ id: string; name: string }> };
      }>("/workers", { params: { limit: 200 } });
      return res.data.data.items;
    },
  });

  const { data: catalogProducts } = useQuery({
    queryKey: ["products", "job-process-init"],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { items: Array<{ id: string; name: string; sku: string }> };
      }>("/products", { params: { limit: 200, activeOnly: "true" } });
      return res.data.data.items;
    },
    enabled: workStages.length === 0,
  });

  useEffect(() => {
    setWorkerByStage((prev) => {
      const next = { ...prev };
      for (const r of workStages) {
        if (r.workerId) next[r.stageKey] = r.workerId;
      }
      return next;
    });
  }, [workStages]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["job-order", jobId] });
    void queryClient.invalidateQueries({ queryKey: ["job-orders"] });
    void queryClient.invalidateQueries({ queryKey: ["workers"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    onInvalidateExtras?.();
  };

  const initPipeline = useMutation({
    mutationFn: async () => {
      if (!initProductId) throw new Error("اختر موديلاً من الكتالوج");
      await api.post(`/job-orders/${jobId}/init-pipeline`, { productId: initProductId });
    },
    onSuccess: () => {
      invalidate();
      setInitProductId("");
    },
  });

  const sortedStages = useMemo(
    () => [...workStages].sort((a, b) => a.sortOrder - b.sortOrder),
    [workStages],
  );

  const patchStageWorker = useMutation({
    mutationFn: async ({
      stageKey,
      workerId,
    }: {
      stageKey: string;
      workerId: string | null;
    }) => {
      await api.patch(`/job-orders/${jobId}/work-stages/${stageKey}`, {
        workerId: workerId === "" || workerId == null ? null : workerId,
      });
    },
    onSuccess: () => invalidate(),
  });

  const reopenStage = useMutation({
    mutationFn: async (stageKey: string) => {
      await api.post(`/job-orders/${jobId}/work-stages/${stageKey}/reopen`);
    },
    onSuccess: () => invalidate(),
  });

  /** Inline admin editor: worker, wage (AED), optional notes / completion time for DONE */
  const [adminDrafts, setAdminDrafts] = useState<
    Record<string, { workerId: string; wageAed: string; notes: string; completedLocal: string }>
  >({});

  useEffect(() => {
    if (!isJobProcessAdmin) return;
    const next: Record<string, { workerId: string; wageAed: string; notes: string; completedLocal: string }> = {};
    for (const r of workStages) {
      next[r.stageKey] = {
        workerId: r.workerId ?? "",
        wageAed: String((r.wageFils ?? 0) / 100),
        notes: r.notes ?? "",
        completedLocal: toLocalDatetimeValue(r.completedAt ?? undefined),
      };
    }
    setAdminDrafts(next);
  }, [workStages, isJobProcessAdmin]);

  const saveAdminRow = useMutation({
    mutationFn: async ({
      row,
      draft,
    }: {
      row: WorkshopWorkStageRow;
      draft: { workerId: string; wageAed: string; notes: string; completedLocal: string };
    }) => {
      const wageFils = Math.round((parseFloat(draft.wageAed) || 0) * 100);
      const wid = draft.workerId.trim();
      if (!wid) throw new Error("اختر عاملاً");
      const payload: {
        workerId: string;
        wageFils?: number;
        notes: string | null;
        completedAt?: string;
      } = {
        workerId: wid,
        notes: draft.notes.trim() ? draft.notes.trim() : null,
      };
      if (canEditWage) payload.wageFils = wageFils;
      if (row.status === "DONE") {
        const completedIso = fromLocalDatetimeValue(draft.completedLocal);
        if (completedIso) payload.completedAt = completedIso;
      }
      await api.patch(`/job-orders/${jobId}/work-stages/${row.stageKey}`, payload);
    },
    onSuccess: () => invalidate(),
  });

  const completeOneClick = useMutation({
    mutationFn: async ({
      stageKey,
      wageFils,
      workerId,
    }: {
      stageKey: string;
      wageFils: number;
      workerId?: string;
    }) => {
      await api.post(`/job-orders/${jobId}/work-stages/${stageKey}/complete-one-click`, {
        ...(workerId?.trim() ? { workerId: workerId.trim() } : {}),
        ...(canEditWage ? { wageFils } : {}),
        completedAt: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      setCompletionError(null);
      invalidate();
    },
    onError: (err) => {
      setCompletionError(apiErrorMessage(err));
    },
  });

  const workerIdForRow = (row: WorkshopWorkStageRow) =>
    workerByStage[row.stageKey] ?? row.workerId ?? "";

  const handleCheckboxChange = (
    row: WorkshopWorkStageRow,
    isCurrent: boolean,
    checked: boolean,
  ) => {
    setCompletionError(null);
    if (row.status === "DONE") {
      if (!checked && canReopen) {
        reopenStage.mutate(row.stageKey);
      }
      return;
    }

    if (!checked) return;
    if (!isCurrent) return;

    const wid = workerIdForRow(row).trim();
    if (!wid) {
      setCompletionError("Please select a worker first");
      return;
    }

    if (row.status === "PENDING" || row.status === "IN_PROGRESS") {
      completeOneClick.mutate({
        stageKey: row.stageKey,
        wageFils: row.wageFils,
        workerId: wid,
      });
    }
  };

  if (workStages.length === 0) {
    return (
      <div className="border border-zinc-900 bg-white p-3 text-sm dark:border-zinc-600 dark:bg-zinc-950">
        <p className="mb-2 font-semibold">
          طلب #{jobNo} — {productStyle}
        </p>
        <p className="mb-3 text-muted-foreground">
          لا يوجد مسار مراحل. اربط موديلاً من الكتالوج لتفعيل الجدول (قص / خياطة / …).
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label className="text-xs">موديل الكتالوج</Label>
            <select
              className="mt-1 flex h-9 min-w-[220px] rounded border border-zinc-900 bg-white px-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
              value={initProductId}
              onChange={(e) => setInitProductId(e.target.value)}
            >
              <option value="">— اختر —</option>
              {catalogProducts?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sku})
                </option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!initProductId || initPipeline.isPending}
            onClick={() => initPipeline.mutate()}
          >
            {initPipeline.isPending ? "…" : "تفعيل المراحل"}
          </Button>
        </div>
        {initPipeline.isError ? (
          <p className="mt-2 text-xs text-destructive">{(initPipeline.error as Error).message}</p>
        ) : null}
      </div>
    );
  }

  const th =
    "border border-zinc-900 bg-zinc-100 px-2 py-2 text-start text-xs font-semibold dark:border-zinc-600 dark:bg-zinc-800";
  const thInv =
    "border-0 border-b border-border/80 bg-muted/60 px-3 py-2.5 text-start text-xs font-bold uppercase tracking-wide text-muted-foreground first:rounded-ss-xl last:rounded-se-xl";
  const td = "border border-zinc-900 px-2 py-2 align-middle text-xs dark:border-zinc-600";
  const tdInv = "border-0 border-b border-border/50 px-3 py-3 align-middle text-sm last:border-b-0";
  const tableWrap = "w-full border-collapse text-sm";
  const tableInv =
    "w-full border-separate border-spacing-0 text-sm [border-spacing-y:0.25rem]";

  return (
    <div
      className={cn(
        "overflow-x-auto",
        layoutVariant === "invoice" && "rounded-xl border border-border/70 bg-card/50 p-2 shadow-sm",
      )}
    >
      {invoiceLine || linkedProduct ? (
        <p className="mb-2 text-xs text-muted-foreground">
          {linkedProduct ? <>موديل: {linkedProduct.name} · </> : null}
          {invoiceLine ? (
            <>
              بند: {invoiceLine.description ?? "—"} · كمية {invoiceLine.qty}
              {!hideInvoiceLinePricing ? (
                <> · إجمالي السطر {formatAED(invoiceLine.totalFils)}</>
              ) : null}
            </>
          ) : null}
        </p>
      ) : null}

      <table className={layoutVariant === "invoice" ? tableInv : tableWrap}>
        <thead>
          <tr>
            <th className={layoutVariant === "invoice" ? thInv : th}>#</th>
            <th className={layoutVariant === "invoice" ? thInv : th}>المرحلة</th>
            <th className={layoutVariant === "invoice" ? thInv : th}>العامل</th>
            <th className={layoutVariant === "invoice" ? thInv : th}>أجر العامل</th>
          </tr>
        </thead>
        <tbody>
          {sortedStages.map((row, idx) => {
            const label = JOB_STAGE_LABELS[row.stageKey] ?? row.stageKey;
            const isPipelineKey = (PIPELINE_STAGE_KEYS as readonly string[]).includes(row.stageKey);
            const isCurrent = isPipelineKey && jobStage === row.stageKey;
            const isDone = row.status === "DONE";
            const isFuture = isPipelineKey && !isDone && !isCurrent;
            const invoiceRowKind =
              layoutVariant === "invoice"
                ? workStageRowKind(row, { isPipelineKey, isCurrent, isFuture, pieceOverdue })
                : null;

            const completingThis =
              completeOneClick.isPending &&
              completeOneClick.variables?.stageKey === row.stageKey;
            const reopeningThis = reopenStage.isPending && reopenStage.variables === row.stageKey;
            const patchingThis =
              patchStageWorker.isPending && patchStageWorker.variables?.stageKey === row.stageKey;
            const showWorkerSelect = !isDone && (row.status === "PENDING" || row.status === "IN_PROGRESS");
            const showAdminEditor = isJobProcessAdmin && !isFuture;
            const draft = adminDrafts[row.stageKey];
            const savingThis = saveAdminRow.isPending && saveAdminRow.variables?.row.stageKey === row.stageKey;
            const rowBusy = completingThis || reopeningThis || patchingThis || savingThis;

            const doneBg = isDone
              ? "bg-emerald-50 dark:bg-emerald-950/35"
              : isCurrent
                ? "bg-amber-50/70 dark:bg-amber-950/25"
                : "";

            const trTint =
              layoutVariant === "invoice" && invoiceRowKind
                ? stageKindClasses(invoiceRowKind)
                : doneBg;
            const cellClass = layoutVariant === "invoice" ? tdInv : td;

            const checkboxDisabled =
              rowBusy ||
              isFuture ||
              (isDone && !canReopen) ||
              (!isDone && !isCurrent) ||
              (!isDone && isCurrent && !canComplete);

            const checked = isDone;

            return (
              <tr
                key={row.id}
                className={cn(
                  layoutVariant === "invoice" ? trTint : doneBg,
                  layoutVariant === "invoice" && "overflow-hidden rounded-lg shadow-sm",
                )}
              >
                <td className={cn(cellClass, "w-10 text-center font-mono", layoutVariant === "invoice" && "rounded-s-lg")}>
                  {idx + 1}
                </td>
                <td className={cn(cellClass)}>
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-input accent-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                      checked={checked}
                      disabled={Boolean(checkboxDisabled)}
                      title={
                        isFuture
                          ? "بعد إتمام المراحل السابقة"
                          : isDone
                            ? canReopen
                              ? "إلغاء التمييز لإعادة فتح المرحلة"
                              : "مكتمل"
                            : isCurrent
                              ? "اضغط لإتمام المرحلة"
                              : ""
                      }
                      onChange={(e) => handleCheckboxChange(row, isCurrent, e.target.checked)}
                      aria-label={`${label} — ${isDone ? "مكتمل" : "لم يكتمل"}`}
                    />
                    <div className="min-w-0 flex-1">
                      <span className="font-medium">{label}</span>
                      {isDone ? (
                        <span className="ms-2 inline-flex flex-wrap items-center gap-1 font-medium text-emerald-800 dark:text-emerald-200">
                          <span className="inline-flex items-center gap-0.5">
                            <Check className="h-3.5 w-3.5" aria-hidden />
                            تم
                          </span>
                        </span>
                      ) : null}
                      {row.completedAt ? (
                        <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
                          {new Date(row.completedAt).toLocaleString()}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </td>
                <td className={cellClass}>
                  {showAdminEditor && draft ? (
                    <div className="flex min-w-[160px] flex-col gap-1.5">
                      <select
                        className="h-9 w-full max-w-[220px] rounded border border-input bg-background px-2 text-sm"
                        disabled={savingThis || !workers?.length}
                        value={draft.workerId}
                        onChange={(e) => {
                          const v = e.target.value;
                          setAdminDrafts((s) => ({
                            ...s,
                            [row.stageKey]: { ...draft, workerId: v },
                          }));
                        }}
                      >
                        <option value="">— اختر عاملاً —</option>
                        {workers?.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                      {isDone ? (
                        <>
                          <Input
                            type="datetime-local"
                            className="h-8 max-w-[200px] text-[11px]"
                            value={draft.completedLocal}
                            onChange={(e) =>
                              setAdminDrafts((s) => ({
                                ...s,
                                [row.stageKey]: { ...draft, completedLocal: e.target.value },
                              }))
                            }
                          />
                          <Input
                            className="h-8 text-[11px]"
                            placeholder="ملاحظات"
                            value={draft.notes}
                            onChange={(e) =>
                              setAdminDrafts((s) => ({
                                ...s,
                                [row.stageKey]: { ...draft, notes: e.target.value },
                              }))
                            }
                          />
                        </>
                      ) : (
                        <Input
                          className="h-8 text-[11px]"
                          placeholder="ملاحظات (اختياري)"
                          value={draft.notes}
                          onChange={(e) =>
                            setAdminDrafts((s) => ({
                              ...s,
                              [row.stageKey]: { ...draft, notes: e.target.value },
                            }))
                          }
                        />
                      )}
                    </div>
                  ) : isDone ? (
                    <span className="text-sm font-medium">{row.worker?.name ?? "—"}</span>
                  ) : showWorkerSelect ? (
                    <select
                      className="h-9 w-full min-w-[140px] max-w-[220px] rounded border border-input bg-background px-2 text-sm"
                      disabled={!workers?.length || rowBusy}
                      value={workerIdForRow(row)}
                      onChange={(e) => {
                        const v = e.target.value;
                        setWorkerByStage((s) => ({ ...s, [row.stageKey]: v }));
                        patchStageWorker.mutate({
                          stageKey: row.stageKey,
                          workerId: v.trim() ? v : null,
                        });
                      }}
                    >
                      <option value="">— اختر عاملاً —</option>
                      {workers?.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </td>
                <td className={cn(cellClass, "font-mono tabular-nums", layoutVariant === "invoice" && "rounded-e-lg")}>
                  {showAdminEditor && draft ? (
                    <div className="flex min-w-[120px] flex-col gap-1.5">
                      {canEditWage ? (
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
                          className="h-9 max-w-[120px]"
                          value={draft.wageAed}
                          onChange={(e) =>
                            setAdminDrafts((s) => ({
                              ...s,
                              [row.stageKey]: { ...draft, wageAed: e.target.value },
                            }))
                          }
                        />
                      ) : (
                        <span className="text-sm">{formatAED(row.wageFils)}</span>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 w-full max-w-[120px]"
                        disabled={savingThis || !draft.workerId.trim()}
                        onClick={() => saveAdminRow.mutate({ row, draft })}
                      >
                        {savingThis ? "…" : "حفظ"}
                      </Button>
                    </div>
                  ) : (
                    formatAED(row.wageFils)
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {completionError ? (
        <p className="mt-2 text-xs font-medium text-destructive">{completionError}</p>
      ) : null}
      {(completeOneClick.error || reopenStage.error) && !completionError ? (
        <p className="mt-2 text-xs text-destructive">
          {apiErrorMessage(completeOneClick.error || reopenStage.error)}
        </p>
      ) : null}
      {patchStageWorker.error ? (
        <p className="mt-2 text-xs text-destructive">{apiErrorMessage(patchStageWorker.error)}</p>
      ) : null}
      {saveAdminRow.error ? (
        <p className="mt-2 text-xs text-destructive">{apiErrorMessage(saveAdminRow.error)}</p>
      ) : null}
    </div>
  );
}
