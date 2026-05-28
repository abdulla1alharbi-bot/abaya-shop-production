import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";

export function CustomerForm() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = usePermissions();

  const save = useMutation({
    mutationFn: async (form: FormData) => {
      const creditLimitAed = parseFloat(String(form.get("creditLimitAed") ?? "0")) || 0;
      await api.post("/customers", {
        name: String(form.get("name") ?? ""),
        mobile: String(form.get("mobile") ?? ""),
        address: String(form.get("address") ?? "") || undefined,
        notes: String(form.get("notes") ?? "") || undefined,
        creditLimitFils: Math.round(creditLimitAed * 100),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      void navigate("/customers");
    },
  });

  return (
    <div className="mx-auto max-w-md space-y-6">
      <PageHeader title="عميل جديد" description="الاسم والجوال كافيان للبدء." />
      <form
        className="space-y-4 rounded-lg border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(new FormData(e.currentTarget));
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="name">الاسم</Label>
          <Input id="name" name="name" required autoComplete="name" className="h-10" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mobile">الجوال</Label>
          <Input id="mobile" name="mobile" required inputMode="tel" autoComplete="tel" className="h-10" dir="ltr" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="address">العنوان (اختياري)</Label>
          <Input id="address" name="address" className="h-10" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="notes">ملاحظة (اختياري)</Label>
          <Input id="notes" name="notes" className="h-10" />
        </div>
        {can("customers.edit") ? (
          <div className="space-y-2">
            <Label htmlFor="creditLimitAed">حد الائتمان (درهم) — 0 يعني بدون حد</Label>
            <Input
              id="creditLimitAed"
              name="creditLimitAed"
              type="number"
              min={0}
              step={0.01}
              placeholder="0.00"
              className="h-10"
              dir="ltr"
            />
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2 pt-2">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "جاري الحفظ…" : "حفظ"}
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link to="/customers">إلغاء</Link>
          </Button>
        </div>
        {save.isError ? <p className="text-sm text-destructive">تعذّر الحفظ (ربما الجوال مسجّل).</p> : null}
      </form>
    </div>
  );
}
