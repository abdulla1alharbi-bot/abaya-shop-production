import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BarChart3, Factory, Scissors } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";

type ProductionTab = {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  /** Match the route exactly (needed for the index tab whose path prefixes others). */
  end?: boolean;
  /** Only show this tab when the user holds this permission. */
  permission?: string;
};

const TABS: ProductionTab[] = [
  { to: "/production", labelKey: "production.title", icon: Factory, end: true },
  { to: "/production/samples", labelKey: "production.samplesTitle", icon: Scissors, end: true },
  {
    to: "/production/samples/performance",
    labelKey: "production.samplesPerformanceTitle",
    icon: BarChart3,
    permission: "reports.sales",
  },
];

/** Shared tab bar across the production pages (model production / samples / performance). */
export function ProductionTabs() {
  const { t } = useTranslation();
  const { can } = usePermissions();
  const tabs = TABS.filter((tab) => !tab.permission || can(tab.permission));

  return (
    <div className="flex flex-wrap gap-1 rounded-lg border bg-muted/30 p-1">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {t(tab.labelKey)}
          </NavLink>
        );
      })}
    </div>
  );
}
