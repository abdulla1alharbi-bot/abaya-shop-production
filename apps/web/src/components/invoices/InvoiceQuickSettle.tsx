import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { formatAED } from "@/lib/money";
import { usePermissions } from "@/hooks/usePermissions";

type Props = {
  invoiceId: string;
  invoiceNo: number;
  balanceFils: number;
  /** Invoice-level delivery stamp; non-null means the handover already happened. */
  deliveredAt: string | null;
  isVoid: boolean;
  /** `READY_FOR_DELIVERY` | `NO_TAILORING` | `IN_WORKSHOP` | … from the API. */
  fulfillmentStatus: string;
  onUpdated: () => void;
};

const METHODS = ["CASH", "TRANSFER", "CARD"] as const;

/**
 * Collect cash and hand the invoice over without leaving the preview dialog.
 * The seller never types a date — the server stamps `deliveredAt` itself, so
 * delivery is always recorded as "now". The full Payment & Delivery panel stays
 * available for payment history and for changing the promised delivery date.
 */
export function InvoiceQuickSettle({
  invoiceId,
  invoiceNo,
  balanceFils,
  deliveredAt,
  isVoid,
  fulfillmentStatus,
  onUpdated,
}: Props) {
  const { t } = useTranslation();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const [method, setMethod] = useState<string>("CASH");
  const [amount, setAmount] = useState("");

  const refresh = () => {
    onUpdated();
    void queryClient.invalidateQueries({ queryKey: ["invoices"] });
    void queryClient.invalidateQueries({ queryKey: ["customers"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["job-orders"] });
  };

  const addPayment = useMutation({
    mutationFn: async (fils: number) => {
      if (fils <= 0) throw new Error(t("invoices.enterValidAmount"));
      await api.post(`/invoices/${invoiceId}/payments`, {
        payments: [{ method, amountFils: fils }],
      });
    },
    onSuccess: () => {
      setAmount("");
      refresh();
    },
  });

  const deliver = useMutation({
    mutationFn: async () => {
      await api.post(`/invoices/${invoiceId}/deliver`);
    },
    onSuccess: refresh,
  });

  const canPay = can("invoices.payment");
  const canDeliver = can("invoices.deliver");
  const workshopDone =
    fulfillmentStatus === "READY_FOR_DELIVERY" || fulfillmentStatus === "NO_TAILORING";
  const amountFils = Math.round((parseFloat(amount) || 0) * 100);

  // Why delivery is unavailable, so the disabled button is never a dead end.
  const blockedReason = deliveredAt
    ? t("invoices.quickSettle.deliveredOn", {
        date: new Date(deliveredAt).toLocaleString(),
      })
    : isVoid
      ? t("status.payment.void")
      : !workshopDone
        ? t("invoices.quickSettle.notReady")
        : null;

  // Paying more than the balance is allowed (cash rounding), but a typo would
  // otherwise vanish into the till silently — so name the excess and confirm it.
  const handleSavePayment = () => {
    const excess = amountFils - balanceFils;
    if (excess > 0) {
      const message = t("invoices.quickSettle.confirmOverpay", {
        amount: formatAED(amountFils),
        due: formatAED(balanceFils),
        excess: formatAED(excess),
      });
      if (!confirm(message)) return;
    }
    addPayment.mutate(amountFils);
  };

  const handleDeliver = () => {
    const message =
      balanceFils > 0
        ? t("invoices.quickSettle.confirmDeliverWithBalance", {
            invoiceNo,
            balance: formatAED(balanceFils),
          })
        : t("invoices.confirmDeliver", { invoiceNo });
    if (confirm(message)) deliver.mutate();
  };

  // Nothing actionable here for this role — the summary above already shows the balance.
  if (!canPay && !canDeliver) return null;

  return (
    <div className="space-y-3 border-t pt-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-muted-foreground">{t("invoices.remaining")}</span>
        <span
          className={
            balanceFils > 0
              ? "font-mono text-lg font-semibold tabular-nums text-amber-900 dark:text-amber-100"
              : "font-mono text-lg font-semibold tabular-nums text-emerald-800 dark:text-emerald-200"
          }
        >
          {formatAED(balanceFils)}
        </span>
      </div>

      {balanceFils > 0 && canPay ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-9 w-[110px] shrink-0 rounded-md border border-input bg-background px-2 text-sm"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              aria-label={t("pos.pay.payments")}
              disabled={addPayment.isPending}
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {t(`pos.pay.${m.toLowerCase()}`)}
                </option>
              ))}
            </select>
            <Input
              className="h-9 min-w-0 flex-1"
              type="number"
              min={0}
              step={0.01}
              inputMode="decimal"
              placeholder={t("pos.pay.amountPh")}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={addPayment.isPending}
            />
            <Button
              type="button"
              size="sm"
              className="h-9 shrink-0"
              disabled={amountFils <= 0 || addPayment.isPending}
              onClick={handleSavePayment}
            >
              {addPayment.isPending ? "…" : t("invoices.savePayment")}
            </Button>
          </div>
          {addPayment.isError ? (
            <p className="text-xs text-destructive">{getApiErrorMessage(addPayment.error)}</p>
          ) : null}
        </div>
      ) : null}

      {canDeliver ? (
        <div className="space-y-1">
          <Button
            type="button"
            variant={blockedReason ? "outline" : "default"}
            className="h-10 w-full"
            disabled={Boolean(blockedReason) || deliver.isPending}
            onClick={handleDeliver}
          >
            {deliver.isPending
              ? "…"
              : deliveredAt
                ? t("invoices.delivered")
                : t("invoices.markAsDelivered")}
          </Button>
          {blockedReason ? (
            <p className="text-center text-[11px] text-muted-foreground">{blockedReason}</p>
          ) : null}
          {deliver.isError ? (
            <p className="text-center text-xs text-destructive">{getApiErrorMessage(deliver.error)}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
