import { useState } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { JOB_STAGE_LABELS } from "@abaya-shop/shared";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { formatAED } from "@/lib/money";
import { cn } from "@/lib/utils";

type Group = { key: string; count: number; valueFils: number; unpaidFils: number };

type Summary = {
  total: number;
  valueFils: number;
  unpaidFils: number;
  prepaidFils: number;
  oldestDays: number;
  byReason: Group[];
  byStage: Group[];
  byAge: Group[];
};

type Row = {
  jobId: string;
  jobNo: number;
  invoiceId: string;
  invoiceNo: number;
  customerName: string;
  customerMobile: string;
  piece: string;
  stage: string;
  reason: string;
  daysLate: number;
  due: string;
  stagesDone: number;
  totalFils: number | null;
  balanceFils: number | null;
};

/** Arabic first — this screen is read by the owner and the workshop supervisor. */
const REASON_AR: Record<string, string> = {
  badDueDate: "تاريخ تسليم غير صحيح",
  awaitingQa: "بانتظار فحص الجودة",
  stalled: "متوقفة — لا عمل ولا حركة منذ شهر",
  notStarted: "لم يبدأ العمل بعد",
  inProgress: "العمل جارٍ",
};

const REASON_EN: Record<string, string> = {
  badDueDate: "Invalid due date",
  awaitingQa: "Awaiting quality check",
  stalled: "Stalled — no work, untouched for a month",
  notStarted: "Not started",
  inProgress: "In progress",
};

/** What the owner should actually do about each bucket. */
const REASON_ACTION_AR: Record<string, string> = {
  badDueDate: "صحّح تاريخ التسليم على الفاتورة",
  awaitingQa: "افحصها وسلّمها — العمل انتهى",
  stalled: "قرار مطلوب: استأنفها أو ألغِها",
  notStarted: "أدخلها الورشة أو أعد جدولة الموعد",
  inProgress: "تابع المرحلة الحالية",
};

const AGE_AR: Record<string, string> = {
  badDate: "تاريخ تالف",
  over90: "أكثر من 90 يومًا",
  d31to90: "31 – 90 يومًا",
  d8to30: "8 – 30 يومًا",
  under7: "أقل من أسبوع",
};

const AGE_EN: Record<string, string> = {
  badDate: "Invalid date",
  over90: "Over 90 days",
  d31to90: "31 – 90 days",
  d8to30: "8 – 30 days",
  under7: "Under a week",
};

/** Red for "someone must decide", amber for "keep pushing", grey for data errors. */
const REASON_TONE: Record<string, string> = {
  stalled: "bg-red-100 text-red-900 dark:bg-red-950/50 dark:text-red-100",
  notStarted: "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-100",
  awaitingQa: "bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-100",
  inProgress: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100",
  badDueDate: "bg-muted text-muted-foreground",
};

const PAGE_SIZE = 50;

export function OverdueJobsPage() {
  const { i18n } = useTranslation();
  const isEn = i18n.language === "en";
  const reasonLabel = (k: string) => (isEn ? REASON_EN[k] : REASON_AR[k]) ?? k;
  const ageLabel = (k: string) => (isEn ? AGE_EN[k] : AGE_AR[k]) ?? k;

  const [reason, setReason] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data: summary } = useQuery({
    queryKey: ["overdue", "summary"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Summary }>("/dashboard/overdue/summary");
      return res.data.data;
    },
  });

  const { data: rows, isFetching } = useQuery({
    queryKey: ["overdue", "rows", reason, stage, search, page],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { items: Row[]; page: number; limit: number; total: number };
      }>("/dashboard/overdue/rows", {
        params: {
          page,
          limit: PAGE_SIZE,
          ...(reason ? { reason } : {}),
          ...(stage ? { stage } : {}),
          ...(search ? { search } : {}),
        },
      });
      return res.data.data;
    },
    // Keeps the table on screen while the next page loads, instead of flashing empty.
    placeholderData: keepPreviousData,
  });

  const resetTo = (fn: () => void) => {
    fn();
    setPage(1);
  };

  const totalPages = rows ? Math.max(1, Math.ceil(rows.total / PAGE_SIZE)) : 1;
  const hasMoney = summary ? summary.valueFils > 0 : false;

  return (
    <div className="space-y-5">
      <PageHeader
        title={isEn ? "Overdue pieces" : "القطع المتأخرة"}
        description={
          isEn
            ? "Every piece past its promised date, and why each one is still late."
            : "كل قطعة تجاوزت موعدها، ولماذا هي متأخرة."
        }
      />

      {summary ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              label={isEn ? "Overdue pieces" : "قطع متأخرة"}
              value={String(summary.total)}
              hint={
                summary.oldestDays > 0
                  ? isEn
                    ? `Oldest: ${summary.oldestDays} days`
                    : `أقدمها: ${summary.oldestDays} يومًا`
                  : undefined
              }
              tone="critical"
            />
            {hasMoney ? (
              <>
                <Tile
                  label={isEn ? "Value of the work" : "قيمة العمل"}
                  value={formatAED(summary.valueFils)}
                />
                <Tile
                  label={isEn ? "Already paid by customers" : "دفعه الزبائن سلفًا"}
                  value={formatAED(summary.prepaidFils)}
                  hint={
                    isEn
                      ? "Collected for pieces not delivered"
                      : "مقبوض عن قطع لم تُسلَّم بعد"
                  }
                  tone="critical"
                />
                <Tile
                  label={isEn ? "Still owed" : "لم يُدفع بعد"}
                  value={formatAED(summary.unpaidFils)}
                />
              </>
            ) : null}
          </div>

          <section>
            <h2 className="mb-2 text-sm font-semibold">{isEn ? "Why they are late" : "لماذا تأخرت"}</h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {summary.byReason.map((g) => {
                const active = reason === g.key;
                return (
                  <li key={g.key}>
                    <button
                      type="button"
                      onClick={() => resetTo(() => setReason(active ? null : g.key))}
                      className={cn(
                        "w-full rounded-lg border p-3 text-start transition",
                        active ? "border-primary ring-1 ring-primary" : "hover:bg-muted/50",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{reasonLabel(g.key)}</span>
                        <span className="text-lg font-bold tabular-nums">{g.count}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {isEn ? "" : REASON_ACTION_AR[g.key]}
                        {hasMoney && g.valueFils > 0 ? ` · ${formatAED(g.valueFils)}` : ""}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold">{isEn ? "How late" : "مدة التأخير"}</h2>
            <ul className="flex flex-wrap gap-2">
              {summary.byAge.map((g) => (
                <li
                  key={g.key}
                  className="rounded-md border px-3 py-1.5 text-xs"
                  title={hasMoney ? formatAED(g.valueFils) : undefined}
                >
                  <span className="text-muted-foreground">{ageLabel(g.key)}: </span>
                  <span className="font-semibold tabular-nums">{g.count}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              resetTo(() => setSearch(searchInput.trim()));
            }}
          >
            <Input
              className="h-9 w-[200px]"
              placeholder={isEn ? "Customer, mobile or invoice #" : "اسم الزبونة أو الجوال أو رقم الفاتورة"}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <Button type="submit" size="sm" variant="outline" className="h-9">
              {isEn ? "Search" : "بحث"}
            </Button>
          </form>
          {summary?.byStage.length ? (
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={stage ?? ""}
              onChange={(e) => resetTo(() => setStage(e.target.value || null))}
            >
              <option value="">{isEn ? "All stages" : "كل المراحل"}</option>
              {summary.byStage.map((g) => (
                <option key={g.key} value={g.key}>
                  {(JOB_STAGE_LABELS[g.key] ?? g.key) + ` (${g.count})`}
                </option>
              ))}
            </select>
          ) : null}
          {reason || stage || search ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-9"
              onClick={() =>
                resetTo(() => {
                  setReason(null);
                  setStage(null);
                  setSearch("");
                  setSearchInput("");
                })
              }
            >
              {isEn ? "Clear filters" : "إلغاء التصفية"}
            </Button>
          ) : null}
          <span className="ms-auto text-xs text-muted-foreground">
            {rows
              ? isEn
                ? `${rows.total} rows`
                : `${rows.total} قطعة`
              : "…"}
          </span>
        </div>

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="p-2 text-start font-medium">{isEn ? "Invoice" : "الفاتورة"}</th>
                <th className="p-2 text-start font-medium">{isEn ? "Customer" : "الزبونة"}</th>
                <th className="p-2 text-start font-medium">{isEn ? "Piece" : "القطعة"}</th>
                <th className="p-2 text-start font-medium">{isEn ? "Stage" : "المرحلة"}</th>
                <th className="p-2 text-start font-medium">{isEn ? "Why" : "السبب"}</th>
                <th className="p-2 text-end font-medium">{isEn ? "Days late" : "أيام التأخير"}</th>
                {hasMoney ? (
                  <th className="p-2 text-end font-medium">{isEn ? "Unpaid" : "المتبقي"}</th>
                ) : null}
              </tr>
            </thead>
            <tbody className={cn("divide-y", isFetching && "opacity-60")}>
              {rows?.items.length === 0 ? (
                <tr>
                  <td colSpan={hasMoney ? 7 : 6} className="p-6 text-center text-muted-foreground">
                    {isEn ? "Nothing matches these filters." : "لا نتائج مطابقة."}
                  </td>
                </tr>
              ) : (
                rows?.items.map((r) => (
                  <tr key={r.jobId} className="hover:bg-muted/30">
                    <td className="p-2">
                      <Link to={`/invoices/${r.invoiceId}`} className="font-medium text-primary hover:underline" dir="ltr">
                        #{r.invoiceNo}
                      </Link>
                    </td>
                    <td className="p-2">
                      <div>{r.customerName}</div>
                      <div className="font-mono text-xs text-muted-foreground" dir="ltr">
                        {r.customerMobile}
                      </div>
                    </td>
                    <td className="p-2 text-muted-foreground">{r.piece}</td>
                    <td className="p-2">{JOB_STAGE_LABELS[r.stage] ?? r.stage}</td>
                    <td className="p-2">
                      <Badge variant="secondary" className={cn("font-normal", REASON_TONE[r.reason])}>
                        {reasonLabel(r.reason)}
                      </Badge>
                    </td>
                    <td className="p-2 text-end tabular-nums">
                      {r.reason === "badDueDate" ? "—" : r.daysLate}
                    </td>
                    {hasMoney ? (
                      <td className="p-2 text-end tabular-nums">
                        {r.balanceFils != null && r.balanceFils > 0 ? formatAED(r.balanceFils) : "—"}
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {rows && rows.total > PAGE_SIZE ? (
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {isEn ? "Previous" : "السابق"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {isEn ? `Page ${page} of ${totalPages}` : `صفحة ${page} من ${totalPages}`}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              {isEn ? "Next" : "التالي"}
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "critical";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-3",
        tone === "critical" && "border-red-200 dark:border-red-900/50",
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-xl font-bold", tone === "critical" && "text-red-700 dark:text-red-300")}>
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
