import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ReportHubCardProps = {
  title: string;
  description?: string;
  icon: ReactNode;
  onClick: () => void;
  className?: string;
};

export function ReportHubCard({ title, description, icon, onClick, className }: ReportHubCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full flex-col items-start gap-3 rounded-xl border border-border/80 bg-card p-4 text-start shadow-sm transition-colors",
        "hover:border-primary/30 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted/80 text-muted-foreground">
        {icon}
      </span>
      <span className="space-y-1">
        <span className="block text-sm font-semibold leading-tight md:text-base">{title}</span>
        {description ? (
          <span className="block text-xs leading-snug text-muted-foreground">{description}</span>
        ) : null}
      </span>
    </button>
  );
}
