import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Package, Scissors } from "lucide-react";
import { GlobalInvoiceSearch } from "@/components/invoices/GlobalInvoiceSearch";
import { PageHeader } from "@/components/shared/PageHeader";
import { CartPanel } from "@/components/pos/CartPanel";
import { ProductGrid } from "@/components/pos/ProductGrid";
import { TailoringIntakePanel } from "@/components/pos/TailoringIntakePanel";
import { PosCustomerBar } from "@/components/pos/PosCustomerBar";
import { useCartStore } from "@/store/cartStore";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";

type PosMode = "retail" | "tailoring";

export function POSPage() {
  const { can } = usePermissions();
  const canRetail = can("pos.readyMade");
  const canTailoring = can("pos.tailoring");
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<PosMode>(() => (canRetail ? "retail" : "tailoring"));
  const posCustomerId = useCartStore((s) => s.posCustomerId);

  useEffect(() => {
    if (mode === "retail" && !canRetail && canTailoring) setMode("tailoring");
    if (mode === "tailoring" && !canTailoring && canRetail) setMode("retail");
  }, [mode, canRetail, canTailoring]);

  useEffect(() => {
    const wanted = searchParams.get("mode");
    if (wanted === "tailoring" && canTailoring) setMode("tailoring");
  }, [searchParams, canTailoring]);

  return (
    <div className="flex min-h-0 flex-col gap-4 pb-[min(28vh,220px)] lg:pb-0">
      <PageHeader
        title="البيع"
        description="أضف للسلة: جاهز من المخزون أو تفصيل. فاتورة واحدة ودفعة واحدة في النهاية."
      />

      <GlobalInvoiceSearch className="max-w-xl" />

      <div className="space-y-3 border-b border-border pb-6">
        <PosCustomerBar variant="pageHero" />
        {!posCustomerId ? (
          <p
            className="rounded-lg border border-amber-300/80 bg-amber-50 px-4 py-3 text-center text-sm font-medium text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
            role="status"
          >
            Please select a customer first
          </p>
        ) : null}
      </div>

      {canRetail || canTailoring ? (
        <div className="flex max-w-lg gap-2 rounded-lg border bg-muted/30 p-1">
          {canRetail ? (
            <button
              type="button"
              onClick={() => setMode("retail")}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-md py-2.5 text-sm font-medium transition-colors",
                mode === "retail"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Package className="h-4 w-4 shrink-0" />
              منتجات جاهزة
            </button>
          ) : null}
          {canTailoring ? (
            <button
              type="button"
              onClick={() => setMode("tailoring")}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-md py-2.5 text-sm font-medium transition-colors",
                mode === "tailoring"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Scissors className="h-4 w-4 shrink-0" />
              تفصيل
            </button>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">لا توجد صلاحية لبيع جاهز أو تفصيل من هذا الحساب.</p>
      )}

      <div className="grid flex-1 gap-4 lg:grid-cols-[3fr_2fr] lg:items-start">
        <section className="min-h-0 space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {mode === "retail" ? "اختر المنتجات" : "بيانات الطلب"}
          </h2>
          {mode === "retail" && canRetail ? (
            <ProductGrid />
          ) : mode === "tailoring" && canTailoring ? (
            <TailoringIntakePanel />
          ) : (
            <p className="text-sm text-muted-foreground">اختر نوع البيع أعلاه.</p>
          )}
        </section>

        <aside
          className={cn(
            "min-h-0",
            "fixed inset-x-0 bottom-0 z-30 max-h-[45vh] overflow-y-auto border-t bg-background p-3 shadow-lg",
            "lg:static lg:z-auto lg:max-h-none lg:overflow-visible lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none",
          )}
        >
          <CartPanel />
        </aside>
      </div>
    </div>
  );
}
