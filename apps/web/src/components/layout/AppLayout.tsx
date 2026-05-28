import { useEffect, useMemo, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Sidebar, SidebarPanel } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { useServerNotificationStore } from "@/store/serverNotificationStore";

/** Short Arabic titles for the top bar — matches sidebar wording */
const titles: Record<string, string> = {
  "/dashboard": "الرئيسية",
  "/pos": "البيع — كاشير",
  "/production": "إنتاج الموديلات",
  "/production/samples": "تفصيل للعرض",
  "/production/samples/performance": "أداء موديلات العرض",
  "/invoices": "الفواتير",
  "/ready-made": "جاهز للبيع",
  "/ready-made/conversions": "تحويلات الجاهز",
  "/fabrics": "مخزون القماش",
  "/models": "موديلات التفصيل",
  "/workers": "العمال",
  "/payroll": "مستحقات وأجور",
  "/customers": "العملاء",
  "/reports": "التقارير",
  "/accounts": "الحركة المالية",
  "/settings": "إعدادات المحل",
  "/workshop/capacity": "طاقة الورشة",
  "/shifts": "الورديات",
};

export function AppLayout() {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const fetchNotifications = useServerNotificationStore((s) => s.fetch);

  useEffect(() => {
    void fetchNotifications();
  }, [location.pathname, fetchNotifications]);

  const title = useMemo(() => {
    const path = location.pathname;
    if (titles[path]) return titles[path];
    const prefix = Object.keys(titles)
      .filter((k) => path.startsWith(k) && k !== "/dashboard")
      .sort((a, b) => b.length - a.length)[0];
    if (prefix) return titles[prefix] ?? "محل العبايات";
    if (path.startsWith("/customers/")) return path.includes("/new") ? "عميل جديد" : "بطاقة عميل";
    if (path.startsWith("/invoices/")) return "تفاصيل فاتورة";
    if (path.startsWith("/workers/")) return path.includes("/new") ? "عامل جديد" : "بطاقة عامل";
    if (path.startsWith("/ready-made/")) return path.includes("/new") ? "منتج جاهز جديد" : "تعديل منتج جاهز";
    if (path.startsWith("/fabrics/")) return path.includes("/new") ? "لفة قماش جديدة" : "تعديل لفة قماش";
    if (path.startsWith("/products/")) return "منتج";
    if (path.startsWith("/inventory/fabric-rolls/")) return "لفة قماش";
    if (path.startsWith("/accounts/")) return "المصاريف";
    return "محل العبايات";
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-[280px] border-0 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>القائمة</SheetTitle>
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
