import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";

export function SettingsPage() {
  const { can } = usePermissions();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, string> }>("/settings");
      return res.data.data;
    },
  });

  const save = useMutation({
    mutationFn: async (form: FormData) => {
      const aedToFilsStr = (field: string) => {
        const v = parseFloat(String(form.get(field) ?? ""));
        const fils = Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : 0;
        return String(fils);
      };
      await api.patch("/settings", {
        shop_name: String(form.get("shop_name") ?? ""),
        shop_name_ar: String(form.get("shop_name_ar") ?? ""),
        vat_rate: String(form.get("vat_rate") ?? "5"),
        vat_number: String(form.get("vat_number") ?? ""),
        currency: String(form.get("currency") ?? "AED"),
        default_cutting_wage_fils: aedToFilsStr("default_cutting_aed"),
        default_sewing_wage_fils: aedToFilsStr("default_sewing_aed"),
        default_embroidery_wage_fils: aedToFilsStr("default_embroidery_aed"),
        default_finishing_wage_fils: aedToFilsStr("default_finishing_aed"),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  if (isLoading || !data) {
    return (
      <div>
        <PageHeader title={t("settings.title")} />
        <p className="text-sm text-muted-foreground">{t("common.loadingData")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <PageHeader
        title={t("settings.title")}
        description={t("settings.description")}
      />
      {can("users.view") ? (
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm font-medium">{t("settings.usersSection")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("settings.usersDesc")}</p>
          <Button variant="outline" size="sm" className="mt-3" asChild>
            <Link to="/settings/users">{t("settings.openUsers")}</Link>
          </Button>
        </div>
      ) : null}
      {can("models.view") ? (
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm font-medium">{t("settings.modelsSection")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("settings.modelsDesc")}</p>
          <Button variant="outline" size="sm" className="mt-3" asChild>
            <Link to="/models">{t("settings.openModels")}</Link>
          </Button>
        </div>
      ) : null}
      <form
        className="space-y-4 rounded-lg border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!can("settings.manage")) return;
          save.mutate(new FormData(e.currentTarget));
        }}
      >
        <fieldset disabled={!can("settings.manage")} className="space-y-4 border-0 p-0 disabled:opacity-60">
        <div className="grid gap-2">
          <Label htmlFor="shop_name">{t("settings.shopNameEn")}</Label>
          <Input id="shop_name" name="shop_name" defaultValue={data.shop_name ?? ""} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="shop_name_ar">{t("settings.shopNameAr")}</Label>
          <Input id="shop_name_ar" name="shop_name_ar" defaultValue={data.shop_name_ar ?? ""} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="vat_rate">{t("settings.vatRate")}</Label>
          <Input id="vat_rate" name="vat_rate" defaultValue={data.vat_rate ?? "5"} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="vat_number">{t("settings.vatNumber")}</Label>
          <Input id="vat_number" name="vat_number" defaultValue={data.vat_number ?? ""} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="currency">{t("settings.currency")}</Label>
          <Input id="currency" name="currency" defaultValue={data.currency ?? "AED"} />
        </div>
        <div className="border-t pt-4">
          <p className="mb-3 text-sm font-medium">{t("settings.defaultWagesTitle")}</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-2">
              <Label htmlFor="default_cutting_aed">{t("settings.wageCutting")}</Label>
              <Input
                id="default_cutting_aed"
                name="default_cutting_aed"
                type="number"
                step={0.01}
                min={0}
                defaultValue={
                  data.default_cutting_wage_fils
                    ? String((parseInt(data.default_cutting_wage_fils, 10) || 0) / 100)
                    : "5"
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="default_sewing_aed">{t("settings.wageSewing")}</Label>
              <Input
                id="default_sewing_aed"
                name="default_sewing_aed"
                type="number"
                step={0.01}
                min={0}
                defaultValue={
                  data.default_sewing_wage_fils
                    ? String((parseInt(data.default_sewing_wage_fils, 10) || 0) / 100)
                    : "20"
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="default_embroidery_aed">{t("settings.wageEmbroidery")}</Label>
              <Input
                id="default_embroidery_aed"
                name="default_embroidery_aed"
                type="number"
                step={0.01}
                min={0}
                defaultValue={
                  data.default_embroidery_wage_fils
                    ? String((parseInt(data.default_embroidery_wage_fils, 10) || 0) / 100)
                    : "3"
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="default_finishing_aed">{t("settings.wageFinishing")}</Label>
              <Input
                id="default_finishing_aed"
                name="default_finishing_aed"
                type="number"
                step={0.01}
                min={0}
                defaultValue={
                  data.default_finishing_wage_fils
                    ? String((parseInt(data.default_finishing_wage_fils, 10) || 0) / 100)
                    : "5"
                }
              />
            </div>
          </div>
        </div>
        <Button type="submit" disabled={save.isPending || !can("settings.manage")}>
          {save.isPending ? "…" : t("common.save")}
        </Button>
        {save.isSuccess ? <p className="text-sm text-green-700">{t("settings.saveSuccess")}</p> : null}
        {!can("settings.manage") ? (
          <p className="text-xs text-muted-foreground">{t("settings.viewOnly")}</p>
        ) : null}
        </fieldset>
      </form>
    </div>
  );
}
