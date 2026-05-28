import { useAuthStore } from "@/store/authStore";

/** Workshop users: operational access only; sales/customer money hidden in UI. */
export function useIsWorker(): boolean {
  return useAuthStore((s) => {
    const role = s.user?.role;
    return role === "WORKER" || role === "WORKSHOP_SUPERVISOR";
  });
}
