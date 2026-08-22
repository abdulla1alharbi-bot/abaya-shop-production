/**
 * Case-insensitive text search filter.
 *
 * PostgreSQL's LIKE is case-sensitive, so a bare `{ contains: term }` finds
 * "Ahmed" only when the user types the capital A. (It looked fine while the
 * project was on SQLite, whose LIKE is case-insensitive for ASCII — the bug
 * arrived with the Postgres move, silently.) Every text search in the API goes
 * through this helper so no call site has to remember the mode flag.
 *
 * Arabic has no letter case, so this changes nothing for Arabic names; it is
 * English names, SKUs, colors and roll codes that were unfindable.
 */
export function icontains(term: string) {
  return { contains: term, mode: "insensitive" as const };
}
