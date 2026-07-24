/** Build a wa.me click-to-chat link. Works on desktop (WhatsApp Web) and mobile (WhatsApp app). */
export function buildWhatsAppLink(phone: string, message: string): string {
  const cleaned = phone.replace(/\D/g, "");
  return `https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`;
}

/** Sent once per invoice — only when every piece on it is ready, never per piece. */
export function orderReadyMessage(
  customerName: string,
  invoiceNo: number | string,
  pieceCount?: number,
): string {
  const pieces = pieceCount && pieceCount > 1 ? `\nجميع القطع (${pieceCount}) جاهزة.` : "";
  return `عزيزتي ${customerName}،\nطلبك رقم ${invoiceNo} جاهز للاستلام الآن. 🎉${pieces}\nيسعدنا خدمتك.`;
}

export function paymentReminderMessage(
  customerName: string,
  invoiceNo: number | string,
  balanceAed: string,
): string {
  return `السلام عليكم ${customerName}،\nلديكم رصيد مستحق ${balanceAed} درهم على الفاتورة رقم ${invoiceNo}.\nنأمل منكم التكرم بالتواصل لتسوية المبلغ.\nشكراً لكم.`;
}
