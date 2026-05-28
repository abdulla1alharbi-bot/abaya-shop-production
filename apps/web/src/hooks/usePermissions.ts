import { useAuthStore } from "@/store/authStore";

/** Check if current user has a permission id (from JWT `permissions` list). */
export function usePermissions() {
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const role = useAuthStore((s) => s.user?.role);

  function can(permission: string): boolean {
    return permissions.includes(permission);
  }

  /** True if user has every listed permission */
  function canAll(...keys: string[]): boolean {
    return keys.every((k) => permissions.includes(k));
  }

  /** True if user has at least one permission */
  function canAny(...keys: string[]): boolean {
    return keys.some((k) => permissions.includes(k));
  }

  return { can, canAll, canAny, permissions, role };
}
