import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

type ConversionRow = {
  id: string;
  model: string;
  customerName: string;
  convertedAt: string;
  notes: string | null;
  invoice: { id: string; invoiceNo: number } | null;
  job: { id: string; jobNo: number; stage: string; isConvertedToReady: boolean };
  readyProduct: { id: string; sku: string; name: string; stockQty: number; isActive: boolean };
  saleStatus: "AVAILABLE" | "SOLD";
  soldAt: string | null;
  soldInvoiceId: string | null;
  soldInvoiceNo: number | null;
};

export function ReadyConversionsPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [model, setModel] = useState("");
  const [customer, setCustomer] = useState("");
  const [saleStatus, setSaleStatus] = useState<"all" | "available" | "sold">("all");
  const [submitted, setSubmitted] = useState({
    from: "",
    to: "",
    model: "",
    customer: "",
    saleStatus: "all" as "all" | "available" | "sold",
  });

  const params = useMemo(
    () => ({
      ...(submitted.from ? { from: new Date(`${submitted.from}T00:00:00`).toISOString() } : {}),
      ...(submitted.to ? { to: new Date(`${submitted.to}T23:59:59`).toISOString() } : {}),
      ...(submitted.model.trim() ? { model: submitted.model.trim() } : {}),
      ...(submitted.customer.trim() ? { customer: submitted.customer.trim() } : {}),
      ...(submitted.saleStatus !== "all" ? { saleStatus: submitted.saleStatus } : {}),
      limit: 300,
    }),
    [submitted],
  );

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["ready-conversions", params],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: {
          items: ConversionRow[];
          summary?: { convertedCount?: number; availableCount?: number; soldCount?: number };
        };
      }>("/job-orders/conversions", { params });
      return res.data.data;
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="تحويلات التفصيل إلى جاهز"
        description="سجل كل قطعة تفصيل تم تحويلها إلى منتج جاهز مع رابط الفاتورة والمنتج."
      />

      <div className="grid gap-2 rounded-xl border bg-card p-3 md:grid-cols-5">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Input placeholder="فلتر بالموديل" value={model} onChange={(e) => setModel(e.target.value)} />
        <Input
          placeholder="فلتر باسم العميل"
          value={customer}
          onChange={(e) => setCustomer(e.target.value)}
        />
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={saleStatus}
          onChange={(e) => setSaleStatus(e.target.value as "all" | "available" | "sold")}
        >
          <option value="all">الكل</option>
          <option value="available">متاح للبيع</option>
          <option value="sold">تم البيع</option>
        </select>
        <div className="flex gap-2 md:col-span-5">
          <Button
            className="flex-1"
            onClick={() => setSubmitted({ from, to, model, customer, saleStatus })}
            disabled={isFetching}
          >
            تصفية
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setFrom("");
              setTo("");
              setModel("");
              setCustomer("");
              setSaleStatus("all");
              setSubmitted({ from: "", to: "", model: "", customer: "", saleStatus: "all" });
              void refetch();
            }}
          >
            مسح
          </Button>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-3 text-sm">
        <span className="text-muted-foreground">عدد التحويلات:</span>{" "}
        <span className="font-semibold">{data?.summary?.convertedCount ?? data?.items.length ?? 0}</span>
        <span className="mx-2 text-muted-foreground">|</span>
        <span className="text-muted-foreground">متاح:</span>{" "}
        <span className="font-semibold">{data?.summary?.availableCount ?? 0}</span>
        <span className="mx-2 text-muted-foreground">|</span>
        <span className="text-muted-foreground">مباع:</span>{" "}
        <span className="font-semibold">{data?.summary?.soldCount ?? 0}</span>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[1180px] text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-start font-medium">رقم الفاتورة</th>
              <th className="px-3 py-2 text-start font-medium">العميل</th>
              <th className="px-3 py-2 text-start font-medium">الموديل</th>
              <th className="px-3 py-2 text-start font-medium">تاريخ التحويل</th>
              <th className="px-3 py-2 text-start font-medium">كود الجاهز</th>
              <th className="px-3 py-2 text-start font-medium">حالة البيع</th>
              <th className="px-3 py-2 text-start font-medium">تاريخ البيع</th>
              <th className="px-3 py-2 text-start font-medium">فاتورة البيع</th>
              <th className="px-3 py-2 text-start font-medium">ملاحظات</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                  جاري التحميل…
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-destructive">
                  تعذر تحميل سجل التحويلات.
                </td>
              </tr>
            ) : !data?.items.length ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                  لا توجد تحويلات مطابقة.
                </td>
              </tr>
            ) : (
              data.items.map((row) => (
                <tr key={row.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2 font-mono">{row.invoice ? `#${row.invoice.invoiceNo}` : "—"}</td>
                  <td className="px-3 py-2">{row.customerName}</td>
                  <td className="px-3 py-2">{row.model}</td>
                  <td className="px-3 py-2">{new Date(row.convertedAt).toLocaleString()}</td>
                  <td className="px-3 py-2 font-mono">{row.readyProduct.sku}</td>
                  <td className="px-3 py-2">
                    {row.saleStatus === "SOLD" ? (
                      <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100">
                        تم البيع
                      </span>
                    ) : (
                      <span className="rounded-full border border-cyan-300 bg-cyan-50 px-2 py-0.5 text-xs font-medium text-cyan-900 dark:border-cyan-800 dark:bg-cyan-950/30 dark:text-cyan-100">
                        متاح للبيع
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{row.soldAt ? new Date(row.soldAt).toLocaleString() : "—"}</td>
                  <td className="px-3 py-2 font-mono">
                    {row.soldInvoiceNo != null ? `#${row.soldInvoiceNo}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{row.notes ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

