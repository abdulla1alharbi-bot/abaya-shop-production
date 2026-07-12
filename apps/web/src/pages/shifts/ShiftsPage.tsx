import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { formatAED } from "@/lib/money";
import { usePermissions } from "@/hooks/usePermissions";
import { getApiErrorMessage } from "@/lib/apiErrors";

type CashierShift = {
  id: string;
  status: "OPEN" | "CLOSED" | "APPROVED";
  openedAt: string;
  closedAt: string | null;
  openingBalanceFils: number;
  closingBalanceFils: number | null;
  cashSalesFils: number;
  expectedCashFils: number;
  varianceFils: number | null;
  notes: string | null;
  user: { id: string; name: string; username: string };
  approvedBy: { id: string; name: string } | null;
  approvedAt: string | null;
};

function VarianceBadge({ fils }: { fils: number | null }) {
  if (fils == null) return <span className="text-muted-foreground">—</span>;
  const color =
    fils === 0
      ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200"
      : fils > 0
        ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200"
        : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200";
  const label = fils >= 0 ? `+${formatAED(fils)}` : `-${formatAED(Math.abs(fils))}`;
  return <span className={`rounded px-2 py-0.5 text-xs font-semibold ${color}`}>{label}</span>;
}

export function ShiftsPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const { t } = useTranslation();
  const canManage = can("settings.manage");

  const [openingAed, setOpeningAed] = useState("");
  const [closingAed, setClosingAed] = useState("");
  const [openNotes, setOpenNotes] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["shifts"] });
  };

  /** My current open shift */
  const currentQuery = useQuery({
    queryKey: ["shifts", "current"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: CashierShift | null }>("/shifts/current");
      return res.data.data;
    },
  });

  /** All shifts (manager view) */
  const allShiftsQuery = useQuery({
    queryKey: ["shifts", "all", filterStatus],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: CashierShift[] }>("/shifts", {
        params: filterStatus ? { status: filterStatus } : undefined,
      });
      return res.data.data;
    },
    enabled: canManage,
  });

  const openShift = useMutation({
    mutationFn: async () => {
      const openingBalanceFils = Math.round((parseFloat(openingAed) || 0) * 100);
      await api.post("/shifts/open", { openingBalanceFils, notes: openNotes || undefined });
    },
    onSuccess: () => {
      setOpeningAed("");
      setOpenNotes("");
      invalidate();
    },
  });

  const closeShift = useMutation({
    mutationFn: async (shiftId: string) => {
      const closingBalanceFils = Math.round((parseFloat(closingAed) || 0) * 100);
      await api.post(`/shifts/${shiftId}/close`, {
        closingBalanceFils,
        notes: closeNotes || undefined,
      });
    },
    onSuccess: () => {
      setClosingAed("");
      setCloseNotes("");
      invalidate();
    },
  });

  const approveShift = useMutation({
    mutationFn: async (shiftId: string) => {
      await api.post(`/shifts/${shiftId}/approve`);
    },
    onSuccess: () => invalidate(),
  });

  const current = currentQuery.data;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6" dir="rtl">
      <PageHeader title={t("shifts.title")} />

      {/* Active shift panel */}
      {currentQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : current ? (
        <div className="rounded-xl border-2 border-green-400 bg-green-50 p-5 dark:border-green-700 dark:bg-green-950/30">
          <h2 className="mb-4 text-lg font-bold text-green-900 dark:text-green-100">
            🟢 {t("shifts.openSince", { time: new Date(current.openedAt).toLocaleTimeString("ar-AE") })}
          </h2>
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">{t("shifts.openingBalance")}</p>
              <p className="text-lg font-bold">{formatAED(current.openingBalanceFils)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("shifts.cashSalesSoFar")}</p>
              <p className="text-lg font-bold text-green-700 dark:text-green-300">
                {formatAED(current.cashSalesFils)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("shifts.expectedCashInDrawer")}</p>
              <p className="text-lg font-bold">{formatAED(current.expectedCashFils)}</p>
            </div>
          </div>

          <div className="mt-5 space-y-3 border-t pt-4">
            <h3 className="text-sm font-semibold">{t("shifts.closeShift")}</h3>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label className="text-xs">{t("shifts.actualCashLabel")}</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  className="mt-1 w-40"
                  value={closingAed}
                  onChange={(e) => setClosingAed(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">{t("shifts.notesOptional")}</Label>
                <Input
                  className="mt-1 w-48"
                  placeholder={t("shifts.closeNotesPlaceholder")}
                  value={closeNotes}
                  onChange={(e) => setCloseNotes(e.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="destructive"
                disabled={closeShift.isPending || !closingAed}
                onClick={() => closeShift.mutate(current.id)}
              >
                {closeShift.isPending ? t("shifts.closing") : t("shifts.closeShift")}
              </Button>
            </div>
            {closingAed ? (
              <p className="text-xs text-muted-foreground">
                {t("shifts.expectedVariance")}{" "}
                <strong>
                  {Math.round((parseFloat(closingAed) || 0) * 100) - current.expectedCashFils > 0
                    ? "+"
                    : ""}
                  {formatAED(Math.round((parseFloat(closingAed) || 0) * 100) - current.expectedCashFils)}
                </strong>
              </p>
            ) : null}
            {closeShift.isError ? (
              <p className="text-sm text-destructive">{getApiErrorMessage(closeShift.error)}</p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border-2 border-border bg-muted/30 p-5">
          <h2 className="mb-4 text-base font-bold">{t("shifts.openNewShift")}</h2>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs">{t("shifts.openingCashLabel")}</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="0.00"
                className="mt-1 w-40"
                value={openingAed}
                onChange={(e) => setOpeningAed(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">{t("shifts.notesOptional")}</Label>
              <Input
                className="mt-1 w-48"
                placeholder={t("shifts.openNotesPlaceholder")}
                value={openNotes}
                onChange={(e) => setOpenNotes(e.target.value)}
              />
            </div>
            <Button
              type="button"
              disabled={openShift.isPending}
              onClick={() => openShift.mutate()}
            >
              {openShift.isPending ? t("shifts.opening") : t("shifts.openShift")}
            </Button>
          </div>
          {openShift.isError ? (
            <p className="mt-2 text-sm text-destructive">{getApiErrorMessage(openShift.error)}</p>
          ) : null}
        </div>
      )}

      {/* Manager: all shifts table */}
      {canManage ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold">{t("shifts.logTitle")}</h2>
            <select
              className="rounded-md border px-2 py-1 text-sm"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="">{t("shifts.filterAll")}</option>
              <option value="OPEN">{t("shifts.statusOpen")}</option>
              <option value="CLOSED">{t("shifts.statusClosed")}</option>
              <option value="APPROVED">{t("shifts.statusApproved")}</option>
            </select>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="bg-muted/80 text-xs font-semibold">
                <tr>
                  <th className="px-3 py-2 text-start">{t("shifts.colEmployee")}</th>
                  <th className="px-3 py-2 text-start">{t("shifts.colOpen")}</th>
                  <th className="px-3 py-2 text-start">{t("shifts.colClose")}</th>
                  <th className="px-3 py-2 text-end">{t("shifts.openingBalance")}</th>
                  <th className="px-3 py-2 text-end">{t("shifts.colCashSales")}</th>
                  <th className="px-3 py-2 text-end">{t("shifts.colExpectedCash")}</th>
                  <th className="px-3 py-2 text-end">{t("shifts.colClosingBalance")}</th>
                  <th className="px-3 py-2 text-center">{t("shifts.colVariance")}</th>
                  <th className="px-3 py-2 text-center">{t("shifts.colStatus")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {allShiftsQuery.data?.length ? (
                  allShiftsQuery.data.map((shift) => {
                    const statusLabel =
                      shift.status === "OPEN"
                        ? t("shifts.statusOpen")
                        : shift.status === "CLOSED"
                          ? t("shifts.statusClosed")
                          : t("shifts.statusApproved");
                    const statusColor =
                      shift.status === "OPEN"
                        ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200"
                        : shift.status === "CLOSED"
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                          : "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200";
                    return (
                      <tr key={shift.id} className="border-b border-border/40 hover:bg-muted/20">
                        <td className="px-3 py-2 font-medium">{shift.user.name}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {new Date(shift.openedAt).toLocaleString("ar-AE")}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {shift.closedAt ? new Date(shift.closedAt).toLocaleString("ar-AE") : "—"}
                        </td>
                        <td className="px-3 py-2 text-end font-mono tabular-nums">
                          {formatAED(shift.openingBalanceFils)}
                        </td>
                        <td className="px-3 py-2 text-end font-mono tabular-nums text-green-700 dark:text-green-400">
                          {formatAED(shift.cashSalesFils)}
                        </td>
                        <td className="px-3 py-2 text-end font-mono tabular-nums">
                          {formatAED(shift.expectedCashFils)}
                        </td>
                        <td className="px-3 py-2 text-end font-mono tabular-nums">
                          {shift.closingBalanceFils != null ? formatAED(shift.closingBalanceFils) : "—"}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <VarianceBadge fils={shift.varianceFils} />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`rounded px-2 py-0.5 text-xs font-semibold ${statusColor}`}>
                            {statusLabel}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-end">
                          {shift.status === "CLOSED" ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={approveShift.isPending}
                              onClick={() => approveShift.mutate(shift.id)}
                            >
                              {t("shifts.approve")}
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">
                      {t("shifts.noShifts")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
