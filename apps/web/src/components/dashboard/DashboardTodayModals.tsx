import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { jobStageLabel } from "@abaya-shop/shared";
import { DashboardDrilldownDialog, DrilldownState } from "@/components/dashboard/DashboardDrilldownDialog";
import { api } from "@/lib/api";
import { formatAED } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useLangStore } from "@/store/langStore";

export type TodayBreakdown = {
  collections: {
    totalFils: number;
    items: Array<{
      id: string;
      amountFils: number;
      method: string;
      at: string;
      invoiceId: string;
      invoiceNo: number;
      customerName: string | null;
    }>;
  };
  invoicedToday: {
    totalFils: number;
    paidFils: number;
    balanceFils: number;
    invoiceCount: number;
    tailoring: { totalFils: number; pieces: number };
    readyMade: { totalFils: number; pieces: number };
    items: Array<{
      id: string;
      invoiceNo: number;
      customerName: string | null;
      totalFils: number;
      paidFils: number;
      balanceFils: number;
      at: string;
      tailoringFils: number;
      pieces: Array<{ label: string; qty: number; totalFils: number; isTailoring: boolean }>;
    }>;
  };
  expenses: {
    totalFils: number;
    items: Array<{
      id: string;
      amountFils: number;
      description: string;
      category: string | null;
      at: string;
    }>;
  };
  wages: {
    totalFils: number;
    items: Array<{
      id: string;
      amountFils: number;
      stageKey: string;
      workerName: string;
      jobNo: number | null;
      productStyle: string | null;
      at: string | null;
    }>;
  };
};

export type TodayModal = "collections" | "invoiced" | "expenses" | "wages" | null;

/** One request backs all four money drill-downs; only fetched once a card is opened. */
export function useTodayBreakdown(enabled: boolean) {
  return useQuery({
    queryKey: ["dashboard", "today"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: TodayBreakdown }>("/dashboard/today");
      return res.data.data;
    },
    enabled,
  });
}

function useTimeFormatter() {
  const { lang } = useLangStore();
  const locale = lang === "ar" ? "ar-AE" : "en-AE";
  return (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : "—";
}

function methodLabelKey(method: string): string {
  switch (method.toUpperCase()) {
    case "CASH":
      return "common.cash";
    case "CARD":
      return "common.card";
    case "TRANSFER":
      return "common.transfer";
    default:
      return "";
  }
}

/** Shared row chrome so all four lists scan the same way. */
function Row({
  primary,
  secondary,
  amountFils,
  amountClass,
  meta,
}: {
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  amountFils: number;
  amountClass?: string;
  meta?: React.ReactNode;
}) {
  return (
    <li className="flex items-start justify-between gap-3 border-b border-border/50 py-2.5 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-tight">{primary}</div>
        {secondary ? <div className="mt-0.5 text-xs text-muted-foreground">{secondary}</div> : null}
      </div>
      <div className="shrink-0 text-end">
        <div className={cn("font-mono text-sm font-semibold tabular-nums", amountClass)}>
          {formatAED(amountFils)}
        </div>
        {meta ? <div className="mt-0.5 text-[11px] text-muted-foreground">{meta}</div> : null}
      </div>
    </li>
  );
}

/** Copy for each drill-down, so the single dialog can retitle itself. */
const CHROME: Record<
  Exclude<TodayModal, null>,
  { title: string; desc: string; totalLabel?: string; href: string }
> = {
  collections: {
    title: "pages.dashboard.drilldown.collectionsTitle",
    desc: "pages.dashboard.drilldown.collectionsDesc",
    totalLabel: "pages.dashboard.drilldown.collectionsTotal",
    href: "/accounts",
  },
  invoiced: {
    title: "pages.dashboard.drilldown.invoicedTitle",
    desc: "pages.dashboard.drilldown.invoicedDesc",
    totalLabel: "pages.dashboard.drilldown.invoicedTotal",
    href: "/invoices",
  },
  expenses: {
    title: "pages.dashboard.drilldown.expensesTitle",
    desc: "pages.dashboard.drilldown.expensesDesc",
    href: "/accounts/expenses",
  },
  wages: {
    title: "pages.dashboard.drilldown.wagesTitle",
    desc: "pages.dashboard.drilldown.wagesDesc",
    href: "/payroll",
  },
};

/**
 * ONE dialog whose contents switch, not four stacked ones. With four separate
 * `<Dialog>`s, clicking straight from one card to the next left the previous
 * dialog mounted at full opacity behind the new one: Radix unmounts a closed
 * dialog only after its exit animation, which never ran while a sibling was
 * opening in the same tick.
 */
export function DashboardTodayModals({
  modal,
  onClose,
}: {
  modal: TodayModal;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { lang } = useLangStore();
  const time = useTimeFormatter();
  const { data, isLoading, isError } = useTodayBreakdown(modal !== null);

  const state = isLoading ? "loading" : isError || !data ? "error" : null;
  const chrome = modal ? CHROME[modal] : null;

  function totalFor(): number | undefined {
    if (!data || !modal) return undefined;
    if (modal === "collections") return data.collections.totalFils;
    if (modal === "invoiced") return data.invoicedToday.totalFils;
    if (modal === "expenses") return data.expenses.totalFils;
    return data.wages.totalFils;
  }

  function body() {
    if (state) return <DrilldownState state={state} />;
    const d = data!;

    if (modal === "collections") {
      if (d.collections.items.length === 0) return <DrilldownState state="empty" />;
      return (
        <ul>
          {d.collections.items.map((p) => {
            const key = methodLabelKey(p.method);
            return (
              <Row
                key={p.id}
                primary={
                  <>
                    #{p.invoiceNo}
                    {p.customerName ? <span className="font-normal"> — {p.customerName}</span> : null}
                  </>
                }
                secondary={`${key ? t(key) : p.method} · ${time(p.at)}`}
                amountFils={p.amountFils}
                amountClass="text-green-700 dark:text-green-400"
              />
            );
          })}
        </ul>
      );
    }

    if (modal === "invoiced") {
      if (d.invoicedToday.items.length === 0) return <DrilldownState state="empty" />;
      return (
        <>
          {/* The point of this dialog: sold vs collected vs still owed. */}
          <div className="mb-4 grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg border bg-muted/30 px-3 py-2">
              <p className="text-[11px] text-muted-foreground">
                {t("pages.dashboard.drilldown.tailoringToday")}
              </p>
              <p className="font-mono text-base font-bold tabular-nums">
                {formatAED(d.invoicedToday.tailoring.totalFils)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {d.invoicedToday.tailoring.pieces} {t("common.pieces")}
              </p>
            </div>
            <div className="rounded-lg border bg-muted/30 px-3 py-2">
              <p className="text-[11px] text-muted-foreground">
                {t("pages.dashboard.drilldown.readyMadeToday")}
              </p>
              <p className="font-mono text-base font-bold tabular-nums">
                {formatAED(d.invoicedToday.readyMade.totalFils)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {d.invoicedToday.readyMade.pieces} {t("common.pieces")}
              </p>
            </div>
            <div className="rounded-lg border-2 border-amber-300 bg-amber-50/70 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-950/25">
              <p className="text-[11px] text-amber-900 dark:text-amber-200">
                {t("pages.dashboard.drilldown.stillOwed")}
              </p>
              <p className="font-mono text-base font-bold tabular-nums text-amber-900 dark:text-amber-100">
                {formatAED(d.invoicedToday.balanceFils)}
              </p>
              <p className="text-[11px] text-amber-800/80 dark:text-amber-200/80">
                {t("pages.dashboard.drilldown.paidSoFar", {
                  amount: formatAED(d.invoicedToday.paidFils),
                })}
              </p>
            </div>
          </div>

          <ul>
            {d.invoicedToday.items.map((inv) => (
              <Row
                key={inv.id}
                primary={
                  <>
                    #{inv.invoiceNo}
                    {inv.customerName ? <span className="font-normal"> — {inv.customerName}</span> : null}
                  </>
                }
                secondary={
                  <>
                    <span>{time(inv.at)}</span>
                    {inv.pieces.length > 0 ? (
                      <span>
                        {" · "}
                        {inv.pieces.map((p) => `${p.label}${p.qty > 1 ? ` ×${p.qty}` : ""}`).join("، ")}
                      </span>
                    ) : null}
                  </>
                }
                amountFils={inv.totalFils}
                meta={
                  inv.balanceFils > 0 ? (
                    <span className="font-semibold text-amber-800 dark:text-amber-300">
                      {t("pages.dashboard.drilldown.remaining")} {formatAED(inv.balanceFils)}
                    </span>
                  ) : (
                    <span className="text-green-700 dark:text-green-400">{t("status.payment.paid")}</span>
                  )
                }
              />
            ))}
          </ul>
        </>
      );
    }

    if (modal === "expenses") {
      if (d.expenses.items.length === 0) return <DrilldownState state="empty" />;
      return (
        <ul>
          {d.expenses.items.map((e) => (
            <Row
              key={e.id}
              primary={e.description}
              secondary={`${e.category ?? "—"} · ${time(e.at)}`}
              amountFils={e.amountFils}
              amountClass="text-red-700 dark:text-red-400"
            />
          ))}
        </ul>
      );
    }

    if (modal === "wages") {
      if (d.wages.items.length === 0) return <DrilldownState state="empty" />;
      return (
        <ul>
          {d.wages.items.map((w) => (
            <Row
              key={w.id}
              primary={w.workerName}
              secondary={
                <>
                  {jobStageLabel(w.stageKey, lang === "ar" ? "ar" : "en")}
                  {w.jobNo ? ` · #${w.jobNo}` : ""}
                  {w.productStyle ? ` · ${w.productStyle}` : ""}
                  {w.at ? ` · ${time(w.at)}` : ""}
                </>
              }
              amountFils={w.amountFils}
              amountClass="text-red-700 dark:text-red-400"
            />
          ))}
        </ul>
      );
    }

    return null;
  }

  return (
    <DashboardDrilldownDialog
      open={modal !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={chrome ? t(chrome.title) : ""}
      description={chrome ? t(chrome.desc) : undefined}
      totalFils={totalFor()}
      totalLabel={chrome?.totalLabel ? t(chrome.totalLabel) : undefined}
      fullPageHref={chrome?.href}
    >
      {body()}
    </DashboardDrilldownDialog>
  );
}

