import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { JobProcessPieceTable } from "@/components/job-orders/JobProcessPieceTable";
import type { WorkshopWorkStageRow } from "@/components/job-orders/WorkshopTaskSheet";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useIsWorker } from "@/hooks/useIsWorker";
import { api } from "@/lib/api";
import { formatAED } from "@/lib/money";
import { invoiceFulfillmentLabel } from "@/lib/invoiceOperationalLabels";

type JobOrderRow = {
  id: string;
  jobNo: number;
  productStyle: string;
  stage: string;
  invoiceItem: {
    id: string;
    description?: string | null;
    totalFils: number;
    unitFils: number;
    qty: number;
  } | null;
  product: {
    name: string;
    cuttingWageFils?: number;
    sewingWageFils?: number;
    embroideryWageFils?: number;
    finishingWageFils?: number;
  } | null;
  workStages: WorkshopWorkStageRow[];
};

function paymentStatusAr(balanceFils: number, paidFils: number, isVoid: boolean): string {
  if (isVoid) return "ملغاة";
  if (balanceFils <= 0) return "مسددة";
  if (paidFils <= 0) return "غير مدفوع";
  return "مدفوع جزئياً";
}

function ModalFooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <div className="border-t pt-3">
      <Button variant="outline" size="sm" className="w-full gap-2 sm:w-auto" asChild>
        <Link to={href}>
          <ExternalLink className="h-3.5 w-3.5" />
          {children}
        </Link>
      </Button>
    </div>
  );
}

export function DashboardInvoiceModal({
  invoiceId,
  open,
  onOpenChange,
}: {
  invoiceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isWorker = useIsWorker();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["invoice", invoiceId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, unknown> }>(`/invoices/${invoiceId}`);
      return res.data.data;
    },
    enabled: open && Boolean(invoiceId),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90vh,720px)] max-w-lg overflow-y-auto">
        <DialogHeader className="text-start">
          <DialogTitle>تفاصيل الفاتورة</DialogTitle>
          <DialogDescription>ملخص سريع دون مغادرة لوحة التحكم.</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">جاري التحميل…</p>
        ) : isError || !data ? (
          <p className="text-sm text-destructive">تعذّر تحميل الفاتورة.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">رقم الفاتورة</dt>
                <dd className="font-mono font-semibold">#{String(data.invoiceNo)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">العميل</dt>
                <dd className="font-medium">
                  {(data.customer as { name?: string } | null)?.name ?? "—"}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">الجوال</dt>
                <dd className="font-mono" dir="ltr">
                  {(data.customer as { mobile?: string } | null)?.mobile ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">تاريخ الفاتورة</dt>
                <dd>{new Date(String(data.createdAt)).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">موعد التسليم</dt>
                <dd>
                  {data.deliveryDate
                    ? new Date(String(data.deliveryDate)).toLocaleString()
                    : "—"}
                </dd>
              </div>
              {!isWorker && !data.financialsRedacted ? (
                <>
                  <div>
                    <dt className="text-xs text-muted-foreground">الإجمالي</dt>
                    <dd className="font-mono tabular-nums">{formatAED(data.totalFils as number)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">المدفوع</dt>
                    <dd className="font-mono tabular-nums">{formatAED(data.paidFils as number)}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-muted-foreground">المتبقي</dt>
                    <dd className="font-mono tabular-nums font-semibold text-amber-900 dark:text-amber-100">
                      {formatAED(data.balanceFils as number)}
                    </dd>
                  </div>
                </>
              ) : null}
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">حالة التشغيل / التفصيل</dt>
                <dd>{invoiceFulfillmentLabel(String(data.fulfillmentStatus ?? ""))}</dd>
              </div>
              {!isWorker && !data.financialsRedacted ? (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">حالة السداد</dt>
                  <dd>
                    {paymentStatusAr(
                      data.balanceFils as number,
                      data.paidFils as number,
                      Boolean(data.isVoid),
                    )}
                  </dd>
                </div>
              ) : null}
            </dl>
            {invoiceId ? (
              <ModalFooterLink href={`/invoices/${invoiceId}`}>فتح صفحة الفاتورة كاملة</ModalFooterLink>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function DashboardJobProcessModal({
  invoiceId,
  focusJobId,
  open,
  onOpenChange,
}: {
  invoiceId: string | null;
  focusJobId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const hideInvoiceLinePricing = useIsWorker();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["invoice", invoiceId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: Record<string, unknown> }>(`/invoices/${invoiceId}`);
      return res.data.data;
    },
    enabled: open && Boolean(invoiceId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard", "pending-tailoring"] });
    if (invoiceId) void queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
  };

  useEffect(() => {
    if (!data || !focusJobId || !open) return;
    const t = window.setTimeout(() => {
      document.getElementById(`modal-job-${focusJobId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 200);
    return () => window.clearTimeout(t);
  }, [data, focusJobId, open]);

  const jobOrders = (data?.jobOrders as JobOrderRow[]) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(92vh,900px)] w-[min(96vw,720px)] max-w-[720px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[720px]">
        <DialogHeader className="shrink-0 border-b px-4 py-3 text-start sm:px-6 sm:py-4">
          <DialogTitle>مسار التفصيل</DialogTitle>
          <DialogDescription>
            جميع قطع التفصيل لهذه الفاتورة — تعيين العمال وإتمام المراحل من هنا.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-6 sm:py-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">جاري التحميل…</p>
          ) : isError || !data ? (
            <p className="text-sm text-destructive">تعذّر تحميل بيانات الفاتورة.</p>
          ) : jobOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد طلبات تفصيل على هذه الفاتورة.</p>
          ) : (
            <div className="space-y-6">
              {jobOrders.map((job) => (
                <div
                  key={job.id}
                  id={`modal-job-${job.id}`}
                  className="rounded-xl border border-border/80 bg-muted/10 p-3 dark:bg-muted/5"
                >
                  <p className="mb-2 text-xs font-semibold text-muted-foreground">
                    طلب تفصيل #{job.jobNo} · {job.productStyle}
                  </p>
                  <JobProcessPieceTable
                    jobId={job.id}
                    jobNo={job.jobNo}
                    productStyle={job.productStyle}
                    jobStage={job.stage}
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
                    hideInvoiceLinePricing={hideInvoiceLinePricing}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {invoiceId ? (
          <div className="shrink-0 border-t px-4 py-3 sm:px-6">
            <ModalFooterLink href={`/invoices/${invoiceId}`}>فتح الفاتورة في صفحة كاملة</ModalFooterLink>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
