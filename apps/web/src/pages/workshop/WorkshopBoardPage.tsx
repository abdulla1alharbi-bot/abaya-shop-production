import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, CheckCircle2, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { jobStageLabel } from "@abaya-shop/shared";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useLangStore } from "@/store/langStore";

/** Pipeline stages the workshop actively works on (left → right = order of work). */
const BOARD_STAGES = ["NEW", "CUTTING", "SEWING", "EMBROIDERY", "FINISHING", "INSPECTION", "READY"] as const;
const BOARD_STAGE_SET = new Set<string>(BOARD_STAGES as readonly string[]);

type WorkStageRow = {
  stageKey: string;
  status: string;
  worker: { id: string; name: string } | null;
};

type JobRow = {
  id: string;
  jobNo: number;
  stage: string;
  dueDate: string | null;
  priority?: string;
  productStyle: string;
  customer: { id: string; name: string; mobile: string | null } | null;
  workStages: WorkStageRow[];
};

function startOfToday(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function isOverdue(job: JobRow): boolean {
  if (!job.dueDate) return false;
  if (job.stage === "READY") return false;
  return new Date(job.dueDate).getTime() < startOfToday();
}

/** Worker currently responsible: the stage row matching the job's stage, else any in-progress row. */
function currentWorkerName(job: JobRow): string | null {
  const onStage = job.workStages.find((s) => s.stageKey === job.stage && s.worker);
  if (onStage?.worker) return onStage.worker.name;
  const inProgress = job.workStages.find((s) => s.status === "IN_PROGRESS" && s.worker);
  return inProgress?.worker?.name ?? null;
}

export function WorkshopBoardPage() {
  const { t } = useTranslation();
  const { lang } = useLangStore();
  const [search, setSearch] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["workshop", "board"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: { items: JobRow[] } }>("/job-orders", {
        params: { limit: 500, open: "true" },
      });
      return res.data.data.items;
    },
    refetchInterval: 60_000,
  });

  const dateLocale = lang === "ar" ? "ar-AE" : "en-AE";

  const active = useMemo(() => (data ?? []).filter((j) => BOARD_STAGE_SET.has(j.stage)), [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return active;
    return active.filter(
      (j) =>
        String(j.jobNo).includes(q) ||
        j.customer?.name?.toLowerCase().includes(q) ||
        j.customer?.mobile?.toLowerCase().includes(q) ||
        j.productStyle?.toLowerCase().includes(q),
    );
  }, [active, search]);

  const stats = useMemo(() => {
    let overdue = 0;
    let inspection = 0;
    let ready = 0;
    for (const j of active) {
      if (isOverdue(j)) overdue += 1;
      if (j.stage === "INSPECTION") inspection += 1;
      if (j.stage === "READY") ready += 1;
    }
    return { total: active.length, overdue, inspection, ready };
  }, [active]);

  const byStage = useMemo(() => {
    const map = new Map<string, JobRow[]>();
    for (const key of BOARD_STAGES) map.set(key, []);
    for (const j of filtered) map.get(j.stage)?.push(j);
    return map;
  }, [filtered]);

  return (
    <div className="space-y-6">
      <PageHeader title={t("workshopBoard.title")} description={t("workshopBoard.desc")} />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loadingData")}</p>
      ) : isError || !data ? (
        <p className="text-sm text-destructive">{t("workshop.errorLoading")}</p>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard title={t("workshop.totalActive")} value={String(stats.total)} icon={<Activity className="h-4 w-4" />} />
            <StatCard
              title={t("workshop.overdue")}
              value={String(stats.overdue)}
              icon={<AlertTriangle className="h-4 w-4" />}
              className={stats.overdue > 0 ? "border-red-400 bg-red-50/40 dark:bg-red-950/20" : ""}
            />
            <StatCard
              title={t("workshop.qualityCheck")}
              value={String(stats.inspection)}
              icon={<Search className="h-4 w-4" />}
              className="border-purple-400"
            />
            <StatCard
              title={t("workshop.readyDelivery")}
              value={String(stats.ready)}
              icon={<CheckCircle2 className="h-4 w-4" />}
              className="border-green-400"
            />
          </section>

          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground ltr:left-3 rtl:right-3" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("workshopBoard.searchPlaceholder")}
              className="ltr:pl-9 rtl:pr-9"
            />
          </div>

          {active.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-8 text-center text-sm text-muted-foreground">
              {t("workshopBoard.empty")}
            </p>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-3">
              {BOARD_STAGES.map((stageKey) => {
                const jobs = byStage.get(stageKey) ?? [];
                return (
                  <div key={stageKey} className="flex w-64 shrink-0 flex-col rounded-xl border border-border bg-muted/20">
                    <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
                      <span className="text-sm font-semibold">{jobStageLabel(stageKey, lang)}</span>
                      <span className="rounded-full bg-background px-2 py-0.5 text-xs font-bold text-muted-foreground">
                        {jobs.length}
                      </span>
                    </div>
                    <div className="flex flex-col gap-2 p-2">
                      {jobs.length === 0 ? (
                        <p className="px-1 py-4 text-center text-[11px] text-muted-foreground/70">—</p>
                      ) : (
                        jobs.map((job) => {
                          const overdue = isOverdue(job);
                          const worker = currentWorkerName(job);
                          return (
                            <Link
                              key={job.id}
                              to={`/job-orders/${job.id}`}
                              className={`block rounded-lg border bg-card p-2.5 transition-colors hover:border-brand-400 ${
                                overdue ? "border-red-400 bg-red-50/40 dark:bg-red-950/20" : "border-border/70"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-xs font-bold text-brand-700">#{job.jobNo}</span>
                                {job.dueDate ? (
                                  <span
                                    className={`text-[11px] font-medium ${
                                      overdue ? "font-bold text-red-600 dark:text-red-400" : "text-muted-foreground"
                                    }`}
                                  >
                                    {new Date(job.dueDate).toLocaleDateString(dateLocale, { month: "short", day: "numeric" })}
                                    {overdue ? " ⚠" : ""}
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-1 truncate text-sm font-semibold">{job.customer?.name ?? "—"}</p>
                              {job.productStyle ? (
                                <p className="truncate text-[11px] text-muted-foreground">{job.productStyle}</p>
                              ) : null}
                              {worker ? (
                                <p className="mt-1 truncate text-[11px] text-brand-600 dark:text-brand-300">{worker}</p>
                              ) : null}
                            </Link>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
