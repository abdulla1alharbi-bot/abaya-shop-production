/**
 * Read Express `req.query` values flexibly (string | string[] | undefined).
 * Never throws; missing or invalid values yield defaults or undefined.
 */

export function queryParamString(q: Record<string, unknown>, key: string): string | undefined {
  const v = q[key];
  if (typeof v === "string" && v.length > 0) return v;
  if (Array.isArray(v) && typeof v[0] === "string" && v[0].length > 0) return v[0];
  return undefined;
}

export function parsePageLimit(
  q: Record<string, unknown>,
  options: { defaultPage?: number; defaultLimit?: number; maxLimit?: number } = {},
): { page: number; limit: number } {
  const defaultPage = options.defaultPage ?? 1;
  const defaultLimit = options.defaultLimit ?? 50;
  const maxLimit = options.maxLimit ?? 100;

  const pageRaw = queryParamString(q, "page");
  const limitRaw = queryParamString(q, "limit");

  const page = Math.max(1, Math.floor(Number(pageRaw) || defaultPage));
  let limit = Math.floor(Number(limitRaw) || defaultLimit);
  if (!Number.isFinite(limit) || limit < 1) limit = defaultLimit;
  limit = Math.min(maxLimit, limit);

  return { page, limit };
}

/** Matches `req.query.activeOnly === "true"` */
export function parseActiveOnlyTrue(q: Record<string, unknown>): boolean {
  return queryParamString(q, "activeOnly") === "true";
}

/** Ready-made retail products only (`Product.isService === false`). */
export function parseRetailOnlyTrue(q: Record<string, unknown>): boolean {
  return queryParamString(q, "retailOnly") === "true";
}

export function parseLowOnlyTrue(q: Record<string, unknown>): boolean {
  return queryParamString(q, "lowOnly") === "true";
}

export function parseOptionalInt(q: Record<string, unknown>, key: string): number | undefined {
  const s = queryParamString(q, key);
  if (s === undefined) return undefined;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
}

/** ISO date string or undefined; invalid strings yield Invalid Date — caller should check */
export function parseOptionalDate(q: Record<string, unknown>, key: string): Date | undefined {
  const s = queryParamString(q, key);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Default: first day of current month 00:00 → last day 23:59:59 */
export function parseDateRangeOrDefault(q: Record<string, unknown>): { from: Date; to: Date } {
  const fromOpt = parseOptionalDate(q, "from");
  const toOpt = parseOptionalDate(q, "to");
  if (fromOpt && toOpt) {
    return { from: fromOpt, to: toOpt };
  }
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from, to };
}
