import { Navigate, useParams } from "react-router-dom";

/** Old `/invoices/:id/process` URL — workflow lives on the invoice detail page. */
export function InvoiceProcessRedirect() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <Navigate to="/invoices" replace />;
  return <Navigate to={`/invoices/${id}`} replace />;
}
