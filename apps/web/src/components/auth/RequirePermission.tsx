import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { usePermissions } from "@/hooks/usePermissions";

type Props = {
  /** Single permission (ignored if `anyOf` is set). */
  permission?: string;
  /** User needs at least one of these permissions. */
  anyOf?: string[];
  children: ReactNode;
};

/** Renders children only if the user has the required permission(s); otherwise redirects to dashboard. */
export function RequirePermission({ permission, anyOf, children }: Props) {
  const { can, canAny } = usePermissions();
  if (anyOf && anyOf.length > 0) {
    if (!canAny(...anyOf)) {
      return <Navigate to="/dashboard" replace />;
    }
  } else if (permission && !can(permission)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}
