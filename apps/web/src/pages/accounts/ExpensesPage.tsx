import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { formatAED } from "@/lib/money";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";

export function ExpensesPage() {
  const { can } = usePermissions();
  const queryClient = useQueryClient();

  const { data: categories } = useQuery({
    queryKey: ["expense-categories"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: { id: string; name: string }[] }>(
        "/expenses/categories",
      );
      return res.data.data;
    },
  });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["expenses"],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: {
          items: Array<{
            id: string;
            description: string;
            notes: string | null;
            amountFils: number;
            date: string;
            category: { name: string };
          }>;
        };
      }>("/expenses", { params: { limit: 100 } });
      return res.data.data.items;
    },
  });

  const create = useMutation({
    mutationFn: async (form: FormData) => {
      const amountAed = parseFloat(String(form.get("amount"))) || 0;
      const dateStr = String(form.get("date") ?? "").trim();
      await api.post("/expenses", {
        categoryId: String(form.get("categoryId")),
        amountFils: Math.round(amountAed * 100),
        description: String(form.get("description") ?? "").trim(),
        notes: String(form.get("notes") ?? "").trim() || undefined,
        ...(dateStr ? { date: new Date(dateStr).toISOString() } : {}),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["expenses"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard", "stats"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
  });

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        title="المصاريف"
        description="سجّل مصروفاً تشغيلياً بسرعة: فئة، عنوان، مبلغ، وتاريخ."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/accounts">الحركة المالية</Link>
            </Button>
            <Button variant="secondary" size="sm" asChild>
              <Link to="/reports">التقارير</Link>
            </Button>
          </div>
        }
      />

      <form
        className="space-y-3 rounded-lg border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!can("expenses.create")) return;
          create.mutate(new FormData(e.currentTarget));
          (e.currentTarget as HTMLFormElement).reset();
          const dateEl = (e.currentTarget as HTMLFormElement).querySelector<HTMLInputElement>('[name="date"]');
          if (dateEl) dateEl.value = todayStr;
        }}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <Label htmlFor="categoryId">الفئة</Label>
            <select
              id="categoryId"
              name="categoryId"
              required
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">— اختر —</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="amount">المبلغ (درهم)</Label>
            <Input id="amount" name="amount" type="number" step={0.01} min={0.01} required className="mt-1" />
          </div>
        </div>
        <div>
          <Label htmlFor="description">عنوان المصروف</Label>
          <Input
            id="description"
            name="description"
            required
            placeholder="مثلاً: إيجار يناير، كهرباء الشهر، شراء قماش…"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="notes">ملاحظات (اختياري)</Label>
          <textarea
            id="notes"
            name="notes"
            rows={2}
            className={cn(
              "mt-1 flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
              "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
            placeholder="تفاصيل إضافية، مرجع، مورد…"
          />
        </div>
        <div className="grid gap-2 sm:max-w-xs">
          <Label htmlFor="date">تاريخ المصروف</Label>
          <Input id="date" name="date" type="date" required className="mt-1" defaultValue={todayStr} />
        </div>
        <Button type="submit" size="sm" disabled={create.isPending || !can("expenses.create")}>
          {create.isPending ? "…" : "تسجيل مصروف"}
        </Button>
        {!can("expenses.create") ? (
          <p className="text-xs text-muted-foreground">لا تملك صلاحية تسجيل مصروف جديد.</p>
        ) : null}
      </form>

      <div>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">آخر المصاريف</h2>
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-start font-medium">التاريخ</th>
                <th className="px-4 py-3 text-start font-medium">الفئة</th>
                <th className="px-4 py-3 text-start font-medium">العنوان</th>
                <th className="px-4 py-3 text-start font-medium">ملاحظات</th>
                <th className="px-4 py-3 text-end font-medium">المبلغ</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    جاري التحميل…
                  </td>
                </tr>
              ) : !rows?.length ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    لا مصاريف مسجّلة.
                  </td>
                </tr>
              ) : (
                rows.map((e) => (
                  <tr key={e.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {new Date(e.date).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2.5">{e.category.name}</td>
                    <td className="px-4 py-2.5">{e.description}</td>
                    <td className="max-w-[200px] px-4 py-2.5 text-xs text-muted-foreground">
                      {e.notes?.trim() || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-end">{formatAED(e.amountFils)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
