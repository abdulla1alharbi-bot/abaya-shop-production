import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { getApiErrorMessage, isServerError } from "@/lib/apiErrors";
import { formatAED } from "@/lib/money";
import { invoiceFulfillmentKey } from "@/lib/invoiceOperationalLabels";
import { useIsWorker } from "@/hooks/useIsWorker";
import { cn } from "@/lib/utils";

type InvoiceListItem = {
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
  status?: string;
  customer: { name: string; mobile: string } | null;
  jobOrders?: { id: string; stage: string }[];
};

type InvoiceListMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  totalOutstandingFils?: number;
  invoiceCountWithBalance?: number;
  readyInvoiceCount?: number;
  totalReadyValueFils?: number;
};

function fulfillmentBadgeClass(s: string): string {
  switch (s) {
    case "VOID":
      return "border-red-200 bg-red-50 text-red-700";
    case "DELIVERED":
      return "border-slate-200 bg-slate-100 text-slate-600";
    case "READY_FOR_DELIVERY":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "IN_WORKSHOP":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "NO_TAILORING":
      return "border-gray-200 bg-gray-50 text-gray-600";
    default:
      return "border-gray-200 bg-gray-50 text-gray-600";
  }
}

function paymentBadgeClass(inv: InvoiceListItem): string {
  if (inv.isVoid) return "border-red-200 bg-red-50 text-red-700";
  if (inv.balanceFils <= 0) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (inv.paidFils <= 0) return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-orange-200 bg-orange-50 text-orange-700";
}

function setListMode(
  setSearchParams: ReturnType<typeof useSearchParams>[1],
  mode: "all" | "balance" | "ready",
) {
  if (mode === "all") {
    setSearchParams({}, { replace: true });
    return;
  }
  if (mode === "balance") {
    setSearchParams({ balanceDue: "true" }, { replace: true });
    return;
  }
  setSearchParams({ readyForDelivery: "true" }, { replace: true });
}

export function InvoicesPage() {
  const isWorker = useIsWorker();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const balanceDueMode = searchParams.get("balanceDue") === "true";
  const readyForDeliveryMode = searchParams.get("readyForDelivery") === "true";
  const { t } = useTranslation();

  const [searchInput, setSearchInput] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(searchInput.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["invoices", balanceDueMode, readyForDeliveryMode, debouncedQ],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { items: InvoiceListItem[]; meta: InvoiceListMeta };
      }>("/invoices", {
        params: {
          limit: 100,
          ...(balanceDueMode ? { balanceDue: "true" } : {}),
          ...(readyForDeliveryMode ? { readyForDelivery: "true" } : {}),
          ...(debouncedQ ? { q: debouncedQ } : {}),
        },
      });
      return res.data.data;
    },
  });

  const items = data?.items ?? [];
  const meta = data?.meta;

  const pageTitle = balanceDueMode
    ? t("pages.invoices.titleBalance")
    : readyForDeliveryMode
      ? t("pages.invoices.titleReady")
      : t("pages.invoices.title");

  const colCount = isWorker ? 8 : 12;

  const pageDescription = balanceDueMode
    ? t("pages.invoices.descBalance")
    : readyForDeliveryMode
      ? t("pages.invoices.descReady")
      : t("pages.invoices.descAll");

  const emptyMessage = debouncedQ
    ? t("pages.invoices.emptySearch")
    : balanceDueMode
      ? t("pages.invoices.emptyBalance")
      : readyForDeliveryMode
        ? t("pages.invoices.emptyReady")
        : t("pages.invoices.emptyDefault");

  function paymentStatusLabel(inv: InvoiceListItem): string {
    if (inv.isVoid) return t("status.payment.void");
    if (inv.balanceFils <= 0) return t("status.payment.paid");
    if (inv.paidFils <= 0) return t("status.payment.unpaid");
    return t("status.payment.partial");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={pageTitle}
        description={pageDescription}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={!balanceDueMode && !readyForDeliveryMode ? "default" : "outline"}
              size="sm"
              onClick={() => setListMode(setSearchParams, "all")}
            >
              {t("pages.invoices.btnAll")}
            </Button>
            {!isWorker ? (
              <>
                <Button
                  type="button"
                  variant={balanceDueMode ? "default" : "outline"}
                  size="sm"
                  onClick={() => setListMode(setSearchParams, "balance")}
                >
                  {t("pages.invoices.btnBalance")}
                </Button>
                <Button
                  type="button"
                  variant={readyForDeliveryMode ? "default" : "outline"}
                  size="sm"
                  onClick={() => setListMode(setSearchParams, "ready")}
                >
                  {t("pages.invoices.btnReady")}
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      {!isWorker && balanceDueMode && meta && typeof meta.totalOutstandingFils === "number" && !isLoading ? (
        <section
          className="rounded-xl border border-amber-200/90 bg-amber-50/70 p-4 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/25"
          aria-label={t("pages.invoices.summaryDebtTitle")}
        >
          <h2 className="text-sm font-semibold text-amber-950 dark:text-amber-100">{t("pages.invoices.summaryDebtTitle")}</h2>
          <dl className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-muted-foreground">{t("pages.invoices.totalOutstanding")}</dt>
              <dd className="mt-1 text-2xl font-bold tabular-nums text-amber-950 dark:text-amber-50">
                {formatAED(meta.totalOutstandingFils)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">{t("pages.invoices.invoicesWithBalance")}</dt>
              <dd className="mt-1 text-2xl font-bold tabular-nums text-amber-950 dark:text-amber-50">
                {meta.invoiceCountWithBalance ?? meta.total}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      {!isWorker && readyForDeliveryMode && meta && typeof meta.totalReadyValueFils === "number" && !isLoading ? (
        <section
          className="rounded-xl border border-emerald-200/90 bg-emerald-50/70 p-4 shadow-sm dark:border-emerald-900/50 dark:bg-emerald-950/25"
          aria-label={t("pages.invoices.summaryReadyTitle")}
        >
          <h2 className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">{t("pages.invoices.summaryReadyTitle")}</h2>
          <dl className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-muted-foreground">{t("pages.invoices.readyInvoiceCount")}</dt>
              <dd className="mt-1 text-2xl font-bold tabular-nums text-emerald-950 dark:text-emerald-50">
                {meta.readyInvoiceCount ?? meta.total}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">{t("pages.invoices.totalReadyValue")}</dt>
              <dd className="mt-1 text-2xl font-bold tabular-nums text-emerald-950 dark:text-emerald-50">
                {formatAED(meta.totalReadyValueFils)}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Search className="h-4 w-4" />
          {t("pages.invoices.searchSection")}
        </h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <Label className="text-xs" htmlFor="invoice-search">
              {t("pages.invoices.searchLabel")}
            </Label>
            <Input
              id="invoice-search"
              className="mt-1 h-10 font-mono"
              dir="ltr"
              inputMode="search"
              autoComplete="off"
              placeholder={t("pages.invoices.searchPlaceholder")}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          {isFetching ? <span className="text-xs text-muted-foreground">{t("pages.invoices.searching")}</span> : null}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t("pages.invoices.searchNote")}</p>
      </section>

      {isError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">
            {isServerError(error)
              ? t("pages.invoices.errorLoadingServer")
              : getApiErrorMessage(error, t("pages.invoices.errorLoading"))}
          </p>
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void refetch()}>
            {t("pages.invoices.retry")}
          </Button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="px-3 py-2.5 text-start text-sm font-semibold text-foreground">{t("pages.invoices.colInvoiceNo")}</th>
              <th className="px-3 py-2.5 text-start text-sm font-semibold text-foreground">{t("pages.invoices.colCustomer")}</th>
              <th className="px-3 py-2.5 text-start text-sm font-semibold text-foreground">{t("pages.invoices.colMobile")}</th>
              <th className="px-3 py-2.5 text-start text-sm font-semibold text-foreground">{t("pages.invoices.colDate")}</th>
              <th className="px-3 py-2.5 text-start text-sm font-semibold text-foreground">{t("pages.invoices.colDeliveryDate")}</th>
              {!isWorker ? (
                <>
                  <th className="px-3 py-2.5 text-end text-sm font-semibold text-foreground">{t("pages.invoices.colTotal")}</th>
                  <th className="px-3 py-2.5 text-end text-sm font-semibold text-foreground">{t("pages.invoices.colPaid")}</th>
                  <th className="px-3 py-2.5 text-end text-sm font-semibold text-foreground">{t("pages.invoices.colBalance")}</th>
                </>
              ) : null}
              <th className="px-3 py-2.5 text-start text-sm font-semibold text-foreground">{t("pages.invoices.colFulfillmentStatus")}</th>
              {!isWorker ? (
                <th className="px-3 py-2.5 text-start text-sm font-semibold text-foreground">{t("pages.invoices.colPaymentStatus")}</th>
              ) : null}
              <th className="px-3 py-2.5 text-center text-sm font-semibold text-foreground">{t("pages.invoices.colView")}</th>
              <th className="px-3 py-2.5 text-center text-sm font-semibold text-foreground">{t("pages.invoices.colDetails")}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-8 text-center text-muted-foreground">
                  {t("common.loadingData")}
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-8 text-center text-muted-foreground">
                  —
                </td>
              </tr>
            ) : !items.length ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-8 text-center text-muted-foreground">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              items.map((inv) => (
                <tr
                  key={inv.id}
                  className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/40"
                  onClick={() => navigate(`/invoices/${inv.id}`)}
                >
                  <td className="px-3 py-3 font-mono font-bold">#{inv.invoiceNo}</td>
                  <td className="px-3 py-3">{inv.customer?.name ?? "—"}</td>
                  <td className="px-3 py-3 font-mono text-muted-foreground" dir="ltr">
                    {inv.customer?.mobile ?? "—"}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">
                    {new Date(inv.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">
                    {inv.deliveryDate ? new Date(inv.deliveryDate).toLocaleString() : "—"}
                  </td>
                  {!isWorker ? (
                    <>
                      <td className="px-3 py-3 text-end font-mono tabular-nums">{formatAED(inv.totalFils)}</td>
                      <td className="px-3 py-3 text-end font-mono tabular-nums">{formatAED(inv.paidFils)}</td>
                      <td className="px-3 py-3 text-end font-mono tabular-nums">
                        <span
                          className={cn(
                            "font-mono tabular-nums",
                            inv.balanceFils > 0 ? "font-bold text-amber-800 dark:text-amber-100" : "text-muted-foreground",
                          )}
                        >
                          {formatAED(inv.balanceFils)}
                        </span>
                      </td>
                    </>
                  ) : null}
                  <td className="px-3 py-3">
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                        fulfillmentBadgeClass(inv.fulfillmentStatus),
                      )}
                    >
                      {t(invoiceFulfillmentKey(inv.fulfillmentStatus))}
                    </span>
                  </td>
                  {!isWorker ? (
                    <td className="px-3 py-3">
                      <span
                        className={cn(
                          "inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                          paymentBadgeClass(inv),
                        )}
                      >
                        {paymentStatusLabel(inv)}
                      </span>
                    </td>
                  ) : null}
                  <td className="px-3 py-3 text-center">
                    <Link
                      className="font-semibold text-brand-700 underline"
                      to={`/invoices/${inv.id}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t("pages.invoices.viewLink")}
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <Link
                      className="text-sm text-muted-foreground underline hover:text-foreground"
                      to={`/invoices/${inv.id}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t("pages.invoices.openWorkLink")}
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
