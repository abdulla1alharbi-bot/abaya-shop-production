import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Loader2, Search } from "lucide-react";
import { InvoiceSellerPanel } from "@/components/invoices/InvoiceSellerPanel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsWorker } from "@/hooks/useIsWorker";
import { usePermissions } from "@/hooks/usePermissions";
import { api } from "@/lib/api";
import { invoiceFulfillmentKey } from "@/lib/invoiceOperationalLabels";
import { formatAED } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

const SEARCH_DEBOUNCE_MS = 500;
const MIN_SEARCH_CHARS = 3;

type SearchInvoiceRow = {
  id: string;
  invoiceNo: number;
  createdAt: string;
  totalFils: number | null;
  paidFils: number | null;
  balanceFils: number | null;
  isVoid: boolean;
  deliveredAt: string | null;
  fulfillmentStatus?: string;
  status: string;
  customer: { id: string; name: string; mobile: string; code?: string | null } | null;
};

function useListStatus() {
  const { t } = useTranslation();
  return (status: string): string => {
    switch (status) {
      case "VOID": return t("components.globalSearch.labelVoid");
      case "DELIVERED": return t("components.globalSearch.labelDelivered");
      case "OPEN": return t("components.globalSearch.labelBalance");
      case "PAID": return t("components.globalSearch.labelPaid");
      default: return status;
    }
  };
}

function usePaymentStatus() {
  const { t } = useTranslation();
  return (balanceFils: number, paidFils: number, isVoid: boolean): string => {
    if (isVoid) return t("status.payment.void");
    if (balanceFils <= 0) return t("status.payment.paid");
    if (paidFils <= 0) return t("status.payment.unpaid");
    return t("status.payment.partial");
  };
}

function useMoneyBadge() {
  const { t } = useTranslation();
  return (balanceFils: number): { label: string; cls: string } => {
    if (balanceFils > 0) {
      return {
        label: t("components.globalSearch.hasBalance"),
        cls: "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100",
      };
    }
    return {
      label: t("status.payment.paid"),
      cls: "border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100",
    };
  };
}

function GlobalInvoiceQuickViewModal({
  invoiceId,
  open,
  onOpenChange,
}: {
  invoiceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isWorker = useIsWorker();
  const queryClient = useQueryClient();
  const [sellerOpen, setSellerOpen] = useState(false);
  const { t } = useTranslation();
  const paymentStatus = usePaymentStatus();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["invoice", invoiceId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, unknown> }>(`/invoices/${invoiceId}`);
      return res.data.data;
    },
    enabled: open && Boolean(invoiceId),
  });

  useEffect(() => {
    if (!open) setSellerOpen(false);
  }, [open]);

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["invoices", "search"] });
    if (invoiceId) void queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  }, [invoiceId, queryClient]);

  const hideMoney =
    isWorker || Boolean((data as { financialsRedacted?: boolean } | undefined)?.financialsRedacted);

  if (!invoiceId) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[min(92vh,780px)] max-w-lg overflow-y-auto">
          <DialogHeader className="text-start">
            <DialogTitle>{t("components.globalSearch.previewTitle", { defaultValue: "Invoice Preview" })}</DialogTitle>
            <DialogDescription>{t("components.globalSearch.previewDesc", { defaultValue: "Quick summary — open full page or payment actions from the buttons below." })}</DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t("common.loadingData")}</p>
          ) : isError || !data ? (
            <p className="text-sm text-destructive">{t("common.error")}</p>
          ) : (
            <div className="space-y-4 text-sm">
              <dl className="grid gap-2 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">{t("pages.invoices.colInvoiceNo")}</dt>
                  <dd className="font-mono font-semibold">#{String(data.invoiceNo)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("pages.invoices.colCustomer")}</dt>
                  <dd className="font-medium">
                    {(data.customer as { name?: string } | null)?.name ?? "—"}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">{t("pages.invoices.colMobile")}</dt>
                  <dd className="font-mono" dir="ltr">
                    {(data.customer as { mobile?: string } | null)?.mobile ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("pages.invoices.colDate")}</dt>
                  <dd>{new Date(String(data.createdAt)).toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("pages.invoices.colDeliveryDate")}</dt>
                  <dd>
                    {data.deliveryDate
                      ? new Date(String(data.deliveryDate)).toLocaleString()
                      : "—"}
                  </dd>
                </div>
                {!hideMoney ? (
                  <>
                    <div>
                      <dt className="text-xs text-muted-foreground">{t("pages.invoices.colTotal")}</dt>
                      <dd className="font-mono tabular-nums">{formatAED(data.totalFils as number)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">{t("pages.invoices.colPaid")}</dt>
                      <dd className="font-mono tabular-nums">{formatAED(data.paidFils as number)}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-xs text-muted-foreground">{t("pages.invoices.colBalance")}</dt>
                      <dd className="font-mono tabular-nums font-semibold text-amber-900 dark:text-amber-100">
                        {formatAED(data.balanceFils as number)}
                      </dd>
                    </div>
                  </>
                ) : null}
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">{t("pages.invoices.colFulfillmentStatus")}</dt>
                  <dd>{t(invoiceFulfillmentKey(String(data.fulfillmentStatus ?? "")))}</dd>
                </div>
                {!hideMoney ? (
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-muted-foreground">{t("pages.invoices.colPaymentStatus")}</dt>
                    <dd>
                      {paymentStatus(
                        data.balanceFils as number,
                        data.paidFils as number,
                        Boolean(data.isVoid),
                      )}
                    </dd>
                  </div>
                ) : null}
              </dl>

              <div>
                <h4 className="mb-2 text-xs font-semibold text-muted-foreground">{t("invoiceDetail.itemsSection")}</h4>
                <ul className="max-h-40 space-y-2 overflow-y-auto rounded-lg border p-2 text-xs">
                  {(((data.items as Array<Record<string, unknown>>) ?? []) as Array<{
                    id: string;
                    description?: string | null;
                    qty: number;
                    totalFils: number | null;
                    product?: { name?: string } | null;
                  }>).length === 0 ? (
                    <li className="text-muted-foreground">{t("common.noData")}</li>
                  ) : (
                    ((data.items as Array<Record<string, unknown>>) ?? []).map(
                      (raw: Record<string, unknown>) => {
                        const it = raw as {
                          id: string;
                          description?: string | null;
                          qty: number;
                          totalFils: number | null;
                          product?: { name?: string } | null;
                        };
                        const label = it.description || it.product?.name || "—";
                        return (
                          <li key={it.id} className="flex flex-wrap justify-between gap-2 border-b border-border/60 pb-2 last:border-0 last:pb-0">
                            <span className="min-w-0 flex-1 font-medium">{label}</span>
                            <span className="shrink-0 text-muted-foreground">×{it.qty}</span>
                            {!hideMoney && typeof it.totalFils === "number" ? (
                              <span className="w-full font-mono tabular-nums sm:w-auto sm:text-end">
                                {formatAED(it.totalFils)}
                              </span>
                            ) : null}
                          </li>
                        );
                      },
                    )
                  )}
                </ul>
              </div>

              <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:flex-wrap">
                <Button variant="default" size="sm" className="gap-2" onClick={() => onOpenChange(false)}>
                  {t("common.view")}
                </Button>
                <Button variant="outline" size="sm" className="gap-2">
                  {t("components.globalSearch.workProcess", { defaultValue: "Work Process" })}
                </Button>
                {!hideMoney ? (
                  <Button type="button" variant="secondary" size="sm" onClick={() => setSellerOpen(true)}>
                    {t("components.globalSearch.payDelivery", { defaultValue: "Payment & Delivery" })}
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {!hideMoney && data ? (
        <Sheet open={sellerOpen} onOpenChange={setSellerOpen}>
          <SheetContent side="right" className="w-full overflow-y-auto p-4 sm:max-w-lg">
            <SheetHeader className="mb-4 text-start">
              <SheetTitle className="text-lg">
                {t("components.globalSearch.payDelivery", { defaultValue: "Payment & Delivery" })} — #{String((data as { invoiceNo?: number }).invoiceNo)}
              </SheetTitle>
            </SheetHeader>
            <InvoiceSellerPanel
              key={`${invoiceId}-${String(data.deliveryDate)}-${String(data.paidFils)}-${String(data.deliveredAt)}`}
              invoiceId={invoiceId}
              invoiceNo={data.invoiceNo as number}
              totalFils={data.totalFils as number}
              paidFils={data.paidFils as number}
              balanceFils={data.balanceFils as number}
              payments={
                (data.payments as Array<{
                  id: string;
                  method: string;
                  amountFils: number;
                  reference: string | null;
                  createdAt: string;
                }>) ?? []
              }
              deliveryDate={data.deliveryDate as string | null | undefined}
              deliveredAt={(data.deliveredAt as string | null | undefined) ?? null}
              canDeliver={
                !Boolean(data.isVoid) &&
                !(data.deliveredAt as string | null | undefined) &&
                (String(data.fulfillmentStatus ?? "") === "READY_FOR_DELIVERY" ||
                  String(data.fulfillmentStatus ?? "") === "NO_TAILORING")
              }
              onUpdated={invalidate}
            />
          </SheetContent>
        </Sheet>
      ) : null}
    </>
  );
}

function SearchInvoiceDetailsPanel({
  invoiceId,
  open,
}: {
  invoiceId: string;
  open: boolean;
}) {
  const isWorker = useIsWorker();
  const [sellerOpen, setSellerOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["invoice", invoiceId, "search-modal"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, unknown> }>(`/invoices/${invoiceId}`);
      return res.data.data;
    },
    enabled: open,
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["invoices", "search"] });
    void queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
  }, [invoiceId, queryClient]);

  const hideMoney =
    isWorker || Boolean((data as { financialsRedacted?: boolean } | undefined)?.financialsRedacted);

  const { t: tInner } = useTranslation();
  if (!open) return null;
  if (isLoading) return <p className="px-3 py-2 text-xs text-muted-foreground">{tInner("common.loadingData")}</p>;
  if (isError || !data) return <p className="px-3 py-2 text-xs text-destructive">{tInner("common.error")}</p>;

  const items = ((data.items as Array<Record<string, unknown>>) ?? []).map((raw) => {
    const it = raw as {
      id: string;
      description?: string | null;
      qty: number;
      totalFils: number | null;
      product?: { name?: string } | null;
    };
    return {
      id: it.id,
      label: it.description || it.product?.name || "—",
      qty: it.qty,
      totalFils: it.totalFils,
    };
  });
  const jobOrders = (data.jobOrders as Array<{ id: string; stage: string; productStyle?: string }> | undefined) ?? [];
  const payments =
    (data.payments as Array<{ id: string; method: string; amountFils: number; createdAt: string }> | undefined) ?? [];

  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3 text-xs">
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <p className="text-muted-foreground">{tInner("pages.invoices.colFulfillmentStatus")}</p>
          <p className="font-medium">{tInner(invoiceFulfillmentKey(String(data.fulfillmentStatus ?? "")))}</p>
        </div>
        <div>
          <p className="text-muted-foreground">{tInner("invoiceDetail.deliveredLabel")}</p>
          <p className="font-medium">{data.deliveredAt ? tInner("status.fulfillment.DELIVERED") : tInner("components.globalSearch.notDelivered", { defaultValue: "Not delivered" })}</p>
        </div>
      </div>
      {!hideMoney ? (
        <div>
          <p className="mb-1 text-muted-foreground">{tInner("invoiceDetail.paymentsSection")}</p>
          <p className="font-medium">
            {tInner("components.globalSearch.paymentsCount", { defaultValue: "Payments:" })} {payments.length} · {tInner("pages.invoices.colPaid")}: {formatAED(data.paidFils as number)} · {tInner("pages.invoices.colBalance")}:{" "}
            <span className={(data.balanceFils as number) > 0 ? "font-semibold text-amber-800 dark:text-amber-200" : ""}>
              {formatAED(data.balanceFils as number)}
            </span>
          </p>
        </div>
      ) : null}
      <div>
        <p className="mb-1 text-muted-foreground">{tInner("invoiceDetail.itemsSection")}</p>
        <ul className="space-y-1">
          {items.length === 0 ? (
            <li className="text-muted-foreground">{tInner("common.noData")}</li>
          ) : (
            items.map((it) => (
              <li key={it.id} className="flex flex-wrap justify-between gap-2 rounded border border-border/60 px-2 py-1.5">
                <span>{it.label}</span>
                <span className="text-muted-foreground">×{it.qty}</span>
                {!hideMoney && typeof it.totalFils === "number" ? (
                  <span className="font-mono">{formatAED(it.totalFils)}</span>
                ) : null}
              </li>
            ))
          )}
        </ul>
      </div>
      <div>
        <p className="mb-1 text-muted-foreground">{tInner("invoiceDetail.tailoringSection")}</p>
        <ul className="space-y-1">
          {jobOrders.length === 0 ? (
            <li className="text-muted-foreground">{tInner("common.noData")}</li>
          ) : (
            jobOrders.map((j) => (
              <li key={j.id} className="rounded border border-border/60 px-2 py-1.5">
                <span className="font-medium">{j.productStyle || tInner("invoiceDetail.tailoringSection")}</span> ·{" "}
                <span className="text-muted-foreground">{j.stage}</span>
              </li>
            ))
          )}
        </ul>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border/70 pt-2">
        <Button type="button" size="sm" variant="outline">
          View invoice
        </Button>
        <Button type="button" size="sm" variant="outline">
          Job Process
        </Button>
        {!hideMoney ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => setSellerOpen(true)}>
            Payments & Delivery
          </Button>
        ) : null}
      </div>

      {!hideMoney ? (
        <Sheet open={sellerOpen} onOpenChange={setSellerOpen}>
          <SheetContent side="right" className="w-full overflow-y-auto p-4 sm:max-w-lg">
            <SheetHeader className="mb-4 text-start">
              <SheetTitle className="text-lg">{tInner("components.globalSearch.payDelivery", { defaultValue: "Payment & Delivery" })} — #{String(data.invoiceNo)}</SheetTitle>
            </SheetHeader>
            <InvoiceSellerPanel
              key={`${invoiceId}-${String(data.deliveryDate)}-${String(data.paidFils)}-${String(data.deliveredAt)}`}
              invoiceId={invoiceId}
              invoiceNo={data.invoiceNo as number}
              totalFils={data.totalFils as number}
              paidFils={data.paidFils as number}
              balanceFils={data.balanceFils as number}
              payments={
                (data.payments as Array<{
                  id: string;
                  method: string;
                  amountFils: number;
                  reference: string | null;
                  createdAt: string;
                }>) ?? []
              }
              deliveryDate={data.deliveryDate as string | null | undefined}
              deliveredAt={(data.deliveredAt as string | null | undefined) ?? null}
              canDeliver={
                !Boolean(data.isVoid) &&
                !(data.deliveredAt as string | null | undefined) &&
                (String(data.fulfillmentStatus ?? "") === "READY_FOR_DELIVERY" ||
                  String(data.fulfillmentStatus ?? "") === "NO_TAILORING")
              }
              onUpdated={invalidate}
            />
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}

function SearchResultsModal({
  open,
  rows,
  onOpenChange,
  onOpenSingle,
}: {
  open: boolean;
  rows: SearchInvoiceRow[];
  onOpenChange: (open: boolean) => void;
  onOpenSingle: (invoiceId: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const isWorker = useIsWorker();
  const { t } = useTranslation();
  const listStatus = useListStatus();
  const paymentStatus = usePaymentStatus();
  const moneyBadge = useMoneyBadge();

  useEffect(() => {
    if (!open) setExpandedId(null);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90vh,820px)] max-w-4xl overflow-y-auto" dir="rtl">
        <DialogHeader className="text-start">
          <DialogTitle>{t("components.globalSearch.resultsTitle", { defaultValue: "Search Results" })}</DialogTitle>
          <DialogDescription>
            {t("components.globalSearch.resultsDesc", { count: rows.length, defaultValue: `Found ${rows.length} matching invoices.` })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {rows.map((inv) => {
            const canShowMoney =
              !isWorker &&
              typeof inv.totalFils === "number" &&
              typeof inv.paidFils === "number" &&
              typeof inv.balanceFils === "number";
            const remainingBadge = typeof inv.balanceFils === "number" ? moneyBadge(inv.balanceFils) : null;
            const expanded = expandedId === inv.id;

            return (
              <div key={inv.id} className="rounded-xl border border-border/70 bg-card p-3">
                <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5">
                  <div>
                    <p className="text-xs text-muted-foreground">{t("pages.invoices.colInvoiceNo")}</p>
                    <p className="font-mono font-semibold">#{inv.invoiceNo}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t("pages.invoices.colCustomer")}</p>
                    <p className="font-medium">{inv.customer?.name ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t("pages.invoices.colMobile")}</p>
                    <p className="font-mono" dir="ltr">
                      {inv.customer?.mobile ?? "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t("pages.invoices.colDate")}</p>
                    <p>{new Date(inv.createdAt).toLocaleDateString()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t("pages.invoices.colFulfillmentStatus")}</p>
                    <p>{t(invoiceFulfillmentKey(String(inv.fulfillmentStatus ?? "")))}</p>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5">
                  <div>
                    <p className="text-xs text-muted-foreground">{t("pages.invoices.colPaymentStatus")}</p>
                    <p>
                      {canShowMoney
                        ? paymentStatus(inv.balanceFils!, inv.paidFils!, Boolean(inv.isVoid))
                        : listStatus(inv.status)}
                    </p>
                  </div>
                  {canShowMoney ? (
                    <>
                      <div>
                        <p className="text-xs text-muted-foreground">{t("pages.invoices.colTotal")}</p>
                        <p className="font-mono">{formatAED(inv.totalFils!)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{t("pages.invoices.colPaid")}</p>
                        <p className="font-mono">{formatAED(inv.paidFils!)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{t("pages.invoices.colBalance")}</p>
                        <p
                          className={cn(
                            "font-mono",
                            inv.balanceFils! > 0 && "font-semibold text-amber-800 dark:text-amber-200",
                          )}
                        >
                          {formatAED(inv.balanceFils!)}
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="sm:col-span-2 lg:col-span-3">
                      <p className="text-xs text-muted-foreground">{t("components.globalSearch.amountsLabel", { defaultValue: "Amounts" })}</p>
                      <p className="text-muted-foreground">{t("components.globalSearch.amountsRestricted", { defaultValue: "Not available for this role" })}</p>
                    </div>
                  )}
                  <div className="flex items-end">
                    {remainingBadge ? (
                      <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-medium", remainingBadge.cls)}>
                        {remainingBadge.label}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 border-t border-border/60 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={() => setExpandedId((prev) => (prev === inv.id ? null : inv.id))}
                  >
                    {t("common.view")}
                    <ChevronDown
                      className={cn("h-4 w-4 transition-transform", expanded ? "rotate-180" : "")}
                    />
                  </Button>
                  <Button type="button" size="sm" onClick={() => onOpenSingle(inv.id)}>
                    View invoice
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => onOpenSingle(inv.id)}>
                    Job Process
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => onOpenSingle(inv.id)}>
                    Payments & Delivery
                  </Button>
                </div>
                <SearchInvoiceDetailsPanel invoiceId={inv.id} open={expanded} />
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function GlobalInvoiceSearch({ className }: { className?: string }) {
  const { canAny } = usePermissions();
  const canSearch = canAny("invoices.view", "jobProcess.view");
  const { t } = useTranslation();
  const listStatus = useListStatus();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [openDropdown, setOpenDropdown] = useState(false);
  const [modalInvoiceId, setModalInvoiceId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [resultsModalOpen, setResultsModalOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query]);

  const { data: rows, isFetching } = useQuery({
    queryKey: ["invoices", "search", debounced],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { items: SearchInvoiceRow[] };
      }>("/invoices/search", { params: { q: debounced } });
      return res.data.data.items;
    },
    enabled: canSearch && debounced.length >= MIN_SEARCH_CHARS,
    staleTime: 20_000,
  });

  useEffect(() => {
    if (!openDropdown) return;
    const onDoc = (e: MouseEvent) => {
      const el = wrapRef.current;
      if (el && !el.contains(e.target as Node)) setOpenDropdown(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [openDropdown]);

  useEffect(() => {
    if (!query.trim()) {
      setOpenDropdown(false);
      return;
    }
    if (query.trim().length >= MIN_SEARCH_CHARS) {
      setOpenDropdown(true);
    }
  }, [query]);

  if (!canSearch) return null;

  const showPanel = openDropdown && debounced.length >= MIN_SEARCH_CHARS;
  const showEmpty = showPanel && !isFetching && Array.isArray(rows) && rows.length === 0;
  const showList = showPanel && !isFetching && rows && rows.length > 0;
  const isQueryTooShort = query.trim().length > 0 && query.trim().length < MIN_SEARCH_CHARS;

  const handleOpenByUserIntent = () => {
    const needle = debounced.trim();
    if (needle.length < MIN_SEARCH_CHARS) {
      setOpenDropdown(true);
      return;
    }
    if (!rows || rows.length === 0) {
      setOpenDropdown(true);
      return;
    }
    const exactNo = rows.find((r) => String(r.invoiceNo) === needle);
    if (exactNo) {
      setModalInvoiceId(exactNo.id);
      setModalOpen(true);
      setResultsModalOpen(false);
      setOpenDropdown(false);
      return;
    }
    setResultsModalOpen(true);
    setModalOpen(false);
    setOpenDropdown(false);
  };

  return (
    <div ref={wrapRef} className={cn("relative w-full max-w-xl", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleOpenByUserIntent();
            }
          }}
          onFocus={() => {
            if (query.trim().length >= MIN_SEARCH_CHARS) setOpenDropdown(true);
          }}
          placeholder={t("components.globalSearch.placeholder")}
          className="h-11 pe-24 ps-9"
          dir="rtl"
          autoComplete="off"
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="absolute end-2 top-1/2 h-7 -translate-y-1/2 px-2 text-xs"
          onClick={handleOpenByUserIntent}
          disabled={debounced.trim().length < MIN_SEARCH_CHARS}
        >
          {t("common.search")}
        </Button>
        {isFetching && debounced.length > 0 ? (
          <Loader2 className="absolute end-[4.75rem] top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
      </div>
      {isQueryTooShort ? (
        <p className="mt-1 text-xs text-muted-foreground">{t("components.globalSearch.minChars", { defaultValue: "Type at least 3 characters to search." })}</p>
      ) : null}

      {showPanel ? (
        <div
          className="absolute start-0 end-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border bg-popover py-1 text-popover-foreground shadow-md"
          role="listbox"
        >
          {isFetching && debounced.length > 0 && !rows ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">{t("components.globalSearch.searching")}</p>
          ) : null}
          {showEmpty ? (
            <p className="px-3 py-3 text-center text-sm text-muted-foreground">{t("components.globalSearch.noResults")}</p>
          ) : null}
          {showList
            ? rows!.map((inv) => {
                const cust = inv.customer;
                const showMoney =
                  typeof inv.balanceFils === "number" &&
                  typeof inv.paidFils === "number" &&
                  typeof inv.totalFils === "number";
                return (
                  <button
                    key={inv.id}
                    type="button"
                    role="option"
                    className="flex w-full flex-col gap-0.5 border-b border-border/60 px-3 py-2.5 text-start text-sm last:border-0 hover:bg-muted/80"
                    onClick={() => {
                      setModalInvoiceId(inv.id);
                      setModalOpen(true);
                      setResultsModalOpen(false);
                      setOpenDropdown(false);
                    }}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-mono font-semibold">#{inv.invoiceNo}</span>
                      <span className="text-xs text-muted-foreground">{listStatus(inv.status)}</span>
                    </div>
                    <div className="font-medium">{cust?.name ?? "—"}</div>
                    <div className="font-mono text-xs text-muted-foreground" dir="ltr">
                      {cust?.mobile ?? "—"}
                    </div>
                    <div className="mt-0.5 flex flex-wrap justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">{t("pages.invoices.colBalance")}</span>
                      <span className="font-mono tabular-nums font-medium">
                        {showMoney ? formatAED(inv.balanceFils!) : "—"}
                      </span>
                    </div>
                  </button>
                );
              })
            : null}
        </div>
      ) : null}

      <GlobalInvoiceQuickViewModal
        invoiceId={modalInvoiceId}
        open={modalOpen}
        onOpenChange={(next) => {
          setModalOpen(next);
          if (!next) setModalInvoiceId(null);
        }}
      />

      <SearchResultsModal
        open={resultsModalOpen}
        rows={rows ?? []}
        onOpenChange={setResultsModalOpen}
        onOpenSingle={(invoiceId) => {
          setResultsModalOpen(false);
          setModalInvoiceId(invoiceId);
          setModalOpen(true);
        }}
      />
    </div>
  );
}
