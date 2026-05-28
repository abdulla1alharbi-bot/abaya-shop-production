import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { formatAED } from "@/lib/money";
import { usePermissions } from "@/hooks/usePermissions";

export function AccountsPage() {
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const [incomeDesc, setIncomeDesc] = useState("");
  const [incomeAmount, setIncomeAmount] = useState("");

  const addIncome = useMutation({
    mutationFn: async () => {
      await api.post("/income", {
        description: incomeDesc.trim(),
        amountFils: Math.round((parseFloat(incomeAmount) || 0) * 100),
      });
    },
    onSuccess: () => {
      setIncomeDesc("");
      setIncomeAmount("");
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const { data } = useQuery({
    queryKey: ["accounts", "summary", start.toISOString(), end.toISOString()],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, unknown> }>(
        "/reports/summary",
        {
          params: { from: start.toISOString(), to: end.toISOString() },
        },
      );
      return res.data.data;
    },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <PageHeader
        title="الحركة المالية"
        description="ملخص الشهر الحالي. التفاصيل الكاملة في التقارير."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/accounts/expenses">المصاريف</Link>
          </Button>
        }
      />

      {data ? (
        <div className="grid gap-3 rounded-lg border bg-card p-4 text-sm sm:grid-cols-2">
          <p>
            <span className="text-muted-foreground">مبيعات الفواتير: </span>
            {formatAED(data.salesTotalFils as number)}
          </p>
          <p>
            <span className="text-muted-foreground">ما وُصِل نقداً: </span>
            {formatAED(data.collectedFils as number)}
          </p>
          <p>
            <span className="text-muted-foreground">مصاريف: </span>
            {formatAED(data.expensesTotalFils as number)}
          </p>
          <p>
            <span className="text-muted-foreground">دخل إضافي: </span>
            {formatAED(data.incomeTotalFils as number)}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">جاري التحميل…</p>
      )}

      {can("reports.financial") ? (
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium">تسجيل دخل إضافي</h2>
          <p className="text-xs text-muted-foreground">مثلاً: بيع خردة، خدمة خارج الفاتورة.</p>
          <div className="grid gap-2">
            <Label htmlFor="inc-desc">الوصف</Label>
            <Input
              id="inc-desc"
              value={incomeDesc}
              onChange={(e) => setIncomeDesc(e.target.value)}
              placeholder="ماذا؟"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="inc-amt">المبلغ (درهم)</Label>
            <Input
              id="inc-amt"
              type="number"
              step={0.01}
              min={0.01}
              value={incomeAmount}
              onChange={(e) => setIncomeAmount(e.target.value)}
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={addIncome.isPending || !incomeDesc.trim()}
            onClick={() => addIncome.mutate()}
          >
            {addIncome.isPending ? "…" : "حفظ"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
