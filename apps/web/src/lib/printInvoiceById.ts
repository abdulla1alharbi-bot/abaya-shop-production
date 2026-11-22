import { api } from "./api";
import { openPrintWindow, printInvoice } from "./printInvoice";

/**
 * Opens the printable copy of an invoice from anywhere the id is known —
 * the list, the quick preview, or straight after a POS checkout — so the
 * seller never has to walk to the invoice page just to print.
 *
 * Must be called straight from the click: the window opens before the fetch so
 * the popup blocker still sees the click. Shop settings come with the invoice
 * (sellers can't read /settings).
 */
export async function printInvoiceById(invoiceId: string, opts?: { shopCopies?: number }): Promise<void> {
  const win = openPrintWindow();
  if (!win) return;
  try {
    const invoice = await api.get<{ success: boolean; data: Record<string, unknown> }>(`/invoices/${invoiceId}`);
    await printInvoice(invoice.data.data, undefined, win, opts);
  } catch (err) {
    win.close();
    throw err;
  }
}
