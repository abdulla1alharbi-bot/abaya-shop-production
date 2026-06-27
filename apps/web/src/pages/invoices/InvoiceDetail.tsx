import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Banknote, MessageCircle, Printer, Trash2 } from "lucide-react";
import { VOID_CATEGORIES } from "@abaya-shop/shared";
import { printInvoice } from "@/lib/printInvoice";
import { buildWhatsAppLink, orderReadyMessage, paymentReminderMessage } from "@/lib/whatsappLinks";
import { JobProcessPieceTable } from "@/components/job-orders/JobProcessPieceTable";
import type { WorkshopWorkStageRow } from "@/components/job-orders/WorkshopTaskSheet";
import { TailoringPieceProgressStrip } from "@/components/invoices/TailoringPieceProgressStrip";
import { TailoringPieceQuickViewDialog } from "@/components/invoices/TailoringPieceQuickViewDialog";
import { InvoiceSellerPanel } from "@/components/invoices/InvoiceSellerPanel";
import { InvoiceTopSearch } from "@/components/invoices/InvoiceTopSearch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import {
  isPieceOverdueForInvoice,
  labelForWorkStageKey,
  lastUpdateFromWorkStages,
  summarizeInvoicePieces,
} from "@/lib/invoiceTailoringUi";
import { formatAED } from "@/lib/money";
import {
  getInvoiceOperationalBadge,
  getTailoringItemBadge,
  invoiceBadgeStyle,
  relatedInvoiceStatusEn,
} from "@/lib/invoiceUiStatus";
import { useIsWorker } from "@/hooks/useIsWorker";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";
import { PIPELINE_STAGE_KEYS } from "@abaya-shop/shared";

type JobOrderRow = {
  id: string;
  jobNo: number;
  productStyle: string;
  stage: string;
  createdAt?: string;
  balanceFils: number;
  deliveredAt?: string | null;
  isConvertedToReady?: boolean;
  convertedAt?: string | null;
  convertedReadyProduct?: {
    id: string;
    sku: string;
    name: string;
    nameAr?: string | null;
    stockQty: number;
    isActive: boolean;
  } | null;
  product: {
    name: string;
    cuttingWageFils?: number;
    sewingWageFils?: number;
    embroideryWageFils?: number;
    finishingWageFils?: number;
  } | null;
  invoiceItem: {
    id: string;
    description?: string | null;
    totalFils: number;
    unitFils: number;
    qty: number;
  } | null;
  workStages: WorkshopWorkStageRow[];
  materials: Array<{
    id: string;
    meters: number;
    materialCostFils?: number;
    roll: { rollCode: string; name: string; color: string; type: string };
  }>;
  totalFils?: number;
};

type RelatedInv = {
  id: string;
  invoiceNo: number;
  createdAt: string;
  totalFils: number;
  paidFils: number;
  balanceFils: number;
  isVoid: boolean;
  deliveredAt: string | null;
};

function fabricParts(job: JobOrderRow): { fabric: string; color: string } {
  const m = job.materials?.[0];
  if (!m) return { fabric: "—", color: "—" };
  return { fabric: m.roll.name, color: m.roll.color };
}

function stageWorkersList(workStages: WorkshopWorkStageRow[]) {
  const keys = new Set(PIPELINE_STAGE_KEYS as readonly string[]);
  return [...workStages]
    .filter((r) => keys.has(r.stageKey))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function operationalPieceStatus(job: JobOrderRow, unclaimedDays: number): {
  key: "pending" | "ready_for_delivery" | "delivered" | "unclaimed" | "converted_to_ready";
  label: string;
  cls: string;
} {
  if (job.stage === "CONVERTED_TO_READY") {
    return {
      key: "converted_to_ready",
      label: "converted_to_ready · محول إلى جاهز",
      cls: "border-cyan-300 bg-cyan-100 text-cyan-900 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-100",
    };
  }
  if (job.deliveredAt || job.stage === "DELIVERED") {
    return {
      key: "delivered",
      label: "delivered · تم التسليم",
      cls: "border-violet-300 bg-violet-100 text-violet-900 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100",
    };
  }
  if (job.stage === "READY") {
    return {
      key: "ready_for_delivery",
      label: "ready_for_delivery · جاهز للتسليم",
      cls: "border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100",
    };
  }
  const createdAt = job.createdAt ? new Date(job.createdAt) : null;
  const ageDays = createdAt ? Math.floor((Date.now() - createdAt.getTime()) / (24 * 60 * 60 * 1000)) : 0;
  if (ageDays >= unclaimedDays) {
    return {
      key: "unclaimed",
      label: `unclaimed · غير مستلمة (${ageDays} يوم)`,
      cls: "border-red-300 bg-red-100 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100",
    };
  }
  return {
    key: "pending",
    label: "pending · قيد الانتظار",
    cls: "border-zinc-300 bg-zinc-100 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
  };
}

export function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [sellerOpen, setSellerOpen] = useState(false);
  const [quickViewJobId, setQuickViewJobId] = useState<string | null>(null);
  const [qaFailJobId, setQaFailJobId] = useState<string | null>(null);
  const [qaFailReason, setQaFailReason] = useState("");
  const [qaReopenStage, setQaReopenStage] = useState("FINISHING");
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidCategory, setVoidCategory] = useState<keyof typeof VOID_CATEGORIES>("DEFECT");
  const [voidReason, setVoidReason] = useState("");
  const isWorker = useIsWorker();
  const { canAny, can } = usePermissions();
  const { t } = useTranslation();
  const canConvertToReady = canAny("jobProcess.update", "jobProcess.adminEdit", "readyMade.create");
  const canInspect = can("jobProcess.inspect");
  const canViewCost = can("reports.financial");
  const canPrint = can("invoices.print");
  const UNCLAIMED_DAYS = 120;
  const scrollToAnchor = useCallback((eid: string) => {
    document.getElementById(eid)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["invoice", id],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, unknown> }>(`/invoices/${id}`);
      return res.data.data;
    },
    enabled: Boolean(id),
  });

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, string> }>("/settings");
      return res.data.data;
    },
    enabled: canPrint,
  });

  useEffect(() => {
    if (!data) return;
    const hashId = location.hash.replace(/^#/, "").trim();
    if (!hashId) return;
    const timer = window.setTimeout(() => {
      document.getElementById(hashId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [data, location.hash]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["invoice", id] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard", "pending-tailoring"] });
    void queryClient.invalidateQueries({ queryKey: ["products", "ready-made"] });
    void queryClient.invalidateQueries({ queryKey: ["job-orders"] });
  };

  const convertToReady = useMutation({
    mutationFn: async (jobId: string) => {
      await api.post(`/job-orders/${jobId}/convert-to-ready`, {});
    },
    onSuccess: () => invalidate(),
  });

  const qaInspect = useMutation({
    mutationFn: async ({
      jobId,
      result,
      failReason,
      reopenStage,
    }: {
      jobId: string;
      result: "PASS" | "FAIL";
      failReason?: string;
      reopenStage?: string;
    }) => {
      await api.post(`/job-orders/${jobId}/qa-inspect`, { result, failReason, reopenStage });
    },
    onSuccess: () => {
      setQaFailJobId(null);
      setQaFailReason("");
      setQaReopenStage("FINISHING");
      invalidate();
    },
  });

  const voidInvoice = useMutation({
    mutationFn: async () => {
      await api.post(`/invoices/${id}/void`, {
        voidCategory,
        voidReason: voidReason.trim(),
      });
    },
    onSuccess: () => {
      setVoidOpen(false);
      setVoidReason("");
      setVoidCategory("DEFECT");
      invalidate();
    },
  });

  if (!id) return null;

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
        <InvoiceTopSearch />
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
        <InvoiceTopSearch />
        <p className="text-destructive">Could not load invoice.</p>
        <Link to="/invoices" className="text-sm underline">
          Back to list
        </Link>
      </div>
    );
  }

  const items = (data.items as Array<Record<string, unknown> & { id: string }>) ?? [];
  const payments = (data.payments as Array<{
    id: string;
    method: string;
    amountFils: number;
    reference: string | null;
    createdAt: string;
  }>) ?? [];
  const jobOrders = (data.jobOrders as JobOrderRow[]) ?? [];
  const relatedInvoices = (data.relatedInvoices as RelatedInv[]) ?? [];
  const fulfillmentStatus = String(data.fulfillmentStatus ?? "NO_TAILORING");
  const balanceFils = data.balanceFils as number;
  const customer = data.customer as { id: string; name: string; mobile: string } | null;
  const deliveredAt = (data.deliveredAt as string | null | undefined) ?? null;
  const isVoid = Boolean(data.isVoid);
  const deliveryDate = data.deliveryDate as string | null | undefined;
  const invoiceNo = data.invoiceNo as number;
  const hideMoney =
    isWorker || Boolean((data as { financialsRedacted?: boolean }).financialsRedacted);

  const itemIds = new Set(items.map((it) => String(it.id)));
  const jobsByInvoiceLine = new Map(
    jobOrders.filter((j) => j.invoiceItem?.id).map((j) => [j.invoiceItem!.id, j] as const),
  );
  const orphanJobOrders = jobOrders.filter(
    (j) => !j.invoiceItem?.id || !itemIds.has(j.invoiceItem.id),
  );

  const canDeliver =
    !isVoid &&
    !deliveredAt &&
    (fulfillmentStatus === "READY_FOR_DELIVERY" || fulfillmentStatus === "NO_TAILORING");

  const invBadge = getInvoiceOperationalBadge({
    isVoid,
    deliveredAt,
    fulfillmentStatus,
  });

  const tailoringCards = items.map((item) => ({
    item,
    job: jobsByInvoiceLine.get(String(item.id)),
  }));

  const pieceSummary = jobOrders.length > 0 ? summarizeInvoicePieces(jobOrders, deliveryDate) : null;
  let pieceCounter = 0;
  const tailoringWithPieceIndex = tailoringCards.map(({ item, job }) => {
    if (job) pieceCounter += 1;
    return { item, job, pieceIndex: job ? pieceCounter : 0 };
  });
  const quickViewJob = quickViewJobId ? jobOrders.find((j) => j.id === quickViewJobId) : null;
  const quickViewItem = quickViewJob?.invoiceItem?.id
    ? items.find((it) => String(it.id) === String(quickViewJob.invoiceItem!.id))
    : null;
  const qvFabric = quickViewJob ? fabricParts(quickViewJob) : { fabric: "—", color: "—" };
  const quickViewPieceLabel = quickViewJob
    ? (() => {
        if (quickViewItem) {
          const d = quickViewItem.description as string | null | undefined;
          const pn = (quickViewItem.product as { name?: string })?.name;
          return (d || pn || quickViewJob.productStyle) ?? "—";
        }
        return quickViewJob.productStyle || "—";
      })()
    : "—";
  const quickViewLineFils =
    quickViewItem && typeof quickViewItem.totalFils === "number"
      ? quickViewItem.totalFils
      : quickViewJob?.invoiceItem && typeof quickViewJob.invoiceItem.totalFils === "number"
        ? quickViewJob.invoiceItem.totalFils
        : null;

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 pb-16 md:p-6 md:pb-20">
      <InvoiceTopSearch currentInvoiceNo={invoiceNo} />

      <section className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm md:p-8" dir="rtl">
        <div className="mb-6 flex flex-col justify-between gap-6 sm:flex-row sm:items-start">
          <div className="min-w-0 space-y-3 text-start">
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
              {hideMoney ? t("invoiceDetail.workshopCustomerSection", { defaultValue: "Workshop — Customer Info" }) : t("invoiceDetail.customerSection")}
            </h1>
            <div className="space-y-2 text-base">
              <p>
                <span className="text-muted-foreground">رقم الفاتورة: </span>
                <span className="font-mono text-2xl font-bold tabular-nums">#{invoiceNo}</span>
              </p>
              <p>
                <span className="text-muted-foreground">اسم العميل: </span>
                <span className="font-semibold">{customer?.name ?? t("invoiceDetail.noCustomer")}</span>
              </p>
              <p>
                <span className="text-muted-foreground">عدد القطع: </span>
                <span className="font-mono font-semibold tabular-nums">
                  {jobOrders.length}{" "}
                  {jobOrders.length === 1 ? "قطعة" : jobOrders.length === 0 ? "قطع" : "قطع"}
                </span>
              </p>
              {customer ? (
                <p className="font-mono text-sm text-muted-foreground" dir="ltr">
                  {customer.mobile}
                </p>
              ) : null}
              {customer && !hideMoney ? (
                <Link to={`/customers/${customer.id}`} className="text-sm text-primary underline">
                  ملف العميل
                </Link>
              ) : null}
            </div>
          </div>
          <div className="w-full shrink-0 space-y-2 text-start sm:max-w-xs sm:text-end">
            <p className="text-sm text-muted-foreground">تاريخ الفاتورة</p>
            <p className="text-base font-medium">{new Date(data.createdAt as string).toLocaleString()}</p>
            <p className="pt-2 text-sm text-muted-foreground">موعد التسليم</p>
            <p className="text-base font-medium">
              {deliveryDate ? new Date(deliveryDate).toLocaleString() : "—"}
            </p>
          </div>
        </div>

        {!hideMoney ? (
          <div className="grid gap-4 border-t pt-6 sm:grid-cols-3">
            <div>
              <p className="text-sm text-muted-foreground">Total amount</p>
              <p className="text-2xl font-bold tabular-nums">{formatAED(data.totalFils as number)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Paid</p>
              <p className="text-2xl font-bold tabular-nums">{formatAED(data.paidFils as number)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Remaining</p>
              <p className="text-2xl font-bold tabular-nums text-amber-900 dark:text-amber-100">
                {formatAED(balanceFils)}
              </p>
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center gap-3 border-t pt-6">
          <span className="text-sm font-medium text-muted-foreground">Status</span>
          <span className={invoiceBadgeStyle(invBadge.key)}>{invBadge.label}</span>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          {!hideMoney ? (
            <Button
              type="button"
              size="lg"
              className="h-14 min-w-[160px] rounded-xl text-base"
              onClick={() => setSellerOpen(true)}
            >
              <Banknote className="me-2 h-5 w-5" />
              الدفع والتسليم
            </Button>
          ) : null}
          {canPrint && data ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-14 rounded-xl"
              onClick={() => printInvoice(data, settings)}
            >
              <Printer className="me-2 h-5 w-5" />
              طباعة الفاتورة
            </Button>
          ) : null}
          {/* WhatsApp: order-ready notification */}
          {customer?.mobile &&
          !isVoid &&
          !deliveredAt &&
          fulfillmentStatus === "READY_FOR_DELIVERY" &&
          jobOrders.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-14 rounded-xl border-green-500 text-green-700 hover:bg-green-50 dark:border-green-600 dark:text-green-400 dark:hover:bg-green-950/30"
              asChild
            >
              <a
                href={buildWhatsAppLink(
                  customer.mobile,
                  orderReadyMessage(customer.name, invoiceNo),
                )}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle className="me-2 h-5 w-5" />
                إشعار الجاهزية (واتساب)
              </a>
            </Button>
          ) : null}
          {/* WhatsApp: payment reminder */}
          {customer?.mobile && !isVoid && balanceFils > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-14 rounded-xl border-amber-500 text-amber-700 hover:bg-amber-50 dark:border-amber-600 dark:text-amber-400 dark:hover:bg-amber-950/30"
              asChild
            >
              <a
                href={buildWhatsAppLink(
                  customer.mobile,
                  paymentReminderMessage(customer.name, invoiceNo, formatAED(balanceFils)),
                )}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle className="me-2 h-5 w-5" />
                تذكير بالدفع (واتساب)
              </a>
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="lg" className="h-14 rounded-xl" asChild>
            <Link to="/invoices">كل الفواتير</Link>
          </Button>
          {!isVoid && can("invoices.edit") ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-14 rounded-xl border-red-400 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950/30"
              onClick={() => setVoidOpen(true)}
            >
              <Trash2 className="me-2 h-4 w-4" />
              إلغاء الفاتورة
            </Button>
          ) : null}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {hideMoney
            ? t("invoiceDetail.tailoringNote", { defaultValue: "Tailoring details and stages for each piece are shown in the Tailoring Pieces section below." })
            : t("invoiceDetail.workshopNote", { defaultValue: "Workshop progress and worker stages for each piece below — same as payment and delivery screen." })}
        </p>
      </section>

      {customer && relatedInvoices.length > 0 ? (
        <section>
          <h2 className="mb-3 text-xl font-bold">{hideMoney ? "Related jobs (invoices)" : "Customer invoices"}</h2>
          <div className="max-h-48 overflow-auto rounded-xl border bg-card">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="sticky top-0 bg-muted/80 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-start">No</th>
                  <th className="px-4 py-3 text-start">Date</th>
                  {!hideMoney ? (
                    <>
                      <th className="px-4 py-3 text-end">Total</th>
                      <th className="px-4 py-3 text-end">Paid</th>
                      <th className="px-4 py-3 text-end">Remaining</th>
                    </>
                  ) : null}
                  <th className="px-4 py-3 text-start">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {relatedInvoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-3 font-mono font-medium">#{inv.invoiceNo}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(inv.createdAt).toLocaleDateString()}
                    </td>
                    {!hideMoney ? (
                      <>
                        <td className="px-4 py-3 text-end font-mono">{formatAED(inv.totalFils)}</td>
                        <td className="px-4 py-3 text-end font-mono">{formatAED(inv.paidFils)}</td>
                        <td className="px-4 py-3 text-end font-mono">{formatAED(inv.balanceFils)}</td>
                      </>
                    ) : null}
                    <td className="px-4 py-3">{relatedInvoiceStatusEn(inv)}</td>
                    <td className="px-4 py-3 text-end">
                      <Link to={`/invoices/${inv.id}`} className="font-medium text-primary underline">
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section id="invoice-workshop" className="space-y-4" dir="rtl">
        <div className="space-y-1 text-start">
          <h2 className="text-xl font-bold md:text-2xl">قطع التفصيل</h2>
          <p className="text-sm text-muted-foreground">
            كل سطر تفصيل له أمر عمل منفصل — تتبع المراحل والعاملين لكل قطعة أدناه.
          </p>
        </div>

        {pieceSummary && jobOrders.length > 0 ? (
          <div className="flex flex-wrap gap-3 rounded-xl border border-border/80 bg-muted/30 p-4 text-sm">
            <span className="inline-flex items-center gap-2 rounded-lg border border-emerald-300/80 bg-emerald-50 px-3 py-1.5 font-medium text-emerald-950 dark:border-emerald-800/60 dark:bg-emerald-950/35 dark:text-emerald-100">
              <span className="text-muted-foreground">مكتمل:</span> {pieceSummary.complete}
            </span>
            <span className="inline-flex items-center gap-2 rounded-lg border border-amber-300/80 bg-amber-50 px-3 py-1.5 font-medium text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/35 dark:text-amber-100">
              <span className="text-muted-foreground">قيد التنفيذ:</span> {pieceSummary.inProgress}
            </span>
            <span className="inline-flex items-center gap-2 rounded-lg border border-red-300/80 bg-red-50 px-3 py-1.5 font-medium text-red-950 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100">
              <span className="text-muted-foreground">متأخر:</span> {pieceSummary.overdue}
            </span>
          </div>
        ) : null}

        <div className="space-y-8">
          {tailoringWithPieceIndex.map(({ item, job, pieceIndex }) => {
            const p = item.product as { name: string; sku: string };
            const desc = item.description as string | null | undefined;
            const title = desc || p.name;
            const itemBadge = job ? getTailoringItemBadge(job, { locale: "ar" }) : null;
            const { fabric, color } = job ? fabricParts(job) : { fabric: "—", color: "—" };
            const pieceOverdue = job ? isPieceOverdueForInvoice(job, deliveryDate) : false;
            const lastTouch = job ? lastUpdateFromWorkStages(job.workStages ?? []) : null;
            const stageRows = job ? stageWorkersList(job.workStages ?? []) : [];
            const createdAt = job?.createdAt ? new Date(job.createdAt) : null;
            const ageDays = createdAt
              ? Math.floor((Date.now() - createdAt.getTime()) / (24 * 60 * 60 * 1000))
              : 0;
            const opStatus = job ? operationalPieceStatus(job, UNCLAIMED_DAYS) : null;
            const shouldSuggestUnclaimed =
              Boolean(job) &&
              ageDays >= UNCLAIMED_DAYS &&
              job!.stage !== "DELIVERED" &&
              job!.stage !== "CONVERTED_TO_READY" &&
              job!.stage !== "CANCELLED";

            return (
              <div
                key={String(item.id)}
                id={job ? `job-${job.id}` : undefined}
                className={cn(
                  "rounded-2xl border-2 bg-card p-5 shadow-sm md:p-6",
                  job
                    ? pieceOverdue
                      ? "border-red-300/90 dark:border-red-800/70"
                      : "border-border/80"
                    : "border-border/60",
                )}
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1 space-y-3 text-start">
                    {job ? (
                      <div className="space-y-1">
                        <h3 className="text-lg font-bold leading-snug md:text-xl">
                          قطعة رقم {pieceIndex} — أمر العمل #{job.jobNo}
                        </h3>
                        <p className="text-sm font-medium text-muted-foreground">{title}</p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <h3 className="text-lg font-bold md:text-xl">{title}</h3>
                        <p className="text-xs text-muted-foreground">بند جاهز — بدون أمر تفصيل</p>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      {itemBadge ? (
                        <span className={invoiceBadgeStyle(itemBadge.key)}>{itemBadge.label}</span>
                      ) : null}
                      {opStatus ? (
                        <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold", opStatus.cls)}>
                          {opStatus.label}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {p.name} · {p.sku}
                    </p>
                    {job ? (
                      <dl className="grid gap-3 text-sm sm:grid-cols-2">
                        <div>
                          <dt className="text-xs text-muted-foreground">الموديل</dt>
                          <dd className="font-semibold">{job.productStyle || "—"}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">القماش</dt>
                          <dd className="font-medium">{fabric}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">اللون</dt>
                          <dd className="font-medium">{color}</dd>
                        </div>
                        <div className="sm:col-span-2">
                          <dt className="text-xs text-muted-foreground">تاريخ آخر تحديث</dt>
                          <dd>{lastTouch ?? "—"}</dd>
                        </div>
                      </dl>
                    ) : null}
                    {job && stageRows.length > 0 ? (
                      <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                        <p className="mb-2 text-xs font-semibold text-muted-foreground">العامل لكل مرحلة</p>
                        <ul className="grid gap-2 sm:grid-cols-2">
                          {stageRows.map((r) => (
                            <li key={r.id} className="flex flex-col text-sm">
                              <span className="text-xs text-muted-foreground">
                                {labelForWorkStageKey(r.stageKey)}
                              </span>
                              <span className="font-medium">{r.worker?.name ?? "—"}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {/* Phase 3 F1: Real Cost & Margin panel — visible only to financial roles */}
                    {job && canViewCost
                      ? (() => {
                          const fabricCostFils = job.materials.reduce(
                            (a, m) => a + (m.materialCostFils ?? 0),
                            0,
                          );
                          const laborCostFils = job.workStages
                            .filter((s) => s.status === "DONE")
                            .reduce((a, s) => a + s.wageFils, 0);
                          const totalCostFils = fabricCostFils + laborCostFils;
                          const salePriceFils = job.totalFils ?? 0;
                          const grossMarginFils = salePriceFils - totalCostFils;
                          const marginPercent =
                            salePriceFils > 0 ? (grossMarginFils / salePriceFils) * 100 : 0;
                          const marginColor =
                            marginPercent >= 25
                              ? "text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 border-green-300"
                              : marginPercent >= 10
                                ? "text-yellow-800 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-950/30 border-yellow-300"
                                : "text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border-red-300";
                          return (
                            <div className={`rounded-lg border-2 p-3 text-start ${marginColor}`}>
                              <p className="mb-2 text-xs font-semibold">💰 التكلفة وهامش الربح</p>
                              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                                <div>
                                  <div className="text-muted-foreground">تكلفة القماش</div>
                                  <div className="font-mono font-bold">{formatAED(fabricCostFils)}</div>
                                </div>
                                <div>
                                  <div className="text-muted-foreground">أجور العمال</div>
                                  <div className="font-mono font-bold">{formatAED(laborCostFils)}</div>
                                </div>
                                <div>
                                  <div className="text-muted-foreground">سعر البيع</div>
                                  <div className="font-mono font-bold">{formatAED(salePriceFils)}</div>
                                </div>
                                <div>
                                  <div className="text-muted-foreground">صافي الربح</div>
                                  <div className="font-mono font-bold">
                                    {formatAED(grossMarginFils)}{" "}
                                    <span className="text-[10px]">({marginPercent.toFixed(1)}٪)</span>
                                  </div>
                                </div>
                              </div>
                              <p className="mt-2 text-[10px] text-muted-foreground">
                                إجمالي التكلفة: {formatAED(totalCostFils)} | أجور العمال محسوبة من المراحل المكتملة فقط
                              </p>
                            </div>
                          );
                        })()
                      : null}
                    {/* QA Inspection panel — shown only when job is in INSPECTION stage */}
                    {job && job.stage === "INSPECTION" && canInspect ? (
                      <div className="rounded-lg border-2 border-purple-400 bg-purple-50 p-4 text-start dark:border-purple-700 dark:bg-purple-950/30">
                        <p className="mb-3 font-semibold text-purple-900 dark:text-purple-200">
                          🔍 فحص الجودة — القطعة في انتظار موافقة المشرف
                        </p>
                        {qaFailJobId === job.id ? (
                          <div className="space-y-3">
                            <div>
                              <label className="mb-1 block text-xs font-medium">سبب الرفض</label>
                              <input
                                className="w-full rounded-md border px-3 py-1.5 text-sm"
                                placeholder="مثال: خطأ في المقاس / غرزة غير منتظمة"
                                value={qaFailReason}
                                onChange={(e) => setQaFailReason(e.target.value)}
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium">أعد إلى مرحلة</label>
                              <select
                                className="rounded-md border px-3 py-1.5 text-sm"
                                value={qaReopenStage}
                                onChange={(e) => setQaReopenStage(e.target.value)}
                              >
                                <option value="CUTTING">قص</option>
                                <option value="SEWING">خياطة</option>
                                <option value="EMBROIDERY">تطريز</option>
                                <option value="FINISHING">الشغل اليدوي</option>
                              </select>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                disabled={qaInspect.isPending}
                                onClick={() =>
                                  qaInspect.mutate({
                                    jobId: job.id,
                                    result: "FAIL",
                                    failReason: qaFailReason || undefined,
                                    reopenStage: qaReopenStage,
                                  })
                                }
                              >
                                {qaInspect.isPending ? "..." : "تأكيد الرفض"}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setQaFailJobId(null)}
                              >
                                إلغاء
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              size="sm"
                              className="bg-green-600 hover:bg-green-700 text-white"
                              disabled={qaInspect.isPending}
                              onClick={() => {
                                if (window.confirm("تأكيد اجتياز فحص الجودة — القطعة ستصبح جاهزة للتسليم؟"))
                                  qaInspect.mutate({ jobId: job.id, result: "PASS" });
                              }}
                            >
                              ✓ اجتياز — جاهز
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() => {
                                setQaFailReason("");
                                setQaReopenStage("FINISHING");
                                setQaFailJobId(job.id);
                              }}
                            >
                              ✗ رفض — إعادة للورشة
                            </Button>
                          </div>
                        )}
                        {qaInspect.isError ? (
                          <p className="mt-2 text-xs text-destructive">
                            {(qaInspect.error as Error).message}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {job ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => setQuickViewJobId(job.id)}
                        >
                          عرض
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => scrollToAnchor(`job-progress-${job.id}`)}
                        >
                          مسار العمل
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => scrollToAnchor(`job-process-${job.id}`)}
                        >
                          تعديل
                        </Button>
                        {canConvertToReady &&
                        job.stage !== "DELIVERED" &&
                        job.stage !== "CONVERTED_TO_READY" &&
                        job.stage !== "CANCELLED" ? (
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            disabled={convertToReady.isPending}
                            onClick={() => {
                              const msg = shouldSuggestUnclaimed
                                ? `هذه القطعة مر عليها ${ageDays} يوم — تحويل إلى جاهز؟`
                                : "تحويل هذه القطعة إلى منتج جاهز بالمخزون؟";
                              if (!window.confirm(msg)) return;
                              convertToReady.mutate(job.id);
                            }}
                          >
                            {convertToReady.isPending ? "..." : "تحويل إلى جاهز"}
                          </Button>
                        ) : null}
                        {convertToReady.isError ? (
                          <p className="mt-1 text-xs text-destructive">
                            {getApiErrorMessage(convertToReady.error, "تعذّر التحويل.")}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {shouldSuggestUnclaimed ? (
                      <p className="text-xs text-amber-800 dark:text-amber-200">
                        هذه القطعة مر عليها {ageDays} يوم — يُنصح بتحويلها إلى جاهز.
                      </p>
                    ) : null}
                    {job?.isConvertedToReady || job?.stage === "CONVERTED_TO_READY" ? (
                      <div className="rounded-lg border border-cyan-300/80 bg-cyan-50/90 p-3 text-xs text-cyan-950 dark:border-cyan-800/60 dark:bg-cyan-950/30 dark:text-cyan-100">
                        <p className="font-semibold">تم تحويلها إلى جاهز</p>
                        <p className="mt-1">
                          رقم المنتج الجاهز:{" "}
                          <span className="font-mono">
                            {job.convertedReadyProduct?.sku ?? job.convertedReadyProduct?.id ?? "—"}
                          </span>
                        </p>
                        <p>
                          تاريخ التحويل:{" "}
                          {job.convertedAt ? new Date(job.convertedAt).toLocaleString() : "—"}
                        </p>
                      </div>
                    ) : null}
                  </div>
                  {!hideMoney ? (
                    <div className="flex w-full shrink-0 flex-col items-stretch gap-2 md:max-w-[200px] md:items-end">
                      <div className="text-start md:text-end">
                        <p className="text-xs font-medium text-muted-foreground">إجمالي السطر</p>
                        <p className="text-2xl font-bold tabular-nums">
                          {formatAED(item.totalFils as number)}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>

                {job ? (
                  <div
                    className="mt-6 space-y-4 border-t border-border/70 pt-4"
                    data-piece-root={job.id}
                  >
                    <div className="text-start" id={`job-progress-${job.id}`}>
                      <h4 className="mb-2 text-sm font-bold text-foreground">مسار العمل والتقدم</h4>
                      <TailoringPieceProgressStrip
                        workStages={job.workStages ?? []}
                        jobStage={job.stage}
                        job={job}
                        invoiceDeliveryDateIso={deliveryDate}
                      />
                    </div>
                    <div className="text-start" id={`job-process-${job.id}`}>
                      <h4 className="mb-3 text-sm font-semibold text-muted-foreground">جدول المراحل — تعديل</h4>
                      <JobProcessPieceTable
                        jobId={job.id}
                        jobNo={job.jobNo}
                        productStyle={job.productStyle}
                        jobStage={job.stage}
                        hideInvoiceLinePricing={hideMoney}
                        layoutVariant="invoice"
                        pieceOverdue={pieceOverdue}
                        invoiceLine={
                          job.invoiceItem
                            ? {
                                totalFils: job.invoiceItem.totalFils,
                                description: job.invoiceItem.description,
                                qty: job.invoiceItem.qty,
                                unitFils: job.invoiceItem.unitFils,
                              }
                            : null
                        }
                        product={job.product}
                        workStages={job.workStages ?? []}
                        onInvalidateExtras={invalidate}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      {orphanJobOrders.length > 0 ? (
        <section className="rounded-2xl border border-dashed border-amber-500/50 bg-amber-50/30 p-4 dark:bg-amber-950/20" dir="rtl">
          <h3 className="mb-2 text-start font-bold">أوامر عمل بلا بند (قديمة)</h3>
          {orphanJobOrders.map((j) => {
            const pOverdue = isPieceOverdueForInvoice(j, deliveryDate);
            return (
              <div key={j.id} className="mb-8 last:mb-0" id={`job-${j.id}`}>
                <p className="mb-2 text-sm text-muted-foreground">طلب #{j.jobNo}</p>
                <div className="mb-3" id={`job-progress-${j.id}`}>
                  <TailoringPieceProgressStrip
                    workStages={j.workStages ?? []}
                    jobStage={j.stage}
                    job={j}
                    invoiceDeliveryDateIso={deliveryDate}
                  />
                </div>
                <div id={`job-process-${j.id}`}>
                  <JobProcessPieceTable
                    jobId={j.id}
                    jobNo={j.jobNo}
                    productStyle={j.productStyle}
                    jobStage={j.stage}
                    hideInvoiceLinePricing={hideMoney}
                    layoutVariant="invoice"
                    pieceOverdue={pOverdue}
                    invoiceLine={
                      j.invoiceItem
                        ? {
                            totalFils: j.invoiceItem.totalFils,
                            description: j.invoiceItem.description,
                            qty: j.invoiceItem.qty,
                            unitFils: j.invoiceItem.unitFils,
                          }
                        : null
                    }
                    product={j.product}
                    workStages={j.workStages ?? []}
                    onInvalidateExtras={invalidate}
                  />
                </div>
              </div>
            );
          })}
        </section>
      ) : null}

      {quickViewJob ? (
        <TailoringPieceQuickViewDialog
          open={Boolean(quickViewJobId)}
          onOpenChange={(o) => {
            if (!o) setQuickViewJobId(null);
          }}
          pieceLabel={quickViewPieceLabel}
          jobNo={quickViewJob.jobNo}
          productStyle={quickViewJob.productStyle}
          fabric={qvFabric.fabric}
          color={qvFabric.color}
          workStages={quickViewJob.workStages ?? []}
          lineTotalFils={quickViewLineFils}
          showMoney={!hideMoney}
        />
      ) : null}

      <Dialog open={voidOpen} onOpenChange={(o) => { if (!voidInvoice.isPending) setVoidOpen(o); }}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-red-700 dark:text-red-400">إلغاء الفاتورة #{invoiceNo}</DialogTitle>
            <DialogDescription>
              سيتم استرجاع قماش الطلبات وعكس رصيد العميل تلقائياً.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {balanceFils > 0 || (data.paidFils as number) > 0 ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                ℹ سيتم استرجاع:
                {balanceFils > 0 ? ` رصيد الذمة ${formatAED(balanceFils)}` : ""}
                {balanceFils > 0 && (data.paidFils as number) > 0 ? " +" : ""}
                {(data.paidFils as number) > 0 ? ` ائتمان للدفعات ${formatAED(data.paidFils as number)}` : ""}
              </div>
            ) : null}

            <div className="space-y-1.5">
              <label className="text-sm font-medium">سبب الإلغاء</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={voidCategory}
                onChange={(e) => setVoidCategory(e.target.value as keyof typeof VOID_CATEGORIES)}
              >
                {(Object.entries(VOID_CATEGORIES) as [keyof typeof VOID_CATEGORIES, string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">تفاصيل إضافية <span className="text-red-500">*</span></label>
              <textarea
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                rows={3}
                placeholder="اكتب تفاصيل سبب الإلغاء..."
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="outline" onClick={() => setVoidOpen(false)} disabled={voidInvoice.isPending}>
              تراجع
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!voidReason.trim() || voidInvoice.isPending}
              onClick={() => voidInvoice.mutate()}
            >
              {voidInvoice.isPending ? "جاري الإلغاء…" : "تأكيد الإلغاء"}
            </Button>
          </DialogFooter>
          {voidInvoice.isError ? (
            <p className="text-sm text-destructive">{(voidInvoice.error as Error).message}</p>
          ) : null}
        </DialogContent>
      </Dialog>

      <Sheet open={sellerOpen && !hideMoney} onOpenChange={setSellerOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto p-4 sm:max-w-lg lg:p-6">
          <SheetHeader className="mb-4 text-start">
            <SheetTitle className="text-xl">Seller — invoice #{invoiceNo}</SheetTitle>
          </SheetHeader>
          <InvoiceSellerPanel
            key={`${id}-${String(deliveryDate)}-${String(data.paidFils)}-${String(deliveredAt)}`}
            invoiceId={id}
            invoiceNo={invoiceNo}
            totalFils={data.totalFils as number}
            paidFils={data.paidFils as number}
            balanceFils={balanceFils}
            payments={payments}
            deliveryDate={deliveryDate}
            deliveredAt={deliveredAt}
            canDeliver={canDeliver}
            onUpdated={invalidate}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
