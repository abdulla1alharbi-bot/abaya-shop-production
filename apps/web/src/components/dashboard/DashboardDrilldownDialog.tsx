import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatAED } from "@/lib/money";

/**
 * Shared shell for every dashboard card drill-down: the owner stays on the
 * dashboard and the detail opens over it, rather than being navigated away and
 * having to find their way back.
 */
export function DashboardDrilldownDialog({
  open,
  onOpenChange,
  title,
  description,
  totalFils,
  totalLabel,
  fullPageHref,
  fullPageLabel,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Shown as a prominent total bar above the rows. */
  totalFils?: number;
  totalLabel?: string;
  /** Escape hatch to the real page, for anything the dialog does not cover. */
  fullPageHref?: string;
  fullPageLabel?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(92vh,900px)] w-[min(96vw,900px)] max-w-[900px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[900px]">
        <DialogHeader className="shrink-0 border-b px-4 py-4 pr-14 text-start sm:px-6 sm:pr-16">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        {typeof totalFils === "number" ? (
          <div className="flex shrink-0 items-baseline justify-between gap-3 border-b bg-muted/30 px-4 py-3 sm:px-6">
            <span className="text-xs font-medium text-muted-foreground">
              {totalLabel ?? t("pages.dashboard.totalLabel")}
            </span>
            <span className="font-mono text-lg font-bold tabular-nums">{formatAED(totalFils)}</span>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3 sm:px-6 sm:py-4">{children}</div>

        {fullPageHref ? (
          <div className="shrink-0 border-t px-4 py-3 sm:px-6">
            <Button variant="outline" size="sm" className="w-full gap-2 sm:w-auto" asChild>
              <Link to={fullPageHref}>
                <ExternalLink className="h-3.5 w-3.5" />
                {fullPageLabel ?? t("pages.dashboard.openFullPage")}
              </Link>
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Consistent empty/loading/error copy inside a drill-down. */
export function DrilldownState({ state }: { state: "loading" | "error" | "empty" }) {
  const { t } = useTranslation();
  if (state === "loading") return <p className="text-sm text-muted-foreground">{t("common.loadingData")}</p>;
  if (state === "error") return <p className="text-sm text-destructive">{t("common.error")}</p>;
  return <p className="py-8 text-center text-sm text-muted-foreground">{t("common.noData")}</p>;
}
