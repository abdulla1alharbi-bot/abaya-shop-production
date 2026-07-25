import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Boxes, CheckCircle2, ChevronLeft, Clock, PhoneCall, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DashboardRowsDialog } from "@/components/dashboard/DashboardRowsDialog";
import { api } from "@/lib/api";
import { formatAED } from "@/lib/money";
import { cn } from "@/lib/utils";

type AttentionId = "overdueJobs" | "dueToday" | "readyUncontacted" | "lowStock" | "overCredit";

type AttentionItem = {
  id: AttentionId;
  severity: "critical" | "warning";
  count: number;
  amountFils?: number;
  detail?: string;
  link: string;
};

const ICONS: Record<AttentionId, LucideIcon> = {
  overdueJobs: AlertTriangle,
  dueToday: Clock,
  readyUncontacted: PhoneCall,
  lowStock: Boxes,
  overCredit: Wallet,
};

/** Highest-severity first, then biggest count — the owner reads top to bottom and stops when done. */
function rank(item: AttentionItem): number {
  return item.severity === "critical" ? 0 : 1;
}

export function NeedsAttentionSection() {
  const { t } = useTranslation();
  const [openItem, setOpenItem] = useState<AttentionItem | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard", "attention"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: { items: AttentionItem[] } }>(
        "/dashboard/attention",
      );
      return res.data.data.items;
    },
  });

  if (isLoading || isError || !data) return null;

  if (data.length === 0) {
    return (
      <section className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 dark:border-emerald-900/50 dark:bg-emerald-950/25">
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-900 dark:text-emerald-100">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          {t("pages.dashboard.attention.allClear")}
        </p>
      </section>
    );
  }

  const items = [...data].sort((a, b) => rank(a) - rank(b) || b.count - a.count);

  return (
    <section>
      <DashboardRowsDialog
        rowsId={openItem?.id ?? null}
        title={openItem ? t(`pages.dashboard.attention.${openItem.id}`) : ""}
        totalFils={openItem?.amountFils}
        fullPageHref={openItem?.link}
        onClose={() => setOpenItem(null)}
      />

      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden />
        {t("pages.dashboard.attention.title")}
      </h2>
      <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border bg-card">
        {items.map((item) => {
          const Icon = ICONS[item.id];
          const critical = item.severity === "critical";
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setOpenItem(item)}
                aria-haspopup="dialog"
                className="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                    critical
                      ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-200"
                      : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
                  )}
                >
                  {Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  {/* The badge on the right carries the number, so the label stays
                      count-free — no plural agreement to get wrong in either language. */}
                  <span className="block text-sm font-medium leading-tight">
                    {t(`pages.dashboard.attention.${item.id}`)}
                  </span>
                  {item.id === "overdueJobs" ? (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {t("pages.dashboard.attention.oldestOverdue", { count: Number(item.detail ?? 0) })}
                    </span>
                  ) : null}
                  {item.detail && item.id === "lowStock" ? (
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.detail}</span>
                  ) : null}
                  {typeof item.amountFils === "number" && item.amountFils > 0 ? (
                    <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                      {formatAED(item.amountFils)}
                    </span>
                  ) : null}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums",
                    critical ? "bg-red-600 text-white" : "bg-amber-500 text-white dark:bg-amber-600",
                  )}
                >
                  {item.count}
                </span>
                <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground ltr:rotate-180" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
