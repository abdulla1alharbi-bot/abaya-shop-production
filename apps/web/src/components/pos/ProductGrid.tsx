import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Package } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";
import { formatAED } from "@/lib/money";
import { useCartStore } from "@/store/cartStore";
import { cn } from "@/lib/utils";

interface Category {
  id: string;
  name: string;
  nameAr: string | null;
}

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  priceFils: number;
  stockQty: number;
  catalogImageUrl: string | null;
  category: Category;
}

export function ProductGrid() {
  const [categoryId, setCategoryId] = useState<string | "ALL">("ALL");
  const addRetailItem = useCartStore((s) => s.addRetailItem);
  const posCustomerId = useCartStore((s) => s.posCustomerId);
  const canAdd = Boolean(posCustomerId);

  const { data: categories } = useQuery({
    queryKey: ["product-categories"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Category[] }>("/products/categories");
      return res.data.data;
    },
  });

  const { data: products, isLoading } = useQuery({
    queryKey: ["products", "pos", categoryId],
    queryFn: async () => {
      const params =
        categoryId === "ALL" ? {} : { categoryId };
      const res = await api.get<{
        success: boolean;
        data: { items: ProductRow[] };
      }>("/products", {
        params: { limit: 200, activeOnly: "true", retailOnly: "true", ...params },
      });
      return res.data.data.items;
    },
  });

  const catButtons = useMemo(() => {
    const list = categories ?? [];
    return [
      { id: "ALL" as const, label: "الكل" },
      ...list.map((c) => ({ id: c.id, label: c.nameAr?.trim() || c.name })),
    ];
  }, [categories]);

  return (
    <Card className="min-h-[320px]">
      <CardContent className="p-4">
        {!canAdd ? (
          <p className="mb-3 rounded-md border border-dashed border-amber-300/80 bg-amber-50/80 px-3 py-2 text-center text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
            Please select a customer first — ثم يمكن إضافة المنتجات.
          </p>
        ) : null}
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {catButtons.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategoryId(c.id)}
              className={cn(
                "whitespace-nowrap rounded-full border px-3 py-2 text-xs font-medium transition-colors sm:py-1.5",
                categoryId === c.id
                  ? "border-brand-600 bg-brand-100 text-brand-900"
                  : "bg-background text-muted-foreground hover:bg-muted",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        {isLoading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">جاري تحميل المنتجات…</p>
        ) : !products?.length ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
            <Package className="h-10 w-10 opacity-50" />
            <p className="text-sm">لا توجد منتجات جاهزة. أضفها من صفحة «جاهز للبيع».</p>
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {products.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() =>
                  addRetailItem({
                    productId: p.id,
                    name: p.name,
                    qty: 1,
                    unitFils: p.priceFils,
                    discountFils: 0,
                    totalFils: p.priceFils,
                  })
                }
                disabled={p.stockQty <= 0 || !canAdd}
                className={cn(
                  "rounded-lg border bg-card p-3 text-right text-sm transition hover:bg-muted/60 active:scale-[0.99]",
                  (p.stockQty <= 0 || !canAdd) && "cursor-not-allowed opacity-50",
                )}
              >
                {p.catalogImageUrl ? (
                  <img
                    src={p.catalogImageUrl}
                    alt=""
                    className="mb-2 h-20 w-full rounded-md object-cover"
                  />
                ) : null}
                <div className="font-medium leading-snug">{p.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">{p.sku}</div>
                <div className="mt-3 flex flex-wrap items-end justify-between gap-2 border-t pt-2">
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">السعر</div>
                    <span className="text-base font-bold text-brand-800">{formatAED(p.priceFils)}</span>
                  </div>
                  <div
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      p.stockQty <= 0
                        ? "bg-destructive/15 text-destructive"
                        : p.stockQty <= 3
                          ? "bg-amber-100 text-amber-900 dark:bg-amber-950/50"
                          : "bg-muted text-foreground",
                    )}
                  >
                    مخزون: {p.stockQty}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
