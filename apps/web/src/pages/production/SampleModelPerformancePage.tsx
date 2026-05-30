import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatAED } from "@/lib/money";

type PerfRow = {
  sampleJobId: string;
  sampleCreatedAt: string;
  modelId: string;
  modelCode: string;
  modelName: string;
  tailoringOrdersCount: number;
  totalTailoringRevenueFils: number;
  sampleProductionCostFils: number;
  estimatedReturnFils: number;
};
type TopModelRow = {
  modelId: string;
  modelCode: string;
  modelName: string;
  count: number;
  revenue: number;
};

export function SampleModelPerformancePage() {
  const { t } = useTranslation();
  const [month, setMonth] = useState("");
  const [modelId, setModelId] = useState("");

  const monthRange = useMemo(() => {
    if (!month) return {};
    const [y, m] = month.split("-").map((n) => Number(n));
    if (!y || !m) return {};
    return {
      from: new Date(y, m - 1, 1).toISOString(),
      to: new Date(y, m, 0, 23, 59, 59, 999).toISOString(),
    };
  }, [month]);

  const { data: models } = useQuery({
    queryKey: ["sample-perf-models"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: { items: Array<{ id: string; code: string; name: string }> } }>(
        "/abaya-models",
        { params: { activeOnly: "true", limit: 500 } },
      );
      return res.data.data.items;
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["sample-performance-display", monthRange, modelId],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: {
          rows: PerfRow[];
          topModels: { byOrders: TopModelRow[] };
          noOrderSamples: PerfRow[];
        };
      }>("/reports/sample-model-performance", {
        params: { ...monthRange, ...(modelId ? { modelId } : {}) },
      });
      return res.data.data;
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("production.samplesPerformanceTitle")}
        description={t("production.samplesPerformanceDesc", { defaultValue: "Measure showroom model performance by number of tailoring orders generated." })}
      />

      <section className="grid gap-2 rounded-xl border bg-card p-3 md:grid-cols-3">
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
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
            setModelId("");
          }}
        >
          مسح الفلاتر
        </Button>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border bg-card p-3">
          <h2 className="mb-2 text-sm font-semibold">أفضل نماذج العرض (حسب طلبات التفصيل)</h2>
          <ul className="space-y-1 text-sm">
            {data?.topModels.byOrders.length ? (
              data.topModels.byOrders.map((r) => (
                <li key={`${r.modelId || r.modelCode}-orders`} className="flex justify-between gap-2">
                  <span>{r.modelCode} — {r.modelName}</span>
                  <span className="font-medium">{r.count}</span>
                </li>
              ))
            ) : (
              <li className="text-muted-foreground">لا توجد بيانات.</li>
            )}
          </ul>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <h2 className="mb-2 text-sm font-semibold">نماذج العرض بدون طلبات</h2>
          <ul className="space-y-1 text-sm">
            {data?.noOrderSamples.length ? (
              data.noOrderSamples.map((r) => (
                <li key={`${r.sampleJobId}-zero`} className="flex justify-between gap-2">
                  <span>{r.modelCode} — {r.modelName}</span>
                  <span className="font-medium">{new Date(r.sampleCreatedAt).toLocaleDateString()}</span>
                </li>
              ))
            ) : (
              <li className="text-muted-foreground">لا توجد بيانات.</li>
            )}
          </ul>
        </div>
      </section>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-start font-medium">الموديل</th>
              <th className="px-3 py-2 text-start font-medium">تاريخ إنشاء النموذج</th>
              <th className="px-3 py-2 text-start font-medium">عدد طلبات التفصيل</th>
              <th className="px-3 py-2 text-start font-medium">إجمالي إيراد التفصيل</th>
              <th className="px-3 py-2 text-start font-medium">تكلفة إنتاج النموذج</th>
              <th className="px-3 py-2 text-start font-medium">العائد التقديري</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">جاري التحميل…</td>
              </tr>
            ) : !data?.rows.length ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">لا توجد نتائج.</td>
              </tr>
            ) : (
              data.rows.map((r) => (
                <tr key={r.sampleJobId} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2">{r.modelCode} — {r.modelName}</td>
                  <td className="px-3 py-2">{new Date(r.sampleCreatedAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2">{r.tailoringOrdersCount}</td>
                  <td className="px-3 py-2">{formatAED(r.totalTailoringRevenueFils)}</td>
                  <td className="px-3 py-2">{formatAED(r.sampleProductionCostFils)}</td>
                  <td className="px-3 py-2">{formatAED(r.estimatedReturnFils)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

