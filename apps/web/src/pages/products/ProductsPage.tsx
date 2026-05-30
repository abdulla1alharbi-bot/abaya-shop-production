import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatAED } from "@/lib/money";

export function ProductsPage() {
  const { t } = useTranslation();
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
        title={t("products.title")}
        description={t("products.description", { defaultValue: "Shelf products with price and quantity." })}
        actions={
          <Button asChild size="sm">
            <Link to="/products/new">
              <Plus className="me-1 h-4 w-4" />
              {t("common.add")}
            </Link>
          </Button>
        }
      />
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="px-4 py-3 text-start font-medium">{t("products.colCode")}</th>
              <th className="px-4 py-3 text-start font-medium">{t("products.colName")}</th>
              <th className="px-4 py-3 text-start font-medium">{t("products.colCategory")}</th>
              <th className="px-4 py-3 text-end font-medium">{t("products.colPrice")}</th>
              <th className="px-4 py-3 text-end font-medium">{t("products.colStock")}</th>
              <th className="px-4 py-3 text-start font-medium">{t("products.colStatus")}</th>
              <th className="px-4 py-3 w-20" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  {t("common.loadingData")}
                </td>
              </tr>
            ) : !data?.length ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  {t("products.emptyMessage")}
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
                  <td className="px-4 py-2.5">
                    {p.isActive ? t("status.active") : t("status.inactive")}
                  </td>
                  <td className="px-4 py-2.5 text-end">
                    <Button variant="link" size="sm" className="h-auto p-0" asChild>
                      <Link to={`/products/${p.id}/edit`}>{t("common.edit")}</Link>
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
