import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { DashboardDrilldownDialog, DrilldownState } from "@/components/dashboard/DashboardDrilldownDialog";
import { api } from "@/lib/api";
import { formatAED } from "@/lib/money";
import { useLangStore } from "@/store/langStore";

export type DashboardRow = {
  id: string;
  title: string;
  subtitle: string | null;
  amountFils: number | null;
  meta: string | null;
  link: string;
};

/**
 * Generic "what is behind this number?" dialog. Every dashboard card that shows a
 * count or a balance can open one by naming the row set it wants; the server
 * returns the same row shape for all of them.
 */
export function DashboardRowsDialog({
  rowsId,
  title,
  description,
  totalFils,
  fullPageHref,
  onClose,
}: {
  /** Row set to load, or null when closed. Matches `/dashboard/attention/:id/rows`. */
  rowsId: string | null;
  title: string;
  description?: string;
  totalFils?: number;
  fullPageHref?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { lang } = useLangStore();
  const locale = lang === "ar" ? "ar-AE" : "en-AE";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard", "rows", rowsId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: { items: DashboardRow[] } }>(
        `/dashboard/attention/${rowsId}/rows`,
      );
      return res.data.data.items;
    },
    enabled: Boolean(rowsId),
  });

  const state = isLoading ? "loading" : isError || !data ? "error" : null;

  return (
    <DashboardDrilldownDialog
      open={Boolean(rowsId)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      description={description ?? t("pages.dashboard.drilldown.attentionDesc")}
      totalFils={totalFils}
      fullPageHref={fullPageHref}
    >
      {state ? (
        <DrilldownState state={state} />
      ) : data!.length === 0 ? (
        <DrilldownState state="empty" />
      ) : (
        <ul>
          {data!.map((row) => (
            <li key={row.id} className="border-b border-border/50 last:border-0">
              <Link
                to={row.link}
                className="flex items-start justify-between gap-3 py-2.5 transition-colors hover:bg-muted/40"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium leading-tight">{row.title}</span>
                  {row.subtitle ? (
                    <span className="mt-0.5 block text-xs text-muted-foreground">{row.subtitle}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-end">
                  {typeof row.amountFils === "number" ? (
                    <span className="block font-mono text-sm font-semibold tabular-nums">
                      {formatAED(row.amountFils)}
                    </span>
                  ) : null}
                  {row.meta ? (
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {/* lowStock sends "available/threshold" metres; the rest send an ISO date. */}
                      {rowsId === "lowStock"
                        ? t("pages.dashboard.drilldown.metersLeft", { value: row.meta })
                        : new Date(row.meta).toLocaleDateString(locale)}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DashboardDrilldownDialog>
  );
}
