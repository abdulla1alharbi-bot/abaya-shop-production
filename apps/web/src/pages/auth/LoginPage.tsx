import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { normalizeUsername, validateUsernameFormat } from "@abaya-shop/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { homeRouteForUser } from "@/lib/homeRoute";
import type { AuthUser } from "@abaya-shop/shared";

type FormValues = {
  username: string;
  password: string;
};

interface LoginResponse {
  success: boolean;
  data: {
    accessToken: string;
    user: AuthUser;
  };
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setAuth = useAuthStore((s) => s.setAuth);
  const user = useAuthStore((s) => s.user);
  const { t } = useTranslation();

  const schema = z.object({
    username: z
      .string()
      .transform((s) => normalizeUsername(s))
      .superRefine((val, ctx) => {
        const err = validateUsernameFormat(val);
        if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, message: err });
      }),
    password: z.string().min(1, t("auth.login.passwordRequired")),
  });

  // Deep link the user was redirected from (e.g. an expired session on /invoices).
  // When absent, fall back to the role-aware home instead of a fixed page.
  const deepLink = (location.state as { from?: { pathname?: string } } | undefined)?.from?.pathname;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: "", password: "" },
  });

  if (user) {
    return <Navigate to={deepLink ?? homeRouteForUser(user)} replace />;
  }

  async function onSubmit(values: FormValues) {
    try {
      const res = await api.post<LoginResponse>("/auth/login", {
        username: values.username,
        password: values.password,
      });
      if (res.data.success && res.data.data) {
        setAuth(res.data.data.user, res.data.data.accessToken);
        void navigate(deepLink ?? homeRouteForUser(res.data.data.user), { replace: true });
      }
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 400) {
        const msg = (e.response?.data as { error?: { message?: string } })?.error?.message;
        if (msg) {
          form.setError("root", { message: msg });
          return;
        }
      }
      form.setError("root", { message: t("auth.login.invalidCredentials") });
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md border shadow-sm">
        <CardHeader className="space-y-1">
          <CardTitle className="text-xl">{t("auth.login.title")}</CardTitle>
          <CardDescription>{t("auth.login.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">{t("auth.login.username")}</Label>
              <Input
                id="username"
                type="text"
                autoComplete="username"
                placeholder={t("auth.login.usernamePlaceholder")}
                className="h-10"
                dir="ltr"
                {...form.register("username")}
              />
              {form.formState.errors.username ? (
                <p className="text-sm text-destructive">{form.formState.errors.username.message}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t("auth.login.password")}</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                className="h-10"
                dir="ltr"
                {...form.register("password")}
              />
              {form.formState.errors.password ? (
                <p className="text-sm text-destructive">{form.formState.errors.password.message}</p>
              ) : null}
            </div>
            {form.formState.errors.root ? (
              <p className="text-sm text-destructive">{form.formState.errors.root.message}</p>
            ) : null}
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? t("auth.login.submitting") : t("auth.login.submit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
