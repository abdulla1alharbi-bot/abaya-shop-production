import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { formatAED } from "@/lib/money";
import { usePermissions } from "@/hooks/usePermissions";

export function AccountsPage() {
  const { can } = usePermissions();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [incomeDesc, setIncomeDesc] = useState("");
  const [incomeAmount, setIncomeAmount] = useState("");

  const addIncome = useMutation({
    mutationFn: async () => {
      await api.post("/income", {
        description: incomeDesc.trim(),
        amountFils: Math.round((parseFloat(incomeAmount) || 0) * 100),
      });
    },
    onSuccess: () => {
      setIncomeDesc("");
      setIncomeAmount("");
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const { data } = useQuery({
    queryKey: ["accounts", "summary", start.toISOString(), end.toISOString()],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, unknown> }>(
        "/reports/summary",
        {
          params: { from: start.toISOString(), to: end.toISOString() },
        },
      );
      return res.data.data;
    },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <PageHeader
        title={t("accounts.title")}
        description={t("accounts.description")}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/accounts/expenses">{t("accounts.expensesBtn")}</Link>
          </Button>
        }
      />

      {data ? (
        <div className="grid gap-3 rounded-lg border bg-card p-4 text-sm sm:grid-cols-2">
          <p>
            <span className="text-muted-foreground">{t("accounts.salesLabel")}</span>
            {formatAED(data.salesTotalFils as number)}
          </p>
          <p>
            <span className="text-muted-foreground">{t("accounts.cashLabel")}</span>
            {formatAED(data.collectedFils as number)}
          </p>
          <p>
            <span className="text-muted-foreground">{t("accounts.expensesLabel")}</span>
            {formatAED(data.expensesTotalFils as number)}
          </p>
          <p>
            <span className="text-muted-foreground">{t("accounts.extraIncomeLabel")}</span>
            {formatAED(data.incomeTotalFils as number)}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("common.loadingData")}</p>
      )}

      {can("reports.financial") ? (
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium">{t("accounts.addIncomeTitle")}</h2>
          <p className="text-xs text-muted-foreground">{t("accounts.addIncomeNote")}</p>
          <div className="grid gap-2">
            <Label htmlFor="inc-desc">{t("accounts.descriptionLabel")}</Label>
            <Input
              id="inc-desc"
              value={incomeDesc}
              onChange={(e) => setIncomeDesc(e.target.value)}
              placeholder={t("accounts.descriptionPlaceholder")}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="inc-amt">{t("accounts.amountLabel")}</Label>
            <Input
              id="inc-amt"
              type="number"
              step={0.01}
              min={0.01}
              value={incomeAmount}
              onChange={(e) => setIncomeAmount(e.target.value)}
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={addIncome.isPending || !incomeDesc.trim()}
            onClick={() => addIncome.mutate()}
          >
            {addIncome.isPending ? "…" : t("common.save")}
          </Button>
          {addIncome.isError ? (
            <p className="text-sm text-destructive">{getApiErrorMessage(addIncome.error)}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
