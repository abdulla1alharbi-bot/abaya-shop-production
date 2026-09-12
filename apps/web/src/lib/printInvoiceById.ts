import { api } from "./api";
import { printInvoice } from "./printInvoice";

/**
 * Opens the printable copy of an invoice from anywhere the id is known —
 * the list, the quick preview, or straight after a POS checkout — so the
 * seller never has to walk to the invoice page just to print.
 */
export async function printInvoiceById(invoiceId: string): Promise<void> {
  const [invoice, settings] = await Promise.all([
    api.get<{ success: boolean; data: Record<string, unknown> }>(`/invoices/${invoiceId}`),
    api.get<{ success: boolean; data: Record<string, string> }>("/settings"),
  ]);
  await printInvoice(invoice.data.data, settings.data.data);
}
