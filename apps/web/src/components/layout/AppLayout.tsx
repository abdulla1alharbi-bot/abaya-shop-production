import { useEffect, useMemo, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Sidebar, SidebarPanel } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { useServerNotificationStore } from "@/store/serverNotificationStore";

const titleKeys: Record<string, string> = {
  "/dashboard": "nav.items.dashboard",
  "/pos": "nav.items.pos",
  "/production": "nav.items.production",
  "/production/samples": "nav.items.productionSamples",
  "/production/samples/performance": "nav.items.productionSamplesPerformance",
  "/invoices": "nav.items.invoices",
  "/ready-made": "nav.items.readyMade",
  "/ready-made/conversions": "nav.items.readyMadeConversions",
  "/fabrics": "nav.items.fabricsMgmt",
  "/models": "nav.items.models",
  "/workers": "nav.items.workers",
  "/payroll": "nav.items.payroll",
  "/customers": "nav.items.customers",
  "/reports": "nav.items.reports",
  "/accounts": "nav.items.accounts",
  "/settings": "nav.items.settings",
  "/workshop/capacity": "nav.items.workshopCapacity",
  "/shifts": "pages.shifts.title",
};

export function AppLayout() {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const fetchNotifications = useServerNotificationStore((s) => s.fetch);
  const { t } = useTranslation();

  useEffect(() => {
    void fetchNotifications();
  }, [location.pathname, fetchNotifications]);

  const title = useMemo(() => {
    const path = location.pathname;
    if (titleKeys[path]) return t(titleKeys[path]);
    const prefix = Object.keys(titleKeys)
      .filter((k) => path.startsWith(k) && k !== "/dashboard")
      .sort((a, b) => b.length - a.length)[0];
    if (prefix) return t(titleKeys[prefix] ?? "common.shopName");
    if (path.startsWith("/customers/")) return path.includes("/new") ? t("pages.customers.newCustomerTitle") : t("pages.customers.detailTitle");
    if (path.startsWith("/invoices/")) return t("pages.invoices.title");
    if (path.startsWith("/workers/")) return path.includes("/new") ? t("pages.workers.newWorkerTitle") : t("pages.workers.detailTitle");
    if (path.startsWith("/ready-made/")) return path.includes("/new") ? t("pages.readyMade.newTitle") : t("pages.readyMade.editTitle");
    if (path.startsWith("/fabrics/")) return path.includes("/new") ? t("pages.fabrics.newTitle") : t("pages.fabrics.editTitle");
    if (path.startsWith("/products/")) return t("pages.products.title");
    if (path.startsWith("/accounts/")) return t("pages.accounts.expensesTitle");
    return t("common.shopName");
  }, [location.pathname, t]);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-[280px] border-0 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>{t("topbar.openMenu")}</SheetTitle>
          </SheetHeader>
          <SidebarPanel onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={title} onOpenMobileNav={() => setMobileNavOpen(true)} />
        <main className="flex-1 px-4 py-5 md:px-8 md:py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
