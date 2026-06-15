import {
  Activity,
  BarChart3,
  ClipboardList,
  Clock,
  CreditCard,
  Factory,
  FileText,
  Home,
  Package,
  Receipt,
  Scissors,
  Settings,
  Shield,
  Shirt,
  ShoppingCart,
  UserCircle,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuthStore } from "@/store/authStore";

type NavBadges = {
  workshopDueToday: number;
  invoicesUnpaid: number;
  fabricsLowStock: number;
  customersOverCredit: number;
};

type NavBadgeKey = keyof NavBadges;

type NavEntry = {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  /** Permission id, or "auth" = any logged-in user */
  permission?: string | "auth";
  /** If set, user needs at least one of these (takes precedence over `permission`). */
  anyOf?: string[];
  /** Live count badge: which count to show, and its urgency tone. */
  badgeKey?: NavBadgeKey;
  badgeTone?: "danger" | "warning";
};

function useNavBadges(enabled: boolean) {
  return useQuery({
    queryKey: ["nav-badges"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: NavBadges }>("/dashboard/nav-badges");
      return res.data.data;
    },
    enabled,
    staleTime: 60_000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: true,
  });
}

const navGroups: Array<{ id: string; titleKey: string; items: NavEntry[] }> = [
  {
    id: "day",
    titleKey: "nav.groups.day",
    items: [
      { to: "/dashboard", labelKey: "nav.items.dashboard", icon: Home, permission: "dashboard.view" },
      { to: "/pos", labelKey: "nav.items.pos", icon: ShoppingCart, permission: "pos.use" },
      {
        to: "/production",
        labelKey: "nav.items.production",
        icon: Factory,
        anyOf: ["jobProcess.view", "jobProcess.update", "readyMade.create"],
      },
    ],
  },
  {
    id: "stock",
    titleKey: "nav.groups.stock",
    items: [
      { to: "/ready-made", labelKey: "nav.items.readyMade", icon: Shirt, permission: "readyMade.view" },
      {
        to: "/ready-made/conversions",
        labelKey: "nav.items.readyMadeConversions",
        icon: FileText,
        anyOf: ["readyMade.view", "jobProcess.view"],
      },
      {
        to: "/fabrics",
        labelKey: "nav.items.fabrics",
        icon: Package,
        permission: "fabrics.view",
        badgeKey: "fabricsLowStock",
        badgeTone: "danger",
      },
      { to: "/models", labelKey: "nav.items.models", icon: Scissors, permission: "models.view" },
    ],
  },
  {
    id: "orders",
    titleKey: "nav.groups.orders",
    items: [
      {
        to: "/invoices",
        labelKey: "nav.items.invoices",
        icon: FileText,
        permission: "invoices.view",
        badgeKey: "invoicesUnpaid",
        badgeTone: "warning",
      },
      {
        to: "/customers",
        labelKey: "nav.items.customers",
        icon: UserCircle,
        permission: "customers.view",
        badgeKey: "customersOverCredit",
        badgeTone: "danger",
      },
    ],
  },
  {
    id: "workshop",
    titleKey: "nav.groups.workshop",
    items: [
      {
        to: "/workshop/board",
        labelKey: "nav.items.workshopBoard",
        icon: ClipboardList,
        permission: "jobProcess.view",
        badgeKey: "workshopDueToday",
        badgeTone: "warning",
      },
      { to: "/invoices", labelKey: "nav.items.workshopTracking", icon: FileText, permission: "jobProcess.view" },
      { to: "/workers", labelKey: "nav.items.workers", icon: Users, permission: "workers.view" },
      { to: "/payroll", labelKey: "nav.items.payroll", icon: Wallet, permission: "workers.wages" },
      { to: "/workshop/capacity", labelKey: "nav.items.workshopCapacity", icon: Activity, permission: "jobProcess.view" },
    ],
  },
  {
    id: "admin",
    titleKey: "nav.groups.admin",
    items: [
      {
        to: "/reports",
        labelKey: "nav.items.reports",
        icon: BarChart3,
        anyOf: [
          "reports.sales",
          "reports.wages",
          "reports.balances",
          "reports.financial",
          "reports.mostRequested",
        ],
      },
      {
        to: "/production/samples/performance",
        labelKey: "nav.items.productionSamplesPerformance",
        icon: BarChart3,
        permission: "reports.sales",
      },
      { to: "/shifts", labelKey: "nav.items.shifts", icon: Clock, permission: "pos.use" },
      { to: "/accounts", labelKey: "nav.items.accounts", icon: CreditCard, permission: "reports.financial" },
      { to: "/accounts/expenses", labelKey: "nav.items.expenses", icon: Receipt, permission: "expenses.view" },
      { to: "/settings", labelKey: "nav.items.settings", icon: Settings, permission: "settings.view" },
      { to: "/settings/users", labelKey: "nav.items.users", icon: UserCog, permission: "users.view" },
      { to: "/settings/audit", labelKey: "nav.items.audit", icon: Shield, permission: "audit.view" },
    ],
  },
];

function NavItem({
  item,
  onNavigate,
  badges,
}: {
  item: NavEntry;
  onNavigate?: () => void;
  badges?: NavBadges;
}) {
  const { can, canAny } = usePermissions();
  const { t } = useTranslation();
  if (item.anyOf?.length) {
    if (!canAny(...item.anyOf)) return null;
  } else if (item.permission !== "auth" && item.permission && !can(item.permission)) return null;
  const Icon = item.icon;
  const badgeCount = item.badgeKey ? badges?.[item.badgeKey] ?? 0 : 0;
  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150",
          isActive
            ? "bg-brand-600 text-white shadow-sm"
            : "text-slate-300 hover:bg-slate-800 hover:text-white",
        )
      }
    >
      <Icon className="h-[18px] w-[18px] shrink-0" />
      <span className="flex-1 truncate">{t(item.labelKey)}</span>
      {badgeCount > 0 ? (
        <span
          className={cn(
            "ms-auto min-w-[20px] shrink-0 rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold leading-none text-white tabular-nums",
            item.badgeTone === "danger" ? "bg-red-600" : "bg-amber-500",
          )}
        >
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      ) : null}
    </NavLink>
  );
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const { canAny } = usePermissions();
  // Only poll badge counts when the user can actually see at least one badged item.
  const hasBadgedItem = canAny("jobProcess.view", "invoices.view", "customers.view", "fabrics.view");
  const { data: badges } = useNavBadges(hasBadgedItem);
  return (
    <nav className="flex flex-1 flex-col gap-0 overflow-y-auto p-2">
      {navGroups.map((group) => (
        <div key={group.id} className="mb-1">
          <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            {t(group.titleKey)}
          </p>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => (
              <NavItem key={item.to + item.labelKey} item={item} onNavigate={onNavigate} badges={badges} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function SidebarHeader() {
  const user = useAuthStore((s) => s.user);
  const { t } = useTranslation();

  return (
    <div className="border-b border-slate-800 px-4 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t("sidebar.systemLabel")}</p>
      <h1 className="mt-0.5 text-base font-bold text-white">{t("sidebar.shopTitle")}</h1>
      {user ? (
        <div className="mt-3 rounded-lg bg-slate-800/70 px-3 py-2.5">
          <p className="truncate text-sm font-semibold text-white">{user.name}</p>
          <p className="mt-0.5 text-[11px] font-medium text-brand-300">
            {t(`roles.${user.role}`, { defaultValue: user.role })}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function SidebarPanel({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col bg-slate-900">
      <SidebarHeader />
      <SidebarNav onNavigate={onNavigate} />
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-[260px] shrink-0 md:block">
      <SidebarPanel />
    </aside>
  );
}
