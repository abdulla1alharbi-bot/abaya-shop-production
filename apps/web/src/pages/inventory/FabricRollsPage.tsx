import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { formatAED } from "@/lib/money";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";

type Roll = {
  id: string;
  rollCode: string;
  name: string;
  type: string;
  color: string;
  totalMeters: number;
  availableMeters: number;
  lowStockAt: number;
  costPerMeter: number;
  isActive: boolean;
  category: string;
};

type Tab = "FABRIC" | "LACE";

export function FabricRollsPage() {
  const { can } = usePermissions();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>("FABRIC");
  const [restockRoll, setRestockRoll] = useState<Roll | null>(null);
  const [adjustRoll, setAdjustRoll] = useState<Roll | null>(null);
  const [meters, setMeters] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["fabric-rolls"],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { items: Roll[] };
      }>("/fabric-rolls", { params: { limit: 200 } });
      return res.data.data.items;
    },
  });

  const restock = useMutation({
    mutationFn: async ({ id, meters, reason }: { id: string; meters: number; reason: string }) => {
      await api.post(`/fabric-rolls/${id}/restock`, { meters, reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fabric-rolls"] });
      setRestockRoll(null);
      setMeters("");
      setReason("");
      setError("");
    },
    onError: () => {
      setError("حدث خطأ، تحقق من البيانات وحاول مجدداً.");
    },
  });

  const adjust = useMutation({
    mutationFn: async ({ id, meters, reason }: { id: string; meters: number; reason: string }) => {
      await api.post(`/fabric-rolls/${id}/adjust`, { meters, reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fabric-rolls"] });
      setAdjustRoll(null);
      setMeters("");
      setReason("");
      setError("");
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message;
      setError(msg === "Not enough available meters" ? "الكمية المطلوبة تتجاوز المتاح." : "حدث خطأ، تحقق من البيانات وحاول مجدداً.");
    },
  });

  function openRestock(roll: Roll) {
    setRestockRoll(roll);
    setMeters("");
    setReason("");
    setError("");
  }

  function openAdjust(roll: Roll) {
    setAdjustRoll(roll);
    setMeters("");
    setReason("");
    setError("");
  }

  function handleSubmit() {
    const val = parseFloat(meters);
    if (!val || val <= 0) {
      setError("أدخل كمية موجبة صحيحة.");
      return;
    }
    restock.mutate({ id: restockRoll!.id, meters: val, reason: reason.trim() });
  }

  function handleAdjustSubmit() {
    const val = parseFloat(meters);
    if (!val || val <= 0) {
      setError("أدخل كمية موجبة صحيحة.");
      return;
    }
    if (val > adjustRoll!.availableMeters) {
      setError(`لا يمكن خصم أكثر من المتاح (${adjustRoll!.availableMeters.toFixed(2)} م).`);
      return;
    }
    adjust.mutate({ id: adjustRoll!.id, meters: val, reason: reason.trim() });
  }

  const filtered = data?.filter((r) => (r.category ?? "FABRIC") === tab) ?? [];

  const tabLabel = tab === "FABRIC" ? "القماش" : "الدانتيل";

  return (
    <div>
      <PageHeader
        title={t("fabrics.title")}
        description={t("fabrics.description", { defaultValue: "Fabric and lace rolls — for tailoring and inventory deduction." })}
        actions={
          can("fabrics.create") ? (
            <Button asChild size="sm">
              <Link to="/fabrics/new">
                <Plus className="me-1 h-4 w-4" />
                {t("fabrics.newTitle")}
              </Link>
            </Button>
          ) : null
        }
      />

      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-lg border bg-muted/40 p-1 w-fit">
        {(["FABRIC", "LACE"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-md px-5 py-1.5 text-sm font-medium transition-colors",
              tab === t
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t === "FABRIC" ? "القماش" : "الدانتيل"}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="px-4 py-3 text-start font-medium">الرمز</th>
              <th className="px-4 py-3 text-start font-medium">الاسم</th>
              <th className="px-4 py-3 text-start font-medium">النوع / اللون</th>
              <th className="px-4 py-3 text-end font-medium">متاح (م)</th>
              <th className="px-4 py-3 text-end font-medium">تكلفة/م</th>
              <th className="px-4 py-3 text-start font-medium">تنبيه</th>
              <th className="px-4 py-3 text-start font-medium">الحالة</th>
              <th className="px-4 py-3 w-36" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  جاري التحميل…
                </td>
              </tr>
            ) : !filtered.length ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  لا {tabLabel} بعد. أضف أول لفة.
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const low = r.availableMeters <= r.lowStockAt;
                return (
                  <tr key={r.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2.5 font-mono text-xs">{r.rollCode}</td>
                    <td className="px-4 py-2.5">{r.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {r.type} · {r.color}
                    </td>
                    <td className="px-4 py-2.5 text-end tabular-nums">{r.availableMeters.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-end">{formatAED(r.costPerMeter)}</td>
                    <td className="px-4 py-2.5">
                      {low ? (
                        <Badge variant="destructive">منخفض</Badge>
                      ) : (
                        <span className="text-muted-foreground">طبيعي</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">{r.isActive ? "نشط" : "موقوف"}</td>
                    <td className="px-4 py-2.5 text-end">
                      <div className="flex items-center justify-end gap-3">
                        {can("fabrics.edit") && (
                          <Button
                            variant="link"
                            size="sm"
                            className="h-auto p-0 text-green-600 hover:text-green-700"
                            onClick={() => openRestock(r)}
                          >
                            إضافة
                          </Button>
                        )}
                        {can("fabrics.edit") && (
                          <Button
                            variant="link"
                            size="sm"
                            className="h-auto p-0 text-red-500 hover:text-red-600"
                            onClick={() => openAdjust(r)}
                          >
                            خصم
                          </Button>
                        )}
                        {can("fabrics.edit") ? (
                          <Button variant="link" size="sm" className="h-auto p-0" asChild>
                            <Link to={`/fabrics/${r.id}/edit`}>تعديل</Link>
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Adjust (Deduct) Dialog */}
      <Dialog open={!!adjustRoll} onOpenChange={(open) => { if (!open) { setAdjustRoll(null); setMeters(""); setReason(""); setError(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>خصم من المخزون</DialogTitle>
          </DialogHeader>
          {adjustRoll && (
            <div className="space-y-4">
              <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                <p className="font-medium">{adjustRoll.name}</p>
                <p className="text-muted-foreground">
                  {adjustRoll.type} · {adjustRoll.color} —{" "}
                  متاح حالياً:{" "}
                  <span className="tabular-nums font-medium">{adjustRoll.availableMeters.toFixed(2)} م</span>
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">كمية الخصم (م) *</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={adjustRoll.availableMeters}
                  value={meters}
                  onChange={(e) => { setMeters(e.target.value); setError(""); }}
                  placeholder={`أقصى: ${adjustRoll.availableMeters.toFixed(2)} م`}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">سبب الخصم (اختياري)</label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="مثال: إدخال خاطئ، تلف، إلخ"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              {meters && parseFloat(meters) > 0 && parseFloat(meters) <= adjustRoll.availableMeters && (
                <p className="text-sm text-muted-foreground">
                  المتاح بعد الخصم:{" "}
                  <span className="font-semibold text-red-500 tabular-nums">
                    {(adjustRoll.availableMeters - parseFloat(meters)).toFixed(2)} م
                  </span>
                </p>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          )}
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline" size="sm">إلغاء</Button>
            </DialogClose>
            <Button size="sm" variant="destructive" onClick={handleAdjustSubmit} disabled={adjust.isPending}>
              {adjust.isPending ? "جاري الحفظ…" : "خصم من المخزون"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restock Dialog */}
      <Dialog open={!!restockRoll} onOpenChange={(open) => !open && setRestockRoll(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>إضافة وارد للمخزون</DialogTitle>
          </DialogHeader>
          {restockRoll && (
            <div className="space-y-4">
              <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                <p className="font-medium">{restockRoll.name}</p>
                <p className="text-muted-foreground">
                  {restockRoll.type} · {restockRoll.color} —{" "}
                  متاح حالياً:{" "}
                  <span className="tabular-nums font-medium">{restockRoll.availableMeters.toFixed(2)} م</span>
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">كمية الوارد (م) *</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={meters}
                  onChange={(e) => { setMeters(e.target.value); setError(""); }}
                  placeholder="مثال: 35"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">ملاحظة (اختياري)</label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="مثال: وارد من المورّد"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              {meters && parseFloat(meters) > 0 && (
                <p className="text-sm text-muted-foreground">
                  المتاح بعد الإضافة:{" "}
                  <span className="font-semibold text-green-600 tabular-nums">
                    {(restockRoll.availableMeters + parseFloat(meters)).toFixed(2)} م
                  </span>
                </p>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          )}
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline" size="sm">إلغاء</Button>
            </DialogClose>
            <Button size="sm" onClick={handleSubmit} disabled={restock.isPending}>
              {restock.isPending ? "جاري الحفظ…" : "إضافة للمخزون"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
