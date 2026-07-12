import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { formatAED } from "@/lib/money";

export type ReturnableLine = {
  id: string;
  label: string;
  qty: number;
  totalFils: number;
};

type InvoiceReturnRow = {
  id: string;
  reason: string;
  refundMethod: string;
  totalFils: number;
  createdAt: string;
  createdBy?: { name: string } | null;
  items: Array<{
    qty: number;
    amountFils: number;
    invoiceItem?: { description?: string | null } | null;
  }>;
};

const REFUND_METHODS = [
  { value: "CREDIT", label: "رصيد للعميل / Customer credit" },
  { value: "CASH", label: "كاش / Cash" },
  { value: "TRANSFER", label: "تحويل / Transfer" },
  { value: "CARD", label: "شبكة / Card" },
] as const;

function refundMethodLabel(method: string): string {
  return REFUND_METHODS.find((m) => m.value === method)?.label ?? method;
}

export function InvoiceReturnDialog({
  invoiceId,
  lines,
}: {
  invoiceId: string;
  lines: ReturnableLine[];
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [qtyByLine, setQtyByLine] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [refundMethod, setRefundMethod] = useState("CREDIT");
  const [created, setCreated] = useState<InvoiceReturnRow | null>(null);

  const returnsQuery = useQuery({
    queryKey: ["invoice-returns", invoiceId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: InvoiceReturnRow[] }>(
        `/invoices/${invoiceId}/returns`,
      );
      return res.data.data;
    },
  });

  const selectedItems = lines
    .map((l) => {
      const raw = Number(qtyByLine[l.id]) || 0;
      const qty = Math.min(Math.max(0, raw), l.qty);
      return { invoiceItemId: l.id, qty };
    })
    .filter((i) => i.qty > 0);

  const createReturn = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ success: boolean; data: InvoiceReturnRow }>(
        `/invoices/${invoiceId}/returns`,
        {
          reason: reason.trim(),
          refundMethod,
          items: selectedItems,
        },
      );
      return res.data.data;
    },
    onSuccess: (ret) => {
      setCreated(ret);
      void queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
      void queryClient.invalidateQueries({ queryKey: ["invoice-returns", invoiceId] });
    },
  });

  const resetForm = () => {
    setQtyByLine({});
    setReason("");
    setRefundMethod("CREDIT");
    setCreated(null);
    createReturn.reset();
  };

  const canSubmit =
    reason.trim().length >= 2 && selectedItems.length > 0 && !createReturn.isPending;

  const previousReturns = returnsQuery.data ?? [];

  return (
    <div className="space-y-3 text-start" dir="rtl">
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="h-14 rounded-xl border-orange-400 text-orange-700 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-400 dark:hover:bg-orange-950/30"
        onClick={() => {
          resetForm();
          setOpen(true);
        }}
      >
        <RotateCcw className="me-2 h-5 w-5" />
        إرجاع / استبدال
      </Button>

      {previousReturns.length > 0 ? (
        <div className="rounded-xl border border-border/80 bg-muted/20 p-4">
          <p className="mb-2 text-sm font-semibold">المرتجعات السابقة / Previous returns</p>
          <ul className="space-y-2 text-sm">
            {previousReturns.map((r) => (
              <li key={r.id} className="rounded-lg border border-border/60 bg-card p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-semibold tabular-nums">
                    {formatAED(r.totalFils)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {refundMethodLabel(r.refundMethod)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString()}
                    {r.createdBy?.name ? ` · ${r.createdBy.name}` : ""}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {r.items
                    .map((it) => `${it.invoiceItem?.description ?? "—"} × ${it.qty}`)
                    .join("، ")}
                </p>
                <p className="mt-1 text-xs">السبب: {r.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (createReturn.isPending) return;
          setOpen(o);
          if (!o) resetForm();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>إرجاع / استبدال</DialogTitle>
            <DialogDescription>
              حدّد الكمية المرتجعة لكل بند، ثم اكتب السبب واختر طريقة الاسترداد.
            </DialogDescription>
          </DialogHeader>

          {created ? (
            <div className="space-y-4 py-2">
              <div className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-950/30 dark:text-green-100">
                <p className="font-semibold">تم تسجيل المرتجع بنجاح ✓</p>
                <p className="mt-1">
                  الإجمالي المسترد:{" "}
                  <span className="font-mono font-bold tabular-nums">
                    {formatAED(created.totalFils)}
                  </span>{" "}
                  — {refundMethodLabel(created.refundMethod)}
                </p>
                {created.items?.length ? (
                  <p className="mt-1 text-xs">
                    {created.items
                      .map((it) => `${it.invoiceItem?.description ?? "—"} × ${it.qty}`)
                      .join("، ")}
                  </p>
                ) : null}
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    resetForm();
                  }}
                >
                  إغلاق
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <div className="space-y-4 py-2">
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/80 text-xs font-semibold">
                      <tr>
                        <th className="px-3 py-2 text-start">البند</th>
                        <th className="px-3 py-2 text-center">الكمية</th>
                        <th className="px-3 py-2 text-end">المجموع</th>
                        <th className="px-3 py-2 text-center">كمية الإرجاع</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line) => (
                        <tr key={line.id} className="border-b border-border/40 last:border-0">
                          <td className="px-3 py-2">{line.label}</td>
                          <td className="px-3 py-2 text-center tabular-nums">{line.qty}</td>
                          <td className="px-3 py-2 text-end font-mono tabular-nums">
                            {formatAED(line.totalFils)}
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              type="number"
                              min={0}
                              max={line.qty}
                              step={0.5}
                              className="mx-auto h-9 w-20 text-center"
                              value={qtyByLine[line.id] ?? "0"}
                              onChange={(e) =>
                                setQtyByLine((prev) => ({ ...prev, [line.id]: e.target.value }))
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    سبب الإرجاع <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    rows={3}
                    placeholder="اكتب سبب الإرجاع…"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">طريقة الاسترداد</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={refundMethod}
                    onChange={(e) => setRefundMethod(e.target.value)}
                  >
                    {REFUND_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                <p className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
                  للاستبدال: سجّل الإرجاع هنا ثم أنشئ فاتورة جديدة بالقطعة البديلة
                </p>
              </div>

              <DialogFooter className="gap-2 sm:justify-between">
                <Button
                  type="button"
                  variant="outline"
                  disabled={createReturn.isPending}
                  onClick={() => {
                    setOpen(false);
                    resetForm();
                  }}
                >
                  إلغاء
                </Button>
                <Button
                  type="button"
                  disabled={!canSubmit}
                  onClick={() => createReturn.mutate()}
                >
                  {createReturn.isPending ? "جارٍ التسجيل…" : "تسجيل المرتجع"}
                </Button>
              </DialogFooter>
              {createReturn.isError ? (
                <p className="text-sm text-destructive">
                  {getApiErrorMessage(createReturn.error, "تعذّر تسجيل المرتجع")}
                </p>
              ) : null}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
