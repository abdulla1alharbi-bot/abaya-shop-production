import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { ArrowRight, Check, Loader2, Plus, RotateCcw, X } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { formatAED } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  WORK_LABEL_AR,
  dateInputToIso,
  toDateInput,
  type DraftEntry,
  type DraftRow,
  type PlanStep,
  type ResolvedRow,
  type RowStatus,
  type SheetPlan,
  type SheetRecord,
  type WorkKind,
} from "@/lib/workshopSheets";

type Worker = { id: string; name: string; isActive?: boolean };

const STATUS_STYLE: Record<RowStatus, { border: string; badge: string; label: string }> = {
  ok: { border: "border-s-emerald-500", badge: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100", label: "واضح" },
  warn: { border: "border-s-amber-500", badge: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100", label: "راجعه" },
  error: { border: "border-s-red-500", badge: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100", label: "ناقص — صحّحه" },
  done: { border: "border-s-zinc-400", badge: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100", label: "مسجّل من قبل" },
  ignored: { border: "border-s-zinc-300", badge: "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300", label: "متجاهَل" },
};

const WORK_OPTIONS: Array<WorkKind> = ["CUTTING", "SEWING", "EMBROIDERY", "FINISHING", "ARI", "PUSSOS"];

function stepText(s: PlanStep): string {
  const label = WORK_LABEL_AR[s.work];
  switch (s.state) {
    case "SKIP":
      return `${label}: بدون`;
    case "CLOSE":
      return `${label}: تُغلق بدون عامل`;
    case "OPEN":
      return `${label}: لم تُسجّل — تبقى`;
    case "DONE_SAME":
      return `${label}: مسجّلة (${s.workerName ?? "—"})`;
    case "DONE_OTHER":
      return `${label}: ${s.note ?? "مسجّلة من قبل"}`;
    default:
      return `${label}: ${s.workerName ?? "؟"} ${(s.wageFils / 100).toFixed(2).replace(/\.00$/, "")}${s.auto ? " (تلقائي)" : ""}`;
  }
}

function stepClass(s: PlanStep): string {
  switch (s.state) {
    case "NEW":
      return "border-primary/30 bg-primary/5";
    case "DONE_SAME":
      return "border-zinc-300 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
    case "DONE_OTHER":
    case "OPEN":
      return "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100";
    default:
      return "border-dashed border-zinc-300 text-muted-foreground line-through decoration-zinc-400 dark:border-zinc-700";
  }
}

function RowCard({
  index,
  row,
  resolved,
  workers,
  readOnly,
  onChange,
}: {
  index: number;
  row: DraftRow;
  resolved: ResolvedRow | undefined;
  workers: Worker[];
  readOnly: boolean;
  onChange: (next: DraftRow) => void;
}) {
  const status: RowStatus = row.ignore ? "ignored" : (resolved?.status ?? "ok");
  const st = STATUS_STYLE[status];
  const chosenJobIds = row.jobIds ?? resolved?.pieces.map((p) => p.jobId) ?? [];
  const hasDoubts = row.doubts.length > 0 || row.entries.some((e) => !e.ignore && e.doubts.length > 0);

  const setEntry = (i: number, patch: Partial<DraftEntry>) => {
    const entries = row.entries.map((e, j) => (j === i ? { ...e, ...patch, doubts: [] } : e));
    onChange({ ...row, entries });
  };

  return (
    <article className={cn("rounded-lg border border-s-4 bg-card p-3 text-sm", st.border, row.ignore && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">{index + 1}</span>
        <label className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">فاتورة</span>
          <Input
            className="h-8 w-24 font-mono"
            inputMode="numeric"
            value={row.invoiceNo}
            disabled={readOnly}
            onChange={(e) =>
              onChange({ ...row, invoiceNo: e.target.value.replace(/[^\d]/g, ""), invoiceAlternatives: [], jobIds: null, doubts: [] })
            }
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">قطع</span>
          <Input
            className="h-8 w-14 font-mono"
            inputMode="numeric"
            value={row.pieces ?? ""}
            placeholder="1"
            disabled={readOnly}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              onChange({ ...row, pieces: Number.isFinite(n) && n > 0 ? n : null, jobIds: null });
            }}
          />
        </label>
        {row.modelText ? (
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{row.modelText}</span>
        ) : null}
        {row.dateText ? <span className="text-xs text-muted-foreground">يوم {row.dateText}</span> : null}
        {resolved?.invoice?.customerName ? (
          <span className="text-xs text-muted-foreground">{resolved.invoice.customerName}</span>
        ) : null}
        <span className={cn("ms-auto rounded px-1.5 py-0.5 text-xs font-medium", st.badge)}>{st.label}</span>
      </div>

      {!row.ignore && resolved?.reasons.length ? (
        <ul className={cn("mt-2 list-disc space-y-0.5 ps-5 text-xs", status === "error" ? "text-red-700 dark:text-red-300" : "text-amber-800 dark:text-amber-200")}>
          {resolved.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      ) : null}

      {!row.ignore && resolved && resolved.candidates.length > 1 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">القطع:</span>
          {resolved.candidates.map((c) => {
            const on = chosenJobIds.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                disabled={readOnly}
                onClick={() => {
                  const next = on ? chosenJobIds.filter((x) => x !== c.id) : [...chosenJobIds, c.id];
                  onChange({ ...row, jobIds: next.length ? next : null, pieces: next.length || row.pieces });
                }}
                className={cn(
                  "rounded border px-2 py-0.5 text-xs",
                  on ? "border-primary bg-primary/10 font-medium text-primary" : "border-border text-muted-foreground",
                )}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {row.entries.length ? (
        <div className="mt-2 space-y-1.5">
          {row.entries.map((e, i) => (
            <div key={e.key} className={cn("flex flex-wrap items-center gap-1.5", e.ignore && "opacity-50")}>
              <span className="w-20 truncate text-xs text-muted-foreground" title={e.nameAsWritten || "مضاف يدويًا"}>
                {e.nameAsWritten ? `«${e.nameAsWritten}»` : "يدوي"}
              </span>
              <select
                className="h-8 w-32 rounded border border-input bg-background px-1.5 text-sm"
                value={e.workerId ?? ""}
                disabled={readOnly || e.ignore}
                onChange={(ev) => setEntry(i, { workerId: ev.target.value || null })}
              >
                <option value="">— العامل —</option>
                {workers
                  .filter((w) => w.isActive !== false || w.id === e.workerId)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
              </select>
              <Input
                className="h-8 w-20 font-mono"
                inputMode="decimal"
                value={e.amountAed ?? ""}
                placeholder="المبلغ"
                disabled={readOnly || e.ignore}
                onChange={(ev) => {
                  const v = ev.target.value.trim();
                  const n = parseFloat(v);
                  setEntry(i, { amountAed: v === "" || Number.isNaN(n) ? null : n });
                }}
              />
              <select
                className="h-8 w-28 rounded border border-input bg-background px-1.5 text-xs"
                value={e.work ?? ""}
                disabled={readOnly || e.ignore}
                onChange={(ev) => setEntry(i, { work: (ev.target.value || null) as WorkKind | null })}
                title="نوع الشغل"
              >
                <option value="">
                  تلقائي{resolved?.entries[i]?.work ? ` (${WORK_LABEL_AR[resolved.entries[i]!.work!]})` : ""}
                </option>
                {WORK_OPTIONS.map((w) => (
                  <option key={w} value={w}>
                    {WORK_LABEL_AR[w]}
                  </option>
                ))}
              </select>
              {!readOnly ? (
                <button
                  type="button"
                  className="rounded p-1 text-muted-foreground hover:bg-muted"
                  title={e.ignore ? "إرجاع" : "حذف هذا الاسم"}
                  aria-label={e.ignore ? "إرجاع" : "حذف هذا الاسم"}
                  onClick={() => setEntry(i, { ignore: !e.ignore })}
                >
                  {e.ignore ? <RotateCcw className="h-4 w-4" /> : <X className="h-4 w-4" />}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {!row.ignore && resolved?.freeRepair ? (
        <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <span className="font-semibold">إصلاح مجاني: </span>
          {resolved.freeRepair.alreadyNoted ? "مكتوب على الفاتورة من قبل" : "يُكتب على الفاتورة"} — «{resolved.freeRepair.note}». المراحل لا تتغير.
        </div>
      ) : null}

      {!row.ignore && resolved?.pieces.length ? (
        <div className="mt-2 space-y-1">
          {resolved.pieces.map((p) => (
            <div key={p.jobId} className="flex flex-wrap items-center gap-1">
              <span className="text-xs font-medium">{p.label}</span>
              {p.steps.map((s, i) => (
                <span key={i} className={cn("rounded border px-1.5 py-0.5 text-xs", stepClass(s))}>
                  {stepText(s)}
                </span>
              ))}
              {p.becomesReady && p.stageBefore !== "READY" && p.stageBefore !== "DELIVERED" ? (
                <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-xs font-medium text-white">← جاهزة</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {!readOnly ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {!row.ignore ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() =>
                onChange({
                  ...row,
                  entries: [
                    ...row.entries,
                    {
                      key: `${row.key}m${Date.now().toString(36)}`,
                      nameAsWritten: "",
                      workerId: null,
                      amountAed: null,
                      work: null,
                      writtenUnder: null,
                      ignore: false,
                      doubts: [],
                    },
                  ],
                })
              }
            >
              <Plus className="me-1 h-3.5 w-3.5" aria-hidden />
              أضف عامل
            </Button>
          ) : null}
          {hasDoubts && !row.ignore ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() =>
                onChange({ ...row, doubts: [], entries: row.entries.map((e) => ({ ...e, doubts: [] })) })
              }
            >
              <Check className="me-1 h-3.5 w-3.5" aria-hidden />
              تأكدت
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onChange({ ...row, ignore: !row.ignore })}>
            {row.ignore ? "إرجاع السطر" : "تجاهل السطر"}
          </Button>
        </div>
      ) : null}
    </article>
  );
}

export function WorkshopSheetReviewPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const samePhoto = (location.state as { samePhoto?: { status: string; approvedAt: string | null } | null } | null)
    ?.samePhoto;

  const sheetQuery = useQuery({
    queryKey: ["workshop-sheet", id],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: { sheet: SheetRecord; rows: DraftRow[]; plan: SheetPlan | null } }>(
        `/workshop-sheets/${id}`,
      );
      return res.data.data;
    },
  });
  const { data: workers = [] } = useQuery({
    queryKey: ["workers", "sheet-review"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: { items: Worker[] } }>("/workers", { params: { limit: 200 } });
      return res.data.data.items;
    },
  });
  const photoQuery = useQuery({
    queryKey: ["workshop-sheet-photo", id],
    queryFn: async () => {
      const res = await api.get<Blob>(`/workshop-sheets/${id}/image`, { responseType: "blob" });
      return URL.createObjectURL(res.data);
    },
    staleTime: Infinity,
  });

  const [rows, setRows] = useState<DraftRow[] | null>(null);
  const [day, setDay] = useState("");
  const [plan, setPlan] = useState<SheetPlan | null>(null);
  const [dirty, setDirty] = useState(0);
  const [approved, setApproved] = useState<{
    linesApplied: number;
    totalFils: number;
    readyPieces: number;
    freeRepairNotes?: number;
  } | null>(null);

  const sheet = sheetQuery.data?.sheet;
  const readOnly = !sheet || sheet.status !== "DRAFT" || approved !== null;

  // Load once; after that the screen owns the rows.
  useEffect(() => {
    if (!sheetQuery.data || rows !== null) return;
    setRows(sheetQuery.data.rows);
    setDay(toDateInput(sheetQuery.data.sheet.sheetDate));
    setPlan(sheetQuery.data.plan);
  }, [sheetQuery.data, rows]);

  const check = useMutation({
    mutationFn: async (body: { rows: DraftRow[]; day: string }) => {
      const res = await api.post<{ success: boolean; data: { plan: SheetPlan } }>(`/workshop-sheets/${id}/resolve`, {
        sheetDate: dateInputToIso(body.day),
        rows: body.rows,
      });
      return res.data.data.plan;
    },
    onSuccess: (p) => setPlan(p),
  });

  // Re-check shortly after the last edit.
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!dirty || !rows || readOnly) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => check.mutate({ rows, day }), 500);
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire on edits only
  }, [dirty]);

  const approve = useMutation({
    mutationFn: async () => {
      const res = await api.post<{
        success: boolean;
        data: { linesApplied: number; totalFils: number; readyPieces: number; freeRepairNotes?: number };
      }>(
        `/workshop-sheets/${id}/approve`,
        { sheetDate: dateInputToIso(day), rows },
        { timeout: 120_000 },
      );
      return res.data.data;
    },
    onSuccess: (r) => {
      setApproved(r);
      void queryClient.invalidateQueries({ queryKey: ["workshop-sheets"] });
      void queryClient.invalidateQueries({ queryKey: ["workshop-sheet", id] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["workers"] });
    },
    onError: (err) => {
      if (isAxiosError(err)) {
        const p = (err.response?.data as { data?: { plan?: SheetPlan } } | undefined)?.data?.plan;
        if (p) setPlan(p);
      }
    },
  });

  const discard = useMutation({
    mutationFn: async () => {
      await api.delete(`/workshop-sheets/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workshop-sheets"] });
      navigate("/workshop/sheets");
    },
  });

  const resolvedByKey = useMemo(() => new Map((plan?.rows ?? []).map((r) => [r.key, r])), [plan]);

  if (sheetQuery.isLoading || !rows) {
    return <p className="p-4 text-sm text-muted-foreground">…</p>;
  }
  if (sheetQuery.isError || !sheet) {
    return <p className="p-4 text-sm text-destructive">{getApiErrorMessage(sheetQuery.error, "تعذّر فتح الورقة")}</p>;
  }

  const editRow = (i: number, next: DraftRow) => {
    setRows((rs) => (rs ? rs.map((r, j) => (j === i ? next : r)) : rs));
    setDirty((n) => n + 1);
  };
  const counts = plan?.counts;
  const isAlteration = sheet.kind === "ALTERATION";

  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-24">
      <PageHeader
        title={isAlteration ? "دفتر التعديل — مراجعة" : "ورقة الشغل — مراجعة"}
        description={
          readOnly
            ? `معتمدة${sheet.approvedBy?.name ? ` من ${sheet.approvedBy.name}` : ""}${sheet.approvedAt ? ` · ${new Date(sheet.approvedAt).toLocaleString()}` : ""}`
            : "راجع كل سطر. الأخضر واضح، الأصفر راجعه، الأحمر لازم تصححه. لا شيء يُحفظ قبل «اعتماد»."
        }
        actions={
          <Link to="/workshop/sheets" className="inline-flex items-center gap-1 text-sm text-primary">
            <ArrowRight className="h-4 w-4" aria-hidden />
            كل الأوراق
          </Link>
        }
      />

      {samePhoto && !readOnly ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          {samePhoto.status === "APPROVED"
            ? `هذه الصورة نفسها اعتُمدت من قبل${samePhoto.approvedAt ? ` (${new Date(samePhoto.approvedAt).toLocaleDateString()})` : ""}.`
            : "هذه الصورة نفسها قُرئت من قبل ولم تُعتمد."}
        </p>
      ) : null}
      {!readOnly && counts && counts.done > 0 ? (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm">
          {counts.done === rows.filter((r) => !r.ignore).length
            ? "هذه الورقة مدخلة من قبل بالكامل — لا يوجد شيء جديد."
            : `${counts.done} من ${rows.filter((r) => !r.ignore).length} أسطر مدخلة من قبل — يُضاف الباقي فقط.`}
        </p>
      ) : null}

      {approved ? (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
          تم الاعتماد: {approved.linesApplied} سطر أجر بمجموع {formatAED(approved.totalFils)}، و{approved.readyPieces} قطعة صارت جاهزة
          {approved.freeRepairNotes ? `، و${approved.freeRepairNotes} ملاحظة «إصلاح مجاني» انكتبت على الفواتير` : ""}.
        </div>
      ) : sheet.status === "APPROVED" ? (
        <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          معتمدة: {sheet.linesApplied} سطر أجر بمجموع {formatAED(sheet.totalFils)}.
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">{isAlteration ? "تاريخ احتياطي" : "تاريخ الإنجاز"}</span>
          <Input
            type="date"
            className="h-9 w-44"
            value={day}
            disabled={readOnly}
            onChange={(e) => {
              setDay(e.target.value);
              setDirty((n) => n + 1);
            }}
          />
        </label>
        {check.isPending ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> يتحقق…
          </span>
        ) : null}
        {check.isError ? <span className="text-xs text-destructive">{getApiErrorMessage(check.error)}</span> : null}
        {counts && !readOnly ? (
          <span className="ms-auto flex flex-wrap gap-1.5 text-xs">
            <span className={cn("rounded px-1.5 py-0.5", STATUS_STYLE.ok.badge)}>واضح {counts.ok}</span>
            <span className={cn("rounded px-1.5 py-0.5", STATUS_STYLE.warn.badge)}>راجعه {counts.warn}</span>
            <span className={cn("rounded px-1.5 py-0.5", STATUS_STYLE.error.badge)}>أحمر {counts.error}</span>
            <span className={cn("rounded px-1.5 py-0.5", STATUS_STYLE.done.badge)}>مسجّل {counts.done}</span>
          </span>
        ) : null}
      </div>

      <details className="rounded-lg border bg-card p-3" open={!readOnly}>
        <summary className="cursor-pointer text-sm font-medium">صورة الورقة</summary>
        {photoQuery.data ? (
          <a href={photoQuery.data} target="_blank" rel="noreferrer">
            <img src={photoQuery.data} alt="صورة الورقة" className="mt-2 w-full rounded object-contain" />
          </a>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">…</p>
        )}
      </details>

      <div className="space-y-2">
        {rows.map((r, i) => (
          <RowCard
            key={r.key}
            index={i}
            row={r}
            resolved={resolvedByKey.get(r.key)}
            workers={workers}
            readOnly={readOnly}
            onChange={(next) => editRow(i, next)}
          />
        ))}
      </div>

      {plan ? (
        <section className="rounded-lg border bg-card p-3">
          <h2 className="mb-2 text-sm font-semibold">المجموع لكل عامل — قارنه بحسابك</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-1.5 text-start font-medium">العامل</th>
                <th className="py-1.5 text-start font-medium">القطع</th>
                <th className="py-1.5 text-start font-medium">المجموع</th>
                <th className="py-1.5 text-start font-medium">جديد</th>
              </tr>
            </thead>
            <tbody>
              {plan.totals.map((t) => (
                <tr key={t.workerId} className="border-b border-border/50">
                  <td className="py-1.5">{t.workerName}</td>
                  <td className="py-1.5 font-mono tabular-nums">{t.pieces}</td>
                  <td className="py-1.5 font-mono tabular-nums">{formatAED(t.totalFils)}</td>
                  <td className="py-1.5 font-mono tabular-nums text-muted-foreground">{formatAED(t.newFils)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-1.5">الإجمالي</td>
                <td />
                <td className="py-1.5 font-mono tabular-nums">{formatAED(plan.grandTotalFils)}</td>
                <td className="py-1.5 font-mono tabular-nums">{formatAED(plan.newTotalFils)}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-1 text-xs text-muted-foreground">
            «المجموع» = المكتوب في الورقة مع القص التلقائي. «جديد» = ما سيُضاف فعلًا (المسجّل من قبل لا يتكرر).
          </p>
        </section>
      ) : null}

      {!readOnly ? (
        <div className="sticky bottom-0 z-10 -mx-2 flex flex-wrap items-center gap-2 border-t bg-background/95 px-2 py-3 backdrop-blur">
          <Button
            type="button"
            disabled={approve.isPending || check.isPending || !plan || plan.counts.error > 0}
            onClick={() => {
              const warn = plan?.counts.warn ?? 0;
              const msg = `اعتماد الورقة؟ سيُضاف ${formatAED(plan?.newTotalFils ?? 0)}${warn ? ` — وفيه ${warn} سطر أصفر لم يُراجع` : ""}.`;
              if (window.confirm(msg)) approve.mutate();
            }}
          >
            {approve.isPending ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden /> : null}
            اعتماد وحفظ
          </Button>
          {plan && plan.counts.error > 0 ? (
            <span className="text-xs text-destructive">فيه {plan.counts.error} سطر أحمر — صحّحه أو تجاهله أولًا</span>
          ) : null}
          {approve.isError ? (
            <span className="text-xs text-destructive">{getApiErrorMessage(approve.error, "تعذّر الاعتماد")}</span>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            className="ms-auto text-xs text-muted-foreground"
            disabled={discard.isPending}
            onClick={() => {
              if (window.confirm("حذف هذه القراءة؟ لم يُحفظ منها شيء.")) discard.mutate();
            }}
          >
            حذف القراءة
          </Button>
        </div>
      ) : null}
    </div>
  );
}
