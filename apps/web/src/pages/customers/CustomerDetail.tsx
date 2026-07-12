import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { formatAED } from "@/lib/money";

type CustomerNoteRow = {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string; username: string };
};

function useTierBadge() {
  const { t } = useTranslation();
  return (tier: string): { label: string; cls: string } => {
    if (tier === "GOLD")
      return {
        label: t("customerTiers.gold"),
        cls: "bg-yellow-100 text-yellow-900 border-yellow-400 dark:bg-yellow-950/40 dark:text-yellow-200",
      };
    if (tier === "SILVER")
      return {
        label: t("customerTiers.silver"),
        cls: "bg-zinc-200 text-zinc-900 border-zinc-400 dark:bg-zinc-800 dark:text-zinc-200",
      };
    return {
      label: t("customerTiers.bronze"),
      cls: "bg-orange-100 text-orange-900 border-orange-400 dark:bg-orange-950/40 dark:text-orange-200",
    };
  };
}

export function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const tierBadge = useTierBadge();
  const [newNote, setNewNote] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["customer", id],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, unknown> }>(`/customers/${id}`);
      return res.data.data;
    },
    enabled: Boolean(id),
  });

  const saveMeasurement = useMutation({
    mutationFn: async (form: FormData) => {
      await api.post(`/customers/${id}/measurements`, {
        label: String(form.get("mlabel") ?? "").trim() || undefined,
        shoulder: num(form, "shoulder"),
        chest: num(form, "chest"),
        waist: num(form, "waist"),
        hip: num(form, "hip"),
        length: num(form, "length"),
        sleeve: num(form, "sleeve"),
        notes: String(form.get("mnotes") ?? "").trim() || undefined,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customer", id] });
    },
  });

  const addNote = useMutation({
    mutationFn: async (body: string) => {
      await api.post(`/customers/${id}/notes`, { body });
    },
    onSuccess: () => {
      setNewNote("");
      void queryClient.invalidateQueries({ queryKey: ["customer", id] });
    },
  });

  const deleteNote = useMutation({
    mutationFn: async (noteId: string) => {
      await api.delete(`/customers/notes/${noteId}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customer", id] });
    },
  });

  function num(form: FormData, key: string): number | undefined {
    const v = String(form.get(key) ?? "").trim();
    if (!v) return undefined;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }

  if (!id) return null;

  const { t } = useTranslation();

  if (isLoading || !data) {
    return (
      <div>
        <PageHeader title={t("pages.customers.detailTitle")} />
        <p className="text-sm text-muted-foreground">{t("common.loadingData")}</p>
      </div>
    );
  }

  const invoices = (data.invoices as Array<Record<string, unknown>>) ?? [];
  const jobs = (data.jobOrders as Array<Record<string, unknown>>) ?? [];
  const measurements = (data.measurements as Array<Record<string, unknown>>) ?? [];
  const notes = (data.customerNotes as CustomerNoteRow[] | undefined) ?? [];

  const lifetimeValueFils = (data.lifetimeValueFils as number) ?? 0;
  const orderCount = (data.orderCount as number) ?? 0;
  const aov = (data.averageOrderValueFils as number) ?? 0;
  const lastVisitAt = data.lastVisitAt as string | null | undefined;
  const tier = (data.tier as string) ?? "BRONZE";
  const creditLimitFils = (data.creditLimitFils as number) ?? 0;
  const balanceFils = (data.balanceFils as number) ?? 0;
  const tierInfo = tierBadge(tier);

  return (
    <div className="space-y-8">
      <PageHeader
        title={String(data.name)}
        description={t("customers.detail.headerSubtitle", { mobile: String(data.mobile), code: String(data.code) })}
        actions={
          <Link to="/customers" className="text-sm text-brand-700 underline">
            {t("common.back")}
          </Link>
        }
      />

      {/* Phase 3 F7: Customer KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" dir="rtl">
        <div className="rounded-lg border-2 p-3 text-center">
          <p className="text-xs text-muted-foreground">{t("customers.detail.kpiLtv")}</p>
          <p className="mt-1 text-base font-bold">{formatAED(lifetimeValueFils)}</p>
        </div>
        <div className="rounded-lg border-2 p-3 text-center">
          <p className="text-xs text-muted-foreground">{t("customers.detail.kpiOrderCount")}</p>
          <p className="mt-1 text-base font-bold">{orderCount}</p>
        </div>
        <div className="rounded-lg border-2 p-3 text-center">
          <p className="text-xs text-muted-foreground">{t("customers.detail.kpiAov")}</p>
          <p className="mt-1 text-base font-bold">{formatAED(aov)}</p>
        </div>
        <div className="rounded-lg border-2 p-3 text-center">
          <p className="text-xs text-muted-foreground">{t("customers.detail.kpiLastVisit")}</p>
          <p className="mt-1 text-sm font-bold">
            {lastVisitAt ? new Date(lastVisitAt).toLocaleDateString("ar-AE") : "—"}
          </p>
        </div>
        <div className={`rounded-lg border-2 p-3 text-center ${tierInfo.cls}`}>
          <p className="text-xs">{t("customers.detail.kpiTier")}</p>
          <p className="mt-1 text-base font-bold">{tierInfo.label}</p>
        </div>
      </div>

      <div className="rounded-lg border bg-muted/20 p-3 text-sm" dir="rtl">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <p>
            <span className="text-muted-foreground">{t("customers.detail.balanceDue")}</span>
            <span className={`font-semibold ${balanceFils > 0 ? "text-amber-700 dark:text-amber-300" : ""}`}>
              {formatAED(balanceFils)}
            </span>
          </p>
          <p>
            <span className="text-muted-foreground">{t("customers.detail.creditLimit")}</span>
            <span className="font-semibold">
              {creditLimitFils > 0 ? formatAED(creditLimitFils) : t("customers.detail.notSet")}
            </span>
          </p>
          {data.address ? (
            <p>
              <span className="text-muted-foreground">{t("customers.detail.address")}</span>
              {String(data.address)}
            </p>
          ) : null}
        </div>
      </div>

      <div>
        <h2 className="mb-2 font-medium">{t("customers.detail.savedMeasurements")}</h2>
        <div className="mb-4 space-y-2">
          {measurements.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("customers.detail.noMeasurements")}</p>
          ) : (
            measurements.map((m) => (
              <div key={String(m.id)} className="rounded-md border bg-muted/30 p-3 text-xs">
                {m.label ? (
                  <p className="mb-2 font-medium text-foreground">{String(m.label)}</p>
                ) : null}
                <div className="grid grid-cols-3 gap-1 sm:grid-cols-6">
                  {["shoulder", "chest", "waist", "hip", "length", "sleeve"].map((k) =>
                    m[k] != null ? (
                      <span key={k}>
                        {t(`measurements.${k}`)}: {String(m[k])}
                      </span>
                    ) : null,
                  )}
                </div>
                {m.notes ? <p className="mt-1 text-muted-foreground">{String(m.notes)}</p> : null}
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {new Date((m.updatedAt as string) ?? (m.createdAt as string)).toLocaleString()}
                </p>
              </div>
            ))
          )}
        </div>
        <form
          className="grid max-w-xl gap-2 rounded-md border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            saveMeasurement.mutate(new FormData(e.currentTarget));
          }}
        >
          <p className="text-sm font-medium">{t("customers.detail.addMeasurement")}</p>
          <div>
            <Label htmlFor="mlabel">{t("customers.detail.groupNameLabel")}</Label>
            <Input id="mlabel" name="mlabel" placeholder={t("customers.detail.groupNamePlaceholder")} className="mt-1" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Input name="shoulder" placeholder={t("measurements.shoulder")} type="number" step={0.1} />
            <Input name="chest" placeholder={t("measurements.chest")} type="number" step={0.1} />
            <Input name="waist" placeholder={t("measurements.waist")} type="number" step={0.1} />
            <Input name="hip" placeholder={t("measurements.hip")} type="number" step={0.1} />
            <Input name="length" placeholder={t("measurements.length")} type="number" step={0.1} />
            <Input name="sleeve" placeholder={t("measurements.sleeve")} type="number" step={0.1} />
          </div>
          <div>
            <Label htmlFor="mnotes">{t("customers.detail.measurementNotes")}</Label>
            <Input id="mnotes" name="mnotes" />
          </div>
          <Button type="submit" size="sm" disabled={saveMeasurement.isPending}>
            {t("customers.detail.saveMeasurement")}
          </Button>
        </form>
      </div>

      {/* Phase 3 F7: Communication log */}
      <div dir="rtl">
        <h2 className="mb-2 font-medium">{t("customers.detail.notesTitle", { count: notes.length })}</h2>
        <form
          className="mb-3 flex gap-2 rounded-md border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const v = newNote.trim();
            if (v) addNote.mutate(v);
          }}
        >
          <Input
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder={t("customers.detail.notePlaceholder")}
            className="flex-1"
          />
          <Button type="submit" size="sm" disabled={!newNote.trim() || addNote.isPending}>
            {addNote.isPending ? "..." : t("common.add")}
          </Button>
        </form>
        <div className="space-y-2">
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("customers.detail.noNotes")}</p>
          ) : (
            notes.map((n) => (
              <div key={n.id} className="flex items-start gap-3 rounded-md border bg-muted/20 p-3 text-sm">
                <div className="flex-1">
                  <p className="whitespace-pre-wrap">{n.body}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {n.author.name} · {new Date(n.createdAt).toLocaleString("ar-AE")}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-destructive"
                  disabled={deleteNote.isPending}
                  onClick={() => {
                    if (window.confirm(t("customers.detail.confirmDeleteNote"))) deleteNote.mutate(n.id);
                  }}
                >
                  {t("common.delete")}
                </Button>
              </div>
            ))
          )}
        </div>
      </div>

      <div>
        <h2 className="mb-2 font-medium">{t("customers.detail.invoicesTitle")}</h2>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-2 text-left">{t("customers.detail.colInvoice")}</th>
                <th className="px-4 py-2 text-right">{t("customers.detail.colTotal")}</th>
                <th className="px-4 py-2 text-right">{t("customers.detail.colBalance")}</th>
                <th className="px-4 py-2 text-left">{t("customers.detail.colDate")}</th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-4 text-muted-foreground">
                    {t("customers.detail.noInvoices")}
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={String(inv.id)} className="border-b last:border-0">
                    <td className="px-4 py-2">
                      <Link
                        to={`/invoices/${String(inv.id)}`}
                        className="font-mono text-brand-700 underline"
                      >
                        #{String(inv.invoiceNo)}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-right">{formatAED(inv.totalFils as number)}</td>
                    <td className="px-4 py-2 text-right">{formatAED(inv.balanceFils as number)}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {new Date(inv.createdAt as string).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="mb-2 font-medium">{t("customers.detail.jobsTitle")}</h2>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-2 text-left">{t("customers.detail.colJob")}</th>
                <th className="px-4 py-2 text-left">{t("customers.detail.colStage")}</th>
                <th className="px-4 py-2 text-right">{t("customers.detail.colSale")}</th>
                <th className="px-4 py-2 text-right">{t("customers.detail.colBalance")}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-4 text-muted-foreground">
                    {t("customers.detail.noJobs")}
                  </td>
                </tr>
              ) : (
                jobs.map((j) => (
                  <tr key={String(j.id)} className="border-b last:border-0">
                    <td className="px-4 py-2 font-mono">#{String(j.jobNo)}</td>
                    <td className="px-4 py-2">{String(j.stage)}</td>
                    <td className="px-4 py-2 text-right">{formatAED(j.totalFils as number)}</td>
                    <td className="px-4 py-2 text-right">{formatAED(j.balanceFils as number)}</td>
                    <td className="px-4 py-2">
                      <Link
                        className="text-brand-700 underline"
                        to={
                          j.invoiceId
                            ? `/invoices/${String(j.invoiceId)}`
                            : `/job-orders/${String(j.id)}`
                        }
                      >
                        {t("customers.detail.invoiceLink")}
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
