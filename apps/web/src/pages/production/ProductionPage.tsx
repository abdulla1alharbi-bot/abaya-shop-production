import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { formatAED } from "@/lib/money";
import { usePermissions } from "@/hooks/usePermissions";

type BatchRow = {
  id: string;
  batchNo: number;
  quantity: number;
  status: "IN_PROGRESS" | "COMPLETED";
  completedQty: number;
  createdAt: string;
  model: { id: string; code: string; name: string };
};

export function ProductionPage() {
  const { can } = usePermissions();
  const { t } = useTranslation();
  const canViewMonthlyReport = can("reports.sales");
  const qc = useQueryClient();
  const [modelId, setModelId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [fabricId, setFabricId] = useState("");
  const [notes, setNotes] = useState("");
  const [month, setMonth] = useState("");
  const [filterModelId, setFilterModelId] = useState("");

  const monthRange = useMemo(() => {
    if (!month) return {};
    const [y, m] = month.split("-").map((n) => Number(n));
    if (!y || !m) return {};
    const from = new Date(y, m - 1, 1).toISOString();
    const to = new Date(y, m, 0, 23, 59, 59, 999).toISOString();
    return { from, to };
  }, [month]);

  const { data: models } = useQuery({
    queryKey: ["production-models"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: { items: Array<{ id: string; code: string; name: string }> } }>(
        "/abaya-models",
        { params: { activeOnly: "true", limit: 500 } },
      );
      return res.data.data.items;
    },
  });

  const { data: fabrics } = useQuery({
    queryKey: ["production-fabrics"],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { items: Array<{ id: string; rollCode: string; name: string; color: string }> };
      }>("/fabric-rolls", { params: { activeOnly: "true", limit: 300 } });
      return res.data.data.items;
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["production-batches", monthRange, filterModelId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: { items: BatchRow[] } }>("/production", {
        params: {
          type: "BATCH",
          ...monthRange,
          ...(filterModelId ? { modelId: filterModelId } : {}),
          limit: 300,
        },
      });
      return res.data.data.items;
    },
  });

  const { data: monthlyReport } = useQuery({
    queryKey: ["production-monthly-report", monthRange, filterModelId],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: {
          summary: {
            totalBatches: number;
            totalProducedQty: number;
            totalWagesFils: number;
            totalCostFils: number;
          };
          rows: Array<{
            batchId: string;
            batchNo: number;
            modelCode: string;
            modelName: string;
            quantityProduced: number;
            totalWagesFils: number;
            totalCostFils: number;
          }>;
        };
      }>("/reports/monthly-production", {
        params: { ...monthRange, ...(filterModelId ? { modelId: filterModelId } : {}) },
      });
      return res.data.data;
    },
    enabled: canViewMonthlyReport,
  });

  const createBatch = useMutation({
    mutationFn: async () => {
      await api.post("/production", {
        modelId,
        quantity: Math.max(1, parseInt(quantity, 10) || 1),
        fabricId: fabricId || null,
        notes: notes.trim() || undefined,
      });
    },
    onSuccess: () => {
      setNotes("");
      setQuantity("1");
      void qc.invalidateQueries({ queryKey: ["production-batches"] });
      void qc.invalidateQueries({ queryKey: ["job-orders"] });
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("production.title")}
        description={t("production.description", { defaultValue: "Create internal production without customer invoices, tracking stages and costs." })}
      />

      <section className="grid gap-2 rounded-xl border bg-card p-3 md:grid-cols-5">
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
        >
          <option value="">اختر الموديل</option>
          {models?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.code} — {m.name}
            </option>
          ))}
        </select>
        <Input value={quantity} onChange={(e) => setQuantity(e.target.value)} type="number" min={1} />
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={fabricId}
          onChange={(e) => setFabricId(e.target.value)}
        >
          <option value="">بدون تحديد قماش</option>
          {fabrics?.map((f) => (
            <option key={f.id} value={f.id}>
              {f.rollCode} — {f.name} ({f.color})
            </option>
          ))}
        </select>
        <Input placeholder="ملاحظات" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Button disabled={!modelId || createBatch.isPending} onClick={() => createBatch.mutate()}>
          {createBatch.isPending ? "..." : "إنشاء إنتاج"}
        </Button>
      </section>

      <section className="grid gap-2 rounded-xl border bg-card p-3 md:grid-cols-3">
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={filterModelId}
          onChange={(e) => setFilterModelId(e.target.value)}
        >
          <option value="">كل الموديلات</option>
          {models?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.code} — {m.name}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          onClick={() => {
            setMonth("");
            setFilterModelId("");
          }}
        >
          مسح الفلاتر
        </Button>
      </section>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-start font-medium">رقم الإنتاج</th>
              <th className="px-3 py-2 text-start font-medium">الموديل</th>
              <th className="px-3 py-2 text-start font-medium">الكمية</th>
              <th className="px-3 py-2 text-start font-medium">المنجز</th>
              <th className="px-3 py-2 text-start font-medium">الحالة</th>
              <th className="px-3 py-2 text-start font-medium">تاريخ الإنشاء</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  جاري التحميل…
                </td>
              </tr>
            ) : !data?.length ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  لا توجد سجلات إنتاج.
                </td>
              </tr>
            ) : (
              data.map((r) => (
                <tr key={r.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2 font-mono">P-{r.batchNo}</td>
                  <td className="px-3 py-2">
                    {r.model.code} — {r.model.name}
                  </td>
                  <td className="px-3 py-2">{r.quantity}</td>
                  <td className="px-3 py-2">
                    {r.completedQty}/{r.quantity}
                  </td>
                  <td className="px-3 py-2">
                    {r.status === "COMPLETED" ? (
                      <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100">
                        مكتمل
                      </span>
                    ) : (
                      <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                        قيد التنفيذ
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{new Date(r.createdAt).toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {canViewMonthlyReport ? (
        <section className="space-y-3 rounded-xl border bg-card p-3">
          <h2 className="text-base font-semibold">إنتاج شهري</h2>
          <div className="grid gap-2 text-sm md:grid-cols-4">
            <div>
              <p className="text-muted-foreground">دفعات الإنتاج</p>
              <p className="font-semibold">{monthlyReport?.summary.totalBatches ?? 0}</p>
            </div>
            <div>
              <p className="text-muted-foreground">الكمية المنتجة</p>
              <p className="font-semibold">{monthlyReport?.summary.totalProducedQty ?? 0}</p>
            </div>
            <div>
              <p className="text-muted-foreground">إجمالي الأجور</p>
              <p className="font-semibold">{formatAED(monthlyReport?.summary.totalWagesFils ?? 0)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">إجمالي التكلفة</p>
              <p className="font-semibold">{formatAED(monthlyReport?.summary.totalCostFils ?? 0)}</p>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

