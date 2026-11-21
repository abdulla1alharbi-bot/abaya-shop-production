import { useMemo, useState } from "react";
import { isAxiosError } from "axios";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EXTRA_WORK_TYPES, type ExtraWorkType } from "@abaya-shop/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { formatAED } from "@/lib/money";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";

type ExtraWorkLine = {
  id: string;
  workType: string;
  totalFils: number;
  date: string;
  notes: string | null;
  workerId: string;
  worker: { id: string; name: string };
};

type WorkerOption = { id: string; name: string; isActive?: boolean; specializations?: string | null };

function apiErrorMessage(err: unknown): string {
  if (isAxiosError(err) && err.response?.data && typeof err.response.data === "object") {
    const d = err.response.data as { error?: { message?: string } };
    if (d.error?.message) return d.error.message;
  }
  if (err instanceof Error) return err.message;
  return "Request failed";
}

function parseSpecs(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** yyyy-mm-dd of today in the browser's (the shop's) local time. */
function todayLocalDate(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Today → now (never "in the future"); an earlier day → midday of that day, safely inside it. */
function workDateToIso(day: string): string | undefined {
  if (!day || day === todayLocalDate()) return undefined;
  const d = new Date(`${day}T12:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * «شغل إضافي» — ARI / PUSSOS lines on one piece. Not pipeline stages: only some
 * pieces get this work, so it never holds a piece back from READY. Each line is
 * a wage for the worker (balance, payroll, reports) exactly like a stage wage.
 */
export function JobExtraWorkPanel({
  jobId,
  layoutVariant = "default",
  onChanged,
}: {
  jobId: string;
  layoutVariant?: "default" | "invoice";
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const canEdit = can("jobProcess.editWage") || can("jobProcess.adminEdit");

  const [workType, setWorkType] = useState<ExtraWorkType>("PUSSOS");
  const [workerId, setWorkerId] = useState("");
  const [amountAed, setAmountAed] = useState("");
  const [day, setDay] = useState(todayLocalDate());
  const [formError, setFormError] = useState<string | null>(null);

  const linesQuery = useQuery({
    queryKey: ["job-extra-work", jobId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: ExtraWorkLine[] }>(`/job-orders/${jobId}/extra-work`);
      return res.data.data;
    },
  });

  const { data: workers } = useQuery({
    queryKey: ["workers", "extra-work-picker"],
    enabled: canEdit,
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: { items: WorkerOption[] } }>("/workers", {
        params: { limit: 200 },
      });
      return res.data.data.items;
    },
  });

  /** Workers whose card lists this work come first, then everyone else active. */
  const workerOptions = useMemo(() => {
    const active = (workers ?? []).filter((w) => w.isActive !== false);
    const matches = active.filter((w) => parseSpecs(w.specializations).includes(workType));
    const others = active.filter((w) => !parseSpecs(w.specializations).includes(workType));
    return { matches, others };
  }, [workers, workType]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["job-extra-work", jobId] });
    void queryClient.invalidateQueries({ queryKey: ["job-order", jobId] });
    void queryClient.invalidateQueries({ queryKey: ["workers"] });
    void queryClient.invalidateQueries({ queryKey: ["worker"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    onChanged?.();
  };

  const addLine = useMutation({
    mutationFn: async () => {
      const amountFils = Math.round((parseFloat(amountAed) || 0) * 100);
      await api.post(`/job-orders/${jobId}/extra-work`, {
        workType,
        workerId,
        amountFils,
        ...(workDateToIso(day) ? { date: workDateToIso(day) } : {}),
      });
    },
    onSuccess: () => {
      setAmountAed("");
      setFormError(null);
      refresh();
    },
  });

  const removeLine = useMutation({
    mutationFn: async (entryId: string) => {
      await api.delete(`/job-orders/${jobId}/extra-work/${entryId}`);
    },
    onSuccess: () => refresh(),
  });

  const submit = () => {
    if (!workerId) {
      setFormError(t("workshop.selectWorkerFirst"));
      return;
    }
    const amount = parseFloat(amountAed);
    if (!amountAed.trim() || Number.isNaN(amount) || amount < 0) {
      setFormError(t("workshop.extraWorkNeedAmount"));
      return;
    }
    setFormError(null);
    addLine.mutate();
  };

  const lines = linesQuery.data ?? [];
  // A worker cannot add work, and there is none to show: stay out of the way.
  if (!canEdit && lines.length === 0) return null;

  const isInvoice = layoutVariant === "invoice";
  const selectClass = "h-9 rounded border border-input bg-background px-2 text-sm";

  return (
    <section
      className={cn(
        "mt-3 border-t pt-3",
        isInvoice ? "border-border/60" : "border-zinc-300 dark:border-zinc-700",
      )}
      aria-label={t("workshop.extraWorkTitle")}
    >
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
        <h4 className="text-sm font-semibold">{t("workshop.extraWorkTitle")}</h4>
        <span className="text-xs text-muted-foreground">{t("workshop.extraWorkHint")}</span>
      </div>

      {linesQuery.isError ? (
        <p className="text-xs text-destructive">{apiErrorMessage(linesQuery.error)}</p>
      ) : lines.length === 0 ? (
        <p className="mb-2 text-xs text-muted-foreground">{t("workshop.extraWorkEmpty")}</p>
      ) : (
        <ul className="mb-2 divide-y divide-border/60 rounded border border-border/60">
          {lines.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5 text-sm">
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold">{l.workType}</span>
              <span className="font-medium">{l.worker.name}</span>
              <span className="font-mono tabular-nums">{formatAED(l.totalFils)}</span>
              <span className="text-xs text-muted-foreground">{new Date(l.date).toLocaleDateString()}</span>
              {canEdit ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="ms-auto h-7 px-2 text-destructive"
                  disabled={removeLine.isPending}
                  aria-label={t("workshop.extraWorkDelete")}
                  onClick={() => {
                    if (window.confirm(t("workshop.extraWorkDeleteConfirm"))) removeLine.mutate(l.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("workshop.extraWorkType")}
            <select
              className={cn(selectClass, "w-28")}
              value={workType}
              onChange={(e) => {
                setWorkType(e.target.value as ExtraWorkType);
                setWorkerId("");
              }}
            >
              {EXTRA_WORK_TYPES.map((wt) => (
                <option key={wt} value={wt}>
                  {wt}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("workshop.colWorker")}
            <select
              className={cn(selectClass, "w-44")}
              value={workerId}
              disabled={!workers?.length}
              onChange={(e) => {
                setWorkerId(e.target.value);
                setFormError(null);
              }}
            >
              <option value="">{t("workshop.selectWorker")}</option>
              {workerOptions.matches.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
              {workerOptions.matches.length > 0 && workerOptions.others.length > 0 ? (
                <option disabled>──────────</option>
              ) : null}
              {workerOptions.others.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("workshop.extraWorkAmount")}
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step={0.5}
              className="h-9 w-24"
              value={amountAed}
              onChange={(e) => {
                setAmountAed(e.target.value);
                setFormError(null);
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("workshop.extraWorkDate")}
            <Input
              type="date"
              className="h-9 w-40"
              max={todayLocalDate()}
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </label>
          <Button type="button" size="sm" className="h-9" disabled={addLine.isPending} onClick={submit}>
            {addLine.isPending ? "…" : t("workshop.extraWorkAdd")}
          </Button>
        </div>
      ) : null}

      {formError ? <p className="mt-1.5 text-xs font-medium text-destructive">{formError}</p> : null}
      {addLine.error ? <p className="mt-1.5 text-xs text-destructive">{apiErrorMessage(addLine.error)}</p> : null}
      {removeLine.error ? (
        <p className="mt-1.5 text-xs text-destructive">{apiErrorMessage(removeLine.error)}</p>
      ) : null}
    </section>
  );
}
