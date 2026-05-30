import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { WORK_TYPES } from "@abaya-shop/shared";
import { workTypeLabel } from "@/lib/jobOrderUi";

export function WorkerForm() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [specs, setSpecs] = useState<string[]>([]);

  const { data: existing, isLoading } = useQuery({
    queryKey: ["worker", id],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, unknown> }>(`/workers/${id}`);
      return res.data.data;
    },
    enabled: !isNew && Boolean(id),
  });

  useEffect(() => {
    if (!existing?.specializations) {
      setSpecs([]);
      return;
    }
    try {
      const p = JSON.parse(String(existing.specializations));
      setSpecs(Array.isArray(p) ? p : []);
    } catch {
      setSpecs([]);
    }
  }, [existing]);

  const { data: defaultRates } = useQuery({
    queryKey: ["piece-rates", "defaults"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Array<{ workType: string; rateFils: number }> }>(
        "/workers/defaults/piece-rates",
      );
      return res.data.data;
    },
  });

  const save = useMutation({
    mutationFn: async (form: FormData) => {
      const payload = {
        name: String(form.get("name") ?? "").trim(),
        role: String(form.get("role") ?? "").trim(),
        phone: String(form.get("phone") ?? "").trim() || undefined,
        nationality: String(form.get("nationality") ?? "").trim() || undefined,
        passportNo: String(form.get("passportNo") ?? "").trim() || undefined,
        notes: String(form.get("notes") ?? "").trim() || undefined,
        specializations: specs.length ? JSON.stringify(specs) : null,
        ...(isNew ? {} : { isActive: String(form.get("isActive")) === "on" }),
      };
      if (isNew) {
        await api.post("/workers", { ...payload, isActive: true });
      } else {
        await api.patch(`/workers/${id}`, payload);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workers"] });
      void navigate(isNew ? "/workers" : `/workers/${id}`);
    },
  });

  const addPieceRate = useMutation({
    mutationFn: async ({ workType, rateAed }: { workType: string; rateAed: string }) => {
      const rateFils = Math.round((parseFloat(rateAed) || 0) * 100);
      await api.post(`/workers/${id}/piece-rates`, { workType, rateFils });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["worker", id] });
    },
  });

  const deleteRate = useMutation({
    mutationFn: async (rateId: string) => {
      await api.delete(`/workers/${id}/piece-rates/${rateId}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["worker", id] });
    },
  });

  if (!isNew && isLoading) {
    return (
      <div>
        <PageHeader title={t("workers.workerLabel")} />
        <p className="text-sm text-muted-foreground">{t("common.loadingData")}</p>
      </div>
    );
  }

  const pieceRates = (existing?.pieceRates as Array<{ id: string; workType: string; rateFils: number }>) ?? [];

  function toggleSpec(wt: string) {
    setSpecs((prev) => (prev.includes(wt) ? prev.filter((x) => x !== wt) : [...prev, wt]));
  }

  return (
    <div className="mx-auto max-w-lg space-y-8 pb-8">
      <PageHeader title={isNew ? t("workers.newTitle") : t("workers.editTitle")} />

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(new FormData(e.currentTarget));
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="name">{t("workers.formNameLabel")}</Label>
          <Input
            id="name"
            name="name"
            required
            defaultValue={existing ? String(existing.name ?? "") : ""}
            key={String(existing?.name ?? "n")}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="role">{t("workers.formRoleLabel")}</Label>
          <Input
            id="role"
            name="role"
            placeholder={t("workers.formRolePlaceholder")}
            required
            defaultValue={existing ? String(existing.role ?? "") : ""}
            key={String(existing?.role ?? "r")}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="phone">{t("workers.formPhoneLabel")}</Label>
          <Input
            id="phone"
            name="phone"
            inputMode="tel"
            defaultValue={existing ? String(existing.phone ?? "") : ""}
          />
        </div>

        <div>
          <Label className="mb-2 block">{t("workers.formSpecialtyLabel")}</Label>
          <div className="flex flex-wrap gap-2">
            {WORK_TYPES.map((wt) => (
              <label
                key={wt}
                className="flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-1 text-xs"
              >
                <input
                  type="checkbox"
                  checked={specs.includes(wt)}
                  onChange={() => toggleSpec(wt)}
                  className="rounded"
                />
                {workTypeLabel(wt, t)}
              </label>
            ))}
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="notes">{t("workers.formNotesLabel")}</Label>
          <textarea
            id="notes"
            name="notes"
            className="min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder={t("workers.formNotesPlaceholder")}
            defaultValue={existing ? String(existing.notes ?? "") : ""}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="nationality">{t("workers.formNationalityLabel")}</Label>
          <Input
            id="nationality"
            name="nationality"
            defaultValue={existing ? String(existing.nationality ?? "") : ""}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="passportNo">{t("workers.formPassportLabel")}</Label>
          <Input
            id="passportNo"
            name="passportNo"
            defaultValue={existing ? String(existing.passportNo ?? "") : ""}
          />
        </div>
        {!isNew ? (
          <div className="flex items-center gap-2">
            <input
              id="isActive"
              name="isActive"
              type="checkbox"
              defaultChecked={existing ? Boolean(existing.isActive) : true}
            />
            <Label htmlFor="isActive">{t("workers.formActiveLabel")}</Label>
          </div>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? t("common.saving") : t("common.save")}
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link to={isNew ? "/workers" : `/workers/${id}`}>{t("common.cancel")}</Link>
          </Button>
        </div>
        {save.isError ? (
          <p className="text-sm text-destructive">{(save.error as Error).message || t("common.saveFailed")}</p>
        ) : null}
      </form>

      {!isNew && id ? (
        <section className="rounded-lg border bg-card p-4">
          <h2 className="mb-2 font-semibold">{t("workers.defaultPieceRatesTitle")}</h2>
          <p className="mb-3 text-xs text-muted-foreground">{t("workers.defaultPieceRatesNote")}</p>
          {defaultRates && defaultRates.length > 0 ? (
            <ul className="mb-4 text-xs text-muted-foreground">
              {defaultRates.map((r) => (
                <li key={r.workType}>
                  {workTypeLabel(r.workType, t)}: {(r.rateFils / 100).toFixed(2)} AED
                </li>
              ))}
            </ul>
          ) : null}
          <div className="space-y-2">
            {pieceRates.map((pr) => (
              <div
                key={pr.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border px-2 py-1.5 text-sm"
              >
                <span>{workTypeLabel(pr.workType, t)}</span>
                <span className="font-mono">{(pr.rateFils / 100).toFixed(2)} AED</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => deleteRate.mutate(pr.id)}
                >
                  {t("common.delete")}
                </Button>
              </div>
            ))}
          </div>
          {deleteRate.isError ? (
            <p className="text-sm text-destructive">{getApiErrorMessage(deleteRate.error)}</p>
          ) : null}
          <AddRateForm
            onAdd={(workType, rateAed) => addPieceRate.mutate({ workType, rateAed })}
            disabled={addPieceRate.isPending}
          />
          {addPieceRate.isError ? (
            <p className="text-sm text-destructive">{getApiErrorMessage(addPieceRate.error)}</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function AddRateForm({
  onAdd,
  disabled,
}: {
  onAdd: (workType: string, rateAed: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [wt, setWt] = useState("CUTTING");
  const [rate, setRate] = useState("");
  return (
    <div className="mt-4 flex flex-wrap items-end gap-2 border-t pt-3">
      <div>
        <Label className="text-xs">{t("workers.workType")}</Label>
        <select
          className="mt-1 flex h-9 rounded-md border bg-background px-2 text-sm"
          value={wt}
          onChange={(e) => setWt(e.target.value)}
        >
          {WORK_TYPES.map((x) => (
            <option key={x} value={x}>
              {t(`workTypes.${x}`)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label className="text-xs">{t("workers.piecePriceAED")}</Label>
        <Input className="mt-1 h-9 w-28" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0" />
      </div>
      <Button type="button" size="sm" disabled={disabled} onClick={() => onAdd(wt, rate)}>
        {t("workers.addPrice")}
      </Button>
    </div>
  );
}
