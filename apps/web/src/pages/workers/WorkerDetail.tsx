import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
      if (amountFils <= 0) throw new Error(t("workers.errorInvalidAmount"));
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
      if (amountFils === 0) throw new Error(t("workers.errorNonZeroAmount"));
      if (!adjReason.trim()) throw new Error(t("workers.errorReasonRequired"));
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
        <PageHeader title={t("workers.workerLabel")} />
        <p className="text-sm text-muted-foreground">{t("common.loadingData")}</p>
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
      if (Array.isArray(p)) specsDisplay = p.map((x: string) => workTypeLabel(x, t)).join(", ");
    }
  } catch {
    specsDisplay = String(data.specializations ?? "—");
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title={String(data.name)}
        description={`${String(data.role)} — ${data.phone ? String(data.phone) : t("common.noPhone")}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to={`/workers/${id}/edit`}>{t("workers.editDataBtn")}</Link>
            </Button>
            <Link to="/workers" className="text-sm text-brand-700 underline">
              {t("common.backToList")}
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-3 font-semibold">{t("workers.balanceSummaryTitle")}</h2>
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between">
              <span className="text-muted-foreground">{t("workers.totalEarned")}</span>
              <span className="font-medium">{formatAED(balance.earnedFils)}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-muted-foreground">{t("workers.manualAdjustments")}</span>
              <span className="font-medium">{formatAED(balance.adjustmentFils)}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-muted-foreground">{t("workers.payoutsToWorker")}</span>
              <span className="font-medium">{formatAED(balance.payoutFils)}</span>
            </li>
            <li className="flex justify-between border-t pt-2 text-lg font-bold text-amber-900 dark:text-amber-100">
              <span>{t("workers.remainingDue")}</span>
              <span>{formatAED(balance.dueFils)}</span>
            </li>
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">{t("workers.balanceNote")}</p>
        </section>

        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-2 font-semibold">{t("workers.periodTitle")}</h2>
          <div className="mb-3 flex flex-wrap gap-2">
            <Input type="date" className="h-9 w-[140px]" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input type="date" className="h-9 w-[140px]" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          {rangeSummary ? (
            <ul className="space-y-1 text-sm">
              <li className="flex justify-between">
                <span className="text-muted-foreground">{t("workers.wagesInPeriod")}</span>
                <span>{formatAED(rangeSummary.earnedFils)}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-muted-foreground">{t("workers.recordsInPeriod")}</span>
                <span>{rangeSummary.taskCount}</span>
              </li>
              <li className="flex justify-between font-medium">
                <span className="text-muted-foreground">{t("workers.netPeriod")}</span>
                <span>{formatAED(rangeSummary.dueFils)}</span>
              </li>
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">{t("workers.selectDates")}</p>
          )}
        </section>
      </div>

      <section className="rounded-xl border bg-muted/30 p-4">
        <h2 className="mb-2 font-semibold">{t("workers.extraInfoTitle")}</h2>
        <p className="text-sm">
          <span className="text-muted-foreground">{t("workers.specialty")}</span>
          {specsDisplay}
        </p>
        {data.notes ? (
          <p className="mt-2 text-sm whitespace-pre-wrap">
            <span className="text-muted-foreground">{t("workers.notes")}</span>
            {String(data.notes)}
          </p>
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-2 font-semibold">{t("workers.recordPayoutTitle")}</h2>
          <div className="flex flex-wrap gap-2">
            <Input
              className="h-9 w-28"
              placeholder={t("workers.amountPlaceholder")}
              value={payoutAed}
              onChange={(e) => setPayoutAed(e.target.value)}
            />
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={payoutMethod}
              onChange={(e) => setPayoutMethod(e.target.value)}
            >
              <option value="CASH">{t("common.cash")}</option>
              <option value="TRANSFER">{t("common.transfer")}</option>
            </select>
            <Input
              className="h-9 flex-1 min-w-[120px]"
              placeholder={t("workers.notePlaceholder")}
              value={payoutNotes}
              onChange={(e) => setPayoutNotes(e.target.value)}
            />
            <Button type="button" size="sm" disabled={addPayout.isPending} onClick={() => addPayout.mutate()}>
              {t("workers.recordPayout")}
            </Button>
          </div>
          {addPayout.isError ? (
            <p className="mt-1 text-xs text-destructive">{(addPayout.error as Error).message}</p>
          ) : null}
        </section>

        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-2 font-semibold">{t("workers.manualAdjTitle")}</h2>
          <p className="mb-2 text-xs text-muted-foreground">{t("workers.manualAdjNote")}</p>
          <div className="flex flex-wrap gap-2">
            <Input
              className="h-9 w-28"
              placeholder="± AED"
              value={adjAed}
              onChange={(e) => setAdjAed(e.target.value)}
            />
            <Input
              className="h-9 flex-1 min-w-[140px]"
              placeholder={t("workers.reasonPlaceholder")}
              value={adjReason}
              onChange={(e) => setAdjReason(e.target.value)}
            />
            <Button type="button" size="sm" disabled={addAdjustment.isPending} onClick={() => addAdjustment.mutate()}>
              {t("common.add")}
            </Button>
          </div>
          {addAdjustment.isError ? (
            <p className="mt-1 text-xs text-destructive">{(addAdjustment.error as Error).message}</p>
          ) : null}
        </section>
      </div>

      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-2 font-semibold">{t("workers.payoutsLogTitle")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-2 py-2 text-start">{t("workers.colDate")}</th>
                <th className="px-2 py-2 text-end">{t("workers.colAmount")}</th>
                <th className="px-2 py-2 text-start">{t("workers.colMethod")}</th>
                <th className="px-2 py-2 text-start">{t("workers.colNote")}</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {payouts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">
                    {t("workers.noPayouts")}
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
                          if (confirm(t("workers.confirmDeletePayout"))) deletePayout.mutate(String(p.id));
                        }}
                      >
                        {t("common.delete")}
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
        <h2 className="mb-2 font-semibold">{t("workers.adjustmentsTitle")}</h2>
        <ul className="space-y-2 text-sm">
          {adjustments.length === 0 ? (
            <li className="text-muted-foreground">{t("workers.noAdjustments")}</li>
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
        <h2 className="mb-2 font-semibold">{t("workers.assignmentsTitle")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-2 py-2 text-start">{t("workers.colOrder")}</th>
                <th className="px-2 py-2 text-start">{t("workers.colRole")}</th>
                <th className="px-2 py-2 text-start">{t("workers.colStage")}</th>
                <th className="px-2 py-2 text-start">{t("workers.colDelivery")}</th>
              </tr>
            </thead>
            <tbody>
              {assignments.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">
                    {t("workers.noAssignments")}
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
                      <td className="px-2 py-2">{workTypeLabel(String(a.workType), t)}</td>
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
        <h2 className="mb-2 font-semibold">{t("workers.recordLaborTitle")}</h2>
        <p className="mb-3 text-xs text-muted-foreground">{t("workers.recordLaborNote")}</p>
        <div className="flex flex-wrap items-end gap-2">
          <Input
            className="h-9 w-36 font-mono text-xs"
            placeholder={t("workers.jobIdPlaceholder")}
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
                {workTypeLabel(wt, t)}
              </option>
            ))}
          </select>
          <Input
            className="h-9 w-14"
            placeholder={t("workers.qtyPlaceholder")}
            value={laborForm.qty}
            onChange={(e) => setLaborForm((f) => ({ ...f, qty: e.target.value }))}
          />
          <Input
            className="h-9 w-24"
            placeholder={t("workers.piecePricePlaceholder")}
            value={laborForm.rateAed}
            onChange={(e) => setLaborForm((f) => ({ ...f, rateAed: e.target.value }))}
          />
          <Input
            className="h-9 flex-1 min-w-[100px]"
            placeholder={t("workers.notePlaceholder")}
            value={laborForm.notes}
            onChange={(e) => setLaborForm((f) => ({ ...f, notes: e.target.value }))}
          />
          <Button type="button" size="sm" disabled={addLabor.isPending} onClick={() => addLabor.mutate()}>
            {t("workers.recordBtn")}
          </Button>
        </div>
        {addLabor.isError ? (
          <p className="mt-1 text-xs text-destructive">{(addLabor.error as Error).message}</p>
        ) : null}
      </section>

      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-2 font-semibold">{t("workers.wagesLogTitle")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-2 py-2 text-start">{t("workers.colDate")}</th>
                <th className="px-2 py-2 text-start">{t("workers.colOrder")}</th>
                <th className="px-2 py-2 text-start">{t("workers.colType")}</th>
                <th className="px-2 py-2 text-end">{t("workers.colQty")}</th>
                <th className="px-2 py-2 text-end">{t("workers.colWages")}</th>
              </tr>
            </thead>
            <tbody>
              {productions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-2 py-8 text-center text-muted-foreground">
                    {t("workers.noRecords")}
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
                      <td className="px-2 py-2">{workTypeLabel(String(p.workType), t)}</td>
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
