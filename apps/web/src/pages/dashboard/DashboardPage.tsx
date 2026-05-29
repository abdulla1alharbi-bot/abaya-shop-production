import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowRightLeft,
  Boxes,
  CheckCircle2,
  Clock,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { DashboardInvoiceQueueCards } from "@/components/dashboard/DashboardInvoiceQueueCards";
import { PendingTailoringSection } from "@/components/dashboard/PendingTailoringSection";
import { Sparkline } from "@/components/dashboard/Sparkline";
import { GlobalInvoiceSearch } from "@/components/invoices/GlobalInvoiceSearch";
import { useIsWorker } from "@/hooks/useIsWorker";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatAED } from "@/lib/money";
import { useLangStore } from "@/store/langStore";

interface DashboardTrends {
  salesToday: number;
  salesYesterday: number;
  salesSameDayLastWeek: number;
  salesLast7Days: number[];
  topProductsThisMonth: Array<{ name: string; qty: number; totalFils: number }>;
  onTimeDeliveryRate30d: number;
  deliveredJobsLast30Days: number;
  topWorkersThisWeek: Array<{ name: string; qty: number; wageFils: number }>;
  overdueJobsCount: number;
}

interface DashboardStats {
  jobOrdersOpenCount: number;
  jobOrdersReadyCount: number;
  jobOrdersOverdueCount: number;
  lowStockFabricRolls: number;
  salesTodayFils: number;
  paymentsTodayFils: number;
  expensesTodayFils: number;
  wagesTodayFils: number;
  netTodayFils: number;
  customersOutstandingFils: number;
  invoicesOutstandingFils: number;
  invoicesWithBalanceCount: number;
  readyForDeliveryInvoiceCount: number;
  readyForDeliveryTotalFils: number;
}

export function DashboardPage() {
  const isWorker = useIsWorker();
  const { t } = useTranslation();
  const { lang } = useLangStore();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard", "stats"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: DashboardStats }>("/dashboard/stats");
      return res.data.data;
    },
  });

  const { data: trends } = useQuery({
    queryKey: ["dashboard", "trends"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: DashboardTrends }>("/dashboard/trends");
      return res.data.data;
    },
    enabled: !isWorker,
  });

  function deltaArrow(now: number, prev: number): { label: string; cls: string } {
    if (prev === 0) {
      return now > 0
        ? { label: t("pages.dashboard.deltaNew"), cls: "text-green-600 dark:text-green-400" }
        : { label: "—", cls: "text-muted-foreground" };
    }
    const pct = ((now - prev) / prev) * 100;
    if (Math.abs(pct) < 0.5) return { label: t("pages.dashboard.deltaNoChange"), cls: "text-muted-foreground" };
    if (pct > 0) return { label: `▲ ${pct.toFixed(0)}%`, cls: "text-green-600 dark:text-green-400" };
    return { label: `▼ ${Math.abs(pct).toFixed(0)}%`, cls: "text-red-600 dark:text-red-400" };
  }

  const dateLocale = lang === "ar" ? "ar-AE" : "en-AE";

  return (
    <div className="space-y-7">
      <PageHeader
        title={t("pages.dashboard.title")}
        description={
          isWorker
            ? t("pages.dashboard.descriptionWorker")
            : t("pages.dashboard.descriptionManager")
        }
        actions={
          isWorker ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to="/invoices">{t("pages.dashboard.btnInvoicesTailoring")}</Link>
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" asChild>
                <Link to="/pos">{t("pages.dashboard.btnOpenSale")}</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to="/accounts/expenses">{t("pages.dashboard.btnRegisterExpense")}</Link>
              </Button>
            </div>
          )
        }
      />

      <GlobalInvoiceSearch className="max-w-xl" />

      <section>
        <h2 className="mb-4 text-sm font-semibold text-foreground">{t("pages.dashboard.sectionOperations")}</h2>
        <div className="grid gap-4 lg:grid-cols-3">
          {!isWorker ? (
            data ? (
              <DashboardInvoiceQueueCards
                stats={{
                  invoicesOutstandingFils: data.invoicesOutstandingFils,
                  invoicesWithBalanceCount: data.invoicesWithBalanceCount,
                  readyForDeliveryInvoiceCount: data.readyForDeliveryInvoiceCount,
                  readyForDeliveryTotalFils: data.readyForDeliveryTotalFils,
                }}
              />
            ) : (
              <div className="flex min-h-[120px] items-center rounded-xl border border-dashed border-border/80 bg-muted/20 px-4 text-sm text-muted-foreground lg:col-span-2">
                {isLoading ? t("pages.dashboard.loadingDebtSummary") : t("pages.dashboard.errorDebtSummary")}
              </div>
            )
          ) : null}
          <div className={isWorker ? "min-w-0 lg:col-span-3" : "min-w-0"}>
            <PendingTailoringSection />
          </div>
        </div>
      </section>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loadingStats")}</p>
      ) : isError || !data ? (
        <p className="text-sm text-destructive">{t("common.errorStats")}</p>
      ) : (
        <>
          {!isWorker ? (
            <section>
              <h2 className="mb-4 text-sm font-semibold text-foreground">{t("pages.dashboard.sectionFinancials")}</h2>
              <p className="mb-4 text-xs text-muted-foreground">{t("pages.dashboard.sectionFinancialsNote")}</p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  title={t("pages.dashboard.salesTodayCard")}
                  value={formatAED(data.paymentsTodayFils)}
                  icon={<Wallet className="h-4 w-4" />}
                />
                <StatCard
                  title={t("pages.dashboard.expensesTodayCard")}
                  value={formatAED(data.expensesTodayFils)}
                  icon={<TrendingDown className="h-4 w-4" />}
                />
                <StatCard
                  title={t("pages.dashboard.wagesTodayCard")}
                  value={formatAED(data.wagesTodayFils)}
                  icon={<ShoppingCart className="h-4 w-4" />}
                />
                <StatCard
                  title={t("pages.dashboard.netTodayCard")}
                  value={formatAED(data.netTodayFils)}
                  icon={<ArrowRightLeft className="h-4 w-4" />}
                  className={data.netTodayFils >= 0 ? "border-primary/25" : "border-destructive/30 bg-destructive/5"}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {t("pages.dashboard.salesTodayNote", { amount: formatAED(data.salesTodayFils) })}
              </p>
            </section>
          ) : null}

          {!isWorker && trends ? (
            <section>
              <h2 className="mb-4 text-sm font-semibold text-foreground">{t("pages.dashboard.sectionTrends")}</h2>

              <div className="mb-4 grid gap-4 sm:grid-cols-3">
                {(() => {
                  const dy = deltaArrow(trends.salesToday, trends.salesYesterday);
                  const dw = deltaArrow(trends.salesToday, trends.salesSameDayLastWeek);
                  return (
                    <>
                      <div className="rounded-xl border-2 border-primary/40 bg-primary/5 p-4">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-muted-foreground">{t("pages.dashboard.collectionsTodayLabel")}</p>
                          <TrendingUp className="h-4 w-4 text-primary" />
                        </div>
                        <p className="mt-1 text-lg font-bold">{formatAED(trends.salesToday)}</p>
                        <div className="mt-2 flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">
                            {t("pages.dashboard.yesterdayLabel")} {formatAED(trends.salesYesterday)}
                          </span>
                          <span className={`font-semibold ${dy.cls}`}>{dy.label}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">
                            {t("pages.dashboard.sameLastWeekLabel")} {formatAED(trends.salesSameDayLastWeek)}
                          </span>
                          <span className={`font-semibold ${dw.cls}`}>{dw.label}</span>
                        </div>
                      </div>
                      <div className="rounded-xl border-2 border-border bg-card p-4 sm:col-span-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-muted-foreground">{t("pages.dashboard.last7Days")}</p>
                          <span className="text-xs text-muted-foreground">
                            {t("pages.dashboard.totalLabel")} {formatAED(trends.salesLast7Days.reduce((s, x) => s + x, 0))}
                          </span>
                        </div>
                        <div className="mt-3 flex items-center justify-center text-primary">
                          <Sparkline values={trends.salesLast7Days} width={280} height={50} fillColor="currentColor" />
                        </div>
                        <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
                          {trends.salesLast7Days.map((_, i) => {
                            const d = new Date();
                            d.setDate(d.getDate() - (6 - i));
                            return <span key={i}>{d.toLocaleDateString(dateLocale, { weekday: "narrow" })}</span>;
                          })}
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>

              <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  title={t("pages.dashboard.kpiOnTimeRate")}
                  value={`${trends.onTimeDeliveryRate30d}%`}
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  className={
                    trends.onTimeDeliveryRate30d >= 90
                      ? "border-green-400"
                      : trends.onTimeDeliveryRate30d >= 70
                        ? "border-yellow-400"
                        : "border-red-400"
                  }
                />
                <StatCard
                  title={t("pages.dashboard.kpiOverdue")}
                  value={String(trends.overdueJobsCount)}
                  icon={<AlertTriangle className="h-4 w-4" />}
                  className={trends.overdueJobsCount > 0 ? "border-red-400 bg-red-50/40 dark:bg-red-950/20" : ""}
                />
                <StatCard
                  title={t("pages.dashboard.kpiDeliveries30d")}
                  value={String(trends.deliveredJobsLast30Days)}
                  icon={<Clock className="h-4 w-4" />}
                />
                <StatCard
                  title={t("pages.dashboard.kpiSalesToday")}
                  value={formatAED(trends.salesToday)}
                  icon={<Wallet className="h-4 w-4" />}
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border bg-card p-4">
                  <h3 className="mb-3 text-sm font-semibold">{t("pages.dashboard.topProductsTitle")}</h3>
                  {trends.topProductsThisMonth.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("common.noData")}</p>
                  ) : (
                    <ol className="space-y-2 text-sm">
                      {trends.topProductsThisMonth.map((p, i) => (
                        <li key={i} className="flex items-center justify-between gap-2 border-b border-border/40 pb-1.5 last:border-0">
                          <span className="flex items-center gap-2">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                              {i + 1}
                            </span>
                            <span className="font-medium">{p.name}</span>
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {p.qty} {t("common.pieces")} · <span className="font-mono">{formatAED(p.totalFils)}</span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
                <div className="rounded-xl border bg-card p-4">
                  <h3 className="mb-3 text-sm font-semibold">{t("pages.dashboard.topWorkersTitle")}</h3>
                  {trends.topWorkersThisWeek.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("common.noData")}</p>
                  ) : (
                    <ol className="space-y-2 text-sm">
                      {trends.topWorkersThisWeek.map((w, i) => (
                        <li key={i} className="flex items-center justify-between gap-2 border-b border-border/40 pb-1.5 last:border-0">
                          <span className="flex items-center gap-2">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                              {i + 1}
                            </span>
                            <span className="font-medium">{w.name}</span>
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {w.qty} {t("common.stages")} · <span className="font-mono">{formatAED(w.wageFils)}</span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            </section>
          ) : null}

          <section>
            <h2 className="mb-4 text-sm font-semibold text-foreground">
              {isWorker ? t("pages.dashboard.sectionInventory") : t("pages.dashboard.sectionInventoryDebt")}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {!isWorker ? (
                <StatCard
                  title={t("pages.dashboard.customerBalancesCard")}
                  value={formatAED(data.customersOutstandingFils)}
                  icon={<Wallet className="h-4 w-4" />}
                  to="/reports"
                />
              ) : null}
              <StatCard
                title={t("pages.dashboard.lowStockCard")}
                value={String(data.lowStockFabricRolls)}
                icon={<Boxes className="h-4 w-4" />}
              />
            </div>
          </section>

          <section>
            <h2 className="mb-4 text-sm font-semibold text-foreground">{t("pages.dashboard.sectionTailoring")}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard
                title={t("pages.dashboard.openJobsCard")}
                value={String(data.jobOrdersOpenCount)}
                icon={<Clock className="h-4 w-4" />}
              />
              <StatCard
                title={t("pages.dashboard.readyJobsCard")}
                value={String(data.jobOrdersReadyCount)}
                icon={<CheckCircle2 className="h-4 w-4 text-green-600" />}
              />
              <StatCard
                title={t("pages.dashboard.overdueJobsCard")}
                value={String(data.jobOrdersOverdueCount)}
                icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}
              />
            </div>
          </section>

          <div className="flex flex-wrap gap-2 border-t pt-6 text-sm">
            <Button variant="outline" size="sm" asChild>
              <Link to="/invoices">{t("pages.dashboard.btnInvoicesTailoring")}</Link>
            </Button>
            {!isWorker ? (
              <>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/accounts">{t("pages.dashboard.btnFinancialMovement")}</Link>
                </Button>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/reports">{t("pages.dashboard.btnAllReports")}</Link>
                </Button>
              </>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
