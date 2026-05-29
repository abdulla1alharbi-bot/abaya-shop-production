/** Mirrors API `InvoiceFulfillmentStatus` — keep in sync with apps/api/src/utils/invoiceFulfillment.ts */
export function invoiceFulfillmentKey(s: string): string {
  switch (s) {
    case "VOID":
      return "status.fulfillment.VOID";
    case "DELIVERED":
      return "status.fulfillment.DELIVERED";
    case "READY_FOR_DELIVERY":
      return "status.fulfillment.READY_FOR_DELIVERY";
    case "IN_WORKSHOP":
      return "status.fulfillment.IN_WORKSHOP";
    case "NO_TAILORING":
      return "status.fulfillment.NO_TAILORING";
    default:
      return s;
  }
}

/** @deprecated Use invoiceFulfillmentKey with t() instead */
export function invoiceFulfillmentLabel(s: string): string {
  switch (s) {
    case "VOID":
      return "ملغاة";
    case "DELIVERED":
      return "تم التسليم";
    case "READY_FOR_DELIVERY":
      return "جاهز للتسليم";
    case "IN_WORKSHOP":
      return "قيد التفصيل بالورشة";
    case "NO_TAILORING":
      return "بدون تفصيل (بيع جاهز)";
    default:
      return s;
  }
}

export function relatedInvoiceRowKey(inv: {
  isVoid: boolean;
  deliveredAt?: string | null;
  balanceFils: number;
}): string {
  if (inv.isVoid) return "status.relatedInvoice.void";
  if (inv.deliveredAt) return "status.relatedInvoice.delivered";
  if (inv.balanceFils <= 0) return "status.relatedInvoice.paid";
  return "status.relatedInvoice.unpaid";
}

/** @deprecated Use relatedInvoiceRowKey with t() instead */
export function relatedInvoiceRowLabel(inv: {
  isVoid: boolean;
  deliveredAt?: string | null;
  balanceFils: number;
}): string {
  if (inv.isVoid) return "ملغاة";
  if (inv.deliveredAt) return "مُسلَّمة";
  if (inv.balanceFils <= 0) return "مسددة";
  return "غير مسددة";
}
