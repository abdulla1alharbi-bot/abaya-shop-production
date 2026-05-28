import {
  Activity,
  BarChart3,
  Clock,
  CreditCard,
  FileText,
  Home,
  Layers,
  Package,
  Receipt,
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
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuthStore } from "@/store/authStore";

const ROLE_LABELS_AR: Record<string, string> = {
  OWNER: "مالك",
  MANAGER: "مدير",
  ADMIN: "مسؤول",
  SELLER: "بائع",
  WORKER: "عامل ورشة",
  WORKSHOP_SUPERVISOR: "مشرف ورشة",
  ACCOUNTANT: "محاسب",
};

type NavEntry = {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Permission id, or "auth" = any logged-in user */
  permission?: string | "auth";
  /** If set, user needs at least one of these (takes precedence over `permission`). */
  anyOf?: string[];
};

const navGroups: Array<{ id: string; title: string; items: NavEntry[] }> = [
  {
    id: "day",
    title: "اليوم",
    items: [
      { to: "/dashboard", label: "الرئيسية", icon: Home, permission: "dashboard.view" },
      { to: "/pos", label: "البيع — كاشير", icon: ShoppingCart, permission: "pos.use" },
      {
        to: "/production",
        label: "إنتاج الموديلات",
        icon: Layers,
        anyOf: ["jobProcess.view", "jobProcess.update", "readyMade.create"],
      },
      {
        to: "/production/samples",
        label: "تفصيل للعرض",
        icon: Layers,
        anyOf: ["jobProcess.view", "jobProcess.update", "readyMade.create"],
      },
      {
        to: "/production/samples/performance",
        label: "أداء موديلات العرض",
        icon: BarChart3,
        anyOf: ["reports.sales"],
      },
    ],
  },
  {
    id: "stock",
    title: "المخزون والموديلات",
    items: [
      { to: "/ready-made", label: "جاهز للبيع", icon: Shirt, permission: "readyMade.view" },
      {
        to: "/ready-made/conversions",
        label: "تحويلات الجاهز",
        icon: FileText,
        anyOf: ["readyMade.view", "jobProcess.view"],
      },
      { to: "/fabrics", label: "القماش", icon: Package, permission: "fabrics.view" },
      { to: "/models", label: "موديلات التفصيل", icon: Layers, permission: "models.view" },
    ],
  },
  {
    id: "orders",
    title: "الفواتير والعملاء",
    items: [
      { to: "/invoices", label: "الفواتير", icon: FileText, permission: "invoices.view" },
      { to: "/customers", label: "العملاء", icon: UserCircle, permission: "customers.view" },
    ],
  },
  {
    id: "workshop",
    title: "الورشة",
    items: [
      { to: "/invoices", label: "متابعة مراحل التفصيل", icon: FileText, permission: "jobProcess.view" },
      { to: "/workers", label: "العمال", icon: Users, permission: "workers.view" },
      { to: "/payroll", label: "مستحقات وأجور", icon: Wallet, permission: "workers.wages" },
      { to: "/workshop/capacity", label: "طاقة الورشة", icon: Activity, permission: "jobProcess.view" },
    ],
  },
  {
    id: "admin",
    title: "الحسابات",
    items: [
      {
        to: "/reports",
        label: "التقارير",
        icon: BarChart3,
        anyOf: [
          "reports.sales",
          "reports.wages",
          "reports.balances",
          "reports.financial",
          "reports.mostRequested",
        ],
      },
      { to: "/shifts", label: "الورديات (الكاشير)", icon: Clock, permission: "pos.use" },
      { to: "/accounts", label: "الحركة المالية", icon: CreditCard, permission: "reports.financial" },
      { to: "/accounts/expenses", label: "المصروفات", icon: Receipt, permission: "expenses.view" },
      { to: "/settings", label: "إعدادات المحل", icon: Settings, permission: "settings.view" },
      { to: "/settings/users", label: "المستخدمين والصلاحيات", icon: UserCog, permission: "users.view" },
      { to: "/settings/audit", label: "سجل التدقيق", icon: Shield, permission: "audit.view" },
    ],
  },
];

function NavItem({
  item,
  onNavigate,
}: {
  item: NavEntry;
  onNavigate?: () => void;
}) {
  const { can, canAny } = usePermissions();
  if (item.anyOf?.length) {
    if (!canAny(...item.anyOf)) return null;
  } else if (item.permission !== "auth" && item.permission && !can(item.permission)) return null;
  const Icon = item.icon;
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
      <span>{item.label}</span>
    </NavLink>
  );
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-1 flex-col gap-0 overflow-y-auto p-2">
      {navGroups.map((group) => (
        <div key={group.id} className="mb-1">
          <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            {group.title}
          </p>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => (
              <NavItem key={item.to} item={item} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function SidebarHeader() {
  const user = useAuthStore((s) => s.user);

  return (
    <div className="border-b border-slate-800 px-4 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">نظام إدارة</p>
      <h1 className="mt-0.5 text-base font-bold text-white">محل العبايات</h1>
      {user ? (
        <div className="mt-3 rounded-lg bg-slate-800/70 px-3 py-2.5">
          <p className="truncate text-sm font-semibold text-white">{user.name}</p>
          <p className="mt-0.5 text-[11px] font-medium text-brand-300">
            {ROLE_LABELS_AR[user.role] ?? user.role}
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
