import type { AuthUser } from "@abaya-shop/shared";

/**
 * Role-aware landing route.
 *
 * Each persona opens on the screen they actually work in, instead of every
 * role landing on the generic dashboard:
 *  - SELLER                          → POS (the till)
 *  - WORKER / WORKSHOP_SUPERVISOR    → Workshop board (their daily task board)
 *  - everyone else (owner/manager/…) → Dashboard
 *
 * Falls back to capability checks so custom permission sets still get a sensible
 * home even if the role label is unusual.
 */
export function homeRouteForUser(user: AuthUser | null | undefined): string {
  if (!user) return "/dashboard";

  const role = user.role;
  const perms = user.permissions ?? [];
  const can = (p: string) => perms.includes(p);

  // Sales floor → straight to the till (only if they can actually open it,
  // otherwise fall through so a misconfigured role isn't bounced to a guarded
  // page — which could loop when they also lack dashboard.view).
  if (role === "SELLER" && can("pos.use")) return "/pos";

  // Workshop floor → their dedicated daily task board.
  if ((role === "WORKER" || role === "WORKSHOP_SUPERVISOR") && can("jobProcess.view")) {
    return "/workshop/board";
  }

  // Management / accounting → the overview dashboard.
  if (can("dashboard.view")) return "/dashboard";

  // Capability fallbacks for custom permission sets.
  if (can("pos.use")) return "/pos";
  if (can("jobProcess.view")) return "/workshop/board";
  if (can("invoices.view")) return "/invoices";

  return "/dashboard";
}
