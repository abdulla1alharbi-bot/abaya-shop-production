/** Turns Arabic-Indic digits and the Arabic decimal/thousands marks into plain ASCII. */
function normalizeDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".")
    .replace(/٬/g, "");
}

/** "5" / "٥" / "12.50" → fils; empty or not a number → null. */
export function parseAedToFils(raw: string): number | null {
  const s = normalizeDigits(raw).trim();
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** "1, 0.5 ، 15" → [100, 50, 1500]. Accepts commas (Latin or Arabic), spaces and new lines. */
export function parseAedList(raw: string): number[] {
  return normalizeDigits(raw)
    .split(/[\s,،;]+/)
    .map((x) => parseAedToFils(x))
    .filter((x): x is number => x !== null);
}

export type BalanceSort = "balanceDesc" | "balanceAsc" | "oldest" | "newest" | "invoiceNo";

export type BalanceFilter = {
  minFils: number | null;
  maxFils: number | null;
  excludeFils: number[];
  sort: BalanceSort;
};

type Row = { invoiceNo: number; createdAt: string; balanceFils: number };

/** Applies the amount filter (min and max inclusive, exact amounts excluded) and the sort. */
export function applyBalanceFilter<T extends Row>(rows: T[], f: BalanceFilter): T[] {
  const excluded = new Set(f.excludeFils);
  const kept = rows.filter(
    (r) =>
      (f.minFils === null || r.balanceFils >= f.minFils) &&
      (f.maxFils === null || r.balanceFils <= f.maxFils) &&
      !excluded.has(r.balanceFils),
  );
  const time = (r: Row) => new Date(r.createdAt).getTime();
  const cmp: Record<BalanceSort, (a: T, b: T) => number> = {
    balanceDesc: (a, b) => b.balanceFils - a.balanceFils || a.invoiceNo - b.invoiceNo,
    balanceAsc: (a, b) => a.balanceFils - b.balanceFils || a.invoiceNo - b.invoiceNo,
    oldest: (a, b) => time(a) - time(b) || a.invoiceNo - b.invoiceNo,
    newest: (a, b) => time(b) - time(a) || b.invoiceNo - a.invoiceNo,
    invoiceNo: (a, b) => a.invoiceNo - b.invoiceNo,
  };
  return [...kept].sort(cmp[f.sort]);
}
