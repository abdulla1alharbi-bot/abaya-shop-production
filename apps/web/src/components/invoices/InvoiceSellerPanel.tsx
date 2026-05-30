import { useState } from "react";
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
  const { can } = usePermissions();
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
      if (fils <= 0) throw new Error("Enter a valid amount");
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

  const saveDue = useMutation({
    mutationFn: async () => {
      const iso = dueLocal.trim() ? new Date(dueLocal).toISOString() : null;
      await api.patch(`/invoices/${invoiceId}`, { deliveryDate: iso });
    },
    onSuccess: () => onUpdated(),
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
          <span className="text-muted-foreground">Total</span>
          <span className="font-mono text-lg font-semibold tabular-nums">{formatAED(totalFils)}</span>
        </div>
        <div className="flex justify-between gap-4 text-sm">
          <span className="text-muted-foreground">Paid</span>
          <span className="font-mono text-lg font-semibold tabular-nums">{formatAED(paidFils)}</span>
        </div>
        <div className="flex justify-between gap-4 border-t pt-3 text-sm">
          <span className="font-medium text-foreground">Remaining</span>
          <span className="font-mono text-xl font-bold tabular-nums text-amber-900 dark:text-amber-100">
            {formatAED(balanceFils)}
          </span>
        </div>
      </div>

      {balanceFils > 0 && can("invoices.payment") ? (
        <div className="space-y-3">
          <Label htmlFor="pay-amt" className="text-base font-semibold">
            Add payment (AED)
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
            {addPayment.isPending ? "…" : "Save payment"}
          </Button>
          {addPayment.isError ? (
            <p className="text-sm text-destructive">{(addPayment.error as Error).message}</p>
          ) : null}
        </div>
      ) : balanceFils > 0 && !can("invoices.payment") ? (
        <p className="text-sm text-muted-foreground">لا تملك صلاحية تسجيل دفعات على هذه الفاتورة.</p>
      ) : (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-center text-sm font-medium text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
          Fully paid.
        </p>
      )}

      {payments.length > 0 ? (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-muted-foreground">Payment history</h4>
          <ul className="max-h-36 space-y-1 overflow-y-auto rounded-lg border text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex justify-between gap-2 border-b px-3 py-2 last:border-0">
                <span className="text-muted-foreground">
                  {p.method} · {new Date(p.createdAt).toLocaleString()}
                </span>
                <span className="font-mono font-medium">{formatAED(p.amountFils)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {can("invoices.edit") ? (
        <div className="space-y-2 rounded-xl border p-4">
          <Label className="text-sm font-semibold">Expected delivery</Label>
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
              {saveDue.isPending ? "…" : "Save date"}
            </Button>
          </div>
          {saveDue.isError ? (
            <p className="text-sm text-destructive">{getApiErrorMessage(saveDue.error)}</p>
          ) : null}
        </div>
      ) : null}

      {can("invoices.deliver") ? (
        <div className="rounded-xl border-2 border-dashed border-amber-300/80 bg-amber-50/50 p-4 dark:bg-amber-950/20">
          <p className="mb-1 text-sm font-semibold">Delivery</p>
          <p className="mb-4 text-xs text-muted-foreground">
            Available when workshop work is finished. You can deliver even if there is a balance — record payment
            above first if you like.
          </p>
          <Button
            type="button"
            className="h-14 w-full rounded-xl text-lg"
            disabled={!canDeliver || deliveredAt != null || deliver.isPending}
            onClick={() => {
              if (confirm(`Mark invoice #${invoiceNo} as delivered?`)) deliver.mutate();
            }}
          >
            {deliver.isPending ? "…" : deliveredAt ? "Delivered" : "Mark as delivered"}
          </Button>
          {deliver.isError ? (
            <p className="mt-2 text-sm text-destructive">{(deliver.error as Error).message}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
