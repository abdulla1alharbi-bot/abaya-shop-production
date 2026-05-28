import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/shared/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatAED } from "@/lib/money";
import { dueDateTimeLocalFromNowCalendarDays } from "@/lib/abayaTailoringCatalog";
import { useCartStore } from "@/store/cartStore";

type SampleRow = {
  id: string;
  primaryJobId: string | null;
  batchNo: number;
  color: string | null;
  status: "IN_PROGRESS" | "COMPLETED";
  createdAt: string;
  model: { id: string; code: string; name: string; abayaTypeId: string; defaultPriceFils: number; defaultDeliveryDays: number };
  fabric: { id: string; rollCode: string; name: string; color: string } | null;
  completedQty: number;
  quantity: number;
};

export function SampleTailoringPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const setTailoringDraft = useCartStore((s) => s.setTailoringDraft);
  const setEditingTailoringId = useCartStore((s) => s.setEditingTailoringId);
  const [modelId, setModelId] = useState("");
  const [fabricId, setFabricId] = useState("");
  const [color, setColor] = useState("");
  const [notes, setNotes] = useState("");
  const [month, setMonth] = useState("");
  const [filterModelId, setFilterModelId] = useState("");

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
    queryKey: ["sample-models"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: { items: Array<{ id: string; code: string; name: string }> } }>(
        "/abaya-models",
        { params: { activeOnly: "true", limit: 500 } },
      );
      return res.data.data.items;
    },
  });

  const { data: fabrics } = useQuery({
    queryKey: ["sample-fabrics"],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { items: Array<{ id: string; rollCode: string; name: string; color: string }> };
      }>("/fabric-rolls", { params: { activeOnly: "true", limit: 300 } });
      return res.data.data.items;
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["sample-list", monthRange, filterModelId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: { items: SampleRow[] } }>("/production", {
        params: {
          type: "SAMPLE",
          ...monthRange,
          ...(filterModelId ? { modelId: filterModelId } : {}),
          limit: 300,
        },
      });
      return res.data.data.items;
    },
  });

  const createSample = useMutation({
    mutationFn: async () => {
      await api.post("/production/samples", {
        modelId,
        fabricId: fabricId || null,
        color: color.trim() || undefined,
        notes: notes.trim() || undefined,
      });
    },
    onSuccess: () => {
      setColor("");
      setNotes("");
      void qc.invalidateQueries({ queryKey: ["sample-list"] });
      void qc.invalidateQueries({ queryKey: ["sample-performance-display"] });
    },
  });

  const { data: sampleReport } = useQuery({
    queryKey: ["sample-report", monthRange, filterModelId],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: {
          summary: { piecesCount: number; totalWagesFils: number };
        };
      }>("/reports/sample-production", {
        params: { ...monthRange, ...(filterModelId ? { modelId: filterModelId } : {}) },
      });
      return res.data.data.summary;
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="تفصيل للعرض"
        description="إنشاء نموذج عرض (Showroom Model) بدون عميل، مع تتبع أجور التنفيذ واستخدامه كمرجع تفصيل فقط."
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
        <Input placeholder="اللون" value={color} onChange={(e) => setColor(e.target.value)} />
        <Input placeholder="ملاحظات" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Button disabled={!modelId || createSample.isPending} onClick={() => createSample.mutate()}>
          {createSample.isPending ? "..." : "إنشاء قطعة عرض"}
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
        <Button variant="outline" onClick={() => {
          setMonth("");
          setFilterModelId("");
        }}>
          مسح الفلاتر
        </Button>
      </section>

      <div className="rounded-xl border bg-card p-3 text-sm">
        <span className="text-muted-foreground">عدد قطع العرض:</span> <span className="font-semibold">{sampleReport?.piecesCount ?? 0}</span>
        <span className="mx-2 text-muted-foreground">|</span>
        <span className="text-muted-foreground">أجور العمال:</span>{" "}
        <span className="font-semibold">{formatAED(sampleReport?.totalWagesFils ?? 0)}</span>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-start font-medium">الموديل</th>
              <th className="px-3 py-2 text-start font-medium">اللون</th>
              <th className="px-3 py-2 text-start font-medium">الحالة</th>
              <th className="px-3 py-2 text-start font-medium">تاريخ الإنشاء</th>
              <th className="px-3 py-2 text-start font-medium">إجراء</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">جاري التحميل…</td>
              </tr>
            ) : !data?.length ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">لا توجد قطع عرض.</td>
              </tr>
            ) : (
              data.map((r) => (
                <tr key={r.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2">{r.model.code} — {r.model.name}</td>
                  <td className="px-3 py-2">{r.color ?? "—"}</td>
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
                  <td className="px-3 py-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={r.status !== "COMPLETED"}
                      onClick={() => {
                        setEditingTailoringId(null);
                        setTailoringDraft({
                          abayaTypeId: r.model.abayaTypeId ?? "",
                          abayaModelId: r.model.id,
                          rollId: r.fabric?.id ?? "",
                          colorNote: r.color ?? r.fabric?.color ?? "",
                          saleAed: (r.model.defaultPriceFils / 100).toFixed(2),
                          dueDate: dueDateTimeLocalFromNowCalendarDays(r.model.defaultDeliveryDays || 7),
                          sourceDisplaySampleJobId: r.primaryJobId,
                          sourceDisplayModelId: r.model.id,
                          itemNotes: `من نموذج عرض #${r.batchNo}`,
                        });
                        navigate("/pos?mode=tailoring");
                      }}
                    >
                      إنشاء طلب تفصيل من هذا النموذج
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

