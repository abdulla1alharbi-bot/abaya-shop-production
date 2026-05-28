import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatAED } from "@/lib/money";

export function ProductsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["products", "list"],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: {
          items: Array<{
            id: string;
            sku: string;
            name: string;
            priceFils: number;
            stockQty: number;
            isActive: boolean;
            category: { name: string };
          }>;
        };
      }>("/products", { params: { limit: 200 } });
      return res.data.data.items;
    },
  });

  return (
    <div>
      <PageHeader
        title="منتجات جاهزة"
        description="ما يُباع من الرف مع السعر والكمية."
        actions={
          <Button asChild size="sm">
            <Link to="/products/new">
              <Plus className="me-1 h-4 w-4" />
              إضافة
            </Link>
          </Button>
        }
      />
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="px-4 py-3 text-start font-medium">الرمز</th>
              <th className="px-4 py-3 text-start font-medium">الاسم</th>
              <th className="px-4 py-3 text-start font-medium">التصنيف</th>
              <th className="px-4 py-3 text-end font-medium">السعر</th>
              <th className="px-4 py-3 text-end font-medium">المخزون</th>
              <th className="px-4 py-3 text-start font-medium">الحالة</th>
              <th className="px-4 py-3 w-20" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  جاري التحميل…
                </td>
              </tr>
            ) : !data?.length ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  لا منتجات بعد.
                </td>
              </tr>
            ) : (
              data.map((p) => (
                <tr key={p.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{p.sku}</td>
                  <td className="px-4 py-2.5">{p.name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{p.category.name}</td>
                  <td className="px-4 py-2.5 text-end">{formatAED(p.priceFils)}</td>
                  <td className="px-4 py-2.5 text-end tabular-nums">{p.stockQty}</td>
                  <td className="px-4 py-2.5">{p.isActive ? "نشط" : "موقوف"}</td>
                  <td className="px-4 py-2.5 text-end">
                    <Button variant="link" size="sm" className="h-auto p-0" asChild>
                      <Link to={`/products/${p.id}/edit`}>تعديل</Link>
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
