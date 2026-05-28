/** Mirrors API `InvoiceFulfillmentStatus` — keep in sync with apps/api/src/utils/invoiceFulfillment.ts */
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

export function relatedInvoiceRowLabel(inv: {
  isVoid: boolean;
  deliveredAt?: string | null;
  balanceFils: number;
}): string {
  if (inv.isVoid) return "ملغاة";
  if (inv.deliveredAt) return "مُسلَّمة";
  if (inv.balanceFils <= 0) return "مسددة";
  return "غير مسددة";
}
