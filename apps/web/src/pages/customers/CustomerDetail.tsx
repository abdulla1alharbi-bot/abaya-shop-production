import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { formatAED } from "@/lib/money";

type CustomerNoteRow = {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string; username: string };
};

function tierBadge(tier: string): { label: string; cls: string } {
  if (tier === "GOLD")
    return {
      label: "🏆 ذهبي",
      cls: "bg-yellow-100 text-yellow-900 border-yellow-400 dark:bg-yellow-950/40 dark:text-yellow-200",
    };
  if (tier === "SILVER")
    return {
      label: "🥈 فضي",
      cls: "bg-zinc-200 text-zinc-900 border-zinc-400 dark:bg-zinc-800 dark:text-zinc-200",
    };
  return {
    label: "🥉 برونزي",
    cls: "bg-orange-100 text-orange-900 border-orange-400 dark:bg-orange-950/40 dark:text-orange-200",
  };
}

export function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [newNote, setNewNote] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["customer", id],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, unknown> }>(`/customers/${id}`);
      return res.data.data;
    },
    enabled: Boolean(id),
  });

  const saveMeasurement = useMutation({
    mutationFn: async (form: FormData) => {
      await api.post(`/customers/${id}/measurements`, {
        label: String(form.get("mlabel") ?? "").trim() || undefined,
        shoulder: num(form, "shoulder"),
        chest: num(form, "chest"),
        waist: num(form, "waist"),
        hip: num(form, "hip"),
        length: num(form, "length"),
        sleeve: num(form, "sleeve"),
        notes: String(form.get("mnotes") ?? "").trim() || undefined,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customer", id] });
    },
  });

  const addNote = useMutation({
    mutationFn: async (body: string) => {
      await api.post(`/customers/${id}/notes`, { body });
    },
    onSuccess: () => {
      setNewNote("");
      void queryClient.invalidateQueries({ queryKey: ["customer", id] });
    },
  });

  const deleteNote = useMutation({
    mutationFn: async (noteId: string) => {
      await api.delete(`/customers/notes/${noteId}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customer", id] });
    },
  });

  function num(form: FormData, key: string): number | undefined {
    const v = String(form.get(key) ?? "").trim();
    if (!v) return undefined;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }

  if (!id) return null;

  if (isLoading || !data) {
    return (
      <div>
        <PageHeader title="عميل" />
        <p className="text-sm text-muted-foreground">جاري التحميل…</p>
      </div>
    );
  }

  const invoices = (data.invoices as Array<Record<string, unknown>>) ?? [];
  const jobs = (data.jobOrders as Array<Record<string, unknown>>) ?? [];
  const measurements = (data.measurements as Array<Record<string, unknown>>) ?? [];
  const notes = (data.customerNotes as CustomerNoteRow[] | undefined) ?? [];

  const lifetimeValueFils = (data.lifetimeValueFils as number) ?? 0;
  const orderCount = (data.orderCount as number) ?? 0;
  const aov = (data.averageOrderValueFils as number) ?? 0;
  const lastVisitAt = data.lastVisitAt as string | null | undefined;
  const tier = (data.tier as string) ?? "BRONZE";
  const creditLimitFils = (data.creditLimitFils as number) ?? 0;
  const balanceFils = (data.balanceFils as number) ?? 0;
  const tierInfo = tierBadge(tier);

  return (
    <div className="space-y-8">
      <PageHeader
        title={String(data.name)}
        description={`${String(data.mobile)} · كود ${String(data.code)}`}
        actions={
          <Link to="/customers" className="text-sm text-brand-700 underline">
            رجوع
          </Link>
        }
      />

      {/* Phase 3 F7: Customer KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" dir="rtl">
        <div className="rounded-lg border-2 p-3 text-center">
          <p className="text-xs text-muted-foreground">القيمة الإجمالية (LTV)</p>
          <p className="mt-1 text-base font-bold">{formatAED(lifetimeValueFils)}</p>
        </div>
        <div className="rounded-lg border-2 p-3 text-center">
          <p className="text-xs text-muted-foreground">عدد الطلبات</p>
          <p className="mt-1 text-base font-bold">{orderCount}</p>
        </div>
        <div className="rounded-lg border-2 p-3 text-center">
          <p className="text-xs text-muted-foreground">متوسط الطلب</p>
          <p className="mt-1 text-base font-bold">{formatAED(aov)}</p>
        </div>
        <div className="rounded-lg border-2 p-3 text-center">
          <p className="text-xs text-muted-foreground">آخر زيارة</p>
          <p className="mt-1 text-sm font-bold">
            {lastVisitAt ? new Date(lastVisitAt).toLocaleDateString("ar-AE") : "—"}
          </p>
        </div>
        <div className={`rounded-lg border-2 p-3 text-center ${tierInfo.cls}`}>
          <p className="text-xs">المستوى</p>
          <p className="mt-1 text-base font-bold">{tierInfo.label}</p>
        </div>
      </div>

      <div className="rounded-lg border bg-muted/20 p-3 text-sm" dir="rtl">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <p>
            <span className="text-muted-foreground">رصيد مستحق: </span>
            <span className={`font-semibold ${balanceFils > 0 ? "text-amber-700 dark:text-amber-300" : ""}`}>
              {formatAED(balanceFils)}
            </span>
          </p>
          <p>
            <span className="text-muted-foreground">حد الائتمان: </span>
            <span className="font-semibold">
              {creditLimitFils > 0 ? formatAED(creditLimitFils) : "— غير محدد"}
            </span>
          </p>
          {data.address ? (
            <p>
              <span className="text-muted-foreground">العنوان: </span>
              {String(data.address)}
            </p>
          ) : null}
        </div>
      </div>

      <div>
        <h2 className="mb-2 font-medium">قياسات محفوظة</h2>
        <div className="mb-4 space-y-2">
          {measurements.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا قياسات بعد.</p>
          ) : (
            measurements.map((m) => (
              <div key={String(m.id)} className="rounded-md border bg-muted/30 p-3 text-xs">
                {m.label ? (
                  <p className="mb-2 font-medium text-foreground">{String(m.label)}</p>
                ) : null}
                <div className="grid grid-cols-3 gap-1 sm:grid-cols-6">
                  {["shoulder", "chest", "waist", "hip", "length", "sleeve"].map((k) =>
                    m[k] != null ? (
                      <span key={k}>
                        {k}: {String(m[k])}
                      </span>
                    ) : null,
                  )}
                </div>
                {m.notes ? <p className="mt-1 text-muted-foreground">{String(m.notes)}</p> : null}
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {new Date((m.updatedAt as string) ?? (m.createdAt as string)).toLocaleString()}
                </p>
              </div>
            ))
          )}
        </div>
        <form
          className="grid max-w-xl gap-2 rounded-md border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            saveMeasurement.mutate(new FormData(e.currentTarget));
          }}
        >
          <p className="text-sm font-medium">إضافة قياس جديد</p>
          <div>
            <Label htmlFor="mlabel">اسم المجموعة (اختياري)</Label>
            <Input id="mlabel" name="mlabel" placeholder="مثال: مقاس رسمي / صيف 2025" className="mt-1" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Input name="shoulder" placeholder="كتف" type="number" step={0.1} />
            <Input name="chest" placeholder="صدر" type="number" step={0.1} />
            <Input name="waist" placeholder="وسط" type="number" step={0.1} />
            <Input name="hip" placeholder="ورك" type="number" step={0.1} />
            <Input name="length" placeholder="طول" type="number" step={0.1} />
            <Input name="sleeve" placeholder="كم" type="number" step={0.1} />
          </div>
          <div>
            <Label htmlFor="mnotes">ملاحظات القياس</Label>
            <Input id="mnotes" name="mnotes" />
          </div>
          <Button type="submit" size="sm" disabled={saveMeasurement.isPending}>
            حفظ القياس
          </Button>
        </form>
      </div>

      {/* Phase 3 F7: Communication log */}
      <div dir="rtl">
        <h2 className="mb-2 font-medium">ملاحظات وسجل التواصل ({notes.length})</h2>
        <form
          className="mb-3 flex gap-2 rounded-md border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const v = newNote.trim();
            if (v) addNote.mutate(v);
          }}
        >
          <Input
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="مثال: تم الاتصال — يستلم الطلب الخميس / طلب تخفيض السعر"
            className="flex-1"
          />
          <Button type="submit" size="sm" disabled={!newNote.trim() || addNote.isPending}>
            {addNote.isPending ? "..." : "إضافة"}
          </Button>
        </form>
        <div className="space-y-2">
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا ملاحظات مسجلة.</p>
          ) : (
            notes.map((n) => (
              <div key={n.id} className="flex items-start gap-3 rounded-md border bg-muted/20 p-3 text-sm">
                <div className="flex-1">
                  <p className="whitespace-pre-wrap">{n.body}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {n.author.name} · {new Date(n.createdAt).toLocaleString("ar-AE")}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-destructive"
                  disabled={deleteNote.isPending}
                  onClick={() => {
                    if (window.confirm("حذف هذه الملاحظة؟")) deleteNote.mutate(n.id);
                  }}
                >
                  حذف
                </Button>
              </div>
            ))
          )}
        </div>
      </div>

      <div>
        <h2 className="mb-2 font-medium">الفواتير</h2>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-2 text-left">فاتورة</th>
                <th className="px-4 py-2 text-right">الإجمالي</th>
                <th className="px-4 py-2 text-right">متبقي</th>
                <th className="px-4 py-2 text-left">التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-4 text-muted-foreground">
                    لا فواتير.
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={String(inv.id)} className="border-b last:border-0">
                    <td className="px-4 py-2">
                      <Link
                        to={`/invoices/${String(inv.id)}`}
                        className="font-mono text-brand-700 underline"
                      >
                        #{String(inv.invoiceNo)}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-right">{formatAED(inv.totalFils as number)}</td>
                    <td className="px-4 py-2 text-right">{formatAED(inv.balanceFils as number)}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {new Date(inv.createdAt as string).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="mb-2 font-medium">طلبات تفصيل سابقة</h2>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-2 text-left">طلب</th>
                <th className="px-4 py-2 text-left">المرحلة</th>
                <th className="px-4 py-2 text-right">البيع</th>
                <th className="px-4 py-2 text-right">متبقي</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-4 text-muted-foreground">
                    لا طلبات تفصيل.
                  </td>
                </tr>
              ) : (
                jobs.map((j) => (
                  <tr key={String(j.id)} className="border-b last:border-0">
                    <td className="px-4 py-2 font-mono">#{String(j.jobNo)}</td>
                    <td className="px-4 py-2">{String(j.stage)}</td>
                    <td className="px-4 py-2 text-right">{formatAED(j.totalFils as number)}</td>
                    <td className="px-4 py-2 text-right">{formatAED(j.balanceFils as number)}</td>
                    <td className="px-4 py-2">
                      <Link
                        className="text-brand-700 underline"
                        to={
                          j.invoiceId
                            ? `/invoices/${String(j.invoiceId)}`
                            : `/job-orders/${String(j.id)}`
                        }
                      >
                        الفاتورة
                      </Link>
                    </td>
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
