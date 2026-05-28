import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { formatAED } from "@/lib/money";
import { JOB_STAGE_LABELS, WORK_TYPES } from "@abaya-shop/shared";
import { workTypeLabel } from "@/lib/jobOrderUi";

export function WorkerDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [payoutAed, setPayoutAed] = useState("");
  const [payoutMethod, setPayoutMethod] = useState("CASH");
  const [payoutNotes, setPayoutNotes] = useState("");
  const [adjAed, setAdjAed] = useState("");
  const [adjReason, setAdjReason] = useState("");
  const [laborForm, setLaborForm] = useState({
    jobOrderId: "",
    workType: "SEW_BASIC",
    qty: "1",
    rateAed: "",
    notes: "",
  });
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const { data, isLoading } = useQuery({
    queryKey: ["worker", id],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, unknown> }>(`/workers/${id}`);
      return res.data.data;
    },
    enabled: Boolean(id),
  });

  const { data: rangeSummary } = useQuery({
    queryKey: ["workers", "summary", id, from, to],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { items: Array<{ workerId: string; earnedFils: number; dueFils: number; taskCount: number }> };
      }>("/workers/summary", {
        params: {
          workerId: id,
          from: new Date(from + "T00:00:00").toISOString(),
          to: new Date(to + "T23:59:59").toISOString(),
        },
      });
      const items = res.data.data.items;
      return (
        items[0] ?? {
          workerId: id!,
          earnedFils: 0,
          payoutFils: 0,
          adjustmentFils: 0,
          dueFils: 0,
          taskCount: 0,
        }
      );
    },
    enabled: Boolean(id),
  });

  const addPayout = useMutation({
    mutationFn: async () => {
      const amountFils = Math.round((parseFloat(payoutAed) || 0) * 100);
      if (amountFils <= 0) throw new Error("أدخل مبلغاً صحيحاً");
      await api.post(`/workers/${id}/payouts`, {
        amountFils,
        method: payoutMethod,
        notes: payoutNotes.trim() || undefined,
      });
    },
    onSuccess: () => {
      setPayoutAed("");
      setPayoutNotes("");
      void queryClient.invalidateQueries({ queryKey: ["worker", id] });
      void queryClient.invalidateQueries({ queryKey: ["workers"] });
    },
  });

  const addAdjustment = useMutation({
    mutationFn: async () => {
      const amountFils = Math.round((parseFloat(adjAed) || 0) * 100);
      if (amountFils === 0) throw new Error("أدخل مبلغاً غير صفر");
      if (!adjReason.trim()) throw new Error("أدخل سبب التعديل");
      await api.post(`/workers/${id}/adjustments`, {
        amountFils,
        reason: adjReason.trim(),
      });
    },
    onSuccess: () => {
      setAdjAed("");
      setAdjReason("");
      void queryClient.invalidateQueries({ queryKey: ["worker", id] });
      void queryClient.invalidateQueries({ queryKey: ["workers"] });
    },
  });

  const addLabor = useMutation({
    mutationFn: async () => {
      const qty = parseInt(laborForm.qty, 10) || 1;
      const rateFils = Math.round((parseFloat(laborForm.rateAed) || 0) * 100);
      await api.post(`/workers/${id}/production-entries`, {
        jobOrderId: laborForm.jobOrderId.trim() || null,
        workType: laborForm.workType,
        qty,
        rateFils,
        notes: laborForm.notes.trim() || undefined,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["worker", id] });
      void queryClient.invalidateQueries({ queryKey: ["job-orders"] });
      setLaborForm((f) => ({ ...f, qty: "1", rateAed: "", notes: "" }));
    },
  });

  const deletePayout = useMutation({
    mutationFn: async (payoutId: string) => {
      await api.delete(`/workers/${id}/payouts/${payoutId}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["worker", id] });
      void queryClient.invalidateQueries({ queryKey: ["workers"] });
    },
  });

  if (!id) return null;

  if (isLoading || !data) {
    return (
      <div>
        <PageHeader title="عامل" />
        <p className="text-sm text-muted-foreground">جاري التحميل…</p>
      </div>
    );
  }

  const balance = data.balance as {
    earnedFils: number;
    payoutFils: number;
    adjustmentFils: number;
    dueFils: number;
  };
  const productions = (data.productions as Array<Record<string, unknown>>) ?? [];
  const payouts = (data.payouts as Array<Record<string, unknown>>) ?? [];
  const adjustments = (data.balanceAdjustments as Array<Record<string, unknown>>) ?? [];
  const assignments = (data.assignments as Array<Record<string, unknown>>) ?? [];

  let specsDisplay = "—";
  try {
    if (data.specializations) {
      const p = JSON.parse(String(data.specializations));
      if (Array.isArray(p)) specsDisplay = p.map((x: string) => workTypeLabel(x)).join("، ");
    }
  } catch {
    specsDisplay = String(data.specializations ?? "—");
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title={String(data.name)}
        description={`${String(data.role)} — ${data.phone ? String(data.phone) : "بدون جوال"}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to={`/workers/${id}/edit`}>تعديل البيانات والأسعار</Link>
            </Button>
            <Link to="/workers" className="text-sm text-brand-700 underline">
              رجوع للقائمة
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-3 font-semibold">ملخص المستحقات (كل الفترات)</h2>
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between">
              <span className="text-muted-foreground">إجمالي أجور القطع المسجّلة</span>
              <span className="font-medium">{formatAED(balance.earnedFils)}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-muted-foreground">تعديلات يدوية (±)</span>
              <span className="font-medium">{formatAED(balance.adjustmentFils)}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-muted-foreground">دفعات للعامل</span>
              <span className="font-medium">{formatAED(balance.payoutFils)}</span>
            </li>
            <li className="flex justify-between border-t pt-2 text-lg font-bold text-amber-900 dark:text-amber-100">
              <span>المتبقي المستحق</span>
              <span>{formatAED(balance.dueFils)}</span>
            </li>
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            المتبقي = الأجور + التعديلات − الدفعات. سجّل دفعة عند دفع كاش أو تحويل للعامل.
          </p>
        </section>

        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-2 font-semibold">الفترة المحددة</h2>
          <div className="mb-3 flex flex-wrap gap-2">
            <Input type="date" className="h-9 w-[140px]" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input type="date" className="h-9 w-[140px]" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          {rangeSummary ? (
            <ul className="space-y-1 text-sm">
              <li className="flex justify-between">
                <span className="text-muted-foreground">أجور في الفترة</span>
                <span>{formatAED(rangeSummary.earnedFils)}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-muted-foreground">عدد السجلات (قطع/مهام)</span>
                <span>{rangeSummary.taskCount}</span>
              </li>
              <li className="flex justify-between font-medium">
                <span className="text-muted-foreground">صافي الفترة (بعد دفعات/تعديلات الفترة)</span>
                <span>{formatAED(rangeSummary.dueFils)}</span>
              </li>
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">اختر تواريخاً لعرض ملخص الفترة.</p>
          )}
        </section>
      </div>

      <section className="rounded-xl border bg-muted/30 p-4">
        <h2 className="mb-2 font-semibold">بيانات إضافية</h2>
        <p className="text-sm">
          <span className="text-muted-foreground">التخصص: </span>
          {specsDisplay}
        </p>
        {data.notes ? (
          <p className="mt-2 text-sm whitespace-pre-wrap">
            <span className="text-muted-foreground">ملاحظات: </span>
            {String(data.notes)}
          </p>
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-2 font-semibold">تسجيل دفعة للعامل</h2>
          <div className="flex flex-wrap gap-2">
            <Input
              className="h-9 w-28"
              placeholder="مبلغ AED"
              value={payoutAed}
              onChange={(e) => setPayoutAed(e.target.value)}
            />
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={payoutMethod}
              onChange={(e) => setPayoutMethod(e.target.value)}
            >
              <option value="CASH">كاش</option>
              <option value="TRANSFER">تحويل</option>
            </select>
            <Input
              className="h-9 flex-1 min-w-[120px]"
              placeholder="ملاحظة"
              value={payoutNotes}
              onChange={(e) => setPayoutNotes(e.target.value)}
            />
            <Button type="button" size="sm" disabled={addPayout.isPending} onClick={() => addPayout.mutate()}>
              تسجيل دفعة
            </Button>
          </div>
          {addPayout.isError ? (
            <p className="mt-1 text-xs text-destructive">{(addPayout.error as Error).message}</p>
          ) : null}
        </section>

        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-2 font-semibold">تعديل يدوي على الرصيد</h2>
          <p className="mb-2 text-xs text-muted-foreground">
            موجب = نزيد المستحقات (مكافأة)، سالب = ننقصها (خصم متفق عليه).
          </p>
          <div className="flex flex-wrap gap-2">
            <Input
              className="h-9 w-28"
              placeholder="± AED"
              value={adjAed}
              onChange={(e) => setAdjAed(e.target.value)}
            />
            <Input
              className="h-9 flex-1 min-w-[140px]"
              placeholder="السبب"
              value={adjReason}
              onChange={(e) => setAdjReason(e.target.value)}
            />
            <Button type="button" size="sm" disabled={addAdjustment.isPending} onClick={() => addAdjustment.mutate()}>
              إضافة
            </Button>
          </div>
          {addAdjustment.isError ? (
            <p className="mt-1 text-xs text-destructive">{(addAdjustment.error as Error).message}</p>
          ) : null}
        </section>
      </div>

      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-2 font-semibold">سجل الدفعات</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-2 py-2 text-start">التاريخ</th>
                <th className="px-2 py-2 text-end">المبلغ</th>
                <th className="px-2 py-2 text-start">طريقة</th>
                <th className="px-2 py-2 text-start">ملاحظة</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {payouts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">
                    لا دفعات مسجّلة.
                  </td>
                </tr>
              ) : (
                payouts.map((p) => (
                  <tr key={String(p.id)} className="border-b">
                    <td className="px-2 py-2">{new Date(p.paidAt as string).toLocaleString()}</td>
                    <td className="px-2 py-2 text-end">{formatAED(p.amountFils as number)}</td>
                    <td className="px-2 py-2">{String(p.method ?? "—")}</td>
                    <td className="px-2 py-2 text-muted-foreground">{String(p.notes ?? "—")}</td>
                    <td className="px-2 py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => {
                          if (confirm("حذف سجل الدفعة؟")) deletePayout.mutate(String(p.id));
                        }}
                      >
                        حذف
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-2 font-semibold">التعديلات اليدوية</h2>
        <ul className="space-y-2 text-sm">
          {adjustments.length === 0 ? (
            <li className="text-muted-foreground">لا تعديلات.</li>
          ) : (
            adjustments.map((a) => (
              <li key={String(a.id)} className="flex justify-between gap-2 border-b pb-2">
                <span>{formatAED(a.amountFils as number)}</span>
                <span className="text-muted-foreground">{String(a.reason)}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(a.createdAt as string).toLocaleString()}
                </span>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-2 font-semibold">طلبات مُعيَّن عليها</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-2 py-2 text-start">طلب</th>
                <th className="px-2 py-2 text-start">الدور</th>
                <th className="px-2 py-2 text-start">المرحلة</th>
                <th className="px-2 py-2 text-start">التسليم</th>
              </tr>
            </thead>
            <tbody>
              {assignments.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">
                    لا تعيينات من طلبات التفصيل.
                  </td>
                </tr>
              ) : (
                assignments.map((a) => {
                  const job = a.jobOrder as {
                    id: string;
                    jobNo: number;
                    productStyle: string;
                    stage: string;
                    dueDate: string;
                    invoiceId: string | null;
                    customer: { name: string };
                  };
                  return (
                    <tr key={String(a.id)} className="border-b">
                      <td className="px-2 py-2">
                        <Link
                          className="text-brand-700 underline"
                          to={
                            job.invoiceId ? `/invoices/${job.invoiceId}` : `/job-orders/${job.id}`
                          }
                        >
                          #{job.jobNo} {job.productStyle}
                        </Link>
                        <div className="text-xs text-muted-foreground">{job.customer?.name}</div>
                      </td>
                      <td className="px-2 py-2">{workTypeLabel(String(a.workType))}</td>
                      <td className="px-2 py-2">{JOB_STAGE_LABELS[job.stage] ?? job.stage}</td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        {new Date(job.dueDate).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-2 font-semibold">تسجيل عمل منجز (قطعة / أجور)</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          يُفضّل الربط برقم الطلب إن وُجد؛ يمكن ترك الطلب فارغاً لعمل عام.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <Input
            className="h-9 w-36 font-mono text-xs"
            placeholder="معرّف الطلب (اختياري)"
            value={laborForm.jobOrderId}
            onChange={(e) => setLaborForm((f) => ({ ...f, jobOrderId: e.target.value }))}
          />
          <select
            className="h-9 w-40 rounded-md border bg-background px-2 text-sm"
            value={laborForm.workType}
            onChange={(e) => setLaborForm((f) => ({ ...f, workType: e.target.value }))}
          >
            {WORK_TYPES.map((wt) => (
              <option key={wt} value={wt}>
                {workTypeLabel(wt)}
              </option>
            ))}
          </select>
          <Input
            className="h-9 w-14"
            placeholder="كم"
            value={laborForm.qty}
            onChange={(e) => setLaborForm((f) => ({ ...f, qty: e.target.value }))}
          />
          <Input
            className="h-9 w-24"
            placeholder="سعر القطعة"
            value={laborForm.rateAed}
            onChange={(e) => setLaborForm((f) => ({ ...f, rateAed: e.target.value }))}
          />
          <Input
            className="h-9 flex-1 min-w-[100px]"
            placeholder="ملاحظة"
            value={laborForm.notes}
            onChange={(e) => setLaborForm((f) => ({ ...f, notes: e.target.value }))}
          />
          <Button type="button" size="sm" disabled={addLabor.isPending} onClick={() => addLabor.mutate()}>
            تسجيل
          </Button>
        </div>
        {addLabor.isError ? (
          <p className="mt-1 text-xs text-destructive">{(addLabor.error as Error).message}</p>
        ) : null}
      </section>

      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-2 font-semibold">سجل الأجور (إنتاج)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-2 py-2 text-start">التاريخ</th>
                <th className="px-2 py-2 text-start">الطلب</th>
                <th className="px-2 py-2 text-start">النوع</th>
                <th className="px-2 py-2 text-end">الكمية</th>
                <th className="px-2 py-2 text-end">الأجور</th>
              </tr>
            </thead>
            <tbody>
              {productions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-2 py-8 text-center text-muted-foreground">
                    لا سجلات بعد.
                  </td>
                </tr>
              ) : (
                productions.map((p) => {
                  const job = p.jobOrder as {
                    id: string;
                    jobNo: number;
                    invoiceId: string | null;
                  } | null;
                  return (
                    <tr key={String(p.id)} className="border-b">
                      <td className="px-2 py-2 text-muted-foreground">
                        {new Date(p.date as string).toLocaleString()}
                      </td>
                      <td className="px-2 py-2">
                        {job ? (
                          <Link
                            className="text-brand-700 underline"
                            to={
                              job.invoiceId ? `/invoices/${job.invoiceId}` : `/job-orders/${job.id}`
                            }
                          >
                            #{job.jobNo}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-2 py-2">{workTypeLabel(String(p.workType))}</td>
                      <td className="px-2 py-2 text-end">{String(p.qty)}</td>
                      <td className="px-2 py-2 text-end font-medium">{formatAED(p.totalFils as number)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
