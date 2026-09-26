import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuthStore } from "@/store/authStore";
import { homeRouteForUser } from "@/lib/homeRoute";

type Props = {
  /** Single permission (ignored if `anyOf` is set). */
  permission?: string;
  /** User needs at least one of these permissions. */
  anyOf?: string[];
  children: ReactNode;
};

/**
 * Renders children only if the user has the required permission(s); otherwise sends
 * them to their own landing page. When that landing page is this very route (a user
 * whose permissions were all revoked), redirecting would loop forever, so a plain
 * no-access notice is shown instead.
 */
export function RequirePermission({ permission, anyOf, children }: Props) {
  const { can, canAny } = usePermissions();
  const user = useAuthStore((s) => s.user);
  const { pathname } = useLocation();

  const allowed = anyOf && anyOf.length > 0 ? canAny(...anyOf) : !permission || can(permission);
  if (allowed) return <>{children}</>;

  const home = homeRouteForUser(user);
  if (home !== pathname) return <Navigate to={home} replace />;
  return (
    <div className="p-8 text-center text-sm text-muted-foreground">
      لا توجد صلاحيات مفعّلة لهذا الحساب — راجع مالك المحل.
      <br />
      This account has no permissions enabled — contact the shop owner.
    </div>
  );
}
