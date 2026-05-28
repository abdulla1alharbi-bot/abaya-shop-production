/** Build a wa.me click-to-chat link. Works on desktop (WhatsApp Web) and mobile (WhatsApp app). */
export function buildWhatsAppLink(phone: string, message: string): string {
  const cleaned = phone.replace(/\D/g, "");
  return `https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`;
}

export function orderReadyMessage(customerName: string, jobNo: number | string): string {
  return `عزيزتي ${customerName}،\nطلبك رقم ${jobNo} جاهز للاستلام الآن. 🎉\nيسعدنا خدمتك.`;
}

export function paymentReminderMessage(
  customerName: string,
  invoiceNo: number | string,
  balanceAed: string,
): string {
  return `السلام عليكم ${customerName}،\nلديكم رصيد مستحق ${balanceAed} درهم على الفاتورة رقم ${invoiceNo}.\nنأمل منكم التكرم بالتواصل لتسوية المبلغ.\nشكراً لكم.`;
}
