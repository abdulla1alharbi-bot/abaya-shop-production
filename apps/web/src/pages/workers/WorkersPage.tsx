import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
      <p className="text-xs text-muted-foreground">{t("workers.footerNote")}</p>
    </div>
  );
}
