import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Eye, Package, Scissors, Wallet } from "lucide-react";
import { DashboardInvoiceModal, DashboardJobProcessModal } from "@/components/dashboard/DashboardTailoringModals";
import { DashboardOperationalCard } from "@/components/dashboard/DashboardOperationalCard";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { formatAED } from "@/lib/money";
import { invoiceFulfillmentKey } from "@/lib/invoiceOperationalLabels";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export type DashboardQueueStats = {
  invoicesOutstandingFils: number;
  invoicesWithBalanceCount: number;
  readyForDeliveryInvoiceCount: number;
  readyForDeliveryTotalFils: number;
};

type InvoiceQueueRow = {
  id: string;
  invoiceNo: number;
  totalFils: number;
  paidFils: number;
  balanceFils: number;
  createdAt: string;
  deliveryDate?: string | null;
  isVoid: boolean;
  fulfillmentStatus: string;
  customer: { name: string; mobile: string } | null;
  jobOrders?: { id: string; stage: string }[];
};

type InvoiceQueueMeta = {
  totalOutstandingFils?: number;
  invoiceCountWithBalance?: number;
  readyInvoiceCount?: number;
  totalReadyValueFils?: number;
};

function usePaymentStatusFn() {
  const { t } = useTranslation();
  return (inv: InvoiceQueueRow): string => {
    if (inv.isVoid) return t("status.payment.void");
    if (inv.balanceFils <= 0) return t("status.payment.paid");
    if (inv.paidFils <= 0) return t("status.payment.unpaid");
    return t("status.payment.partial");
  };
}

function pickJobProcessId(jobOrders: { id: string; stage: string }[] | undefined): string | null {
  if (!jobOrders?.length) return null;
  const active = jobOrders.find((j) => j.stage !== "DELIVERED");
  return (active ?? jobOrders[0]).id;
}

function InvoiceQueueTable({
  items,
  onRowInvoice,
  onView,
  onJob,
}: {
  items: InvoiceQueueRow[];
  onRowInvoice: (id: string) => void;
  onView: (id: string) => void;
  onJob: (invoiceId: string, jobId: string) => void;
}) {
  const { t } = useTranslation();
  const paymentStatus = usePaymentStatusFn();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1000px] text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 md:px-4">{t("pages.invoices.colInvoiceNo")}</th>
            <th className="px-3 py-2 md:px-4">{t("pages.invoices.colCustomer")}</th>
            <th className="px-3 py-2 md:px-4">{t("pages.invoices.colMobile")}</th>
            <th className="px-3 py-2 md:px-4">{t("pages.invoices.colDate")}</th>
            <th className="px-3 py-2 md:px-4">{t("pages.invoices.colDeliveryDate")}</th>
            <th className="px-3 py-2 text-end md:px-4">{t("pages.invoices.colTotal")}</th>
            <th className="px-3 py-2 text-end md:px-4">{t("pages.invoices.colPaid")}</th>
            <th className="px-3 py-2 text-end md:px-4">{t("pages.invoices.colBalance")}</th>
            <th className="px-3 py-2 md:px-4">{t("pages.invoices.colFulfillmentStatus")}</th>
            <th className="px-3 py-2 md:px-4">{t("pages.invoices.colPaymentStatus")}</th>
            <th className="px-3 py-2 text-center md:px-4">{t("pages.invoices.colView")}</th>
            <th className="px-3 py-2 text-center md:px-4">{t("pages.invoices.colDetails")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((inv) => {
            const jobId = pickJobProcessId(inv.jobOrders);
            return (
              <tr
                key={inv.id}
                role="button"
                tabIndex={0}
                className={cn(
                  "cursor-pointer border-b border-border/50 transition-colors",
                  "hover:bg-muted/50 hover:shadow-sm",
                )}
                onClick={() => onRowInvoice(inv.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onRowInvoice(inv.id);
                  }
                }}
              >
                <td className="px-3 py-2.5 font-mono font-medium md:px-4">#{inv.invoiceNo}</td>
                <td className="px-3 py-2.5 md:px-4">{inv.customer?.name ?? "—"}</td>
                <td className="px-3 py-2.5 font-mono text-muted-foreground md:px-4" dir="ltr">
                  {inv.customer?.mobile ?? "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground md:px-4">
                  {new Date(inv.createdAt).toLocaleString()}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground md:px-4">
                  {inv.deliveryDate ? new Date(inv.deliveryDate).toLocaleString() : "—"}
                </td>
                <td className="px-3 py-2.5 text-end font-mono tabular-nums md:px-4">{formatAED(inv.totalFils)}</td>
                <td className="px-3 py-2.5 text-end font-mono tabular-nums md:px-4">{formatAED(inv.paidFils)}</td>
                <td className="px-3 py-2.5 text-end font-mono tabular-nums md:px-4">
                  <span
                    className={cn(
                      inv.balanceFils > 0 ? "font-semibold text-amber-900 dark:text-amber-100" : "",
                    )}
                  >
                    {formatAED(inv.balanceFils)}
                  </span>
                </td>
                <td className="max-w-[140px] px-3 py-2.5 text-xs md:px-4">
                  {t(invoiceFulfillmentKey(inv.fulfillmentStatus))}
                </td>
                <td className="px-3 py-2.5 text-xs md:px-4">{paymentStatus(inv)}</td>
                <td className="px-3 py-2.5 md:px-4">
                  <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      title="View Invoice"
                      aria-label="عرض الفاتورة"
                      onClick={() => onView(inv.id)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
                <td className="px-3 py-2.5 md:px-4">
                  <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                    {jobId ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon"
                        className="h-8 w-8"
                        title="Job Process"
                        aria-label="مسار التفصيل"
                        onClick={() => onJob(inv.id, jobId)}
                      >
                        <Scissors className="h-4 w-4" />
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function useInvoiceQueue(mode: "balance" | "ready" | null, open: boolean) {
  const balanceDue = mode === "balance";
  const readyForDelivery = mode === "ready";

  return useQuery({
    queryKey: ["dashboard", "invoice-queue", mode],
    queryFn: async () => {
      const res = await api.get<{
        success: boolean;
        data: { items: InvoiceQueueRow[]; meta: InvoiceQueueMeta };
      }>("/invoices", {
        params: {
          limit: 200,
          ...(balanceDue ? { balanceDue: "true" } : {}),
          ...(readyForDelivery ? { readyForDelivery: "true" } : {}),
        },
      });
      return res.data.data;
    },
    enabled: open && Boolean(mode),
  });
}

export function DashboardInvoiceQueueCards({ stats }: { stats: DashboardQueueStats }) {
  const { t } = useTranslation();
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [readyOpen, setReadyOpen] = useState(false);
  const [invoiceModalId, setInvoiceModalId] = useState<string | null>(null);
  const [jobModal, setJobModal] = useState<{ invoiceId: string; focusJobId: string } | null>(null);

  const openInvoiceModal = (invoiceId: string) => {
    setJobModal(null);
    setInvoiceModalId(invoiceId);
  };

  const openJobModal = (invoiceId: string, focusJobId: string) => {
    setInvoiceModalId(null);
    setJobModal({ invoiceId, focusJobId });
  };

  const balanceQuery = useInvoiceQueue("balance", balanceOpen);
  const readyQuery = useInvoiceQueue("ready", readyOpen);

  return (
    <div className="min-w-0 lg:col-span-2">
      <DashboardInvoiceModal
        invoiceId={invoiceModalId}
        open={Boolean(invoiceModalId)}
        onOpenChange={(o) => {
          if (!o) setInvoiceModalId(null);
        }}
      />
      <DashboardJobProcessModal
        invoiceId={jobModal?.invoiceId ?? null}
        focusJobId={jobModal?.focusJobId ?? null}
        open={Boolean(jobModal)}
        onOpenChange={(o) => {
          if (!o) setJobModal(null);
        }}
      />

      <Dialog open={balanceOpen} onOpenChange={setBalanceOpen}>
        <DialogContent className="flex max-h-[min(92vh,900px)] w-[min(96vw,1200px)] max-w-[1200px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1200px]">
          <DialogHeader className="shrink-0 border-b px-4 py-4 pr-14 text-start sm:px-6 sm:pr-16">
            <DialogTitle>{t("components.invoiceQueue.outstandingTitle")}</DialogTitle>
            <DialogDescription>
              {t("pages.invoices.descBalance")}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto px-4 py-3 sm:px-6 sm:py-4">
            {balanceQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">{t("common.loadingData")}</p>
            ) : balanceQuery.isError || !balanceQuery.data ? (
              <p className="text-sm text-destructive">{t("common.error")}</p>
            ) : balanceQuery.data.items.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("pages.invoices.emptyBalance")}</p>
            ) : (
              <InvoiceQueueTable
                items={balanceQuery.data.items}
                onRowInvoice={openInvoiceModal}
                onView={openInvoiceModal}
                onJob={openJobModal}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={readyOpen} onOpenChange={setReadyOpen}>
        <DialogContent className="flex max-h-[min(92vh,900px)] w-[min(96vw,1200px)] max-w-[1200px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1200px]">
          <DialogHeader className="shrink-0 border-b px-4 py-4 pr-14 text-start sm:px-6 sm:pr-16">
            <DialogTitle>{t("components.invoiceQueue.readyTitle")}</DialogTitle>
            <DialogDescription>
              فواتير اكتمل فيها العمل بالورشة ولم يُسجَّل تسليمها بعد.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto px-4 py-3 sm:px-6 sm:py-4">
            {readyQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">جاري التحميل…</p>
            ) : readyQuery.isError || !readyQuery.data ? (
              <p className="text-sm text-destructive">تعذّر تحميل القائمة.</p>
            ) : readyQuery.data.items.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("pages.invoices.emptyReady")}</p>
            ) : (
              <InvoiceQueueTable
                items={readyQuery.data.items}
                onRowInvoice={openInvoiceModal}
                onView={openInvoiceModal}
                onJob={openJobModal}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <div className="grid gap-3 sm:grid-cols-2">
        <DashboardOperationalCard
          title={t("components.invoiceQueue.outstandingTitle")}
          icon={<Wallet className="h-5 w-5" aria-hidden />}
          summary={
            <>
              {formatAED(stats.invoicesOutstandingFils)} — {stats.invoicesWithBalanceCount} {t("pages.invoices.title").toLowerCase()}
            </>
          }
          onClick={() => setBalanceOpen(true)}
          open={balanceOpen}
        />
        <DashboardOperationalCard
          title={t("components.invoiceQueue.readyTitle")}
          icon={<CheckCircle2 className="h-5 w-5 text-green-600" aria-hidden />}
          summary={
            <>
              {stats.readyForDeliveryInvoiceCount} {t("pages.invoices.title").toLowerCase()} · {t("pages.invoices.totalReadyValue")}{" "}
              {formatAED(stats.readyForDeliveryTotalFils)}
            </>
          }
          onClick={() => setReadyOpen(true)}
          open={readyOpen}
          aside={
            <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100">
              <Package className="h-3.5 w-3.5" />
              {stats.readyForDeliveryInvoiceCount}
            </span>
          }
        />
      </div>
    </div>
  );
}
