import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CalendarClock, ClipboardList, Eye, Scissors } from "lucide-react";
import { JOB_STAGE_LABELS } from "@abaya-shop/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DashboardInvoiceModal, DashboardJobProcessModal } from "@/components/dashboard/DashboardTailoringModals";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DashboardOperationalCard } from "@/components/dashboard/DashboardOperationalCard";
import { api } from "@/lib/api";
import { formatAED } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useIsWorker } from "@/hooks/useIsWorker";

type Urgency = "overdue" | "due_today" | "future";

type PendingItem = {
  jobId: string;
  jobNo: number;
  stage: string;
  productStyle: string;
  pieceLabel: string | null;
  effectiveDueAt: string;
  urgency: Urgency;
  invoiceId: string;
  invoiceNo: number;
  invoiceDeliveryDate: string | null;
  jobDueDate: string;
  invoiceBalanceFils: number;
  customerName: string;
  customerMobile: string;
};

type PendingResponse = {
  summary: {
    overdueCount: number;
    dueTodayCount: number;
    inProgressCount: number;
  };
  items: PendingItem[];
};

type RowFilter = "all" | "overdue" | "due_today";

function stageLabel(stage: string): string {
  return JOB_STAGE_LABELS[stage] ?? stage;
}

function rowUrgencyClass(u: Urgency): string {
  switch (u) {
    case "overdue":
      return "border-red-300 bg-red-50/90 dark:border-red-900/60 dark:bg-red-950/35";
    case "due_today":
      return "border-orange-300 bg-orange-50/90 dark:border-orange-900/50 dark:bg-orange-950/30";
    default:
      return "border-border/80 bg-muted/25 dark:bg-muted/15";
  }
}

function rowHoverClass(u: Urgency): string {
  switch (u) {
    case "overdue":
      return "hover:bg-red-100/95 dark:hover:bg-red-950/50";
    case "due_today":
      return "hover:bg-orange-100/90 dark:hover:bg-orange-950/45";
    default:
      return "hover:bg-muted/50 dark:hover:bg-muted/30";
  }
}

function urgencyBadge(u: Urgency): { label: string; className: string } {
  switch (u) {
    case "overdue":
      return {
        label: "متأخر",
        className: "border-red-300 bg-red-100 text-red-900 dark:bg-red-950/50 dark:text-red-100",
      };
    case "due_today":
      return {
        label: "مستحق اليوم",
        className: "border-orange-300 bg-orange-100 text-orange-950 dark:bg-orange-950/40 dark:text-orange-100",
      };
    default:
      return {
        label: "قيد التنفيذ",
        className: "border-zinc-200 bg-zinc-100 text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
      };
  }
}

function filterItems(items: PendingItem[], rowFilter: RowFilter): PendingItem[] {
  if (rowFilter === "all") return items;
  if (rowFilter === "overdue") return items.filter((it) => it.urgency === "overdue");
  return items.filter((it) => it.urgency === "due_today");
}

function normalizeSearchQuery(s: string): string {
  return s.trim().toLowerCase();
}

/** Single string for partial matching (invoice #, customer, mobile, piece/model, stage). */
function itemSearchHaystack(it: PendingItem): string {
  const piece = it.pieceLabel ?? it.productStyle;
  const stageAr = stageLabel(it.stage);
  const mobileDigits = it.customerMobile.replace(/\D/g, "");
  return [
    String(it.invoiceNo),
    it.customerName,
    it.customerMobile,
    mobileDigits,
    it.productStyle,
    it.pieceLabel ?? "",
    piece,
    it.stage,
    stageAr,
  ]
    .join(" ")
    .toLowerCase();
}

function itemMatchesSearch(it: PendingItem, needle: string): boolean {
  if (!needle) return true;
  return itemSearchHaystack(it).includes(needle);
}

export function PendingTailoringSection() {
  const isWorker = useIsWorker();
  const [invoiceModalId, setInvoiceModalId] = useState<string | null>(null);
  const [jobModal, setJobModal] = useState<{ invoiceId: string; focusJobId: string } | null>(null);
  const [listModalOpen, setListModalOpen] = useState(false);
  const [rowFilter, setRowFilter] = useState<RowFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    if (listModalOpen) {
      setRowFilter("all");
      setSearchInput("");
      setDebouncedSearch("");
    }
  }, [listModalOpen]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchInput), 250);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const openInvoiceModal = (invoiceId: string) => {
    setJobModal(null);
    setInvoiceModalId(invoiceId);
  };

  const openJobModal = (invoiceId: string, focusJobId: string) => {
    setInvoiceModalId(null);
    setJobModal({ invoiceId, focusJobId });
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["dashboard", "pending-tailoring"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: PendingResponse }>("/dashboard/pending-tailoring");
      return res.data.data;
    },
  });

  const summary = data?.summary;
  const items = data?.items ?? [];
  const filteredItems = useMemo(() => {
    const byUrgency = filterItems(items, rowFilter);
    const needle = normalizeSearchQuery(debouncedSearch);
    if (!needle) return byUrgency;
    return byUrgency.filter((it) => itemMatchesSearch(it, needle));
  }, [items, rowFilter, debouncedSearch]);

  if (isLoading) {
    return (
      <div className="min-w-0">
        <section className="rounded-xl border border-border/80 bg-card p-4 shadow-sm">
          <h2 className="sr-only">أعمال التفصيل غير المكتملة</h2>
          <p className="text-sm text-muted-foreground">جاري التحميل…</p>
        </section>
      </div>
    );
  }

  if (isError || !data || !summary) {
    return (
      <div className="min-w-0">
        <section className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
          <h2 className="mb-1 text-sm font-semibold">أعمال التفصيل غير المكتملة</h2>
          <p className="text-sm text-destructive">تعذّر تحميل القائمة.</p>
          <button
            type="button"
            className="mt-2 text-sm font-medium text-primary underline"
            onClick={() => void refetch()}
          >
            إعادة المحاولة
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <DashboardInvoiceModal
        invoiceId={invoiceModalId}
        open={Boolean(invoiceModalId)}
        onOpenChange={(open) => {
          if (!open) setInvoiceModalId(null);
        }}
      />
      <DashboardJobProcessModal
        invoiceId={jobModal?.invoiceId ?? null}
        focusJobId={jobModal?.focusJobId ?? null}
        open={Boolean(jobModal)}
        onOpenChange={(open) => {
          if (!open) setJobModal(null);
        }}
      />

      <Dialog open={listModalOpen} onOpenChange={setListModalOpen}>
        <DialogContent className="flex max-h-[min(92vh,900px)] w-[min(96vw,1200px)] max-w-[1200px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1200px]">
          <DialogHeader className="shrink-0 border-b px-4 py-4 pr-14 text-start sm:px-6 sm:pr-16">
            <DialogTitle>أعمال التفصيل غير المكتملة</DialogTitle>
            <DialogDescription>
              مرتبة حسب الأولوية: متأخر → مستحق اليوم → لاحقاً، ثم أقرب موعد تسليم. اضغط الصف لعرض ملخص الفاتورة.
            </DialogDescription>
          </DialogHeader>

          <div className="flex shrink-0 flex-col gap-3 border-b bg-muted/20 px-4 py-3 sm:px-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">تصفية:</span>
              {(
                [
                  { id: "all" as const, label: "الكل" },
                  { id: "overdue" as const, label: "متأخر" },
                  { id: "due_today" as const, label: "اليوم" },
                ] as const
              ).map((f) => (
                <Button
                  key={f.id}
                  type="button"
                  size="sm"
                  variant={rowFilter === f.id ? "secondary" : "outline"}
                  className="h-8"
                  onClick={() => setRowFilter(f.id)}
                >
                  {f.label}
                </Button>
              ))}
            </div>
            <div className="w-full min-w-0 sm:max-w-md">
              <Input
                type="search"
                dir="auto"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="ابحث برقم الفاتورة أو العميل أو الجوال أو الموديل"
                className="h-9 bg-background"
                aria-label="بحث في قائمة التفصيل غير المكتمل"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-4 py-3 sm:px-6 sm:py-4">
            {filteredItems.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {items.length === 0
                  ? "لا توجد أيّة أعمال تفصيل غير مكتملة حالياً."
                  : normalizeSearchQuery(debouncedSearch)
                    ? "لا توجد نتائج مطابقة"
                    : rowFilter !== "all"
                      ? "لا توجد نتائج لهذا التصفية."
                      : "لا توجد نتائج مطابقة"}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 md:px-4">الأولوية</th>
                      <th className="px-3 py-2 md:px-4">فاتورة</th>
                      <th className="px-3 py-2 md:px-4">العميل</th>
                      <th className="px-3 py-2 md:px-4">الجوال</th>
                      <th className="px-3 py-2 md:px-4">القطعة / النوع</th>
                      <th className="px-3 py-2 md:px-4">المرحلة</th>
                      <th className="px-3 py-2 md:px-4">موعد التسليم</th>
                      {!isWorker ? (
                        <th className="px-3 py-2 text-end md:px-4">متبقي الفاتورة</th>
                      ) : null}
                      <th className="px-3 py-2 text-center md:px-4">إجراءات سريعة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((it) => {
                      const badge = urgencyBadge(it.urgency);
                      const dueLabel = new Date(it.effectiveDueAt).toLocaleString();
                      const piece = it.pieceLabel ?? it.productStyle;
                      return (
                        <tr
                          key={it.jobId}
                          role="button"
                          tabIndex={0}
                          className={cn(
                            "cursor-pointer border-b border-border/50 transition-colors duration-150 ease-out",
                            "hover:shadow-sm hover:ring-1 hover:ring-ring/35",
                            rowUrgencyClass(it.urgency),
                            rowHoverClass(it.urgency),
                          )}
                          title="اضغط لعرض ملخص الفاتورة"
                          onClick={() => openInvoiceModal(it.invoiceId)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openInvoiceModal(it.invoiceId);
                            }
                          }}
                        >
                          <td className="px-3 py-2.5 align-middle md:px-4">
                            <span
                              className={cn(
                                "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                                badge.className,
                              )}
                            >
                              {badge.label}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 font-mono font-medium md:px-4">#{it.invoiceNo}</td>
                          <td className="px-3 py-2.5 md:px-4">{it.customerName}</td>
                          <td className="px-3 py-2.5 font-mono text-muted-foreground md:px-4" dir="ltr">
                            {it.customerMobile}
                          </td>
                          <td className="max-w-[200px] px-3 py-2.5 md:px-4">
                            <span className="line-clamp-2" title={piece}>
                              {piece}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 md:px-4">{stageLabel(it.stage)}</td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground md:px-4">
                            {dueLabel}
                          </td>
                          {!isWorker ? (
                            <td className="px-3 py-2.5 text-end font-mono tabular-nums md:px-4">
                              {formatAED(it.invoiceBalanceFils)}
                            </td>
                          ) : null}
                          <td className="px-3 py-2.5 md:px-4">
                            <div
                              className="flex flex-wrap items-center justify-center gap-1"
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                            >
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                title="View Invoice"
                                aria-label="عرض تفاصيل الفاتورة"
                                onClick={() => openInvoiceModal(it.invoiceId)}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="secondary"
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                title="Job Process"
                                aria-label="مسار التفصيل"
                                onClick={() => openJobModal(it.invoiceId, it.jobId)}
                              >
                                <Scissors className="h-4 w-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="shrink-0 border-t px-4 py-3 text-[11px] leading-relaxed text-muted-foreground sm:px-6">
            دليل الألوان:{" "}
            <span className="font-medium text-red-800 dark:text-red-200">أحمر</span> = متأخر ·{" "}
            <span className="font-medium text-orange-800 dark:text-orange-200">برتقالي</span> = اليوم ·{" "}
            <span className="font-medium">رمادي</span> = لاحقاً. أيقونة العين = ملخص الفاتورة · أيقونة المقص =
            مسار التفصيل.
          </p>
        </DialogContent>
      </Dialog>

      <DashboardOperationalCard
        title="أعمال التفصيل غير المكتملة"
        icon={<ClipboardList className="h-5 w-5" aria-hidden />}
        summary={
          <>
            متأخر: {summary.overdueCount} | اليوم: {summary.dueTodayCount} | لاحقاً: {summary.inProgressCount}
          </>
        }
        hint="اضغط لعرض القائمة الكاملة"
        onClick={() => setListModalOpen(true)}
        open={listModalOpen}
        aside={
          <>
            <span className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100">
              <AlertCircle className="h-3 w-3" />
              {summary.overdueCount}
            </span>
            <span className="inline-flex items-center gap-1 rounded border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[10px] font-medium text-orange-950 dark:border-orange-900/50 dark:bg-orange-950/40 dark:text-orange-100">
              <CalendarClock className="h-3 w-3" />
              {summary.dueTodayCount}
            </span>
            <span className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-800 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200">
              <ClipboardList className="h-3 w-3" />
              {summary.inProgressCount}
            </span>
          </>
        }
      />
    </div>
  );
}
