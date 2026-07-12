import { useEffect, useMemo, useRef, useState } from "react";
import { isAxiosError } from "axios";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { jobStageLabel, PIPELINE_STAGE_KEYS } from "@abaya-shop/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { formatAED } from "@/lib/money";
import { usePermissions } from "@/hooks/usePermissions";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type WorkshopWorkStageRow = {
  id: string;
  stageKey: string;
  sortOrder: number;
  status: string;
  /** Duplicates `status === "DONE"`; set on the server for reporting. */
  isCompleted?: boolean;
  wageFils: number;
  workerId?: string | null;
  worker?: { id: string; name: string } | null;
  assignedAt?: string | null;
  completedAt?: string | null;
  notes?: string | null;
};

function statusBadge(status: string, t: (key: string) => string) {
  switch (status) {
    case "DONE":
      return {
        label: t("workshop.statusDone"),
        className: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100",
      };
    case "IN_PROGRESS":
      return {
        label: t("workshop.statusInProgress"),
        className: "border-amber-200 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100",
      };
    default:
      return {
        label: t("workshop.statusPending"),
        className: "border-zinc-200 bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
      };
  }
}

function apiErrorMessage(err: unknown): string {
  if (isAxiosError(err) && err.response?.data && typeof err.response.data === "object") {
    const d = err.response.data as { error?: { message?: string } };
    if (d.error?.message) return d.error.message;
  }
  if (err instanceof Error) return err.message;
  return "Request failed";
}

export function toLocalDatetimeValue(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalDatetimeValue(local: string): string | undefined {
  if (!local.trim()) return undefined;
  return new Date(local).toISOString();
}

type Props = {
  jobId: string;
  jobNo: number;
  productStyle: string;
  jobStage: string;
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
  /** When true, refetch job-orders list + dashboard */
  onInvalidateExtras?: () => void;
  /** Tighter layout when embedded under an invoice line */
  compact?: boolean;
  /** Simpler English copy for the invoice hub */
  locale?: "ar" | "en";
  /** Soft row backgrounds: pending = gray, active = amber, done = green */
  rowTint?: boolean;
  /** Invoice Job Process: tighter table, row tints, no long wage banner */
  embeddedInJobProcess?: boolean;
};

export function WorkshopTaskSheet({
  jobId,
  jobNo,
  productStyle,
  jobStage,
  invoiceLine,
  product: linkedProduct,
  workStages,
  onInvalidateExtras,
  compact = false,
  locale = "ar",
  rowTint = false,
  embeddedInJobProcess = false,
}: Props) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const { can } = usePermissions();
  const canAdminCorrect = can("jobProcess.adminEdit");
  const canComplete = can("jobProcess.complete");
  const canEditWage = can("jobProcess.editWage") || can("jobProcess.adminEdit");
  const canReopen = can("jobProcess.adminEdit") || can("jobProcess.reopenStage");
  const canMarkReady = can("jobProcess.markReady");
  /**
   * May activate the workshop pipeline (cutting/sewing/…). Mirrors the
   * `init-pipeline` endpoint: needs `jobProcess.update` and is NOT a restricted
   * workshop supervisor (assignWorkers without adminEdit).
   */
  const canInitPipeline =
    can("jobProcess.update") && (!can("jobProcess.assignWorkers") || can("jobProcess.adminEdit"));

  const { data: workers } = useQuery({
    queryKey: ["workers", "workshop-sheet"],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { items: Array<{ id: string; name: string }> };
      }>("/workers", { params: { limit: 200 } });
      return res.data.data.items;
    },
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["job-order", jobId] });
    void queryClient.invalidateQueries({ queryKey: ["job-orders"] });
    void queryClient.invalidateQueries({ queryKey: ["workers"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    onInvalidateExtras?.();
  };

  // Activates the workshop pipeline from the piece's own model (or default
  // wages for exempt types with no model). No product picker needed.
  const initPipeline = useMutation({
    mutationFn: async () => {
      await api.post(`/job-orders/${jobId}/init-pipeline`);
    },
    onSuccess: () => invalidate(),
  });

  // Auto-activate the pipeline the moment a not-yet-started piece is opened, so
  // the workflow (cutting/sewing/…) is ready without any manual model pick.
  const autoInitFired = useRef(false);
  useEffect(() => {
    if (
      workStages.length === 0 &&
      canInitPipeline &&
      jobStage === "NEW" &&
      !autoInitFired.current &&
      !initPipeline.isPending
    ) {
      autoInitFired.current = true;
      initPipeline.mutate();
    }
  }, [workStages.length, canInitPipeline, jobStage, initPipeline]);

  const sortedStages = useMemo(
    () => [...workStages].sort((a, b) => a.sortOrder - b.sortOrder),
    [workStages],
  );

  const currentRow = sortedStages.find((r) => r.stageKey === jobStage);

  /**
   * Worker from the closest earlier stage that already has one — used to pre-fill
   * the assignment dropdown so one tailor doing several stages (e.g. cutting + sewing)
   * is one click instead of re-picking every stage.
   */
  const prevStageWithWorker = useMemo(() => {
    if (!currentRow) return null;
    const before = sortedStages.filter((r) => r.sortOrder < currentRow.sortOrder && r.workerId);
    return before.length ? before[before.length - 1]! : null;
  }, [sortedStages, currentRow?.id, currentRow?.sortOrder]);
  const prevStageWorkerId = prevStageWithWorker?.workerId ?? "";
  const prevStageWorkerName = prevStageWithWorker?.worker?.name ?? "";

  const [draftWorker, setDraftWorker] = useState("");
  const [draftWageAed, setDraftWageAed] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const [draftCompletedLocal, setDraftCompletedLocal] = useState("");

  useEffect(() => {
    if (!currentRow) return;
    if (currentRow.status === "PENDING") {
      setDraftWorker(prevStageWorkerId);
      setDraftWageAed(String((currentRow.wageFils ?? 0) / 100));
      setDraftNotes(currentRow.notes ?? "");
    } else if (currentRow.status === "IN_PROGRESS") {
      setDraftWorker(currentRow.workerId ?? "");
      setDraftWageAed(String((currentRow.wageFils ?? 0) / 100));
      setDraftNotes(currentRow.notes ?? "");
      setDraftCompletedLocal(toLocalDatetimeValue(new Date().toISOString()));
    }
  }, [currentRow?.id, currentRow?.status, currentRow?.wageFils, currentRow?.notes, jobStage, prevStageWorkerId]);

  const patchStage = useMutation({
    mutationFn: async (stageKey: string) => {
      const row = sortedStages.find((r) => r.stageKey === stageKey);
      if (!row || row.status === "DONE") return;
      const wageFils = Math.round((parseFloat(draftWageAed) || 0) * 100);
      await api.patch(`/job-orders/${jobId}/work-stages/${stageKey}`, {
        ...(canEditWage ? { wageFils } : {}),
        notes: draftNotes.trim() || null,
      });
    },
    onSuccess: () => invalidate(),
  });

  const assignStage = useMutation({
    mutationFn: async (stageKey: string) => {
      const row = sortedStages.find((r) => r.stageKey === stageKey);
      if (!row || row.status !== "PENDING") return;
      if (!draftWorker) throw new Error(t("workshop.selectWorker"));
      const wageFils = Math.round((parseFloat(draftWageAed) || 0) * 100);
      await api.post(`/job-orders/${jobId}/work-stages/${stageKey}/assign`, {
        workerId: draftWorker,
        ...(canEditWage ? { wageFils } : {}),
        notes: draftNotes.trim() || undefined,
      });
    },
    onSuccess: () => invalidate(),
  });

  const completeStage = useMutation({
    mutationFn: async (stageKey: string) => {
      const row = sortedStages.find((r) => r.stageKey === stageKey);
      if (!row || row.status !== "IN_PROGRESS") return;
      const completedAt = fromLocalDatetimeValue(draftCompletedLocal);
      await api.post(`/job-orders/${jobId}/work-stages/${stageKey}/complete`, {
        completedAt,
        notes: draftNotes.trim() || undefined,
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

  const markReady = useMutation({
    mutationFn: async () => {
      await api.post(`/job-orders/${jobId}/mark-ready`);
    },
    onSuccess: () => invalidate(),
  });

  const [adminEditRow, setAdminEditRow] = useState<WorkshopWorkStageRow | null>(null);
  const [adminDraftWorker, setAdminDraftWorker] = useState("");
  const [adminDraftWageAed, setAdminDraftWageAed] = useState("");
  const [adminDraftNotes, setAdminDraftNotes] = useState("");
  const [adminDraftCompletedLocal, setAdminDraftCompletedLocal] = useState("");

  const openAdminEdit = (row: WorkshopWorkStageRow) => {
    setAdminEditRow(row);
    setAdminDraftWorker(row.workerId ?? "");
    setAdminDraftWageAed(String((row.wageFils ?? 0) / 100));
    setAdminDraftNotes(row.notes ?? "");
    setAdminDraftCompletedLocal(toLocalDatetimeValue(row.completedAt ?? undefined));
  };

  const adminPatchDone = useMutation({
    mutationFn: async () => {
      if (!adminEditRow) return;
      const wageFils = Math.round((parseFloat(adminDraftWageAed) || 0) * 100);
      const wid = adminDraftWorker.trim();
      if (!wid) throw new Error(t("workshop.selectWorker"));
      const completedIso = fromLocalDatetimeValue(adminDraftCompletedLocal);
      await api.patch(`/job-orders/${jobId}/work-stages/${adminEditRow.stageKey}`, {
        workerId: wid,
        ...(canEditWage ? { wageFils } : {}),
        notes: adminDraftNotes.trim() ? adminDraftNotes.trim() : null,
        ...(completedIso ? { completedAt: completedIso } : {}),
      });
    },
    onSuccess: () => {
      setAdminEditRow(null);
      invalidate();
    },
  });

  if (workStages.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-sm">
        <p className="mb-2 font-medium">
          {t("workshop.jobLabel", { jobNo })} — {productStyle}
        </p>
        {initPipeline.isError ? (
          <>
            <p className="mb-2 text-xs text-destructive">{apiErrorMessage(initPipeline.error)}</p>
            {canInitPipeline ? (
              <Button
                type="button"
                size="sm"
                disabled={initPipeline.isPending}
                onClick={() => initPipeline.mutate()}
              >
                {initPipeline.isPending ? "…" : t("workshop.retryInitPipeline")}
              </Button>
            ) : null}
          </>
        ) : canInitPipeline ? (
          <p className="text-muted-foreground">{t("workshop.initializingStages")}</p>
        ) : (
          <p className="text-muted-foreground">{t("workshop.stagesNotActivated")}</p>
        )}
      </div>
    );
  }

  const effectiveCompact = embeddedInJobProcess || compact;
  const effectiveRowTint = embeddedInJobProcess || rowTint;
  const pad = effectiveCompact ? "p-2" : "px-2 py-2";
  const headerPad = effectiveCompact ? "px-2 py-1.5" : "px-3 py-2";

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <div className="border-b bg-muted/40 px-3 py-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <span className="font-semibold">{t("workshop.jobTitle", { jobNo })}</span>
            <span className="ms-2 text-muted-foreground">{productStyle}</span>
            {linkedProduct ? (
              <span className="ms-2 text-xs text-muted-foreground">
                {t("workshop.modelInline")} {linkedProduct.name}
              </span>
            ) : null}
          </div>
          {invoiceLine ? (
            <div className="text-xs text-muted-foreground">
              {locale === "en"
                ? t("workshop.lineSummaryEn", {
                    description: invoiceLine.description ?? "—",
                    qty: invoiceLine.qty,
                    total: formatAED(invoiceLine.totalFils),
                  })
                : t("workshop.lineSummaryAr", {
                    description: invoiceLine.description ?? "—",
                    qty: invoiceLine.qty,
                    unit: formatAED(invoiceLine.unitFils),
                    total: formatAED(invoiceLine.totalFils),
                  })}
            </div>
          ) : null}
        </div>
        {!embeddedInJobProcess ? (
          <p className="mt-1 text-xs text-muted-foreground">{t("workshop.wageHint")}</p>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">{t("workshop.sequenceHint")}</p>
        )}
      </div>
      <table className="w-full min-w-[960px] text-sm">
        <thead>
          <tr className="border-b bg-muted/30 text-start text-xs text-muted-foreground">
            <th className={`${headerPad} w-10 font-medium`}>{t("workshop.colDone")}</th>
            <th className={`${headerPad} font-medium`}>{t("workshop.colTask")}</th>
            <th className={`${headerPad} font-medium`}>{t("workshop.colStatus")}</th>
            <th className={`${headerPad} font-medium`}>{t("workshop.colWage")}</th>
            <th className={`${headerPad} font-medium`}>{t("workshop.colWorker")}</th>
            <th className={`${headerPad} font-medium`}>{t("workshop.colDoneAt")}</th>
            <th className={`${headerPad} font-medium`}>{t("workshop.colNotes")}</th>
            <th className={`${headerPad} font-medium`}>{t("workshop.colAction")}</th>
          </tr>
        </thead>
        <tbody>
          {sortedStages.map((row) => {
            const badge = statusBadge(row.status, t);
            const label = jobStageLabel(row.stageKey, locale);
            const isJobHere = jobStage === row.stageKey;
            const isPipelineKey = (PIPELINE_STAGE_KEYS as readonly string[]).includes(row.stageKey);
            const isActiveRow = isJobHere && isPipelineKey && currentRow?.id === row.id;
            const defaultWageHint = formatAED(row.wageFils);
            const tint =
              effectiveRowTint && row.status === "DONE"
                ? "bg-emerald-50/90 dark:bg-emerald-950/20"
                : effectiveRowTint && row.status === "IN_PROGRESS"
                  ? "bg-amber-50/85 dark:bg-amber-950/25"
                  : effectiveRowTint && row.status === "PENDING"
                    ? "bg-zinc-50/90 dark:bg-zinc-900/30"
                    : "";

            return (
              <tr
                key={row.id}
                className={`border-b ${tint} ${isActiveRow ? "bg-brand-50/50 dark:bg-brand-950/20" : ""}`}
              >
                <td className={`${pad} align-top`}>
                  {row.status === "DONE" ? (
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-emerald-300 bg-emerald-50 text-emerald-800">
                      <Check className="h-4 w-4" aria-hidden />
                    </span>
                  ) : (
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-zinc-200 bg-zinc-50 text-zinc-400">
                      <span className="sr-only">{t("workshop.notCompleted")}</span>
                    </span>
                  )}
                </td>
                <td className={`${pad} align-top font-medium`}>
                  {label}
                  <div className="mt-0.5 text-xs font-normal text-muted-foreground">
                    {t("workshop.defaultWage")} {defaultWageHint}
                  </div>
                </td>
                <td className={`${pad} align-top`}>
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${badge.className}`}>
                    {badge.label}
                  </span>
                </td>

                {isActiveRow && row.status === "PENDING" ? (
                  <>
                    <td className={`${pad} align-top`}>
                      <Label className="sr-only">{t("workshop.colWorkerWage")}</Label>
                      {canEditWage ? (
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
                          className="h-9 max-w-[120px]"
                          value={draftWageAed}
                          onChange={(e) => setDraftWageAed(e.target.value)}
                        />
                      ) : (
                        <span className="font-mono text-sm">{formatAED(row.wageFils)}</span>
                      )}
                    </td>
                    <td className={`${pad} align-top`}>
                      <Label className="sr-only">{t("workshop.colWorker")}</Label>
                      <select
                        className="flex h-9 min-w-[140px] max-w-[200px] rounded-md border bg-background px-2 text-sm"
                        value={draftWorker}
                        onChange={(e) => setDraftWorker(e.target.value)}
                      >
                        <option value="">{t("workshop.chooseOption")}</option>
                        {workers?.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                      {prevStageWorkerId ? (
                        draftWorker === prevStageWorkerId ? (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {t("workshop.samePreviousWorker", { name: prevStageWorkerName })}
                          </p>
                        ) : (
                          <button
                            type="button"
                            className="mt-1 text-[11px] text-brand-600 underline-offset-2 hover:underline dark:text-brand-300"
                            onClick={() => setDraftWorker(prevStageWorkerId)}
                          >
                            {t("workshop.usePreviousWorker", { name: prevStageWorkerName })}
                          </button>
                        )
                      ) : null}
                    </td>
                    <td className={`${pad} align-top text-xs text-muted-foreground`}>{t("workshop.afterAssign")}</td>
                    <td className={`${pad} align-top`}>
                      <Label className="sr-only">{t("workshop.colNotes")}</Label>
                      <Input
                        className="h-9 min-w-[140px]"
                        value={draftNotes}
                        onChange={(e) => setDraftNotes(e.target.value)}
                        placeholder={t("workshop.optional")}
                      />
                    </td>
                    <td className={`${pad} align-top`}>
                      <div className="flex flex-col gap-1">
                        {canEditWage ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className={locale === "en" ? "min-h-11" : "h-8"}
                            disabled={patchStage.isPending}
                            onClick={() => patchStage.mutate(row.stageKey)}
                          >
                            {patchStage.isPending ? "…" : t("workshop.saveWage")}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          className={locale === "en" ? "min-h-11" : "h-8"}
                          disabled={!draftWorker || assignStage.isPending}
                          onClick={() => assignStage.mutate(row.stageKey)}
                        >
                          {assignStage.isPending ? "…" : t("workshop.assignAndStart")}
                        </Button>
                      </div>
                    </td>
                  </>
                ) : null}

                {isActiveRow && row.status === "IN_PROGRESS" ? (
                  <>
                    <td className={`${pad} align-top`}>
                      <Label className="sr-only">{t("workshop.colWorkerWage")}</Label>
                      {canEditWage ? (
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
                          className="h-9 max-w-[120px]"
                          value={draftWageAed}
                          onChange={(e) => setDraftWageAed(e.target.value)}
                        />
                      ) : (
                        <span className="font-mono text-sm">{formatAED(row.wageFils)}</span>
                      )}
                    </td>
                    <td className={`${pad} align-top text-sm`}>{row.worker?.name ?? "—"}</td>
                    <td className={`${pad} align-top`}>
                      <Label className="sr-only">{t("workshop.colDoneAt")}</Label>
                      <Input
                        type="datetime-local"
                        className="h-9 max-w-[200px]"
                        value={draftCompletedLocal}
                        onChange={(e) => setDraftCompletedLocal(e.target.value)}
                      />
                    </td>
                    <td className={`${pad} align-top`}>
                      <Input
                        className="h-9 min-w-[140px]"
                        value={draftNotes}
                        onChange={(e) => setDraftNotes(e.target.value)}
                        placeholder={t("workshop.optional")}
                      />
                    </td>
                    <td className={`${pad} align-top`}>
                      <div className="flex flex-col gap-1">
                        {canEditWage ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className={locale === "en" ? "min-h-11" : "h-8"}
                            disabled={patchStage.isPending}
                            onClick={() => patchStage.mutate(row.stageKey)}
                          >
                            {patchStage.isPending ? "…" : t("workshop.update")}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          className={
                            locale === "en"
                              ? "min-h-11 bg-emerald-600 hover:bg-emerald-700"
                              : "h-8 bg-emerald-600 hover:bg-emerald-700"
                          }
                          disabled={completeStage.isPending || !canComplete}
                          onClick={() => completeStage.mutate(row.stageKey)}
                        >
                          {completeStage.isPending ? "…" : t("workshop.markDone")}
                        </Button>
                      </div>
                    </td>
                  </>
                ) : null}

                {!isActiveRow || row.status === "DONE" ? (
                  <>
                    <td className={`${pad} align-top font-mono`}>{formatAED(row.wageFils)}</td>
                    <td className={`${pad} align-top`}>{row.worker?.name ?? "—"}</td>
                    <td className={`${pad} align-top text-xs text-muted-foreground`}>
                      {row.completedAt ? new Date(row.completedAt).toLocaleString() : "—"}
                    </td>
                    <td
                      className={`${pad} align-top max-w-[200px] truncate text-xs text-muted-foreground`}
                      title={row.notes ?? ""}
                    >
                      {row.notes ?? "—"}
                    </td>
                    <td className={`${pad} align-top`}>
                      {row.status === "DONE" && (canAdminCorrect || canReopen) ? (
                        <div className="flex flex-col gap-1">
                          {canAdminCorrect ? (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="h-8 text-xs"
                              disabled={adminPatchDone.isPending}
                              onClick={() => openAdminEdit(row)}
                            >
                              {t("workshop.correct")}
                            </Button>
                          ) : null}
                          {canReopen ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs"
                              disabled={reopenStage.isPending}
                              onClick={() => {
                                if (
                                  confirm(t("workshop.reopenConfirm"))
                                ) {
                                  reopenStage.mutate(row.stageKey);
                                }
                              }}
                            >
                              {t("workshop.reopen")}
                            </Button>
                          ) : null}
                        </div>
                      ) : !isActiveRow && row.status === "PENDING" ? (
                        <span className="text-xs text-muted-foreground">
                          {isPipelineKey && jobStage !== row.stageKey
                            ? t("workshop.activatesWhenReached")
                            : "—"}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>

      {(assignStage.error || patchStage.error || completeStage.error) && (
        <p className="border-t px-3 py-2 text-xs text-destructive">
          {(assignStage.error || patchStage.error || completeStage.error) instanceof Error
            ? (assignStage.error || patchStage.error || completeStage.error)?.message
            : ""}
        </p>
      )}

      {canMarkReady && (PIPELINE_STAGE_KEYS as readonly string[]).includes(jobStage) ? (
        <div className="border-t px-3 py-2 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {t("workshop.bypassHint")}
          </span>
          <div className="flex flex-col items-end gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 border-amber-300 text-amber-700 hover:bg-amber-50"
              disabled={markReady.isPending}
              onClick={() => {
                if (
                  confirm(t("workshop.markReadyConfirm"))
                ) {
                  markReady.mutate();
                }
              }}
            >
              {markReady.isPending ? "…" : t("workshop.markAsReady")}
            </Button>
            {markReady.isError && (
              <p className="text-xs text-destructive">{apiErrorMessage(markReady.error)}</p>
            )}
          </div>
        </div>
      ) : null}

      <Dialog open={adminEditRow !== null} onOpenChange={(o) => !o && setAdminEditRow(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("workshop.correctStageTitle")}</DialogTitle>
          </DialogHeader>
          {adminEditRow ? (
            <div className="grid gap-3 text-sm">
              <p className="text-xs text-muted-foreground">{t("workshop.correctStageHint")}</p>
              <div>
                <Label className="text-xs">{t("workshop.colWorker")}</Label>
                <select
                  className="mt-1 flex h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={adminDraftWorker}
                  onChange={(e) => setAdminDraftWorker(e.target.value)}
                >
                  <option value="">—</option>
                  {workers?.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">{t("workshop.wageAedLabel")}</Label>
                {canEditWage ? (
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    className="mt-1 h-9"
                    value={adminDraftWageAed}
                    onChange={(e) => setAdminDraftWageAed(e.target.value)}
                  />
                ) : (
                  <p className="mt-1 font-mono text-sm">{formatAED(adminEditRow.wageFils)}</p>
                )}
              </div>
              <div>
                <Label className="text-xs">{t("workshop.colDoneAt")}</Label>
                <Input
                  type="datetime-local"
                  className="mt-1 h-9"
                  value={adminDraftCompletedLocal}
                  onChange={(e) => setAdminDraftCompletedLocal(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">{t("workshop.colNotes")}</Label>
                <Input
                  className="mt-1 h-9"
                  value={adminDraftNotes}
                  onChange={(e) => setAdminDraftNotes(e.target.value)}
                  placeholder={t("workshop.optional")}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setAdminEditRow(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              disabled={adminPatchDone.isPending || !adminEditRow}
              onClick={() => adminPatchDone.mutate()}
            >
              {adminPatchDone.isPending ? "…" : t("common.save")}
            </Button>
          </DialogFooter>
          {adminPatchDone.error ? (
            <p className="text-xs text-destructive">{apiErrorMessage(adminPatchDone.error)}</p>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
