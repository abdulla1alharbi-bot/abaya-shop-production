import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { JOB_STAGE_LABELS } from "@abaya-shop/shared";
import {
  Banknote,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  PieChart,
  Printer,
  Scissors,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { printReport } from "@/lib/printReport";
import { PageHeader } from "@/components/shared/PageHeader";
import { ReportDateRangeBar } from "@/components/reports/ReportDateRangeBar";
import { ReportHubCard } from "@/components/reports/ReportHubCard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import {
  defaultReportDateRange,
  normalizeReportRange,
  reportRangeToApiParams,
  type ReportDateRange,
} from "@/lib/reportDateRange";
import { formatAED } from "@/lib/money";
import { cn } from "@/lib/utils";
import { invoiceFulfillmentKey } from "@/lib/invoiceOperationalLabels";
import { usePermissions } from "@/hooks/usePermissions";
import { useTranslation } from "react-i18next";

function rangeKey(r: ReportDateRange): string {
  return `${r.from.getTime()}-${r.to.getTime()}`;
}

function useCashFlowTypeLabel() {
  const { t } = useTranslation();
  return (type: "income" | "expense" | "wage"): string => {
    if (type === "income") return t("reports.cashFlowIncome");
    if (type === "expense") return t("reports.cashFlowExpense");
    return t("reports.cashFlowWage");
  };
}

function usePaymentLabel() {
  const { t } = useTranslation();
  return (inv: { balanceFils: number; paidFils: number; isVoid: boolean }): string => {
    if (inv.isVoid) return t("reports.paymentVoid");
    if (inv.balanceFils <= 0) return t("reports.paymentPaid");
    if (inv.paidFils <= 0) return t("reports.paymentUnpaid");
    return t("reports.paymentPartial");
  };
}

type InvoiceReportItem = {
  id: string;
  invoiceNo: number;
  totalFils: number;
  paidFils: number;
  balanceFils: number;
  createdAt: string;
  deliveryDate?: string | null;
  isVoid: boolean;
  deliveredAt?: string | null;
  fulfillmentStatus: string;
  customer: { name: string; mobile: string } | null;
};

export function ReportsPage() {
  const { can } = usePermissions();
  const { t } = useTranslation();
  const cashFlowTypeLabel = useCashFlowTypeLabel();
  const paymentLabelAr = usePaymentLabel();
  const defaults = useMemo(() => defaultReportDateRange(), []);

  const { data: shopSettings } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, string> }>("/settings");
      return res.data.data;
    },
  });

  const rangeToParams = (r: ReportDateRange): { from?: string; to?: string } => {
    const p = reportRangeToApiParams(r.from, r.to);
    return { from: p.from ?? undefined, to: p.to ?? undefined };
  };

  const [wagesOpen, setWagesOpen] = useState(false);
  const [salesOpen, setSalesOpen] = useState(false);
  const [invoicesOpen, setInvoicesOpen] = useState(false);
  const [balancesOpen, setBalancesOpen] = useState(false);
  const [tailoringOpen, setTailoringOpen] = useState(false);
  const [mostRequestedOpen, setMostRequestedOpen] = useState(false);

  const [wagesDraft, setWagesDraft] = useState(defaults);
  const [wagesApplied, setWagesApplied] = useState(defaults);
  const [salesDraft, setSalesDraft] = useState(defaults);
  const [salesApplied, setSalesApplied] = useState(defaults);
  const [invDraft, setInvDraft] = useState(defaults);
  const [invApplied, setInvApplied] = useState(defaults);
  const [balDraft, setBalDraft] = useState(defaults);
  const [balApplied, setBalApplied] = useState(defaults);
  const [tailDraft, setTailDraft] = useState(defaults);
  const [tailApplied, setTailApplied] = useState(defaults);
  const [mostDraft, setMostDraft] = useState(defaults);
  const [mostApplied, setMostApplied] = useState(defaults);
  const [cashFlowOpen, setCashFlowOpen] = useState(false);
  const [cashFlowShowDetails, setCashFlowShowDetails] = useState(false);
  /** When true, API returns one row per payment (optional drill-down). */
  const [cashFlowIncomeDetailed, setCashFlowIncomeDetailed] = useState(false);
  /** When true, API returns one wage row per completed stage (optional drill-down). */
  const [cashFlowWagesDetailed, setCashFlowWagesDetailed] = useState(false);
  const [cashDraft, setCashDraft] = useState(defaults);
  const [cashApplied, setCashApplied] = useState(defaults);

  useEffect(() => {
    if (!cashFlowOpen) {
      setCashFlowShowDetails(false);
      setCashFlowIncomeDetailed(false);
      setCashFlowWagesDetailed(false);
    }
  }, [cashFlowOpen]);

  useEffect(() => {
    if (wagesOpen) setWagesDraft(wagesApplied);
  }, [wagesOpen, wagesApplied]);
  useEffect(() => {
    if (salesOpen) setSalesDraft(salesApplied);
  }, [salesOpen, salesApplied]);
  useEffect(() => {
    if (invoicesOpen) setInvDraft(invApplied);
  }, [invoicesOpen, invApplied]);
  useEffect(() => {
    if (balancesOpen) setBalDraft(balApplied);
  }, [balancesOpen, balApplied]);
  useEffect(() => {
    if (tailoringOpen) setTailDraft(tailApplied);
  }, [tailoringOpen, tailApplied]);
  useEffect(() => {
    if (mostRequestedOpen) setMostDraft(mostApplied);
  }, [mostRequestedOpen, mostApplied]);
  useEffect(() => {
    if (cashFlowOpen) setCashDraft(cashApplied);
  }, [cashFlowOpen, cashApplied]);

  const wagesParams = reportRangeToApiParams(wagesApplied.from, wagesApplied.to);

  const entriesQuery = useQuery({
    queryKey: ["reports", "production-entries", rangeKey(wagesApplied)],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: {
          entries: Array<{
            id: string;
            date: string;
            workType: string;
            qty: number;
            totalFils: number;
            workerName: string;
            jobNo: number | null;
            productStyle: string | null;
          }>;
        };
      }>("/reports/production-entries", { params: wagesParams });
      return res.data.data;
    },
    enabled: wagesOpen,
  });

  const workshopWagesQuery = useQuery({
    queryKey: ["reports", "workshop-wages", rangeKey(wagesApplied)],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: {
          rows: Array<{
            workerId: string | null;
            name: string;
            completedTasks: number;
            totalWageFils: number;
          }>;
          totalWageFils: number;
          note?: string;
        };
      }>("/reports/workshop-wages", { params: wagesParams });
      return res.data.data;
    },
    enabled: wagesOpen,
  });

  const salesParams = reportRangeToApiParams(salesApplied.from, salesApplied.to);
  const salesReportQuery = useQuery({
    queryKey: ["reports", "invoices-period", rangeKey(salesApplied)],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: {
          items: InvoiceReportItem[];
          summary: {
            invoiceCount: number;
            totalSalesFils: number;
            totalPaidFils: number;
            totalRemainingFils: number;
          };
        };
      }>("/reports/invoices", { params: salesParams });
      return res.data.data;
    },
    enabled: salesOpen,
  });

  const invoicesReportQuery = useQuery({
    queryKey: ["reports", "invoices-period", rangeKey(invApplied)],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: {
          items: InvoiceReportItem[];
          summary: {
            invoiceCount: number;
            totalSalesFils: number;
            totalPaidFils: number;
            totalRemainingFils: number;
          };
        };
      }>("/reports/invoices", { params: reportRangeToApiParams(invApplied.from, invApplied.to) });
      return res.data.data;
    },
    enabled: invoicesOpen,
  });

  const balParams = reportRangeToApiParams(balApplied.from, balApplied.to);
  type AgingBucket = "current" | "31to60" | "61to90" | "over90";
  const receivablesQuery = useQuery({
    queryKey: ["reports", "receivables", rangeKey(balApplied)],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: {
          unpaidInvoices: Array<{
            id: string;
            invoiceNo: number;
            totalFils: number;
            paidFils: number;
            balanceFils: number;
            createdAt: string;
            daysSince: number;
            agingBucket: AgingBucket;
            customer: { name: string; mobile: string } | null;
          }>;
          customersWithBalance: Array<{
            id: string;
            name: string;
            mobile: string;
            balanceFils: number;
          }>;
          agingTotals: Record<AgingBucket, number>;
        };
      }>("/reports/receivables", { params: balParams });
      return res.data.data;
    },
    enabled: balancesOpen,
  });

  const tailoringQuery = useQuery({
    queryKey: ["reports", "tailoring-orders", rangeKey(tailApplied)],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: {
          jobOrders: Array<{
            id: string;
            jobNo: number;
            productStyle: string;
            stage: string;
            dueDate: string;
            createdAt: string;
            customer: { name: string; mobile: string };
            invoice: { id: string; invoiceNo: number } | null;
          }>;
          count: number;
        };
      }>("/reports/tailoring-orders", { params: reportRangeToApiParams(tailApplied.from, tailApplied.to) });
      return res.data.data;
    },
    enabled: tailoringOpen,
  });

  const mostRequestedQuery = useQuery({
    queryKey: ["reports", "most-requested-items", rangeKey(mostApplied)],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: {
          items: Array<{
            productId: string;
            sku: string | null;
            name: string;
            categoryName: string;
            kind: "tailoring" | "retail";
            lineCount: number;
            invoiceCount: number;
            totalQty: number;
            totalSalesFils: number;
          }>;
          productCount?: number;
          note?: string;
        };
      }>("/reports/most-requested-items", { params: reportRangeToApiParams(mostApplied.from, mostApplied.to) });
      return res.data.data;
    },
    enabled: mostRequestedOpen,
  });

  const financialActivityQuery = useQuery({
    queryKey: ["reports", "financial-activity", rangeKey(cashApplied), cashFlowIncomeDetailed, cashFlowWagesDetailed],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: {
          note?: string;
          incomeRowsMode?: "aggregate" | "detailed";
          wageRowsMode?: "aggregate" | "detailed";
          summary: {
            totalIncomeFils: number;
            totalExpensesFils: number;
            totalWagesFils: number;
            netProfitFils: number;
            incomeBasis: "payments";
          };
          entries: Array<{
            id: string;
            type: "income" | "expense" | "wage";
            description: string;
            amountFils: number;
            date: string;
          }>;
        };
      }>("/reports/financial-activity", {
        params: {
          ...reportRangeToApiParams(cashApplied.from, cashApplied.to),
          ...(cashFlowIncomeDetailed ? { detailedIncome: "true" } : {}),
          ...(cashFlowWagesDetailed ? { detailedWages: "true" } : {}),
        },
      });
      return res.data.data;
    },
    enabled: cashFlowOpen,
  });

  const invoiceTable = (rows: InvoiceReportItem[] | undefined, loading: boolean) => {
    if (loading) return <p className="text-sm text-muted-foreground">جاري التحميل…</p>;
    if (!rows?.length) return <p className="text-sm text-muted-foreground">لا فواتير في هذه الفترة.</p>;
    return (
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-start">رقم</th>
              <th className="px-3 py-2 text-start">العميل</th>
              <th className="px-3 py-2 text-start">الجوال</th>
              <th className="px-3 py-2 text-start">تاريخ الفاتورة</th>
              <th className="px-3 py-2 text-end">الإجمالي</th>
              <th className="px-3 py-2 text-end">المدفوع</th>
              <th className="px-3 py-2 text-end">المتبقي</th>
              <th className="px-3 py-2 text-start">التشغيل</th>
              <th className="px-3 py-2 text-start">السداد</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((inv) => (
              <tr key={inv.id} className="border-b border-border/50">
                <td className="px-3 py-2 font-mono">#{inv.invoiceNo}</td>
                <td className="px-3 py-2">{inv.customer?.name ?? "—"}</td>
                <td className="px-3 py-2 font-mono" dir="ltr">
                  {inv.customer?.mobile ?? "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                  {new Date(inv.createdAt).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-end font-mono tabular-nums">{formatAED(inv.totalFils)}</td>
                <td className="px-3 py-2 text-end font-mono tabular-nums">{formatAED(inv.paidFils)}</td>
                <td className="px-3 py-2 text-end font-mono tabular-nums">{formatAED(inv.balanceFils)}</td>
                <td className="max-w-[140px] px-3 py-2 text-xs">{t(invoiceFulfillmentKey(inv.fulfillmentStatus))}</td>
                <td className="px-3 py-2 text-xs">{paymentLabelAr(inv)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("reports.title")}
        description={t("reports.description", { defaultValue: "Sales, balances, workshop wages, financial activity, and most requested — all with date range filtering." })}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {can("reports.wages") ? (
          <ReportHubCard
            title={t("reports.wagesTitle", { defaultValue: "Worker Wages" })}
            description={t("reports.wagesDesc", { defaultValue: "Completed workshop stages — task count and total wage per worker." })}
            icon={<Users className="h-5 w-5" />}
            onClick={() => setWagesOpen(true)}
          />
        ) : null}
        {can("reports.sales") ? (
          <ReportHubCard
            title={t("reports.salesTitle", { defaultValue: "Sales" })}
            description={t("reports.salesDesc", { defaultValue: "Period invoices: total, paid, balance — cash income from financial activity report." })}
            icon={<PieChart className="h-5 w-5" />}
            onClick={() => setSalesOpen(true)}
          />
        ) : null}
        {can("reports.sales") ? (
          <ReportHubCard
            title={t("pages.invoices.title")}
            description={t("reports.invoicesDesc", { defaultValue: "Period invoice list (same data as sales with different label)." })}
            icon={<FileSpreadsheet className="h-5 w-5" />}
            onClick={() => setInvoicesOpen(true)}
          />
        ) : null}
        {can("reports.balances") ? (
          <ReportHubCard
            title={t("reports.balancesTitle", { defaultValue: "Outstanding Balances" })}
            description={t("reports.balancesDesc", { defaultValue: "Customers and invoices with remaining balance — can filter by invoice creation date." })}
            icon={<Banknote className="h-5 w-5" />}
            onClick={() => setBalancesOpen(true)}
          />
        ) : null}
        {can("reports.sales") ? (
          <ReportHubCard
            title={t("reports.tailoringTitle", { defaultValue: "Tailoring Orders" })}
            description={t("reports.tailoringDesc", { defaultValue: "Tailoring orders created in the period." })}
            icon={<Scissors className="h-5 w-5" />}
            onClick={() => setTailoringOpen(true)}
          />
        ) : null}
        {can("reports.mostRequested") ? (
          <ReportHubCard
            title={t("reports.mostRequestedTitle", { defaultValue: "Most Requested" })}
            description={t("reports.mostRequestedDesc", { defaultValue: "Products and models appearing most in invoice items (tailoring and ready-made)." })}
            icon={<TrendingUp className="h-5 w-5" />}
            onClick={() => setMostRequestedOpen(true)}
          />
        ) : null}
        {can("reports.financial") ? (
          <ReportHubCard
            title={t("reports.cashFlowTitle", { defaultValue: "Financial Activity" })}
            description={t("reports.cashFlowDesc", { defaultValue: "Collections, expenses, and operating wages — and net profit for the period." })}
            icon={<Wallet className="h-5 w-5" />}
            onClick={() => setCashFlowOpen(true)}
          />
        ) : null}
      </div>

      {/* Worker wages */}
      <Dialog open={wagesOpen} onOpenChange={setWagesOpen}>
        <DialogContent className="flex max-h-[min(92vh,880px)] w-[min(96vw,960px)] max-w-[960px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[960px]">
          <DialogHeader className="shrink-0 border-b px-4 py-4 pr-14 text-start sm:px-6 sm:pr-16">
            <DialogTitle>أجور العمال (الورشة)</DialogTitle>
            <DialogDescription>
              أجور مراحل التشغيل المكتملة (قص، خياطة، تطريز، الشغل اليدوي) — كل مهمة مكتملة تُحسب بأجرها المحفوظ. أسفلها
              سجلات الإنتاج للمراجعة.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-end gap-2 border-b px-4 py-3 sm:px-6">
            <div className="flex-1">
              <ReportDateRangeBar
                from={wagesDraft.from}
                to={wagesDraft.to}
                onFromChange={(v) => setWagesDraft((d) => ({ ...d, from: v }))}
                onToChange={(v) => setWagesDraft((d) => ({ ...d, to: v }))}
                onApply={() => setWagesApplied(normalizeReportRange(wagesDraft.from, wagesDraft.to))}
                isFetching={workshopWagesQuery.isFetching || entriesQuery.isFetching}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!workshopWagesQuery.data}
              onClick={() =>
                printReport(
                  "wages",
                  {
                    productionRows: (workshopWagesQuery.data?.rows ?? []).map((r) => ({
                      workerId: r.workerId ?? "",
                      name: r.name,
                      entries: r.completedTasks,
                      qty: r.completedTasks,
                      totalFils: r.totalWageFils,
                    })),
                  },
                  rangeToParams(wagesApplied),
                  shopSettings,
                )
              }
            >
              <Printer className="me-1 h-4 w-4" />
              طباعة / PDF
            </Button>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 sm:px-6 sm:py-4">
            {workshopWagesQuery.data?.note ? (
              <p className="text-xs leading-relaxed text-muted-foreground">{workshopWagesQuery.data.note}</p>
            ) : null}
            {workshopWagesQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">جاري التحميل…</p>
            ) : workshopWagesQuery.isError ? (
              <p className="text-sm text-destructive">تعذّر تحميل التقرير.</p>
            ) : (
              <>
                <p className="text-sm">
                  <span className="text-muted-foreground">إجمالي أجور الورشة في الفترة: </span>
                  <span className="font-semibold tabular-nums">
                    {formatAED(workshopWagesQuery.data?.totalWageFils ?? 0)}
                  </span>
                </p>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 text-start">العامل</th>
                        <th className="px-3 py-2 text-end">عدد المهام المكتملة</th>
                        <th className="px-3 py-2 text-end">إجمالي الأجر</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workshopWagesQuery.data?.rows?.length ? (
                        workshopWagesQuery.data.rows.map((r, idx) => (
                          <tr key={r.workerId ?? `w-${idx}-${r.name}`} className="border-b border-border/50">
                            <td className="px-3 py-2 font-medium">{r.name}</td>
                            <td className="px-3 py-2 text-end tabular-nums">{r.completedTasks}</td>
                            <td className="px-3 py-2 text-end font-mono tabular-nums">{formatAED(r.totalWageFils)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                            لا مراحل مكتملة في هذه الفترة.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                سجلات الإنتاج (تفصيل)
              </h3>
              {entriesQuery.isLoading ? (
                <p className="text-xs text-muted-foreground">جاري تحميل التفاصيل…</p>
              ) : entriesQuery.data?.entries?.length ? (
                <div className="max-h-[240px] overflow-auto rounded-md border">
                  <table className="w-full min-w-[700px] text-xs">
                    <thead className="sticky top-0 border-b bg-muted/80">
                      <tr>
                        <th className="px-2 py-1.5 text-start">التاريخ</th>
                        <th className="px-2 py-1.5 text-start">العامل</th>
                        <th className="px-2 py-1.5 text-start">طلب / نوع</th>
                        <th className="px-2 py-1.5 text-end">الكمية</th>
                        <th className="px-2 py-1.5 text-end">الأجر</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entriesQuery.data.entries.map((e) => (
                        <tr key={e.id} className="border-b border-border/40">
                          <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">
                            {new Date(e.date).toLocaleString()}
                          </td>
                          <td className="px-2 py-1.5">{e.workerName}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">
                            {e.jobNo != null ? `#${e.jobNo} ${e.productStyle ?? ""}` : "—"}
                          </td>
                          <td className="px-2 py-1.5 text-end">{e.qty}</td>
                          <td className="px-2 py-1.5 text-end font-mono">{formatAED(e.totalFils)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">لا سجلات تفصيلية.</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Sales */}
      <Dialog open={salesOpen} onOpenChange={setSalesOpen}>
        <DialogContent className="flex max-h-[min(92vh,900px)] w-[min(96vw,1100px)] max-w-[1100px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1100px]">
          <DialogHeader className="shrink-0 border-b px-4 py-4 pr-14 text-start sm:px-6 sm:pr-16">
            <DialogTitle>تقرير المبيعات</DialogTitle>
            <DialogDescription>
              فواتير غير الملغاة صُدرت في الفترة: يظهر إجمالي الفاتورة، والمدفوع حتى الآن على تلك الفواتير، والمتبقي
              — الدخل النقدي الفعلي يُتابع من تقرير «النشاط المالي» (التحصيلات).
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-end gap-2 border-b px-4 py-3 sm:px-6">
            <div className="flex-1">
              <ReportDateRangeBar
                from={salesDraft.from}
                to={salesDraft.to}
                onFromChange={(v) => setSalesDraft((d) => ({ ...d, from: v }))}
                onToChange={(v) => setSalesDraft((d) => ({ ...d, to: v }))}
                onApply={() => setSalesApplied(normalizeReportRange(salesDraft.from, salesDraft.to))}
                isFetching={salesReportQuery.isFetching}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!salesReportQuery.data}
              onClick={() => {
                const d = salesReportQuery.data;
                if (!d) return;
                printReport(
                  "sales",
                  {
                    invoices: d.items.map((i) => ({
                      id: i.id,
                      invoiceNo: i.invoiceNo,
                      createdAt: i.createdAt,
                      totalFils: i.totalFils,
                      paidFils: i.paidFils,
                      balanceFils: i.balanceFils,
                      customer: i.customer,
                    })),
                    totals: {
                      totalFils: d.summary.totalSalesFils,
                      paidFils: d.summary.totalPaidFils,
                      balanceFils: d.summary.totalRemainingFils,
                      count: d.summary.invoiceCount,
                    },
                  },
                  rangeToParams(salesApplied),
                  shopSettings,
                );
              }}
            >
              <Printer className="me-1 h-4 w-4" />
              طباعة / PDF
            </Button>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 sm:px-6 sm:py-4">
            {salesReportQuery.data?.summary ? (
              <div className="grid gap-2 rounded-lg border border-border/60 bg-muted/15 p-3 sm:grid-cols-2 lg:grid-cols-4">
                <p className="text-sm">
                  <span className="text-muted-foreground">عدد الفواتير: </span>
                  <span className="font-semibold tabular-nums">{salesReportQuery.data.summary.invoiceCount}</span>
                </p>
                <p className="text-sm">
                  <span className="text-muted-foreground">إجمالي المبيعات: </span>
                  <span className="font-semibold tabular-nums">
                    {formatAED(salesReportQuery.data.summary.totalSalesFils)}
                  </span>
                </p>
                <p className="text-sm">
                  <span className="text-muted-foreground">إجمالي المدفوع: </span>
                  <span className="font-semibold tabular-nums">
                    {formatAED(salesReportQuery.data.summary.totalPaidFils)}
                  </span>
                </p>
                <p className="text-sm">
                  <span className="text-muted-foreground">إجمالي المتبقي: </span>
                  <span className="font-semibold tabular-nums text-amber-900 dark:text-amber-100">
                    {formatAED(salesReportQuery.data.summary.totalRemainingFils)}
                  </span>
                </p>
              </div>
            ) : null}
            {invoiceTable(salesReportQuery.data?.items, salesReportQuery.isLoading)}
          </div>
        </DialogContent>
      </Dialog>

      {/* Invoices (same API) */}
      <Dialog open={invoicesOpen} onOpenChange={setInvoicesOpen}>
        <DialogContent className="flex max-h-[min(92vh,900px)] w-[min(96vw,1100px)] max-w-[1100px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1100px]">
          <DialogHeader className="shrink-0 border-b px-4 py-4 pr-14 text-start sm:px-6 sm:pr-16">
            <DialogTitle>تقرير الفواتير</DialogTitle>
            <DialogDescription>جميع الفواتير الصادرة في الفترة (غير الملغاة).</DialogDescription>
          </DialogHeader>
          <div className="border-b px-4 py-3 sm:px-6">
            <ReportDateRangeBar
              from={invDraft.from}
              to={invDraft.to}
              onFromChange={(v) => setInvDraft((d) => ({ ...d, from: v }))}
              onToChange={(v) => setInvDraft((d) => ({ ...d, to: v }))}
              onApply={() => setInvApplied(normalizeReportRange(invDraft.from, invDraft.to))}
              isFetching={invoicesReportQuery.isFetching}
            />
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 sm:px-6 sm:py-4">
            {invoicesReportQuery.data?.summary ? (
              <div className="grid gap-2 rounded-lg border border-border/60 bg-muted/15 p-3 sm:grid-cols-2 lg:grid-cols-4">
                <p className="text-sm">
                  <span className="text-muted-foreground">عدد الفواتير: </span>
                  <span className="font-semibold tabular-nums">{invoicesReportQuery.data.summary.invoiceCount}</span>
                </p>
                <p className="text-sm">
                  <span className="text-muted-foreground">الإجمالي: </span>
                  <span className="font-semibold tabular-nums">
                    {formatAED(invoicesReportQuery.data.summary.totalSalesFils)}
                  </span>
                </p>
                <p className="text-sm">
                  <span className="text-muted-foreground">المدفوع: </span>
                  <span className="font-semibold tabular-nums">
                    {formatAED(invoicesReportQuery.data.summary.totalPaidFils)}
                  </span>
                </p>
                <p className="text-sm">
                  <span className="text-muted-foreground">المتبقي: </span>
                  <span className="font-semibold tabular-nums text-amber-900 dark:text-amber-100">
                    {formatAED(invoicesReportQuery.data.summary.totalRemainingFils)}
                  </span>
                </p>
              </div>
            ) : null}
            {invoiceTable(invoicesReportQuery.data?.items, invoicesReportQuery.isLoading)}
          </div>
        </DialogContent>
      </Dialog>

      {/* Outstanding balances */}
      <Dialog open={balancesOpen} onOpenChange={setBalancesOpen}>
        <DialogContent className="flex max-h-[min(92vh,900px)] w-[min(96vw,960px)] max-w-[960px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[960px]">
          <DialogHeader className="shrink-0 border-b px-4 py-4 pr-14 text-start sm:px-6 sm:pr-16">
            <DialogTitle>الذمم المستحقة</DialogTitle>
            <DialogDescription>
              أرصدة العملاء وفواتير بها متبقي أو جزئي السداد. عند تطبيق التاريخ، تُقيّد قائمة الفواتير بتاريخ إنشاء
              الفاتورة؛ قائمة العملاء تعرض من له رصيد مستحق حالياً.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-end gap-2 border-b px-4 py-3 sm:px-6">
            <div className="flex-1">
              <ReportDateRangeBar
                from={balDraft.from}
                to={balDraft.to}
                onFromChange={(v) => setBalDraft((d) => ({ ...d, from: v }))}
                onToChange={(v) => setBalDraft((d) => ({ ...d, to: v }))}
                onApply={() => setBalApplied(normalizeReportRange(balDraft.from, balDraft.to))}
                isFetching={receivablesQuery.isFetching}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!receivablesQuery.data}
              onClick={() => {
                const d = receivablesQuery.data;
                if (!d) return;
                printReport(
                  "receivables",
                  {
                    unpaidInvoices: d.unpaidInvoices,
                    customersWithBalance: d.customersWithBalance,
                    agingTotals: d.agingTotals,
                  },
                  rangeToParams(balApplied),
                  shopSettings,
                );
              }}
            >
              <Printer className="me-1 h-4 w-4" />
              طباعة / PDF
            </Button>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 sm:px-6 sm:py-4">
            {receivablesQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">جاري التحميل…</p>
            ) : receivablesQuery.isError ? (
              <p className="text-sm text-destructive">تعذّر تحميل التقرير.</p>
            ) : (
              <div className="space-y-4">
                {/* Aging summary cards */}
                {receivablesQuery.data?.agingTotals && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(
                      [
                        { key: "current", label: "0 – 30 يوم", color: "border-green-400 bg-green-50 dark:bg-green-950/30" },
                        { key: "31to60", label: "31 – 60 يوم", color: "border-yellow-400 bg-yellow-50 dark:bg-yellow-950/30" },
                        { key: "61to90", label: "61 – 90 يوم", color: "border-orange-400 bg-orange-50 dark:bg-orange-950/30" },
                        { key: "over90", label: "+90 يوم", color: "border-red-500 bg-red-50 dark:bg-red-950/30" },
                      ] as const
                    ).map(({ key, label, color }) => (
                      <div key={key} className={`rounded-lg border-2 p-3 text-center ${color}`}>
                        <p className="text-xs text-muted-foreground">{label}</p>
                        <p className="mt-1 text-sm font-bold">
                          {formatAED(receivablesQuery.data.agingTotals[key])}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Aging invoices table */}
                <div className="rounded-lg border p-3">
                  <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
                    فواتير غير مسددة ({receivablesQuery.data?.unpaidInvoices?.length ?? 0})
                  </h3>
                  <div className="overflow-auto rounded-md border text-xs">
                    <table className="w-full min-w-[480px]">
                      <thead className="sticky top-0 bg-muted/80">
                        <tr>
                          <th className="px-2 py-1.5 text-start font-medium">فاتورة / عميل</th>
                          <th className="px-2 py-1.5 text-center font-medium">أيام</th>
                          <th className="px-2 py-1.5 text-end font-medium">الإجمالي</th>
                          <th className="px-2 py-1.5 text-end font-medium">المدفوع</th>
                          <th className="px-2 py-1.5 text-end font-medium">المتبقي</th>
                        </tr>
                      </thead>
                      <tbody>
                        {receivablesQuery.data?.unpaidInvoices?.length ? (
                          receivablesQuery.data.unpaidInvoices.map((inv) => {
                            const bucketColor =
                              inv.agingBucket === "current"
                                ? "text-green-700 dark:text-green-400"
                                : inv.agingBucket === "31to60"
                                  ? "text-yellow-700 dark:text-yellow-400"
                                  : inv.agingBucket === "61to90"
                                    ? "text-orange-700 dark:text-orange-400"
                                    : "text-red-700 dark:text-red-400";
                            return (
                              <tr key={inv.id} className="border-b border-border/40 hover:bg-muted/30">
                                <td className="px-2 py-1.5">
                                  <span className="font-medium">#{inv.invoiceNo}</span>{" "}
                                  <span className="text-muted-foreground">{inv.customer?.name ?? ""}</span>
                                </td>
                                <td className={`px-2 py-1.5 text-center font-bold tabular-nums ${bucketColor}`}>
                                  {inv.daysSince}
                                </td>
                                <td className="px-2 py-1.5 text-end font-mono tabular-nums">{formatAED(inv.totalFils)}</td>
                                <td className="px-2 py-1.5 text-end font-mono tabular-nums">{formatAED(inv.paidFils)}</td>
                                <td className={`px-2 py-1.5 text-end font-mono font-bold tabular-nums ${bucketColor}`}>
                                  {formatAED(inv.balanceFils)}
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={5} className="px-2 py-4 text-center text-muted-foreground">
                              لا يوجد.
                            </td>
                          </tr>
                        )}
                      </tbody>
                      {(receivablesQuery.data?.unpaidInvoices?.length ?? 0) > 0 && (
                        <tfoot className="bg-muted/80 font-semibold">
                          <tr>
                            <td colSpan={4} className="px-2 py-1.5 text-end text-xs">الإجمالي</td>
                            <td className="px-2 py-1.5 text-end font-mono tabular-nums">
                              {formatAED(
                                receivablesQuery.data?.unpaidInvoices?.reduce((s, i) => s + i.balanceFils, 0) ?? 0,
                              )}
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>

                {/* Customers with balance */}
                <div className="rounded-lg border p-3">
                  <h3 className="mb-2 text-xs font-semibold text-muted-foreground">عملاء بذمة</h3>
                  <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
                    {receivablesQuery.data?.customersWithBalance?.length ? (
                      receivablesQuery.data.customersWithBalance.map((c) => (
                        <li key={c.id} className="flex justify-between gap-2 border-b border-border/40 py-1">
                          <span>
                            {c.name}{" "}
                            <span className="text-muted-foreground" dir="ltr">
                              {c.mobile}
                            </span>
                          </span>
                          <span className="shrink-0 font-medium">{formatAED(c.balanceFils)}</span>
                        </li>
                      ))
                    ) : (
                      <li className="text-muted-foreground">لا يوجد.</li>
                    )}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Tailoring orders */}
      <Dialog open={tailoringOpen} onOpenChange={setTailoringOpen}>
        <DialogContent className="flex max-h-[min(92vh,900px)] w-[min(96vw,1000px)] max-w-[1000px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1000px]">
          <DialogHeader className="shrink-0 border-b px-4 py-4 pr-14 text-start sm:px-6 sm:pr-16">
            <DialogTitle>طلبات التفصيل</DialogTitle>
            <DialogDescription>طلبات التفصيل المُنشأة في الفترة المحددة.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-end gap-2 border-b px-4 py-3 sm:px-6">
            <div className="flex-1">
              <ReportDateRangeBar
                from={tailDraft.from}
                to={tailDraft.to}
                onFromChange={(v) => setTailDraft((d) => ({ ...d, from: v }))}
                onToChange={(v) => setTailDraft((d) => ({ ...d, to: v }))}
                onApply={() => setTailApplied(normalizeReportRange(tailDraft.from, tailDraft.to))}
                isFetching={tailoringQuery.isFetching}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!tailoringQuery.data}
              onClick={() => {
                const d = tailoringQuery.data;
                if (!d) return;
                printReport(
                  "tailoring",
                  { jobOrders: d.jobOrders, count: d.count },
                  rangeToParams(tailApplied),
                  shopSettings,
                );
              }}
            >
              <Printer className="me-1 h-4 w-4" />
              طباعة / PDF
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-6 sm:py-4">
            {tailoringQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">جاري التحميل…</p>
            ) : tailoringQuery.isError ? (
              <p className="text-sm text-destructive">تعذّر تحميل التقرير.</p>
            ) : (
              <>
                <p className="mb-3 text-sm text-muted-foreground">
                  العدد: <span className="font-medium text-foreground">{tailoringQuery.data?.count ?? 0}</span>
                </p>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full min-w-[800px] text-sm">
                    <thead className="border-b bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 text-start">طلب</th>
                        <th className="px-3 py-2 text-start">العميل</th>
                        <th className="px-3 py-2 text-start">النوع</th>
                        <th className="px-3 py-2 text-start">المرحلة</th>
                        <th className="px-3 py-2 text-start">فاتورة</th>
                        <th className="px-3 py-2 text-start">الإنشاء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tailoringQuery.data?.jobOrders?.length ? (
                        tailoringQuery.data.jobOrders.map((j) => (
                          <tr key={j.id} className="border-b border-border/50">
                            <td className="px-3 py-2 font-mono">#{j.jobNo}</td>
                            <td className="px-3 py-2">{j.customer.name}</td>
                            <td className="max-w-[200px] px-3 py-2 text-xs">{j.productStyle}</td>
                            <td className="px-3 py-2 text-xs">{JOB_STAGE_LABELS[j.stage] ?? j.stage}</td>
                            <td className="px-3 py-2 font-mono text-xs">
                              {j.invoice ? `#${j.invoice.invoiceNo}` : "—"}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                              {new Date(j.createdAt).toLocaleString()}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                            لا طلبات في هذه الفترة.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Most requested items */}
      <Dialog open={mostRequestedOpen} onOpenChange={setMostRequestedOpen}>
        <DialogContent className="flex max-h-[min(92vh,900px)] w-[min(96vw,1000px)] max-w-[1000px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1000px]">
          <DialogHeader className="shrink-0 border-b px-4 py-4 pr-14 text-start sm:px-6 sm:pr-16">
            <DialogTitle>الأكثر طلباً</DialogTitle>
            <DialogDescription>
              جميع أصناف الكتالوج مرتبة حسب عدد سطور البيع في الفواتير غير الملغاة خلال الفترة — بما فيها الأصناف
              بلا مبيعات في الفترة (تظهر في الأسفل). يشمل التفصيل (خدمة) والبيع الجاهز.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-end gap-2 border-b px-4 py-3 sm:px-6">
            <div className="flex-1">
              <ReportDateRangeBar
                from={mostDraft.from}
                to={mostDraft.to}
                onFromChange={(v) => setMostDraft((d) => ({ ...d, from: v }))}
                onToChange={(v) => setMostDraft((d) => ({ ...d, to: v }))}
                onApply={() => setMostApplied(normalizeReportRange(mostDraft.from, mostDraft.to))}
                isFetching={mostRequestedQuery.isFetching}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!mostRequestedQuery.data}
              onClick={() => {
                const d = mostRequestedQuery.data;
                if (!d) return;
                printReport("most-requested", { items: d.items }, rangeToParams(mostApplied), shopSettings);
              }}
            >
              <Printer className="me-1 h-4 w-4" />
              طباعة / PDF
            </Button>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 sm:px-6 sm:py-4">
            {mostRequestedQuery.data?.note ? (
              <p className="text-xs leading-relaxed text-muted-foreground">{mostRequestedQuery.data.note}</p>
            ) : null}
            {mostRequestedQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">جاري التحميل…</p>
            ) : mostRequestedQuery.isError ? (
              <p className="text-sm text-destructive">تعذّر تحميل التقرير.</p>
            ) : mostRequestedQuery.data?.items?.length ? (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[880px] text-sm">
                  <thead className="border-b bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 text-start">الصنف / الموديل</th>
                      <th className="px-3 py-2 text-start">التصنيف</th>
                      <th className="px-3 py-2 text-start">النوع</th>
                      <th className="px-3 py-2 text-end">مرات الطلب (سطور)</th>
                      <th className="px-3 py-2 text-end">فواتير</th>
                      <th className="px-3 py-2 text-end">إجمالي الكمية</th>
                      <th className="px-3 py-2 text-end">إجمالي المبيعات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mostRequestedQuery.data.items.map((row) => (
                      <tr
                        key={row.productId}
                        className={cn(
                          "border-b border-border/50",
                          row.lineCount === 0 && "bg-muted/45 dark:bg-muted/25",
                          row.lineCount > 0 &&
                            row.lineCount <= 2 &&
                            "bg-amber-50/90 dark:bg-amber-950/35",
                        )}
                      >
                        <td className="px-3 py-2">
                          <span className="font-medium">{row.name}</span>
                          {row.sku ? (
                            <span className="ms-2 font-mono text-xs text-muted-foreground">{row.sku}</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-xs">{row.categoryName}</td>
                        <td className="px-3 py-2 text-xs">
                          {row.kind === "tailoring" ? "تفصيل" : "جاهز"}
                        </td>
                        <td className="px-3 py-2 text-end font-mono tabular-nums">{row.lineCount}</td>
                        <td className="px-3 py-2 text-end font-mono tabular-nums">{row.invoiceCount}</td>
                        <td className="px-3 py-2 text-end font-mono tabular-nums">
                          {Number.isInteger(row.totalQty) ? row.totalQty : row.totalQty.toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-end font-mono tabular-nums">
                          {formatAED(row.totalSalesFils)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">لا توجد منتجات في الكتالوج.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Financial activity / cash flow */}
      <Dialog open={cashFlowOpen} onOpenChange={setCashFlowOpen}>
        <DialogContent className="flex max-h-[min(92vh,900px)] w-[min(96vw,1000px)] max-w-[1000px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1000px]">
          <DialogHeader className="shrink-0 border-b px-4 py-4 pr-14 text-start sm:px-6 sm:pr-16">
            <DialogTitle>النشاط المالي</DialogTitle>
            <DialogDescription>
              الإجماليات أولاً؛ في جدول التفاصيل يظهر دخل وأجور كسطرين إجماليين افتراضياً (مع إمكانية تفصيل الدفعات
              والمراحل من داخل «عرض التفاصيل»).
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-end gap-2 border-b px-4 py-3 sm:px-6">
            <div className="flex-1">
              <ReportDateRangeBar
                from={cashDraft.from}
                to={cashDraft.to}
                onFromChange={(v) => setCashDraft((d) => ({ ...d, from: v }))}
                onToChange={(v) => setCashDraft((d) => ({ ...d, to: v }))}
                onApply={() => setCashApplied(normalizeReportRange(cashDraft.from, cashDraft.to))}
                isFetching={financialActivityQuery.isFetching}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!financialActivityQuery.data}
              onClick={() => {
                const d = financialActivityQuery.data;
                if (!d) return;
                printReport(
                  "financial",
                  {
                    incomeFils: d.summary.totalIncomeFils,
                    expensesFils: d.summary.totalExpensesFils,
                    wagesFils: d.summary.totalWagesFils,
                    netFils: d.summary.netProfitFils,
                  },
                  rangeToParams(cashApplied),
                  shopSettings,
                );
              }}
            >
              <Printer className="me-1 h-4 w-4" />
              طباعة / PDF
            </Button>
          </div>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-3 sm:px-6 sm:py-4">
            {financialActivityQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">جاري التحميل…</p>
            ) : financialActivityQuery.isError ? (
              <p className="text-sm text-destructive">تعذّر تحميل التقرير.</p>
            ) : financialActivityQuery.data ? (
              <>
                <section
                  className={cn(
                    "sticky top-0 z-10 -mx-1 rounded-xl border-2 border-primary/25 bg-gradient-to-b from-muted/50 to-card px-3 py-4 shadow-md sm:px-5 sm:py-5",
                    "dark:border-primary/35 dark:from-muted/30",
                  )}
                  aria-label="ملخص الفترة"
                >
                  <h3 className="mb-1 text-center text-sm font-bold text-foreground sm:text-base">
                    ملخص الفترة — إجماليات
                  </h3>
                  <p className="mb-4 text-center text-[11px] text-muted-foreground sm:text-xs">
                    مراجعة سريعة عند الإغلاق: اضبط الفترة أعلاه — التفاصيل التفصيلية اختيارية من الزر أسفل الملخص.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="flex flex-col justify-center rounded-lg border border-emerald-300/60 bg-emerald-50/90 px-4 py-3 dark:border-emerald-800/50 dark:bg-emerald-950/40">
                      <p className="text-xs font-semibold text-emerald-900 dark:text-emerald-100">إجمالي الدخل (التحصيلات)</p>
                      <p className="mt-2 font-mono text-2xl font-bold tabular-nums tracking-tight text-emerald-950 dark:text-emerald-50 sm:text-3xl">
                        {formatAED(financialActivityQuery.data.summary.totalIncomeFils)}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">مجموع مدفوعات الفواتير في الفترة</p>
                    </div>
                    <div className="flex flex-col justify-center rounded-lg border border-amber-300/60 bg-amber-50/90 px-4 py-3 dark:border-amber-800/50 dark:bg-amber-950/35">
                      <p className="text-xs font-semibold text-amber-900 dark:text-amber-100">إجمالي أجور العمال</p>
                      <p className="mt-2 font-mono text-2xl font-bold tabular-nums tracking-tight text-amber-950 dark:text-amber-50 sm:text-3xl">
                        {formatAED(financialActivityQuery.data.summary.totalWagesFils)}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">مراحل الورشة المكتملة في الفترة</p>
                    </div>
                    <div className="flex flex-col justify-center rounded-lg border border-rose-200/80 bg-rose-50/80 px-4 py-3 dark:border-rose-900/50 dark:bg-rose-950/30">
                      <p className="text-xs font-semibold text-rose-900 dark:text-rose-100">إجمالي المصروفات</p>
                      <p className="mt-2 font-mono text-2xl font-bold tabular-nums tracking-tight text-rose-950 dark:text-rose-50 sm:text-3xl">
                        {formatAED(financialActivityQuery.data.summary.totalExpensesFils)}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">مصروفات مسجّلة بتاريخ ضمن الفترة</p>
                    </div>
                    <div
                      className={cn(
                        "flex flex-col justify-center rounded-lg border-2 px-4 py-3",
                        financialActivityQuery.data.summary.netProfitFils >= 0
                          ? "border-primary/50 bg-primary/10 dark:bg-primary/15"
                          : "border-destructive/50 bg-destructive/15 dark:bg-destructive/20",
                      )}
                    >
                      <p className="text-xs font-bold text-foreground">النتيجة الصافية</p>
                      <p
                        className={cn(
                          "mt-2 font-mono text-2xl font-bold tabular-nums tracking-tight sm:text-3xl",
                          financialActivityQuery.data.summary.netProfitFils >= 0
                            ? "text-primary"
                            : "text-destructive",
                        )}
                      >
                        {formatAED(financialActivityQuery.data.summary.netProfitFils)}
                      </p>
                      <p className="mt-1 text-[10px] font-medium text-muted-foreground">
                        الدخل − أجور العمال − المصروفات
                      </p>
                    </div>
                  </div>
                </section>

                <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => setCashFlowShowDetails((v) => !v)}
                    aria-expanded={cashFlowShowDetails}
                  >
                    {cashFlowShowDetails ? (
                      <>
                        <ChevronUp className="h-4 w-4" />
                        إخفاء التفاصيل
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-4 w-4" />
                        عرض التفاصيل ({financialActivityQuery.data.entries.length} سطر)
                      </>
                    )}
                  </Button>
                </div>

                {cashFlowShowDetails ? (
                  <div className="space-y-3 rounded-lg border border-border/80 bg-muted/20 p-3 sm:p-4">
                    <div className="space-y-2 rounded-md border border-border/60 bg-background/80 px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <Label htmlFor="cash-income-detail" className="cursor-pointer text-xs font-normal leading-snug">
                          عرض تحصيلات تفصيلية (كل دفعة / فاتورة)
                        </Label>
                        <input
                          id="cash-income-detail"
                          type="checkbox"
                          className="h-4 w-4 shrink-0 rounded border-input disabled:opacity-50"
                          checked={cashFlowIncomeDetailed}
                          disabled={financialActivityQuery.isFetching}
                          onChange={(e) => setCashFlowIncomeDetailed(e.target.checked)}
                        />
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-2">
                        <Label htmlFor="cash-wages-detail" className="cursor-pointer text-xs font-normal leading-snug">
                          عرض أجور تفصيلية (كل مرحلة وطلب)
                        </Label>
                        <input
                          id="cash-wages-detail"
                          type="checkbox"
                          className="h-4 w-4 shrink-0 rounded border-input disabled:opacity-50"
                          checked={cashFlowWagesDetailed}
                          disabled={financialActivityQuery.isFetching}
                          onChange={(e) => setCashFlowWagesDetailed(e.target.checked)}
                        />
                      </div>
                    </div>
                    {financialActivityQuery.data.note ? (
                      <p className="text-xs leading-relaxed text-muted-foreground">{financialActivityQuery.data.note}</p>
                    ) : null}
                    <h3 className="text-sm font-semibold">تفاصيل الحركة (سطر بسطر)</h3>
                    <div className="overflow-x-auto rounded-md border bg-card">
                      <table className="w-full min-w-[720px] text-sm">
                        <thead className="border-b bg-muted/50">
                          <tr>
                            <th className="px-3 py-2 text-start">النوع</th>
                            <th className="px-3 py-2 text-start">البيان</th>
                            <th className="px-3 py-2 text-end">المبلغ</th>
                            <th className="px-3 py-2 text-start">التاريخ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {financialActivityQuery.data.entries.length ? (
                            financialActivityQuery.data.entries.map((row) => (
                              <tr
                                key={row.id}
                                className={cn(
                                  "border-b border-border/50",
                                  row.type === "income" && "bg-emerald-50/40 dark:bg-emerald-950/15",
                                  row.type === "expense" && "bg-rose-50/35 dark:bg-rose-950/15",
                                  row.type === "wage" && "bg-amber-50/35 dark:bg-amber-950/15",
                                )}
                              >
                                <td className="whitespace-nowrap px-3 py-2 text-xs font-medium">
                                  {cashFlowTypeLabel(row.type)}
                                </td>
                                <td className="max-w-[340px] px-3 py-2 text-xs">{row.description}</td>
                                <td className="px-3 py-2 text-end font-mono text-xs tabular-nums">
                                  {formatAED(row.amountFils)}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                                  {new Date(row.date).toLocaleString()}
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                                لا حركة مالية في هذه الفترة.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
