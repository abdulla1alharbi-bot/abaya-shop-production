import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Minus, Pencil, Plus, Trash2 } from "lucide-react";
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
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1">
              <CardTitle className="text-base">{"\u0627\u0644\u0633\u0644\u0629 \u0648\u0627\u0644\u062f\u0641\u0639"}</CardTitle>
              <p className="text-xs text-muted-foreground">{"\u0627\u0644\u062c\u0627\u0647\u0632 \u0648\u0627\u0644\u062a\u0641\u0635\u064a\u0644 \u064a\u0638\u0647\u0631\u0627\u0646 \u0647\u0646\u0627 \u0645\u0639\u0627\u064b."}</p>
            </div>
            {nextInvoiceNo != null ? (
              <div className="shrink-0 rounded-lg border border-amber-300/70 bg-amber-50 px-2.5 py-1 text-center dark:border-amber-800 dark:bg-amber-950/30">
                <div className="text-[10px] font-medium text-amber-800 dark:text-amber-200">{"\u0641\u0627\u062a\u0648\u0631\u0629 (\u0645\u0633\u0648\u0651\u062f\u0629)"}</div>
                <div className="text-sm font-semibold tabular-nums text-amber-900 dark:text-amber-100">#{nextInvoiceNo}</div>
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {cartEmpty ? (
            <p className="text-sm text-muted-foreground">{"\u0644\u0627 \u0634\u064a\u0621 \u0641\u064a \u0627\u0644\u0633\u0644\u0629 \u0628\u0639\u062f."}</p>
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
                          {"\u062c\u0627\u0647\u0632"}
                        </Badge>
                        <div className="font-medium leading-snug">{line.name}</div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                        onClick={() => removeRetailLine(line.productId)}
                        aria-label="\u062d\u0630\u0641 \u0645\u0646 \u0627\u0644\u0633\u0644\u0629"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">{"\u0627\u0644\u0643\u0645\u064a\u0629"}</span>
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
                <span className="text-muted-foreground">{"\u0627\u0644\u0645\u062c\u0645\u0648\u0639 \u0627\u0644\u0641\u0631\u0639\u064a"}</span>
                <span>{formatAED(subtotalFils)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-muted-foreground">{"\u062e\u0635\u0645 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629 (AED)"}</Label>
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
                <span className="text-muted-foreground">{`\u0636\u0631\u064a\u0628\u0629 (${vatPercent}%)`}</span>
                <span>{formatAED(vatFils)}</span>
              </div>
              <div className="flex justify-between text-base font-semibold">
                <span>{"\u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a"}</span>
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
            title={!can("pos.checkout") ? "\u0644\u0627 \u062a\u0645\u0644\u0643 \u0635\u0644\u0627\u062d\u064a\u0629 \u0625\u062a\u0645\u0627\u0645 \u0627\u0644\u062f\u0641\u0639" : undefined}
          >
            {"\u0625\u062a\u0645\u0627\u0645 \u0627\u0644\u0628\u064a\u0639"}
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
                <p className="text-lg font-semibold text-green-700 dark:text-green-400">{"\u062a\u0645 \u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629 \u0628\u0646\u062c\u0627\u062d"}</p>
                <p className="mt-1 text-2xl font-bold">#{successData.invoiceNo}</p>
                <p className="mt-2 text-xs text-muted-foreground">{"\u062c\u0627\u0631\u064a \u0627\u0644\u0627\u0646\u062a\u0642\u0627\u0644 \u0625\u0644\u0649 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629\u2026"}</p>
              </div>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{"\u0627\u0644\u062f\u0641\u0639"}</DialogTitle>
                <DialogDescription>
                  {"\u0623\u062f\u062e\u0644 \u0627\u0644\u0645\u062f\u0641\u0648\u0639. \u064a\u0645\u0643\u0646 \u062a\u0642\u0633\u064a\u0645 \u0627\u0644\u062f\u0641\u0639\u0627\u062a. \u0627\u0644\u0628\u0627\u0642\u064a \u064a\u064f\u0633\u062c\u064e\u0651\u0644 \u0639\u0644\u0649 \u0627\u0644\u0639\u0645\u064a\u0644 \u0625\u0646 \u0648\u064f\u062c\u062f."}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="rounded-md border bg-muted/30 p-3 text-sm">
                  <span className="text-muted-foreground">{"\u0627\u0644\u0639\u0645\u064a\u0644: "}</span>
                  {posCustomerId ? (
                    <span className="font-medium">{posCustomerLabel}</span>
                  ) : (
                    <span className="text-amber-800 dark:text-amber-200">\u064a\u0631\u062c\u0649 \u0627\u062e\u062a\u064a\u0627\u0631 \u0627\u0644\u0639\u0645\u064a\u0644 \u0623\u0648\u0644\u0627\u064b</span>
                  )}
                  {customerCredit && customerCredit.creditLimitFils > 0 ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      \u0627\u0644\u0631\u0635\u064a\u062f: {formatAED(customerCredit.balanceFils)} / \u0627\u0644\u062d\u062f: {formatAED(customerCredit.creditLimitFils)}
                    </div>
                  ) : null}
                </div>
                {creditLimitExceeded ? (
                  <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
                    \u26a0 \u062a\u062c\u0627\u0648\u0632 \u062d\u062f \u0627\u0644\u0627\u0626\u062a\u0645\u0627\u0646 \u2014 \u0627\u0644\u0631\u0635\u064a\u062f \u0627\u0644\u062d\u0627\u0644\u064a: {formatAED(customerCredit!.balanceFils)}\u060c \u0627\u0644\u062d\u062f: {formatAED(customerCredit!.creditLimitFils)}
                    {canCreditOverride ? (
                      <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded"
                          checked={creditOverride}
                          onChange={(e) => setCreditOverride(e.target.checked)}
                        />
                        \u062a\u062c\u0627\u0648\u0632 \u0627\u0644\u062d\u062f \u0628\u0645\u0648\u0627\u0641\u0642\u0629 \u0627\u0644\u0645\u062f\u064a\u0631
                      </label>
                    ) : (
                      <p className="mt-1 text-xs">\u064a\u0644\u0632\u0645 \u0645\u0648\u0627\u0641\u0642\u0629 \u0627\u0644\u0645\u062f\u064a\u0631 \u0644\u0625\u062a\u0645\u0627\u0645 \u0627\u0644\u0639\u0645\u0644\u064a\u0629.</p>
                    )}
                  </div>
                ) : null}

                <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span>{"\u0627\u0644\u0645\u0633\u062a\u062d\u0642"}</span>
                    <span className="font-semibold">{formatAED(totalFils)}</span>
                  </div>
                  {changeFils > 0 ? (
                    <div className="flex justify-between text-green-700 dark:text-green-400 font-medium">
                      <span>{"\u0627\u0644\u062e\u0631\u062f\u0629 (\u0628\u0627\u0642\u064a \u0644\u0644\u0639\u0645\u064a\u0644)"}</span>
                      <span>{formatAED(changeFils)}</span>
                    </div>
                  ) : (
                    <div className="flex justify-between text-amber-800 dark:text-amber-200">
                      <span>{"\u0627\u0644\u0645\u062a\u0628\u0642\u064a \u0628\u0639\u062f \u0627\u0644\u062f\u0641\u0639\u0627\u062a"}</span>
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
                    {t("pos.fillTotal", { defaultValue: "Fill paid = total (cash)" })}
                  </Button>
                  {hasTailoring ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 flex-1 border-brand-400 text-xs text-brand-700 hover:bg-brand-50 dark:border-brand-600 dark:text-brand-300 dark:hover:bg-brand-950/30 sm:flex-none"
                      title={`عربون 50٪ — ${formatAED(Math.ceil(totalFils / 2))}`}
                      onClick={() =>
                        setPaymentRows([{ method: "CASH", amountAed: (Math.ceil(totalFils / 2) / 100).toFixed(2) }])
                      }
                    >
                      {t("pos.deposit50", { defaultValue: "50% Deposit — " })}{formatAED(Math.ceil(totalFils / 2))}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 flex-1 text-xs sm:flex-none"
                    onClick={() => setPaymentRows([{ method: "CASH", amountAed: "" }])}
                    title={"إنشاء الفاتورة بدون تسجيل دفعة الآن — يُسجَّل الإجمالي كرصيد مستحق على العميل"}
                  >
                    {t("pos.noPay", { defaultValue: "No Payment Now" })}
                  </Button>
                </div>
                {hasTailoring && paidFils === 0 ? (
                  <p className="rounded-md bg-yellow-50 px-3 py-2 text-xs text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-200">
                    {t("pos.confirmNoPay", { defaultValue: "⚠ No deposit recorded. Full amount will be posted as balance due on customer. Are you sure?" })}
                  </p>
                ) : null}

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Label>{"\u062f\u0641\u0639\u0627\u062a"}</Label>
                      {isMixedPayment ? (
                        <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-semibold text-brand-900 dark:bg-brand-950 dark:text-brand-100">
                          {"\u062f\u0641\u0639 \u0645\u062e\u062a\u0644\u0637"}
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
                      {"\u062f\u0641\u0639\u0629 \u0623\u062e\u0631\u0649"}
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
                        <option value="CASH">{"\u0643\u0627\u0634"}</option>
                        <option value="TRANSFER">{"\u062a\u062d\u0648\u064a\u0644"}</option>
                        <option value="CARD">{"\u0628\u0637\u0627\u0642\u0629"}</option>
                      </select>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        placeholder="\u0627\u0644\u0645\u0628\u0644\u063a AED"
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
                  <Label>{"\u0645\u0644\u0627\u062d\u0638\u0627\u062a"}</Label>
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
                    {"\u062d\u0641\u0638 \u0645\u0642\u0627\u0633 \u0622\u062e\u0631 \u0639\u0646\u0635\u0631 \u062a\u0641\u0635\u064a\u0644 \u0639\u0644\u0649 \u0645\u0644\u0641 \u0627\u0644\u0639\u0645\u064a\u0644"}
                  </label>
                ) : null}
              </div>
              <DialogFooter className="gap-2 sm:justify-between">
                <Button type="button" variant="outline" onClick={() => setCheckoutOpen(false)}>
                  {"\u0625\u0644\u063a\u0627\u0621"}
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
                  {checkout.isPending ? "\u062c\u0627\u0631\u064a \u0627\u0644\u062d\u0641\u0638\u2026" : "\u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629"}
                </Button>
              </DialogFooter>
              {checkout.isError ? (
                <p className={`text-sm ${isCreditLimitError(checkout.error) ? "text-amber-700 dark:text-amber-300" : "text-destructive"}`}>
                  {getApiErrorMessage(checkout.error, "\u062a\u0639\u0630\u0631 \u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629.")}
                </p>
              ) : null}
              <p className="text-center text-xs text-muted-foreground">
                <Link to="/invoices" className="underline">
                  {"\u0627\u0644\u0641\u0648\u0627\u062a\u064a\u0631 \u0648\u0645\u0633\u0627\u0631 \u0627\u0644\u0639\u0645\u0644"}
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
  const roll = rolls?.find((r) => r.id === line.rollId);
  return (
    <li className="flex flex-col gap-2 border-b pb-3 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Badge className="mb-1 bg-brand-700 text-[10px] hover:bg-brand-700">{"\u062a\u0641\u0635\u064a\u0644"}</Badge>
          <div className="font-medium leading-snug">{tailoringLineDisplayLabel(line, abayaCatalog)}</div>
          <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            <p>{"\u0642\u0645\u0627\u0634: "}{roll ? `${roll.rollCode} \u00b7 ${roll.name}` : "\u2014"}</p>
            <p>
              {"\u0644\u0648\u0646: "}{roll?.color ?? "\u2014"}
              {line.colorNote ? ` (${line.colorNote})` : ""}
            </p>
            <p>{"\u0645\u0642\u0627\u0633: "}{sizeSummary(line)}</p>
            {line.itemNotes.trim() ? <p>{"\u0645\u0644\u0627\u062d\u0638\u0627\u062a: "}{line.itemNotes}</p> : null}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={onEdit} aria-label="\u062a\u0639\u062f\u064a\u0644">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={onRemove}
            aria-label="\u062d\u0630\u0641"
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
