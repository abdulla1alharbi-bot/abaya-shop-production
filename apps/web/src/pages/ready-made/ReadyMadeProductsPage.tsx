import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatAED } from "@/lib/money";
import { usePermissions } from "@/hooks/usePermissions";

/** Ready-made retail SKUs only — excludes tailoring service products (`isService`). */
export function ReadyMadeProductsPage() {
  const { can } = usePermissions();
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ["products", "ready-made"],
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
            catalogImageUrl: string | null;
            category: { name: string };
            createdFromInvoiceNo?: number | null;
            createdFromJobNo?: number | null;
            isSample?: boolean;
          }>;
        };
      }>("/products", { params: { limit: 300, retailOnly: "true" } });
      return res.data.data.items;
    },
  });

  return (
    <div>
      <PageHeader
        title={t("readyMade.title")}
        description={t("readyMade.description", { defaultValue: "Shelf products only (ready sale at cashier). Does not include tailoring models or fabric rolls." })}
        actions={
          can("readyMade.create") ? (
            <Button asChild size="sm">
              <Link to="/ready-made/new">
                <Plus className="me-1 h-4 w-4" />
                {t("common.add")}
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="px-3 py-3 text-start font-medium">{t("readyMade.colImage")}</th>
              <th className="px-4 py-3 text-start font-medium">{t("readyMade.colCode")}</th>
              <th className="px-4 py-3 text-start font-medium">{t("readyMade.colName")}</th>
              <th className="px-4 py-3 text-start font-medium">{t("readyMade.colCategory")}</th>
              <th className="px-4 py-3 text-end font-medium">{t("readyMade.colPrice")}</th>
              <th className="px-4 py-3 text-end font-medium">{t("readyMade.colStock")}</th>
              <th className="px-4 py-3 text-start font-medium">{t("readyMade.colStatus")}</th>
              <th className="px-4 py-3 text-start font-medium">{t("readyMade.colSource")}</th>
              <th className="px-4 py-3 w-20" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                  {t("common.loadingData")}
                </td>
              </tr>
            ) : !data?.length ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                  {t("readyMade.emptyMessage", { defaultValue: "No ready-made products yet." })}
                </td>
              </tr>
            ) : (
              data.map((p) => (
                <tr key={p.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2">
                    {p.catalogImageUrl ? (
                      <img
                        src={p.catalogImageUrl}
                        alt=""
                        className="h-10 w-10 rounded border object-cover"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{p.sku}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span>{p.name}</span>
                      {p.isSample ? (
                        <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                          قطعة عرض
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{p.category.name}</td>
                  <td className="px-4 py-2.5 text-end">{formatAED(p.priceFils)}</td>
                  <td className="px-4 py-2.5 text-end tabular-nums">{p.stockQty}</td>
                  <td className="px-4 py-2.5">{p.isActive ? t("status.active") : t("status.inactive")}</td>
                  <td className="px-4 py-2.5 text-xs">
                    {typeof p.createdFromInvoiceNo === "number" ? (
                      <span className="rounded-md border border-cyan-300 bg-cyan-50 px-2 py-1 font-medium text-cyan-900 dark:border-cyan-800 dark:bg-cyan-950/30 dark:text-cyan-100">
                        تم إنشاؤه من فاتورة #{p.createdFromInvoiceNo}
                        {typeof p.createdFromJobNo === "number" ? ` · طلب #${p.createdFromJobNo}` : ""}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-end">
                    {can("readyMade.edit") ? (
                      <Button variant="link" size="sm" className="h-auto p-0" asChild>
                        <Link to={`/ready-made/${p.id}/edit`}>تعديل</Link>
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
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
