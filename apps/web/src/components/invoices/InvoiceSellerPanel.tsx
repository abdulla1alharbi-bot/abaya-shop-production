import { useState } from "react";
import { useTranslation } from "react-i18next";
import { isAxiosError } from "axios";
import { Trash2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { formatAED } from "@/lib/money";
import { usePermissions } from "@/hooks/usePermissions";

type PaymentRow = {
  id: string;
  method: string;
  amountFils: number;
  reference: string | null;
  createdAt: string;
};

type Props = {
  invoiceId: string;
  invoiceNo: number;
  totalFils: number;
  paidFils: number;
  balanceFils: number;
  payments: PaymentRow[];
  deliveryDate: string | null | undefined;
  deliveredAt: string | null | undefined;
  canDeliver: boolean;
  onUpdated: () => void;
};

export function InvoiceSellerPanel({
  invoiceId,
  invoiceNo,
  totalFils,
  paidFils,
  balanceFils,
  payments,
  deliveryDate,
  deliveredAt,
  canDeliver,
  onUpdated,
}: Props) {
  const { t } = useTranslation();
  const { can } = usePermissions();
  const canDeletePayment = can("invoices.paymentDelete");
  const queryClient = useQueryClient();
  const [payAmount, setPayAmount] = useState("");
  const [dueLocal, setDueLocal] = useState(() => {
    if (!deliveryDate) return "";
    const d = new Date(deliveryDate);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });

  const addPayment = useMutation({
    mutationFn: async () => {
      const fils = Math.round((parseFloat(payAmount) || 0) * 100);
      if (fils <= 0) throw new Error(t("invoices.enterValidAmount"));
      await api.post(`/invoices/${invoiceId}/payments`, {
        payments: [{ method: "CASH", amountFils: fils }],
      });
    },
    onSuccess: () => {
      setPayAmount("");
      onUpdated();
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["job-orders"] });
    },
  });

  const deletePayment = useMutation({
    mutationFn: async (paymentId: string) => {
      await api.delete(`/invoices/${invoiceId}/payments/${paymentId}`);
    },
    onSuccess: () => {
      onUpdated();
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["job-orders"] });
    },
  });

  const saveDue = useMutation({
    mutationFn: async () => {
      const iso = dueLocal.trim() ? new Date(dueLocal).toISOString() : null;
      await api.patch(`/invoices/${invoiceId}`, { deliveryDate: iso });
    },
    onSuccess: () => onUpdated(),
  });

  const [renumberInput, setRenumberInput] = useState("");
  const [renumberDone, setRenumberDone] = useState<string | null>(null);

  const renumber = useMutation({
    /** Resolves to null when the user cancels the confirmation. */
    mutationFn: async (): Promise<{ oldNo: number; newNo: number; swapped: boolean } | null> => {
      const raw = renumberInput.trim();
      const newNo = /^\d+$/.test(raw) ? parseInt(raw, 10) : NaN;
      if (!Number.isFinite(newNo) || newNo < 1) throw new Error(t("invoices.renumberInvalid"));

      // Say what will happen before doing it: a taken number means a swap with
      // someone else's invoice, which the owner should see by name.
      let holderName: string | null = null;
      let taken = false;
      try {
        const res = await api.get<{ data: { customer?: { name?: string } | null } }>(
          `/invoices/lookup?no=${newNo}`,
        );
        taken = true;
        holderName = res.data.data.customer?.name ?? "—";
      } catch (err) {
        if (!(isAxiosError(err) && err.response?.status === 404)) throw err;
      }

      let message = taken
        ? t("invoices.renumberConfirmSwap", { newNo, oldNo: invoiceNo, customer: holderName })
        : t("invoices.renumberConfirmFree", { newNo, oldNo: invoiceNo });
      if (!taken) {
        const meta = await api.get<{ data: { invoiceNo: number } }>("/invoices/next-invoice-no");
        if (newNo >= meta.data.data.invoiceNo) message += `\n\n${t("invoices.renumberAboveMax")}`;
      }
      if (!window.confirm(message)) return null;

      const res = await api.post<{ meta: { oldNo: number; newNo: number; swapped: boolean } }>(
        `/invoices/${invoiceId}/renumber`,
        { invoiceNo: newNo },
      );
      return res.data.meta;
    },
    onSuccess: (result) => {
      if (!result) return;
      setRenumberInput("");
      setRenumberDone(
        result.swapped
          ? t("invoices.renumberDoneSwap", { newNo: result.newNo, oldNo: result.oldNo })
          : t("invoices.renumberDone", { newNo: result.newNo }),
      );
      onUpdated();
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["job-orders"] });
    },
  });

  const deliver = useMutation({
    mutationFn: async () => {
      await api.post(`/invoices/${invoiceId}/deliver`);
    },
    onSuccess: () => {
      onUpdated();
      void queryClient.invalidateQueries({ queryKey: ["job-orders"] });
    },
  });

  return (
    <div className="space-y-6 text-base">
      <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
        <div className="flex justify-between gap-4 text-sm">
          <span className="text-muted-foreground">{t("invoiceDetail.totalLabel")}</span>
          <span className="font-mono text-lg font-semibold tabular-nums">{formatAED(totalFils)}</span>
        </div>
        <div className="flex justify-between gap-4 text-sm">
          <span className="text-muted-foreground">{t("invoiceDetail.paidLabel")}</span>
          <span className="font-mono text-lg font-semibold tabular-nums">{formatAED(paidFils)}</span>
        </div>
        <div className="flex justify-between gap-4 border-t pt-3 text-sm">
          <span className="font-medium text-foreground">{t("invoices.remaining")}</span>
          <span className="font-mono text-xl font-bold tabular-nums text-amber-900 dark:text-amber-100">
            {formatAED(balanceFils)}
          </span>
        </div>
      </div>

      {balanceFils > 0 && can("invoices.payment") ? (
        <div className="space-y-3">
          <Label htmlFor="pay-amt" className="text-base font-semibold">
            {t("invoices.addPaymentAed")}
          </Label>
          <Input
            id="pay-amt"
            className="h-14 rounded-xl text-lg"
            type="number"
            min={0}
            step={0.01}
            inputMode="decimal"
            value={payAmount}
            onChange={(e) => setPayAmount(e.target.value)}
          />
          <Button
            type="button"
            className="h-14 w-full rounded-xl text-lg"
            disabled={addPayment.isPending}
            onClick={() => addPayment.mutate()}
          >
            {addPayment.isPending ? "…" : t("invoices.savePayment")}
          </Button>
          {addPayment.isError ? (
            <p className="text-sm text-destructive">{(addPayment.error as Error).message}</p>
          ) : null}
        </div>
      ) : balanceFils > 0 && !can("invoices.payment") ? (
        <p className="text-sm text-muted-foreground">{t("invoices.noPaymentPermission")}</p>
      ) : (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-center text-sm font-medium text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
          {t("invoices.fullyPaid")}
        </p>
      )}

      {payments.length > 0 ? (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-muted-foreground">{t("invoices.paymentHistory")}</h4>
          <ul className="max-h-36 space-y-1 overflow-y-auto rounded-lg border text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 border-b px-3 py-2 last:border-0">
                <span className="text-muted-foreground">
                  {p.method} · {new Date(p.createdAt).toLocaleString()}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-mono font-medium">{formatAED(p.amountFils)}</span>
                  {canDeletePayment ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      title={t("invoices.deletePayment")}
                      aria-label={t("invoices.deletePayment")}
                      disabled={deletePayment.isPending}
                      onClick={() => {
                        if (window.confirm(t("invoices.confirmDeletePayment"))) deletePayment.mutate(p.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {can("invoices.edit") ? (
        <div className="space-y-2 rounded-xl border p-4">
          <Label className="text-sm font-semibold">{t("invoices.expectedDelivery")}</Label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              type="datetime-local"
              className="h-12 rounded-lg"
              value={dueLocal}
              onChange={(e) => setDueLocal(e.target.value)}
            />
            <Button
              type="button"
              variant="secondary"
              className="h-12 shrink-0"
              disabled={saveDue.isPending}
              onClick={() => saveDue.mutate()}
            >
              {saveDue.isPending ? "…" : t("invoices.saveDate")}
            </Button>
          </div>
          {saveDue.isError ? (
            <p className="text-sm text-destructive">{getApiErrorMessage(saveDue.error)}</p>
          ) : null}
        </div>
      ) : null}

      {can("invoices.renumber") ? (
        <div className="space-y-2 rounded-xl border p-4">
          <Label htmlFor="renumber-no" className="text-sm font-semibold">
            {t("invoices.renumberTitle")}
          </Label>
          <p className="text-xs text-muted-foreground">{t("invoices.renumberHint")}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              id="renumber-no"
              className="h-12 rounded-lg font-mono"
              inputMode="numeric"
              dir="ltr"
              placeholder={t("invoices.renumberPlaceholder")}
              value={renumberInput}
              onChange={(e) => {
                setRenumberInput(e.target.value);
                setRenumberDone(null);
              }}
            />
            <Button
              type="button"
              variant="secondary"
              className="h-12 shrink-0"
              disabled={renumber.isPending || !renumberInput.trim()}
              onClick={() => renumber.mutate()}
            >
              {renumber.isPending ? "…" : t("invoices.renumberSave")}
            </Button>
          </div>
          {renumber.isError ? (
            <p className="text-sm text-destructive">{getApiErrorMessage(renumber.error)}</p>
          ) : renumberDone ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-300">{renumberDone}</p>
          ) : null}
        </div>
      ) : null}

      {can("invoices.deliver") ? (
        <div className="rounded-xl border-2 border-dashed border-amber-300/80 bg-amber-50/50 p-4 dark:bg-amber-950/20">
          <p className="mb-1 text-sm font-semibold">{t("invoices.delivery")}</p>
          <p className="mb-4 text-xs text-muted-foreground">
            {t("invoices.deliveryHint")}
          </p>
          <Button
            type="button"
            className="h-14 w-full rounded-xl text-lg"
            disabled={!canDeliver || deliveredAt != null || deliver.isPending}
            onClick={() => {
              if (confirm(t("invoices.confirmDeliver", { invoiceNo }))) deliver.mutate();
            }}
          >
            {deliver.isPending ? "…" : deliveredAt ? t("invoices.delivered") : t("invoices.markAsDelivered")}
          </Button>
          {deliver.isError ? (
            <p className="mt-2 text-sm text-destructive">{(deliver.error as Error).message}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
