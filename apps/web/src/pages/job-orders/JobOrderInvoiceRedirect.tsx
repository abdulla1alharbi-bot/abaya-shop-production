import { Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";

/**
 * Legacy URLs like `/job-orders/:id` resolve to the parent invoice when linked.
 */
export function JobOrderInvoiceRedirect() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["job-order", id, "invoice-redirect"],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { invoiceId: string | null };
      }>(`/job-orders/${id}`);
      return res.data.data;
    },
    enabled: Boolean(id),
  });

  if (!id) return <Navigate to="/invoices" replace />;
  if (isLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">{t("common.loadingData")}</div>
    );
  }
  if (isError || !data) return <Navigate to="/invoices" replace />;
  if (data.invoiceId) return <Navigate to={`/invoices/${data.invoiceId}`} replace />;
  return <Navigate to="/invoices" replace />;
}
