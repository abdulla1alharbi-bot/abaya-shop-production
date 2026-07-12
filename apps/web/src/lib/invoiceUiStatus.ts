export type SimpleInvoiceBadge = "new" | "in_progress" | "ready" | "delivered" | "void" | "converted";

const badgeClass: Record<SimpleInvoiceBadge, string> = {
  new: "border-slate-300 bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100",
  in_progress: "border-amber-300 bg-amber-100 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100",
  ready: "border-emerald-300 bg-emerald-100 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100",
  delivered: "border-violet-300 bg-violet-100 text-violet-950 dark:bg-violet-950/40 dark:text-violet-100",
  void: "border-neutral-400 bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100",
  converted: "border-cyan-300 bg-cyan-100 text-cyan-950 dark:bg-cyan-950/40 dark:text-cyan-100",
};

export function invoiceBadgeStyle(key: SimpleInvoiceBadge): string {
  return `inline-flex items-center rounded-full border px-3 py-1 text-sm font-semibold ${badgeClass[key]}`;
}

/** Invoice-level badge for the operational hub. `labelKey` is an i18n key — render with t(). */
export function getInvoiceOperationalBadge(args: {
  isVoid: boolean;
  deliveredAt: string | null | undefined;
  fulfillmentStatus: string;
}): { key: SimpleInvoiceBadge; labelKey: string } {
  if (args.isVoid) return { key: "void", labelKey: "status.relatedInvoice.void" };
  if (args.deliveredAt) return { key: "delivered", labelKey: "status.job.delivered" };
  if (args.fulfillmentStatus === "READY_FOR_DELIVERY" || args.fulfillmentStatus === "NO_TAILORING") {
    return { key: "ready", labelKey: "status.badge.readyForDelivery" };
  }
  if (args.fulfillmentStatus === "IN_WORKSHOP") return { key: "in_progress", labelKey: "status.job.in_progress" };
  return { key: "new", labelKey: "status.job.new" };
}

type JobLite = {
  stage: string;
  workStages: Array<{ status: string }>;
  deliveredAt?: string | null;
};

/** Per tailoring line / job. `labelKey` is an i18n key — render with t(). */
export function getTailoringItemBadge(job: JobLite): { key: SimpleInvoiceBadge; labelKey: string } {
  if (job.deliveredAt || job.stage === "DELIVERED")
    return { key: "delivered", labelKey: "status.job.delivered" };
  if (job.stage === "CONVERTED_TO_READY")
    return { key: "converted", labelKey: "status.badge.converted" };
  if (job.stage === "READY") return { key: "ready", labelKey: "status.job.ready" };
  if (job.workStages?.length) {
    const allDone = job.workStages.every((w) => w.status === "DONE");
    if (allDone) return { key: "ready", labelKey: "status.job.ready" };
    const anyStarted = job.workStages.some((w) => w.status !== "PENDING");
    if (anyStarted) return { key: "in_progress", labelKey: "status.job.in_progress" };
  }
  if (job.stage === "NEW" || job.stage === "CUTTING")
    return { key: "new", labelKey: "status.job.new" };
  return { key: "in_progress", labelKey: "status.job.in_progress" };
}
