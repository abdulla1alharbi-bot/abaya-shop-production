import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

type ZReportData = {
  shift: CashierShift;
  byMethod: Array<{ method: "CASH" | "CARD" | "TRANSFER"; totalFils: number; count: number }>;
  totalCollectedFils: number;
  invoiceCount: number;
  invoices: Array<{ invoiceNo: number; totalFils: number; paidFils: number; createdAt: string }>;
};

const Z_METHOD_LABELS: Record<string, string> = {
  CASH: "كاش / Cash",
  CARD: "شبكة / Card",
  TRANSFER: "تحويل / Transfer",
};

function zAed(f: number): string {
  return `AED ${(f / 100).toFixed(2)}`;
}

/** Opens a print-friendly Z-report in a new window (same approach as printInvoice). */
function printZReport(r: ZReportData): void {
  const s = r.shift;
  const varianceColor = (s.varianceFils ?? 0) < 0 ? "#b91c1c" : "#15803d";
  const methodRows = r.byMethod
    .map(
      (m) => `<tr>
        <td>${Z_METHOD_LABELS[m.method] ?? m.method}</td>
        <td class="c">${m.count}</td>
        <td class="e">${zAed(m.totalFils)}</td>
      </tr>`,
    )
    .join("");
  const invoiceRows = r.invoices
    .map(
      (inv) => `<tr>
        <td>#${inv.invoiceNo}</td>
        <td class="e">${zAed(inv.totalFils)}</td>
        <td class="e">${zAed(inv.paidFils)}</td>
        <td class="c">${new Date(inv.createdAt).toLocaleTimeString("ar-AE")}</td>
      </tr>`,
    )
    .join("");
  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<title>تقرير Z / Z-Report</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #111; direction: rtl; padding: 24px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .meta { color: #555; font-size: 12px; margin-bottom: 16px; }
  h2 { font-size: 13px; margin: 16px 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #111; color: #fff; padding: 6px 8px; font-size: 11px; text-align: start; }
  td { padding: 5px 8px; border-bottom: 1px solid #eee; }
  .e { text-align: end; font-variant-numeric: tabular-nums; }
  .c { text-align: center; }
  .variance { font-weight: 700; color: ${varianceColor}; }
  @media print { @page { margin: 1cm; } }
</style>
</head>
<body>
  <h1>تقرير Z / Z-Report</h1>
  <div class="meta">
    الكاشير: ${s.user.name}<br/>
    الفتح: ${new Date(s.openedAt).toLocaleString("ar-AE")}<br/>
    الإغلاق: ${s.closedAt ? new Date(s.closedAt).toLocaleString("ar-AE") : "—"}
  </div>
  <h2>التسوية / Reconciliation</h2>
  <table>
    <tr><td>رصيد افتتاحي</td><td class="e">${zAed(s.openingBalanceFils)}</td></tr>
    <tr><td>مبيعات كاش</td><td class="e">${zAed(s.cashSalesFils)}</td></tr>
    <tr><td>المتوقع في الدرج</td><td class="e">${zAed(s.expectedCashFils)}</td></tr>
    <tr><td>الفعلي عند الإغلاق</td><td class="e">${s.closingBalanceFils != null ? zAed(s.closingBalanceFils) : "—"}</td></tr>
    <tr><td>الفرق</td><td class="e variance">${s.varianceFils != null ? `${s.varianceFils > 0 ? "+" : ""}${zAed(s.varianceFils)}` : "—"}</td></tr>
  </table>
  <h2>حسب طريقة الدفع / By payment method</h2>
  <table>
    <thead><tr><th>الطريقة</th><th class="c">عدد العمليات</th><th class="e">الإجمالي</th></tr></thead>
    <tbody>${methodRows || '<tr><td colspan="3" class="c">—</td></tr>'}</tbody>
    <tfoot><tr><td><strong>الإجمالي المحصّل</strong></td><td class="c">${r.invoiceCount}</td><td class="e"><strong>${zAed(r.totalCollectedFils)}</strong></td></tr></tfoot>
  </table>
  <h2>الفواتير (${r.invoiceCount}) / Invoices</h2>
  <table>
    <thead><tr><th>رقم</th><th class="e">الإجمالي</th><th class="e">المدفوع</th><th class="c">الوقت</th></tr></thead>
    <tbody>${invoiceRows || '<tr><td colspan="4" class="c">—</td></tr>'}</tbody>
  </table>
<script>window.onload = function() { window.print(); }</script>
</body>
</html>`;
  const win = window.open("", "_blank", "width=800,height=700");
  if (!win) {
    alert("يرجى السماح بفتح النوافذ المنبثقة للطباعة.\nPlease allow popups to print.");
    return;
  }
  win.document.write(html);
  win.document.close();
}

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
  const [zReportShiftId, setZReportShiftId] = useState<string | null>(null);

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

  /** Z-report for a CLOSED/APPROVED shift */
  const zReportQuery = useQuery({
    queryKey: ["shifts", "z-report", zReportShiftId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: ZReportData }>(
        `/shifts/${zReportShiftId}/z-report`,
      );
      return res.data.data;
    },
    enabled: Boolean(zReportShiftId),
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
                          <div className="flex justify-end gap-1.5">
                            {shift.status !== "OPEN" ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => setZReportShiftId(shift.id)}
                              >
                                تقرير Z
                              </Button>
                            ) : null}
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
                          </div>
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

      {/* Z-report dialog */}
      <Dialog
        open={Boolean(zReportShiftId)}
        onOpenChange={(o) => {
          if (!o) setZReportShiftId(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>تقرير Z / Z-Report</DialogTitle>
          </DialogHeader>
          {zReportQuery.isLoading ? (
            <p className="py-4 text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : zReportQuery.isError ? (
            <p className="py-4 text-sm text-destructive">
              {getApiErrorMessage(zReportQuery.error)}
            </p>
          ) : zReportQuery.data ? (
            (() => {
              const r = zReportQuery.data;
              const s = r.shift;
              return (
                <div className="space-y-4 text-sm">
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p>
                      <span className="text-muted-foreground">الكاشير: </span>
                      <span className="font-semibold">{s.user.name}</span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      الفتح: {new Date(s.openedAt).toLocaleString("ar-AE")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      الإغلاق: {s.closedAt ? new Date(s.closedAt).toLocaleString("ar-AE") : "—"}
                    </p>
                  </div>

                  <div>
                    <h3 className="mb-2 text-xs font-bold text-muted-foreground">
                      التسوية / Reconciliation
                    </h3>
                    <table className="w-full rounded-lg border">
                      <tbody>
                        <tr className="border-b border-border/40">
                          <td className="px-3 py-1.5">رصيد افتتاحي</td>
                          <td className="px-3 py-1.5 text-end font-mono tabular-nums">
                            {formatAED(s.openingBalanceFils)}
                          </td>
                        </tr>
                        <tr className="border-b border-border/40">
                          <td className="px-3 py-1.5">مبيعات كاش</td>
                          <td className="px-3 py-1.5 text-end font-mono tabular-nums">
                            {formatAED(s.cashSalesFils)}
                          </td>
                        </tr>
                        <tr className="border-b border-border/40">
                          <td className="px-3 py-1.5">المتوقع في الدرج</td>
                          <td className="px-3 py-1.5 text-end font-mono tabular-nums">
                            {formatAED(s.expectedCashFils)}
                          </td>
                        </tr>
                        <tr className="border-b border-border/40">
                          <td className="px-3 py-1.5">الفعلي عند الإغلاق</td>
                          <td className="px-3 py-1.5 text-end font-mono tabular-nums">
                            {s.closingBalanceFils != null ? formatAED(s.closingBalanceFils) : "—"}
                          </td>
                        </tr>
                        <tr>
                          <td className="px-3 py-1.5 font-semibold">الفرق</td>
                          <td
                            className={`px-3 py-1.5 text-end font-mono font-bold tabular-nums ${
                              (s.varianceFils ?? 0) < 0
                                ? "text-red-700 dark:text-red-400"
                                : "text-green-700 dark:text-green-400"
                            }`}
                          >
                            {s.varianceFils != null
                              ? `${s.varianceFils > 0 ? "+" : ""}${formatAED(s.varianceFils)}`
                              : "—"}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div>
                    <h3 className="mb-2 text-xs font-bold text-muted-foreground">
                      حسب طريقة الدفع / By payment method
                    </h3>
                    <table className="w-full rounded-lg border">
                      <thead className="bg-muted/60 text-xs">
                        <tr>
                          <th className="px-3 py-1.5 text-start">الطريقة</th>
                          <th className="px-3 py-1.5 text-center">عدد العمليات</th>
                          <th className="px-3 py-1.5 text-end">الإجمالي</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.byMethod.map((m) => (
                          <tr key={m.method} className="border-b border-border/40 last:border-0">
                            <td className="px-3 py-1.5">{Z_METHOD_LABELS[m.method] ?? m.method}</td>
                            <td className="px-3 py-1.5 text-center tabular-nums">{m.count}</td>
                            <td className="px-3 py-1.5 text-end font-mono tabular-nums">
                              {formatAED(m.totalFils)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t">
                        <tr>
                          <td className="px-3 py-1.5 font-semibold">الإجمالي المحصّل</td>
                          <td className="px-3 py-1.5 text-center tabular-nums">{r.invoiceCount}</td>
                          <td className="px-3 py-1.5 text-end font-mono font-bold tabular-nums">
                            {formatAED(r.totalCollectedFils)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    عدد الفواتير في الوردية: <strong>{r.invoiceCount}</strong>
                  </p>

                  <DialogFooter className="gap-2 sm:justify-between">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setZReportShiftId(null)}
                    >
                      إغلاق
                    </Button>
                    <Button type="button" onClick={() => printZReport(r)}>
                      طباعة
                    </Button>
                  </DialogFooter>
                </div>
              );
            })()
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
