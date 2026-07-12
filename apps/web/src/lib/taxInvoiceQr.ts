import QRCode from "qrcode";

/**
 * E-invoice QR payload in the TLV format required by KSA (ZATCA Phase 1) and
 * accepted as a rich QR on UAE tax invoices:
 *   tag 1 = seller name, tag 2 = VAT registration number,
 *   tag 3 = invoice timestamp (ISO 8601), tag 4 = total incl. VAT,
 *   tag 5 = VAT amount. Base64 of the concatenated TLV bytes.
 */
function tlvBase64(fields: Array<[tag: number, value: string]>): string {
  const enc = new TextEncoder();
  const parts: number[] = [];
  for (const [tag, value] of fields) {
    const bytes = enc.encode(value);
    parts.push(tag, bytes.length, ...bytes);
  }
  let bin = "";
  for (const b of parts) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function taxInvoiceQrDataUrl(opts: {
  sellerName: string;
  vatNumber: string;
  isoTimestamp: string;
  totalWithVat: string; // e.g. "1150.00"
  vatAmount: string; // e.g. "150.00"
}): Promise<string> {
  const payload = tlvBase64([
    [1, opts.sellerName],
    [2, opts.vatNumber],
    [3, opts.isoTimestamp],
    [4, opts.totalWithVat],
    [5, opts.vatAmount],
  ]);
  return QRCode.toDataURL(payload, { errorCorrectionLevel: "M", margin: 1, width: 140 });
}
