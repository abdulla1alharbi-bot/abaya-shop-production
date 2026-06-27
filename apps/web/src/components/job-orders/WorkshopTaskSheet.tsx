import { useEffect, useMemo, useState } from "react";
import { isAxiosError } from "axios";
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

function statusBadge(status: string, locale: "ar" | "en") {
  switch (status) {
    case "DONE":
      return {
        label: locale === "en" ? "Done" : "تم",
        className: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100",
      };
    case "IN_PROGRESS":
      return {
        label: locale === "en" ? "In progress" : "قيد التنفيذ",
        className: "border-amber-200 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100",
      };
    default:
      return {
        label: locale === "en" ? "Pending" : "معلّق",
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
  const { can } = usePermissions();
  const canAdminCorrect = can("jobProcess.adminEdit");
  const canComplete = can("jobProcess.complete");
  const canEditWage = can("jobProcess.editWage") || can("jobProcess.adminEdit");
  const canReopen = can("jobProcess.adminEdit") || can("jobProcess.reopenStage");
  const canMarkReady = can("jobProcess.markReady");

  const [initProductId, setInitProductId] = useState("");

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

  const { data: catalogProducts } = useQuery({
    queryKey: ["products", "workshop-init"],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { items: Array<{ id: string; name: string; sku: string }> };
      }>("/products", { params: { limit: 200, activeOnly: "true" } });
      return res.data.data.items;
    },
    enabled: workStages.length === 0,
  });

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
      if (!draftWorker) throw new Error("اختر عاملاً");
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
      if (!wid) throw new Error(locale === "en" ? "Select a worker" : "اختر عاملاً");
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
          طلب #{jobNo} — {productStyle}
        </p>
        <p className="mb-3 text-muted-foreground">
          لا يوجد مسار مراحل (قص/خياطة/…). اربط موديلاً من الكتالوج لتفعيل ورشة التتبع والأجور التلقائية.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label className="text-xs">موديل الكتالوج</Label>
            <select
              className="mt-1 flex h-9 min-w-[200px] rounded-md border bg-background px-2 text-sm"
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

  const effectiveCompact = embeddedInJobProcess || compact;
  const effectiveRowTint = embeddedInJobProcess || rowTint;
  const pad = effectiveCompact ? "p-2" : "px-2 py-2";
  const headerPad = effectiveCompact ? "px-2 py-1.5" : "px-3 py-2";

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <div className="border-b bg-muted/40 px-3 py-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <span className="font-semibold">
              {locale === "en" ? `Job #${jobNo}` : `طلب تفصيل #${jobNo}`}
            </span>
            <span className="ms-2 text-muted-foreground">{productStyle}</span>
            {linkedProduct ? (
              <span className="ms-2 text-xs text-muted-foreground">
                {locale === "en" ? "— Model:" : "— موديل:"} {linkedProduct.name}
              </span>
            ) : null}
          </div>
          {invoiceLine ? (
            <div className="text-xs text-muted-foreground">
              {locale === "en" ? (
                <>
                  Line: {invoiceLine.description ?? "—"} · Qty {invoiceLine.qty} · Line total{" "}
                  {formatAED(invoiceLine.totalFils)}
                </>
              ) : (
                <>
                  بند الفاتورة: {invoiceLine.description ?? "—"} — كمية {invoiceLine.qty} — سعر الوحدة{" "}
                  {formatAED(invoiceLine.unitFils)} — إجمالي السطر {formatAED(invoiceLine.totalFils)}
                </>
              )}
            </div>
          ) : null}
        </div>
        {!embeddedInJobProcess ? (
          locale === "ar" ? (
            <p className="mt-1 text-xs text-muted-foreground">
              أجر العامل لكل مرحلة يُعبأ من إعدادات الموديل في الكتالوج (يمكن تعديله قبل التعيين أو الإكمال). عند «تم
              التنفيذ» يُسجَّل في مستحقات العامل.
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Wages default from the catalog model. Mark <strong>Done</strong> to record pay for the worker.
            </p>
          )
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            بالترتيب: اختر العامل ← تعيين وبدء ← عند الانتهاء اضغط «تم التنفيذ».
          </p>
        )}
      </div>
      <table className="w-full min-w-[960px] text-sm">
        <thead>
          <tr className="border-b bg-muted/30 text-start text-xs text-muted-foreground">
            <th className={`${headerPad} w-10 font-medium`}>{locale === "en" ? "✓" : "تم"}</th>
            <th className={`${headerPad} font-medium`}>{locale === "en" ? "Task" : "المرحلة"}</th>
            <th className={`${headerPad} font-medium`}>{locale === "en" ? "Status" : "الحالة"}</th>
            <th className={`${headerPad} font-medium`}>{locale === "en" ? "Wage (AED)" : "أجر العامل (AED)"}</th>
            <th className={`${headerPad} font-medium`}>{locale === "en" ? "Worker" : "العامل"}</th>
            <th className={`${headerPad} font-medium`}>{locale === "en" ? "Done at" : "تاريخ الإنجاز"}</th>
            <th className={`${headerPad} font-medium`}>{locale === "en" ? "Notes" : "ملاحظات"}</th>
            <th className={`${headerPad} font-medium`}>{locale === "en" ? "Action" : "إجراءات"}</th>
          </tr>
        </thead>
        <tbody>
          {sortedStages.map((row) => {
            const badge = statusBadge(row.status, locale);
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
                      <span className="sr-only">غير مكتمل</span>
                    </span>
                  )}
                </td>
                <td className={`${pad} align-top font-medium`}>
                  {label}
                  <div className="mt-0.5 text-xs font-normal text-muted-foreground">
                    {locale === "en" ? "Default wage:" : "افتراضي أجر:"} {defaultWageHint}
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
                      <Label className="sr-only">أجر العامل</Label>
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
                      <Label className="sr-only">العامل</Label>
                      <select
                        className="flex h-9 min-w-[140px] max-w-[200px] rounded-md border bg-background px-2 text-sm"
                        value={draftWorker}
                        onChange={(e) => setDraftWorker(e.target.value)}
                      >
                        <option value="">— اختر —</option>
                        {workers?.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                      {prevStageWorkerId ? (
                        draftWorker === prevStageWorkerId ? (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {locale === "en"
                              ? `Same worker as previous stage (${prevStageWorkerName})`
                              : `نفس عامل المرحلة السابقة (${prevStageWorkerName})`}
                          </p>
                        ) : (
                          <button
                            type="button"
                            className="mt-1 text-[11px] text-brand-600 underline-offset-2 hover:underline dark:text-brand-300"
                            onClick={() => setDraftWorker(prevStageWorkerId)}
                          >
                            {locale === "en"
                              ? `Use previous worker (${prevStageWorkerName})`
                              : `نفس عامل المرحلة السابقة (${prevStageWorkerName})`}
                          </button>
                        )
                      ) : null}
                    </td>
                    <td className={`${pad} align-top text-xs text-muted-foreground`}>بعد التعيين</td>
                    <td className={`${pad} align-top`}>
                      <Label className="sr-only">ملاحظات</Label>
                      <Input
                        className="h-9 min-w-[140px]"
                        value={draftNotes}
                        onChange={(e) => setDraftNotes(e.target.value)}
                        placeholder="اختياري"
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
                            {patchStage.isPending ? "…" : locale === "en" ? "Save wage" : "حفظ الأجر"}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          className={locale === "en" ? "min-h-11" : "h-8"}
                          disabled={!draftWorker || assignStage.isPending}
                          onClick={() => assignStage.mutate(row.stageKey)}
                        >
                          {assignStage.isPending ? "…" : locale === "en" ? "Assign & start" : "تعيين وبدء"}
                        </Button>
                      </div>
                    </td>
                  </>
                ) : null}

                {isActiveRow && row.status === "IN_PROGRESS" ? (
                  <>
                    <td className={`${pad} align-top`}>
                      <Label className="sr-only">أجر العامل</Label>
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
                      <Label className="sr-only">تاريخ الإنجاز</Label>
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
                        placeholder="اختياري"
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
                            {patchStage.isPending ? "…" : locale === "en" ? "Update" : "تحديث"}
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
                          {completeStage.isPending ? "…" : locale === "en" ? "Done" : "تم التنفيذ"}
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
                              {locale === "en" ? "Correct" : "تصحيح"}
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
                                  confirm(
                                    locale === "en"
                                      ? "Reopen this stage? The payroll line for this stage will be removed."
                                      : "إعادة فتح المرحلة؟ سيتم عكس أجر العامل من السجل.",
                                  )
                                ) {
                                  reopenStage.mutate(row.stageKey);
                                }
                              }}
                            >
                              {locale === "en" ? "Reopen" : "إعادة فتح"}
                            </Button>
                          ) : null}
                        </div>
                      ) : !isActiveRow && row.status === "PENDING" ? (
                        <span className="text-xs text-muted-foreground">
                          {isPipelineKey && jobStage !== row.stageKey
                            ? "يُفعّل عند وصول الطلب لهذه المرحلة"
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
            {locale === "en" ? "Bypass remaining stages and mark as ready." : "تجاوز المراحل المتبقية وتحويل الطلب مباشرةً إلى جاهز."}
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
                  confirm(
                    locale === "en"
                      ? "Mark this job as READY now? Remaining stages will not be recorded."
                      : "تحويل الطلب إلى جاهز الآن؟ لن تُسجَّل المراحل المتبقية.",
                  )
                ) {
                  markReady.mutate();
                }
              }}
            >
              {markReady.isPending ? "…" : locale === "en" ? "Mark as Ready" : "تحويل إلى جاهز"}
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
            <DialogTitle>{locale === "en" ? "Correct completed stage" : "تصحيح مرحلة مكتملة"}</DialogTitle>
          </DialogHeader>
          {adminEditRow ? (
            <div className="grid gap-3 text-sm">
              <p className="text-xs text-muted-foreground">
                {locale === "en"
                  ? "Adjust worker, wage, completion time, or notes. Payroll line is updated to match."
                  : "تعديل العامل أو الأجر أو وقت الإنجاز أو الملاحظات. يُحدَّث سجل الأجر ليتطابق."}
              </p>
              <div>
                <Label className="text-xs">{locale === "en" ? "Worker" : "العامل"}</Label>
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
                <Label className="text-xs">{locale === "en" ? "Wage (AED)" : "الأجر (درهم)"}</Label>
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
                <Label className="text-xs">{locale === "en" ? "Done at" : "تاريخ الإنجاز"}</Label>
                <Input
                  type="datetime-local"
                  className="mt-1 h-9"
                  value={adminDraftCompletedLocal}
                  onChange={(e) => setAdminDraftCompletedLocal(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">{locale === "en" ? "Notes" : "ملاحظات"}</Label>
                <Input
                  className="mt-1 h-9"
                  value={adminDraftNotes}
                  onChange={(e) => setAdminDraftNotes(e.target.value)}
                  placeholder={locale === "en" ? "Optional" : "اختياري"}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setAdminEditRow(null)}>
              {locale === "en" ? "Cancel" : "إلغاء"}
            </Button>
            <Button
              type="button"
              disabled={adminPatchDone.isPending || !adminEditRow}
              onClick={() => adminPatchDone.mutate()}
            >
              {adminPatchDone.isPending ? "…" : locale === "en" ? "Save" : "حفظ"}
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
