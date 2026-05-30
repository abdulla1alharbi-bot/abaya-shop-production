import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, CheckCircle2, Clock, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { JOB_STAGE_LABELS } from "@abaya-shop/shared";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { api } from "@/lib/api";
import { useLangStore } from "@/store/langStore";

type WorkshopCapacity = {
  overall: {
    totalActive: number;
    totalReady: number;
    totalOverdue: number;
    totalInInspection: number;
  };
  perWorker: Array<{
    workerId: string;
    name: string;
    role: string;
    activeStages: Array<{
      jobNo: number;
      stageKey: string;
      dueDate: string | null;
      isOverdue: boolean;
    }>;
    backlogCount: number;
    oldestJobAgeDays: number;
  }>;
};

export function WorkshopCapacityPage() {
  const { t } = useTranslation();
  const { lang } = useLangStore();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["workshop", "capacity"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: WorkshopCapacity }>("/job-process/workshop/capacity");
      return res.data.data;
    },
    refetchInterval: 60_000,
  });

  const dateLocale = lang === "ar" ? "ar-AE" : "en-AE";

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("workshop.capacityTitle")}
        description={t("workshop.capacityDesc")}
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loadingData")}</p>
      ) : isError || !data ? (
        <p className="text-sm text-destructive">{t("workshop.errorLoading")}</p>
      ) : (
        <>
          <section>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                title={t("workshop.totalActive")}
                value={String(data.overall.totalActive)}
                icon={<Activity className="h-4 w-4" />}
              />
              <StatCard
                title={t("workshop.readyDelivery")}
                value={String(data.overall.totalReady)}
                icon={<CheckCircle2 className="h-4 w-4" />}
                className="border-green-400"
              />
              <StatCard
                title={t("workshop.qualityCheck")}
                value={String(data.overall.totalInInspection)}
                icon={<Search className="h-4 w-4" />}
                className="border-purple-400"
              />
              <StatCard
                title={t("workshop.overdue")}
                value={String(data.overall.totalOverdue)}
                icon={<AlertTriangle className="h-4 w-4" />}
                className={data.overall.totalOverdue > 0 ? "border-red-400 bg-red-50/40 dark:bg-red-950/20" : ""}
              />
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold">{t("workshop.workersSection")} ({data.perWorker.length})</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {data.perWorker.map((w) => {
                const isFree = w.backlogCount === 0;
                const hasOverdue = w.activeStages.some((s) => s.isOverdue);
                const cardBorder = isFree
                  ? "border-green-300 dark:border-green-700"
                  : hasOverdue
                    ? "border-red-400 dark:border-red-700 bg-red-50/30 dark:bg-red-950/20"
                    : "border-border";
                return (
                  <div key={w.workerId} className={`rounded-xl border-2 bg-card p-3 ${cardBorder}`}>
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{w.name}</p>
                        <p className="text-[10px] text-muted-foreground">{w.role}</p>
                      </div>
                      {isFree ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-800 dark:bg-green-900 dark:text-green-100">
                          {t("workshop.available")}
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-900 dark:text-amber-100">
                          {t("workshop.stagesCount", { count: w.backlogCount })}
                        </span>
                      )}
                    </div>
                    {w.activeStages.length > 0 ? (
                      <>
                        <ul className="space-y-1 text-xs">
                          {w.activeStages.slice(0, 5).map((s, i) => (
                            <li key={i} className="flex items-center justify-between gap-1 rounded border border-border/40 bg-muted/20 px-2 py-1">
                              <span className="font-mono">
                                <Link to={`/job-orders/${s.jobNo}`} className="text-brand-700 hover:underline">
                                  #{s.jobNo}
                                </Link>{" "}
                                · {JOB_STAGE_LABELS[s.stageKey] ?? s.stageKey}
                              </span>
                              {s.dueDate ? (
                                <span className={s.isOverdue ? "text-red-600 dark:text-red-400 font-bold" : "text-muted-foreground"}>
                                  {new Date(s.dueDate).toLocaleDateString(dateLocale, { month: "short", day: "numeric" })}
                                  {s.isOverdue ? " ⚠" : ""}
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                        {w.activeStages.length > 5 ? (
                          <p className="mt-1 text-center text-[10px] text-muted-foreground">
                            {t("workshop.more", { count: w.activeStages.length - 5 })}
                          </p>
                        ) : null}
                        {w.oldestJobAgeDays > 0 ? (
                          <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {t("workshop.oldestJob", { days: w.oldestJobAgeDays })}
                          </p>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
