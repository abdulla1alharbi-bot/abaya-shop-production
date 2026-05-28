import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string;
  icon?: ReactNode;
  className?: string;
  /** Softer visual weight — default true */
  subtle?: boolean;
  /** When set, the whole card is a link (e.g. dashboard drill-down). */
  to?: string;
}

export function StatCard({ title, value, icon, className, subtle = true, to }: StatCardProps) {
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-tight text-muted-foreground">{title}</p>
        {icon ? (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-muted-foreground">
            {icon}
          </div>
        ) : null}
      </div>
      <p className="mt-3 text-2xl font-bold tabular-nums tracking-tight md:text-3xl">{value}</p>
    </>
  );

  const shellClass = cn(
    "rounded-xl border bg-card px-5 py-4",
    subtle ? "shadow-none" : "shadow-sm",
    className,
  );

  if (to) {
    return (
      <Link
        to={to}
        className={cn(
          shellClass,
          "block transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        {inner}
      </Link>
    );
  }

  return <div className={shellClass}>{inner}</div>;
}
