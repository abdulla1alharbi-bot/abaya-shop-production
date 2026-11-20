import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Printer, X } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { applyBalanceFilter, parseAedList, parseAedToFils, type BalanceSort } from "@/lib/balanceFilter";
import { formatAED } from "@/lib/money";
import { printInvoiceBalances, type OpenInvoiceBalance } from "@/lib/printReport";

const SORTS: BalanceSort[] = ["balanceDesc", "balanceAsc", "oldest", "newest", "invoiceNo"];

/**
 * Every invoice that still has money owed on it, one row per invoice so the
 * owner reads invoice numbers rather than the phone numbers most customers are
 * saved under. Amounts can be filtered out (rounding crumbs, specific figures)
 * and the print button prints exactly the filtered, numbered list.
 *
 * The filter lives in the URL so a refresh or a bookmark keeps it.
 */
export function CustomerBalancesPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const minRaw = params.get("min") ?? "";
  const maxRaw = params.get("max") ?? "";
  const excludeRaw = params.get("exclude") ?? "";
  const sortParam = params.get("sort") as BalanceSort | null;
  const sort: BalanceSort = sortParam && SORTS.includes(sortParam) ? sortParam : "balanceDesc";

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value === "" || (key === "sort" && value === "balanceDesc")) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["customer-balances"],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { items: OpenInvoiceBalance[]; shopName: string; vatNumber: string };
      }>("/dashboard/customer-balances");
      return res.data.data;
    },
  });

  const filter = useMemo(
    () => ({
      minFils: parseAedToFils(minRaw),
      maxFils: parseAedToFils(maxRaw),
      excludeFils: parseAedList(excludeRaw),
      sort,
    }),
    [minRaw, maxRaw, excludeRaw, sort],
  );

  const all = useMemo(() => data?.items ?? [], [data]);
  const rows = useMemo(() => applyBalanceFilter(all, filter), [all, filter]);
  const allTotal = all.reduce((a, r) => a + r.balanceFils, 0);
  const shownTotal = rows.reduce((a, r) => a + r.balanceFils, 0);
  const isFiltered = filter.minFils !== null || filter.maxFils !== null || filter.excludeFils.length > 0;

  const filterNote = [
    filter.minFils !== null ? `من ${(filter.minFils / 100).toFixed(2)}` : "",
    filter.maxFils !== null ? `إلى ${(filter.maxFils / 100).toFixed(2)}` : "",
    filter.excludeFils.length > 0
      ? `باستثناء ${filter.excludeFils.map((f) => (f / 100).toFixed(2)).join("، ")}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const handlePrint = () => {
    if (!data) return;
    printInvoiceBalances({
      rows,
      shopName: data.shopName,
      vatNumber: data.vatNumber,
      filterNote: filterNote ? `الفلتر: ${filterNote}` : "",
      allCount: all.length,
      allTotalFils: allTotal,
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("pages.customerBalances.title")}
        description={t("pages.customerBalances.description")}
        actions={
          <Button size="sm" onClick={handlePrint} disabled={!data}>
            <Printer className="me-1 h-4 w-4" />
            {t("pages.customerBalances.print", { count: rows.length })}
          </Button>
        }
      />

      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="bal-min">{t("pages.customerBalances.min")}</Label>
            <Input
              id="bal-min"
              inputMode="decimal"
              placeholder="0.00"
              value={minRaw}
              onChange={(e) => setParam("min", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bal-max">{t("pages.customerBalances.max")}</Label>
            <Input
              id="bal-max"
              inputMode="decimal"
              placeholder="—"
              value={maxRaw}
              onChange={(e) => setParam("max", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bal-exclude">{t("pages.customerBalances.exclude")}</Label>
            <Input
              id="bal-exclude"
              inputMode="decimal"
              placeholder="1, 0.5"
              value={excludeRaw}
              onChange={(e) => setParam("exclude", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bal-sort">{t("pages.customerBalances.sort")}</Label>
            <select
              id="bal-sort"
              className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={sort}
              onChange={(e) => setParam("sort", e.target.value)}
            >
              {SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(`pages.customerBalances.sort_${s}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t("pages.customerBalances.filterHint")}</p>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
          <span>
            {t("pages.customerBalances.shown")}{" "}
            <strong className="tabular-nums">{rows.length}</strong> —{" "}
            <strong className="tabular-nums text-amber-900 dark:text-amber-100">{formatAED(shownTotal)}</strong>
            {isFiltered ? (
              <span className="text-muted-foreground">
                {" "}
                · {t("pages.customerBalances.ofAll", { count: all.length, total: formatAED(allTotal) })}
              </span>
            ) : null}
          </span>
          {isFiltered ? (
            <Button variant="ghost" size="sm" onClick={() => setParams(sort === "balanceDesc" ? {} : { sort }, { replace: true })}>
              <X className="me-1 h-3.5 w-3.5" />
              {t("pages.customerBalances.clear")}
            </Button>
          ) : null}
        </div>
      </section>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="w-12 px-3 py-3 text-center font-medium">#</th>
              <th className="px-3 py-3 text-center font-medium">{t("pages.customerBalances.colInvoice")}</th>
              <th className="px-3 py-3 text-start font-medium">{t("pages.customerBalances.colCustomer")}</th>
              <th className="px-3 py-3 text-center font-medium">{t("pages.customerBalances.colDate")}</th>
              <th className="px-3 py-3 text-end font-medium">{t("pages.customerBalances.colRemaining")}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  {t("common.loadingData")}
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-destructive">
                  {getApiErrorMessage(error)}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  {t("pages.customerBalances.empty")}
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => (
                <tr key={r.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2.5 text-center tabular-nums text-muted-foreground">{idx + 1}</td>
                  <td className="px-3 py-2.5 text-center">
                    <Link className="font-mono font-semibold text-brand-700 underline" to={`/invoices/${r.id}`}>
                      {r.invoiceNo}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="font-medium">{r.customerName ?? "—"}</span>
                    {r.customerMobile && r.customerMobile !== r.customerName ? (
                      <span className="block text-xs text-muted-foreground" dir="ltr">
                        {r.customerMobile}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-center tabular-nums text-muted-foreground">
                    {new Date(r.createdAt).toLocaleDateString("en-GB")}
                  </td>
                  <td className="px-3 py-2.5 text-end font-semibold tabular-nums">{formatAED(r.balanceFils)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
