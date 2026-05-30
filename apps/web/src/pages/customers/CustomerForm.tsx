import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { usePermissions } from "@/hooks/usePermissions";

export function CustomerForm() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const { t } = useTranslation();

  const save = useMutation({
    mutationFn: async (form: FormData) => {
      const creditLimitAed = parseFloat(String(form.get("creditLimitAed") ?? "0")) || 0;
      await api.post("/customers", {
        name: String(form.get("name") ?? ""),
        mobile: String(form.get("mobile") ?? ""),
        address: String(form.get("address") ?? "") || undefined,
        notes: String(form.get("notes") ?? "") || undefined,
        creditLimitFils: Math.round(creditLimitAed * 100),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      void navigate("/customers");
    },
  });

  return (
    <div className="mx-auto max-w-md space-y-6">
      <PageHeader title={t("pages.customers.newCustomerTitle")} />
      <form
        className="space-y-4 rounded-lg border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(new FormData(e.currentTarget));
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="name">{t("pages.customers.formNameLabel")}</Label>
          <Input id="name" name="name" required autoComplete="name" className="h-10" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mobile">{t("pages.customers.formMobileLabel")}</Label>
          <Input id="mobile" name="mobile" required inputMode="tel" autoComplete="tel" className="h-10" dir="ltr" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="address">{t("pages.customers.formAddressLabel")}</Label>
          <Input id="address" name="address" className="h-10" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="notes">{t("pages.customers.formNoteLabel")}</Label>
          <Input id="notes" name="notes" className="h-10" />
        </div>
        {can("customers.edit") ? (
          <div className="space-y-2">
            <Label htmlFor="creditLimitAed">{t("pages.customers.formCreditLabel")}</Label>
            <Input
              id="creditLimitAed"
              name="creditLimitAed"
              type="number"
              min={0}
              step={0.01}
              placeholder="0.00"
              className="h-10"
              dir="ltr"
            />
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2 pt-2">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? t("common.saving") : t("common.save")}
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link to="/customers">{t("common.cancel")}</Link>
          </Button>
        </div>
        {save.isError ? <p className="text-sm text-destructive">{getApiErrorMessage(save.error)}</p> : null}
      </form>
    </div>
  );
}
