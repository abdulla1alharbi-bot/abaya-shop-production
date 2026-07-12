import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";
import type { Role } from "@abaya-shop/shared";

type UserRow = {
  id: string;
  username: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: Role;
  isActive: boolean;
};

export function UsersPage() {
  const { can } = usePermissions();
  const { t } = useTranslation();

  const { data: items, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: { items: UserRow[] } }>("/users");
      return res.data.data.items;
    },
    enabled: can("users.view"),
  });

  if (!can("users.view")) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("nav.items.users")}
        description={t("settings.usersDescription")}
        actions={
          can("users.create") ? (
            <Button asChild size="sm">
              <Link to="/settings/users/new">
                <Plus className="me-1 h-4 w-4" />
                {t("settings.newUser")}
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="overflow-x-auto rounded-lg border bg-card shadow-sm">
        <table className="w-full min-w-[800px] text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-start font-medium">{t("settings.colUsername")}</th>
              <th className="px-4 py-3 text-start font-medium">{t("settings.colFullName")}</th>
              <th className="px-4 py-3 text-start font-medium">{t("settings.colRole")}</th>
              <th className="px-4 py-3 text-start font-medium">{t("settings.colStatus")}</th>
              <th className="px-4 py-3 text-start font-medium">{t("pages.customers.colMobile")}</th>
              <th className="px-4 py-3 text-start font-medium">{t("settings.colEmail")}</th>
              <th className="px-4 py-3 text-end font-medium">{t("settings.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                  {t("common.loadingData")}
                </td>
              </tr>
            ) : !items?.length ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                  {t("settings.noUsers")}
                </td>
              </tr>
            ) : (
              items.map((u) => (
                <tr key={u.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-mono font-medium" dir="auto">
                    {u.username}
                  </td>
                  <td className="px-4 py-3">{u.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {t(`roles.${u.role}`, { defaultValue: u.role })}
                  </td>
                  <td className="px-4 py-3">
                    {u.isActive ? (
                      <Badge variant="secondary">{t("settings.statusActive")}</Badge>
                    ) : (
                      <Badge variant="outline">{t("settings.statusInactive")}</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground" dir="ltr">
                    {u.phone ?? "—"}
                  </td>
                  <td className="max-w-[180px] truncate px-4 py-3 text-xs text-muted-foreground" dir="ltr">
                    {u.email ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-end">
                    {can("users.edit") ? (
                      <Button variant="ghost" size="sm" asChild>
                        <Link to={`/settings/users/${u.id}/edit`}>
                          <Pencil className="me-1 h-4 w-4" />
                          {t("common.edit")}
                        </Link>
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
