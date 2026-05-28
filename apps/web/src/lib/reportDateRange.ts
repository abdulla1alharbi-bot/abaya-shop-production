/** Date-only range for reports: from = start of first day, to = end of last day (API ISO). */

export type ReportDateRange = { from: Date; to: Date };

/** First day of current month → today (date only, local). */
export function defaultReportDateRange(): ReportDateRange {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return { from, to };
}

/** If user picks from > to, swap so the range is valid. */
export function normalizeReportRange(from: Date, to: Date): ReportDateRange {
  const a = from.getTime();
  const b = to.getTime();
  if (a <= b) return { from, to };
  return { from: to, to: from };
}

export function reportRangeToApiParams(from: Date, to: Date) {
  const { from: f, to: t } = normalizeReportRange(from, to);
  const start = new Date(f.getFullYear(), f.getMonth(), f.getDate(), 0, 0, 0, 0);
  const end = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}
