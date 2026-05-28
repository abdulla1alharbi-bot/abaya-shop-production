import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import type { AuthUser } from "@abaya-shop/shared";

interface AuthResponse {
  success: boolean;
  data: {
    accessToken: string;
    user: AuthUser;
  };
}

export function useAuthBootstrap(): boolean {
  const [ready, setReady] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);
  const clearAuth = useAuthStore((s) => s.clearAuth);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.post<AuthResponse>("/auth/refresh", {});
        if (cancelled) return;
        if (res.data.success && res.data.data?.accessToken && res.data.data.user) {
          setAuth(res.data.data.user, res.data.data.accessToken);
        }
      } catch {
        clearAuth();
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setAuth, clearAuth]);

  return ready;
}

export function useLogout() {
  const navigate = useNavigate();
  const clearAuth = useAuthStore((s) => s.clearAuth);

  return useCallback(async () => {
    try {
      await api.post("/auth/logout", {});
    } catch {
      // still clear local session
    }
    clearAuth();
    void navigate("/login", { replace: true });
  }, [clearAuth, navigate]);
}
