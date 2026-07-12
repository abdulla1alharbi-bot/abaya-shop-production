import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { formatAED } from "@/lib/money";
import { workTypeLabel } from "@/lib/jobOrderUi";

type WorkerRow = {
  id: string;
  name: string;
  role: string;
  phone: string | null;
  isActive: boolean;
  specializations?: string | null;
};

type SummaryRow = {
  workerId: string;
  dueFils: number;
  earnedFils: number;
  taskCount: number;
};

export function WorkersPage() {
  const { t } = useTranslation();
  const { data: workers, isLoading } = useQuery({
    queryKey: ["workers"],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { items: WorkerRow[] };
      }>("/workers", { params: { limit: 500 } });
      return res.data.data.items;
    },
  });

  const { data: summaryData } = useQuery({
    queryKey: ["workers", "summary", "alltime"],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { items: SummaryRow[] };
      }>("/workers/summary");
      return res.data.data.items;
    },
  });

  const dueById = new Map((summaryData ?? []).map((s) => [s.workerId, s]));

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("workers.title")}
        description={t("workers.description")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/payroll">{t("workers.btnPayroll")}</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/workers/new">
                <Plus className="me-1 h-4 w-4" />
                {t("workers.newWorker")}
              </Link>
            </Button>
          </div>
        }
      />

      <div className="overflow-x-auto rounded-lg border bg-card shadow-sm">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-start font-medium">{t("workers.colName")}</th>
              <th className="px-4 py-3 text-start font-medium">{t("workers.colRole")}</th>
              <th className="px-4 py-3 text-start font-medium">{t("workers.colSpecialty")}</th>
              <th className="px-4 py-3 text-start font-medium">{t("workers.colMobile")}</th>
              <th className="px-4 py-3 text-end font-medium">{t("workers.colBalance")}</th>
              <th className="px-4 py-3 text-start font-medium">{t("workers.colStatus")}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                  {t("common.loadingData")}
                </td>
              </tr>
            ) : !workers?.length ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                  {t("workers.emptyMessage")}
                </td>
              </tr>
            ) : (
              workers.map((w) => {
                const s = dueById.get(w.id);
                return (
                  <tr key={w.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">
                      <Link className="text-brand-700 underline hover:no-underline" to={`/workers/${w.id}`}>
                        {w.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{w.role}</td>
                    <td className="max-w-[220px] truncate px-4 py-3 text-xs text-muted-foreground">
                      {w.specializations ? (
                        <span title={w.specializations}>
                          {(() => {
                            try {
                              const p = JSON.parse(w.specializations) as string[];
                              return Array.isArray(p) ? p.map((x) => workTypeLabel(x, t)).join(", ") : "—";
                            } catch {
                              return w.specializations;
                            }
                          })()}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{w.phone ?? "—"}</td>
                    <td className="px-4 py-3 text-end font-semibold tabular-nums">
                      {s ? (
                        <span className={s.dueFils > 0 ? "text-amber-800 dark:text-amber-200" : ""}>
                          {formatAED(s.dueFils)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {w.isActive ? (
                        <Badge variant="secondary">{t("status.active")}</Badge>
                      ) : (
                        <Badge variant="outline">{t("status.inactive")}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-end whitespace-nowrap">
                      <Button variant="ghost" size="sm" asChild>
                        <Link to={`/workers/${w.id}`}>{t("common.details")}</Link>
                      </Button>
                      <Button variant="ghost" size="sm" asChild>
                        <Link to={`/workers/${w.id}/edit`}>{t("common.edit")}</Link>
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <WorkerQualitySection />
      <p className="text-xs text-muted-foreground">{t("workers.footerNote")}</p>
    </div>
  );
}

type QualityRow = {
  workerId: string;
  name: string;
  role: string;
  completed: number;
  reworks: number;
  qaFails: number;
  reworkRatePercent: number;
  avgHoursPerStage: number | null;
};

/** Quality & speed metrics per worker (completed stages, reworks, QA fails, rework rate, avg hours/stage). */
function WorkerQualitySection() {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === "en";
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const params = useMemo(
    () => ({
      from: new Date(from + "T00:00:00").toISOString(),
      to: new Date(to + "T23:59:59").toISOString(),
    }),
    [from, to],
  );

  const { data, isFetching } = useQuery({
    queryKey: ["workers", "quality-metrics", params],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { from: string; to: string; rows: QualityRow[] };
      }>("/workers/quality-metrics", { params });
      return res.data.data;
    },
  });

  const rows = data?.rows ?? [];

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">
            {isEn ? "Worker Quality & Speed" : "جودة وسرعة العمال"}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {isEn
              ? "Completed stages, reworks and average speed for the selected period"
              : "المراحل المكتملة والإعادات ومتوسط السرعة خلال الفترة المحددة"}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">{isEn ? "From" : "من"}</Label>
            <Input
              className="mt-1 h-9"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">{isEn ? "To" : "إلى"}</Label>
            <Input
              className="mt-1 h-9"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-4 py-2 text-start font-medium">{isEn ? "Worker" : "العامل"}</th>
              <th className="px-4 py-2 text-end font-medium">
                {isEn ? "Completed stages" : "مراحل مكتملة"}
              </th>
              <th className="px-4 py-2 text-end font-medium">{isEn ? "Reworks" : "مرات الإعادة"}</th>
              <th className="px-4 py-2 text-end font-medium">
                {isEn ? "QA rejections" : "رفض فحص الجودة"}
              </th>
              <th className="px-4 py-2 text-end font-medium">
                {isEn ? "Rework rate %" : "نسبة الإعادة %"}
              </th>
              <th className="px-4 py-2 text-end font-medium">
                {isEn ? "Avg hours/stage" : "متوسط ساعات/مرحلة"}
              </th>
            </tr>
          </thead>
          <tbody>
            {isFetching && !rows.length ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  {t("common.loadingData")}
                </td>
              </tr>
            ) : !rows.length ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  {isEn ? "No data for this period" : "لا توجد بيانات لهذه الفترة"}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.workerId} className="border-b last:border-0">
                  <td className="px-4 py-2">
                    <Link
                      className="font-medium text-brand-700 underline hover:no-underline"
                      to={`/workers/${r.workerId}`}
                    >
                      {r.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{r.role}</div>
                  </td>
                  <td className="px-4 py-2 text-end tabular-nums">{r.completed}</td>
                  <td className="px-4 py-2 text-end tabular-nums">{r.reworks}</td>
                  <td className="px-4 py-2 text-end tabular-nums">{r.qaFails}</td>
                  <td
                    className={`px-4 py-2 text-end tabular-nums ${
                      r.reworkRatePercent > 10 ? "font-semibold text-red-600 dark:text-red-400" : ""
                    }`}
                  >
                    {r.reworkRatePercent}%
                  </td>
                  <td className="px-4 py-2 text-end tabular-nums text-muted-foreground">
                    {r.avgHoursPerStage == null ? "—" : r.avgHoursPerStage.toFixed(1)}
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
