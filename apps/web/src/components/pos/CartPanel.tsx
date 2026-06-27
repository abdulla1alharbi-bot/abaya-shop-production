import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Minus, Pencil, Plus, Receipt, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";
import {
  tailoringLineToCheckoutItem,
  tailoringLineDisplayLabel,
  sizeSummary,
  type FabricRollRow,
} from "@/lib/tailoringLinePayload";
import type { AbayaCatalogType } from "@/lib/abayaTailoringCatalog";
import { calcVatFils, formatAED } from "@/lib/money";
import { getApiErrorMessage, isCreditLimitError } from "@/lib/apiErrors";
import { useCartStore, subtotalFilsFromLines } from "@/store/cartStore";
import type { PosCartLine, TailoringCartLine } from "@/types/posCart";

type PayRow = { method: string; amountAed: string };

export function CartPanel() {
  const { can } = usePermissions();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const lines = useCartStore((s) => s.lines);
  const invoiceDiscountFils = useCartStore((s) => s.invoiceDiscountFils);
  const updateRetailQty = useCartStore((s) => s.updateRetailQty);
  const removeRetailLine = useCartStore((s) => s.removeRetailLine);
  const removeTailoringLine = useCartStore((s) => s.removeTailoringLine);
  const startEditTailoringLine = useCartStore((s) => s.startEditTailoringLine);
  const setInvoiceDiscount = useCartStore((s) => s.setInvoiceDiscount);
  const clear = useCartStore((s) => s.clear);
  const posCustomerId = useCartStore((s) => s.posCustomerId);
  const posCustomerLabel = useCartStore((s) => s.posCustomerLabel);

  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [paymentRows, setPaymentRows] = useState<PayRow[]>([{ method: "CASH", amountAed: "" }]);
  const [notes, setNotes] = useState("");
  const [saveMeasurementsToProfile, setSaveMeasurementsToProfile] = useState(false);
  const [successData, setSuccessData] = useState<{ id: string; invoiceNo: number } | null>(null);
  const [creditOverride, setCreditOverride] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, string> }>("/settings");
      return res.data.data;
    },
  });

  const { data: abayaCatalog } = useQuery({
    queryKey: ["abaya-catalog"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: { types: AbayaCatalogType[] } }>("/abaya-catalog");
      return res.data.data;
    },
  });

  const { data: rolls } = useQuery({
    queryKey: ["fabric-rolls", "pos-cart"],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { items: FabricRollRow[] };
      }>("/fabric-rolls", { params: { limit: 300, activeOnly: "true" } });
      return res.data.data.items;
    },
  });

  const { data: nextInvoiceNo } = useQuery({
    queryKey: ["invoices", "next-no"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: { invoiceNo: number } }>(
        "/invoices/next-invoice-no",
      );
      return res.data.data.invoiceNo;
    },
    staleTime: 30_000,
  });

  const { data: customerCredit } = useQuery({
    queryKey: ["customer-credit", posCustomerId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: { balanceFils: number; creditLimitFils: number } }>(
        `/customers/${posCustomerId}`,
      );
      return { balanceFils: res.data.data.balanceFils ?? 0, creditLimitFils: res.data.data.creditLimitFils ?? 0 };
    },
    enabled: Boolean(posCustomerId),
  });

  const vatPercent = parseFloat(settings?.vat_rate ?? "5") || 5;

  const subtotalFils = useMemo(() => subtotalFilsFromLines(lines), [lines]);
  const taxableFils = Math.max(0, subtotalFils - invoiceDiscountFils);
  const vatFils = calcVatFils(taxableFils, vatPercent);
  const totalFils = taxableFils + vatFils;

  const hasTailoring = useMemo(() => lines.some((l) => l.kind === "tailoring"), [lines]);

  const paidFils = useMemo(
    () =>
      paymentRows.reduce((a, r) => a + Math.round((parseFloat(r.amountAed) || 0) * 100), 0),
    [paymentRows],
  );
  const remainingFils = Math.max(0, totalFils - paidFils);
  const changeFils = Math.max(0, paidFils - totalFils);

  const creditLimitExceeded =
    customerCredit &&
    customerCredit.creditLimitFils > 0 &&
    remainingFils > 0 &&
    customerCredit.balanceFils + remainingFils > customerCredit.creditLimitFils;
  const canCreditOverride = can("invoices.creditOverride");

  const activePaymentRows = paymentRows.filter((r) => (parseFloat(r.amountAed) || 0) > 0);
  const isMixedPayment = activePaymentRows.length > 1;

  const fillPaidWithTotal = () => {
    setPaymentRows([{ method: "CASH", amountAed: (totalFils / 100).toFixed(2) }]);
  };

  const checkout = useMutation({
    mutationFn: async () => {
      if (lines.length === 0) throw new Error("\u0627\u0644\u0633\u0644\u0629 \u0641\u0627\u0631\u063a\u0629");
      if (!posCustomerId) throw new Error("\u0627\u062e\u062a\u0631 \u0627\u0644\u0639\u0645\u064a\u0644 \u0623\u0648\u0644\u0627\u064b.");

      const payments = paymentRows
        .map((r) => ({
          method: r.method,
          amountFils: Math.round((parseFloat(r.amountAed) || 0) * 100),
        }))
        .filter((p) => p.amountFils > 0);

      const retailItems = lines
        .filter((l): l is Extract<PosCartLine, { kind: "retail" }> => l.kind === "retail")
        .map((i) => ({
          productId: i.productId,
          qty: i.qty,
          unitFils: i.unitFils,
          discountFils: i.discountFils,
        }));

      const tailoringItems = lines
        .filter((l): l is TailoringCartLine => l.kind === "tailoring")
        .map((t) => tailoringLineToCheckoutItem(t, rolls, abayaCatalog));

      const res = await api.post<{
        success: boolean;
        data: { invoice: { id: string; invoiceNo: number } };
      }>("/invoices/pos-checkout", {
        customerId: posCustomerId ?? undefined,
        retailItems,
        tailoringItems,
        payments,
        invoiceDiscountFils,
        notes: notes.trim() || undefined,
        creditOverride: creditOverride || undefined,
      });

      const tailoringOnlyLines = lines.filter((l): l is TailoringCartLine => l.kind === "tailoring");
      if (saveMeasurementsToProfile && posCustomerId && tailoringOnlyLines.length > 0) {
        const last = tailoringOnlyLines[tailoringOnlyLines.length - 1];
        try {
          if (last.sizeMode === "STANDARD") {
            const abayaLabel = tailoringLineDisplayLabel(last, abayaCatalog);
            await api.post(`/customers/${posCustomerId}/measurements`, {
              notes: `\u0645\u0642\u0627\u0633 \u0642\u064a\u0627\u0633\u064a: ${last.standardSize} \u2014 ${abayaLabel}`,
            });
          } else {
            await api.post(`/customers/${posCustomerId}/measurements`, {
              shoulder: last.shoulder ? Number(last.shoulder) : undefined,
              chest: last.chest ? Number(last.chest) : undefined,
              waist: last.waist ? Number(last.waist) : undefined,
              hip: last.hip ? Number(last.hip) : undefined,
              length: last.lengthVal ? Number(last.lengthVal) : undefined,
              sleeve: last.sleeve ? Number(last.sleeve) : undefined,
              notes: last.itemNotes.trim() || "\u062a\u0641\u0635\u064a\u0644 \u2014 \u0645\u0642\u0627\u0633 \u062e\u0627\u0635",
            });
          }
        } catch {
          /* optional */
        }
      }

      return res.data.data;
    },
    onSuccess: (data) => {
      clear();
      setPaymentRows([{ method: "CASH", amountAed: "" }]);
      setNotes("");
      setSaveMeasurementsToProfile(false);
      setCreditOverride(false);
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      void queryClient.invalidateQueries({ queryKey: ["job-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["fabric-rolls"] });
      setSuccessData(data.invoice);
      setTimeout(() => {
        setCheckoutOpen(false);
        setSuccessData(null);
        navigate(`/invoices/${data.invoice.id}`);
      }, 2000);
    },
  });

  const cartEmpty = lines.length === 0;

  return (
    <>
      <Card className="border shadow-sm">
        <CardHeader className="space-y-1 pb-3">
          <CardTitle className="text-base">{t("pos.cart.title")}</CardTitle>
          <p className="text-xs text-muted-foreground">{t("pos.cart.subtitle")}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {nextInvoiceNo != null ? (
            <div className="flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30">
              <div className="flex items-center gap-2.5">
                <Receipt className="h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
                <div>
                  <div className="text-xs font-medium text-amber-800 dark:text-amber-200">{t("pos.cart.nextInvoiceNo")}</div>
                  <div className="text-2xl font-bold tabular-nums text-amber-900 dark:text-amber-100">#{nextInvoiceNo}</div>
                </div>
              </div>
              <span className="rounded-full bg-amber-200 px-2.5 py-1 text-[11px] font-semibold text-amber-900 dark:bg-amber-900 dark:text-amber-100">{t("pos.cart.draft")}</span>
            </div>
          ) : null}
          {cartEmpty ? (
            <p className="text-sm text-muted-foreground">{t("pos.cart.empty")}</p>
          ) : (
            <ul className="max-h-[min(50vh,420px)] space-y-3 overflow-y-auto pr-1 text-sm">
              {lines.map((line) =>
                line.kind === "retail" ? (
                  <li
                    key={`r-${line.productId}`}
                    className="flex flex-col gap-2 border-b pb-3 last:border-0"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Badge variant="secondary" className="mb-1 text-[10px]">
                          {t("pos.cart.ready")}
                        </Badge>
                        <div className="font-medium leading-snug">{line.name}</div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                        onClick={() => removeRetailLine(line.productId)}
                        aria-label={t("pos.cart.removeFromCart")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">{t("pos.cart.qty")}</span>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-9 w-9 shrink-0"
                          onClick={() =>
                            updateRetailQty(
                              line.productId,
                              Math.max(0.5, Math.round((line.qty - 0.5) * 10) / 10),
                            )
                          }
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <Input
                          type="number"
                          min={0.5}
                          step={0.5}
                          className="h-9 w-[72px] text-center"
                          value={line.qty}
                          onChange={(e) => updateRetailQty(line.productId, Number(e.target.value))}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-9 w-9 shrink-0"
                          onClick={() =>
                            updateRetailQty(line.productId, Math.round((line.qty + 0.5) * 10) / 10)
                          }
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                      <span className="ms-auto text-sm font-semibold">{formatAED(line.totalFils)}</span>
                    </div>
                  </li>
                ) : (
                  <TailoringCartRow
                    key={`t-${line.id}`}
                    line={line}
                    rolls={rolls}
                    abayaCatalog={abayaCatalog}
                    onEdit={() => startEditTailoringLine(line)}
                    onRemove={() => removeTailoringLine(line.id)}
                  />
                ),
              )}
            </ul>
          )}

          {!cartEmpty ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("pos.cart.subtotal")}</span>
                <span>{formatAED(subtotalFils)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-muted-foreground">{t("pos.cart.discount")}</Label>
                <Input
                  className="h-8 max-w-[100px]"
                  type="number"
                  min={0}
                  step={0.01}
                  value={(invoiceDiscountFils / 100).toFixed(2)}
                  onChange={(e) => {
                    const f = Math.round((parseFloat(e.target.value) || 0) * 100);
                    setInvoiceDiscount(f);
                  }}
                />
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("pos.cart.vat", { pct: vatPercent })}</span>
                <span>{formatAED(vatFils)}</span>
              </div>
              <div className="flex justify-between text-base font-semibold">
                <span>{t("pos.cart.total")}</span>
                <span>{formatAED(totalFils)}</span>
              </div>
            </div>
          ) : null}

          <Button
            type="button"
            size="lg"
            className="h-11 w-full font-semibold"
            disabled={cartEmpty || !posCustomerId || !can("pos.checkout")}
            onClick={() => setCheckoutOpen(true)}
            title={!can("pos.checkout") ? t("pos.cart.noCheckoutPerm") : undefined}
          >
            {t("pos.cart.checkout")}
          </Button>
        </CardContent>
      </Card>

      <Dialog open={checkoutOpen} onOpenChange={(open) => { if (!successData) setCheckoutOpen(open); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          {successData ? (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
                <svg className="h-8 w-8 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-lg font-semibold text-green-700 dark:text-green-400">{t("pos.pay.successTitle")}</p>
                <p className="mt-1 text-2xl font-bold">#{successData.invoiceNo}</p>
                <p className="mt-2 text-xs text-muted-foreground">{t("pos.pay.redirecting")}</p>
              </div>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{t("pos.pay.title")}</DialogTitle>
                <DialogDescription>
                  {t("pos.pay.description")}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="rounded-md border bg-muted/30 p-3 text-sm">
                  <span className="text-muted-foreground">{t("pos.pay.customer")}</span>
                  {posCustomerId ? (
                    <span className="font-medium">{posCustomerLabel}</span>
                  ) : (
                    <span className="text-amber-800 dark:text-amber-200">{t("pos.pay.selectCustomerFirst")}</span>
                  )}
                  {customerCredit && customerCredit.creditLimitFils > 0 ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {t("pos.pay.balanceLimit", { balance: formatAED(customerCredit.balanceFils), limit: formatAED(customerCredit.creditLimitFils) })}
                    </div>
                  ) : null}
                </div>
                {creditLimitExceeded ? (
                  <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
                    {t("pos.pay.creditExceeded", { balance: formatAED(customerCredit!.balanceFils), limit: formatAED(customerCredit!.creditLimitFils) })}
                    {canCreditOverride ? (
                      <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded"
                          checked={creditOverride}
                          onChange={(e) => setCreditOverride(e.target.checked)}
                        />
                        {t("pos.pay.overrideManager")}
                      </label>
                    ) : (
                      <p className="mt-1 text-xs">{t("pos.pay.needManager")}</p>
                    )}
                  </div>
                ) : null}

                <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span>{t("pos.pay.due")}</span>
                    <span className="font-semibold">{formatAED(totalFils)}</span>
                  </div>
                  {changeFils > 0 ? (
                    <div className="flex justify-between text-green-700 dark:text-green-400 font-medium">
                      <span>{t("pos.pay.change")}</span>
                      <span>{formatAED(changeFils)}</span>
                    </div>
                  ) : (
                    <div className="flex justify-between text-amber-800 dark:text-amber-200">
                      <span>{t("pos.pay.remainingAfter")}</span>
                      <span className="font-semibold">{formatAED(remainingFils)}</span>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-9 flex-1 text-xs sm:flex-none"
                    onClick={fillPaidWithTotal}
                  >
                    {t("pos.pay.fillTotal")}
                  </Button>
                  {hasTailoring ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 flex-1 border-brand-400 text-xs text-brand-700 hover:bg-brand-50 dark:border-brand-600 dark:text-brand-300 dark:hover:bg-brand-950/30 sm:flex-none"
                      title={t("pos.pay.depositTitle", { amount: formatAED(Math.ceil(totalFils / 2)) })}
                      onClick={() =>
                        setPaymentRows([{ method: "CASH", amountAed: (Math.ceil(totalFils / 2) / 100).toFixed(2) }])
                      }
                    >
                      {t("pos.pay.deposit50")}{formatAED(Math.ceil(totalFils / 2))}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 flex-1 text-xs sm:flex-none"
                    onClick={() => setPaymentRows([{ method: "CASH", amountAed: "" }])}
                    title={t("pos.pay.noPayTitle")}
                  >
                    {t("pos.pay.noPay")}
                  </Button>
                </div>
                {hasTailoring && paidFils === 0 ? (
                  <p className="rounded-md bg-yellow-50 px-3 py-2 text-xs text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-200">
                    {t("pos.pay.confirmNoPay")}
                  </p>
                ) : null}

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Label>{t("pos.pay.payments")}</Label>
                      {isMixedPayment ? (
                        <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-semibold text-brand-900 dark:bg-brand-950 dark:text-brand-100">
                          {t("pos.pay.mixed")}
                        </span>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1"
                      onClick={() => setPaymentRows((rows) => [...rows, { method: "TRANSFER", amountAed: "" }])}
                    >
                      <Plus className="h-3 w-3" />
                      {t("pos.pay.anotherPayment")}
                    </Button>
                  </div>
                  {paymentRows.map((row, idx) => (
                    <div key={idx} className="flex gap-2">
                      <select
                        className="h-9 w-[110px] shrink-0 rounded-md border border-input bg-background px-1 text-xs"
                        value={row.method}
                        onChange={(e) => {
                          const next = [...paymentRows];
                          next[idx] = { ...next[idx], method: e.target.value };
                          setPaymentRows(next);
                        }}
                      >
                        <option value="CASH">{t("pos.pay.cash")}</option>
                        <option value="TRANSFER">{t("pos.pay.transfer")}</option>
                        <option value="CARD">{t("pos.pay.card")}</option>
                      </select>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        placeholder={t("pos.pay.amountPh")}
                        value={row.amountAed}
                        onChange={(e) => {
                          const next = [...paymentRows];
                          next[idx] = { ...next[idx], amountAed: e.target.value };
                          setPaymentRows(next);
                        }}
                      />
                      {paymentRows.length > 1 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 shrink-0"
                          onClick={() => setPaymentRows((rows) => rows.filter((_, i) => i !== idx))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>

                <div>
                  <Label>{t("pos.pay.notes")}</Label>
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>

                {hasTailoring ? (
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded"
                      checked={saveMeasurementsToProfile}
                      onChange={(e) => setSaveMeasurementsToProfile(e.target.checked)}
                    />
                    {t("pos.pay.saveMeasurementProfile")}
                  </label>
                ) : null}
              </div>
              <DialogFooter className="gap-2 sm:justify-between">
                <Button type="button" variant="outline" onClick={() => setCheckoutOpen(false)}>
                  {t("pos.pay.cancel")}
                </Button>
                <Button
                  type="button"
                  size="lg"
                  className="min-w-[140px]"
                  disabled={
                    checkout.isPending ||
                    !posCustomerId ||
                    lines.length === 0 ||
                    !can("pos.checkout") ||
                    Boolean(creditLimitExceeded && !creditOverride)
                  }
                  onClick={() => checkout.mutate()}
                >
                  {checkout.isPending ? t("pos.pay.creating") : t("pos.pay.createInvoice")}
                </Button>
              </DialogFooter>
              {checkout.isError ? (
                <p className={`text-sm ${isCreditLimitError(checkout.error) ? "text-amber-700 dark:text-amber-300" : "text-destructive"}`}>
                  {getApiErrorMessage(checkout.error, t("pos.pay.createFailed"))}
                </p>
              ) : null}
              <p className="text-center text-xs text-muted-foreground">
                <Link to="/invoices" className="underline">
                  {t("pos.pay.invoicesLink")}
                </Link>
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function TailoringCartRow({
  line,
  rolls,
  abayaCatalog,
  onEdit,
  onRemove,
}: {
  line: TailoringCartLine;
  rolls: FabricRollRow[] | undefined;
  abayaCatalog: { types: AbayaCatalogType[] } | undefined;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const roll = rolls?.find((r) => r.id === line.rollId);
  return (
    <li className="flex flex-col gap-2 border-b pb-3 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Badge className="mb-1 bg-brand-700 text-[10px] hover:bg-brand-700">{t("pos.cart.tailoring")}</Badge>
          <div className="font-medium leading-snug">{tailoringLineDisplayLabel(line, abayaCatalog)}</div>
          <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            <p>{t("pos.cart.fabricShort")}{roll ? `${roll.rollCode} \u00b7 ${roll.name}` : "\u2014"}</p>
            <p>
              {t("pos.cart.colorShort")}{roll?.color ?? "\u2014"}
              {line.colorNote ? ` (${line.colorNote})` : ""}
            </p>
            <p>{t("pos.cart.sizeShort")}{sizeSummary(line)}</p>
            {line.itemNotes.trim() ? <p>{t("pos.cart.notesShort")}{line.itemNotes}</p> : null}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={onEdit} aria-label={t("pos.cart.edit")}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={onRemove}
            aria-label={t("pos.cart.delete")}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="text-end text-sm font-semibold">
        {formatAED(Math.round((parseFloat(line.saleAed) || 0) * 100))}
      </div>
    </li>
  );
}
