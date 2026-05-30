import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

type DashboardOperationalCardProps = {
  title: string;
  /** Main summary line(s), e.g. amounts or counts */
  summary: ReactNode;
  hint?: string;
  icon: ReactNode;
  onClick: () => void;
  open: boolean;
  /** Optional right column (e.g. urgency chips) — hidden on narrow screens if not needed */
  aside?: ReactNode;
  className?: string;
};

/**
 * Shared compact dashboard card: title, summary, icon, full-width click target.
 */
export function DashboardOperationalCard({
  title,
  summary,
  hint,
  icon,
  onClick,
  open,
  aside,
  className,
}: DashboardOperationalCardProps) {
  const { t } = useTranslation();
  const defaultHint = hint ?? t("components.invoiceQueue.tapForDetails");

  return (
    <section className={cn("rounded-xl border border-border/80 bg-card shadow-sm", className)}>
      <button
        type="button"
        className={cn(
          "flex w-full items-start gap-3 rounded-xl p-4 text-start transition-colors",
          "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
        onClick={onClick}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {icon}
        </span>
        <span className="min-w-0 flex-1 space-y-1">
          <span className="block text-sm font-semibold leading-tight md:text-base">{title}</span>
          <span className="block text-xs text-muted-foreground md:text-sm">{summary}</span>
          <span className="block text-[11px] text-muted-foreground">{defaultHint}</span>
        </span>
        {aside ? (
          <span className="hidden shrink-0 sm:flex sm:flex-col sm:items-end sm:gap-1">{aside}</span>
        ) : null}
      </button>
    </section>
  );
}
