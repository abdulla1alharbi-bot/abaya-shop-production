/** Amounts from API are in fils (1 AED = 100 fils). */
export function formatAED(fils: number): string {
  return (fils / 100).toLocaleString("en-AE", {
    style: "currency",
    currency: "AED",
    minimumFractionDigits: 2,
  });
}

export function parseAedToFils(input: string): number | null {
  const n = parseFloat(input.replace(/,/g, ""));
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100);
}

export function calcVatFils(taxableFils: number, vatPercent: number): number {
  return Math.round((taxableFils * vatPercent) / 100);
}

export function formatPercent(n: number): string {
  return `${Math.round(n)}%`;
}
