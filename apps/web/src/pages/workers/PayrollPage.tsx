import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { formatAED } from "@/lib/money";
import { WORK_TYPES } from "@abaya-shop/shared";

type SummaryItem = {
  workerId: string;
  name: string;
  role: string;
  isActive: boolean;
  earnedFils: number;
  payoutFils: number;
  adjustmentFils: number;
  dueFils: number;
  taskCount: number;
};

export function PayrollPage() {
  const { t } = useTranslation();
  const [workerId, setWorkerId] = useState("");
  const [workType, setWorkType] = useState("");
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const params = useMemo(() => {
    const p: Record<string, string> = {
      from: new Date(from + "T00:00:00").toISOString(),
      to: new Date(to + "T23:59:59").toISOString(),
    };
    if (workerId) p.workerId = workerId;
    if (workType) p.workType = workType;
    return p;
  }, [from, to, workerId, workType]);

  const { data: workers } = useQuery({
    queryKey: ["workers", "payroll-dropdown"],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { items: Array<{ id: string; name: string }> };
      }>("/workers", { params: { limit: 300 } });
      return res.data.data.items;
    },
  });

  const { data: summary, isFetching } = useQuery({
    queryKey: ["workers", "summary", params],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { items: SummaryItem[]; from: string | null; to: string | null };
      }>("/workers/summary", { params });
      return res.data.data;
    },
  });

  const totals = useMemo(() => {
    const items = summary?.items ?? [];
    return {
      earned: items.reduce((a, i) => a + i.earnedFils, 0),
      paid: items.reduce((a, i) => a + i.payoutFils, 0),
      adj: items.reduce((a, i) => a + i.adjustmentFils, 0),
      due: items.reduce((a, i) => a + i.dueFils, 0),
      tasks: items.reduce((a, i) => a + i.taskCount, 0),
    };
  }, [summary]);

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("payroll.title")}
        description={t("payroll.description")}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/workers">{t("payroll.workersLink")}</Link>
          </Button>
        }
      />

      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-xs font-medium text-muted-foreground">{t("payroll.periodAndWorker")}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">{t("payroll.fromDate")}</Label>
            <Input className="mt-1 h-9" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">{t("payroll.toDate")}</Label>
            <Input className="mt-1 h-9" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">{t("payroll.workerOptional")}</Label>
            <select
              className="mt-1 flex h-9 min-w-[200px] rounded-md border border-input bg-background px-2 text-sm"
              value={workerId}
              onChange={(e) => setWorkerId(e.target.value)}
            >
              <option value="">{t("payroll.all")}</option>
              {workers?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">{t("payroll.workTypeOptional")}</Label>
            <select
              className="mt-1 flex h-9 min-w-[180px] rounded-md border border-input bg-background px-2 text-sm"
              value={workType}
              onChange={(e) => setWorkType(e.target.value)}
            >
              <option value="">{t("payroll.all")}</option>
              {WORK_TYPES.map((wt) => (
                <option key={wt} value={wt}>
                  {t(`workTypes.${wt}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {t("payroll.workTypeNote")}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border bg-muted/40 px-4 py-3">
          <div className="text-xs text-muted-foreground">{t("payroll.totalWagesPeriod")}</div>
          <div className="text-lg font-bold">{isFetching ? "…" : formatAED(totals.earned)}</div>
        </div>
        <div className="rounded-lg border bg-muted/40 px-4 py-3">
          <div className="text-xs text-muted-foreground">{t("payroll.payoutsPeriod")}</div>
          <div className="text-lg font-bold">{isFetching ? "…" : formatAED(totals.paid)}</div>
        </div>
        <div className="rounded-lg border bg-muted/40 px-4 py-3">
          <div className="text-xs text-muted-foreground">{t("payroll.adjustmentsPeriod")}</div>
          <div className="text-lg font-bold">{isFetching ? "…" : formatAED(totals.adj)}</div>
        </div>
        <div className="rounded-lg border bg-amber-50 px-4 py-3 dark:bg-amber-950/30">
          <div className="text-xs text-amber-900 dark:text-amber-100">{t("payroll.netPeriodPerRow")}</div>
          <div className="text-lg font-bold text-amber-950 dark:text-amber-50">
            {isFetching ? "…" : formatAED(totals.due)}
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("payroll.netPeriodNote")}
      </p>

      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
        <table className="w-full min-w-[800px] text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-start">{t("payroll.colWorker")}</th>
              <th className="px-3 py-2 text-end">{t("payroll.colTasksPieces")}</th>
              <th className="px-3 py-2 text-end">{t("payroll.colPeriodWages")}</th>
              <th className="px-3 py-2 text-end">{t("payroll.colPayouts")}</th>
              <th className="px-3 py-2 text-end">{t("payroll.colAdjustments")}</th>
              <th className="px-3 py-2 text-end">{t("payroll.colNetPeriod")}</th>
              <th className="px-3 py-2 text-start">{t("payroll.colStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {!summary?.items.length ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                  {isFetching ? t("common.loading") : t("payroll.noData")}
                </td>
              </tr>
            ) : (
              summary.items.map((row) => (
                <tr key={row.workerId} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <Link className="font-medium text-brand-700 underline" to={`/workers/${row.workerId}`}>
                      {row.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{row.role}</div>
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums">{row.taskCount}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{formatAED(row.earnedFils)}</td>
                  <td className="px-3 py-2 text-end tabular-nums text-muted-foreground">
                    {formatAED(row.payoutFils)}
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums text-muted-foreground">
                    {formatAED(row.adjustmentFils)}
                  </td>
                  <td className="px-3 py-2 text-end font-semibold tabular-nums text-amber-900 dark:text-amber-100">
                    {formatAED(row.dueFils)}
                  </td>
                  <td className="px-3 py-2">{row.isActive ? t("payroll.active") : t("payroll.suspended")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <section>
        <h2 className="mb-2 text-lg font-medium">{t("payroll.legacyTitle")}</h2>
        <PayrollLegacyTable />
      </section>
    </div>
  );
}

function PayrollLegacyTable() {
  const { t } = useTranslation();
  const { data: payrolls } = useQuery({
    queryKey: ["payrolls", "legacy"],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: {
          items: Array<{
            id: string;
            month: number;
            year: number;
            netFils: number;
            isPaid: boolean;
            worker: { name: string };
          }>;
        };
      }>("/payroll", { params: { limit: 50 } });
      return res.data.data.items;
    },
  });

  return (
    <div className="overflow-x-auto rounded-md border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50">
          <tr>
            <th className="px-4 py-2 text-start font-medium">{t("payroll.legacyColWorker")}</th>
            <th className="px-4 py-2 text-start font-medium">{t("payroll.legacyColPeriod")}</th>
            <th className="px-4 py-2 text-end font-medium">{t("payroll.legacyColNet")}</th>
            <th className="px-4 py-2 text-start font-medium">{t("payroll.legacyColStatus")}</th>
          </tr>
        </thead>
        <tbody>
          {!payrolls?.length ? (
            <tr>
              <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                {t("payroll.legacyNoRecords")}
              </td>
            </tr>
          ) : (
            payrolls.map((p) => (
              <tr key={p.id} className="border-b last:border-0">
                <td className="px-4 py-2">{p.worker.name}</td>
                <td className="px-4 py-2">
                  {p.month}/{p.year}
                </td>
                <td className="px-4 py-2 text-end">{formatAED(p.netFils)}</td>
                <td className="px-4 py-2">{p.isPaid ? t("payroll.legacyPaid") : t("payroll.legacyOpen")}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
