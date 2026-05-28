import type { Request } from "express";
import { normalizeAppRole } from "@abaya-shop/shared";

export function isWorkerRequest(req: Pick<Request, "user">): boolean {
  const role = normalizeAppRole(req.user?.role ?? "");
  return role === "WORKER" || role === "WORKSHOP_SUPERVISOR";
}

function redactProductForWorker(p: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!p) return null;
  const { priceFils: _p, costFils: _c, ...rest } = p;
  return rest as Record<string, unknown>;
}

function redactInvoiceItemForWorker(it: Record<string, unknown>): Record<string, unknown> {
  const { unitFils: _u, discountFils: _d, totalFils: _t, product, ...rest } = it;
  return {
    ...rest,
    unitFils: null,
    discountFils: null,
    totalFils: null,
    product:
      product && typeof product === "object"
        ? redactProductForWorker(product as Record<string, unknown>)
        : product,
  };
}

function redactJobOrderInInvoiceForWorker(j: Record<string, unknown>): Record<string, unknown> {
  const {
    balanceFils: _b,
    totalFils: _tf,
    paidFils: _pf,
    costFils: _c,
    invoiceItem,
    product,
    ...rest
  } = j;
  const ii = invoiceItem && typeof invoiceItem === "object" ? (invoiceItem as Record<string, unknown>) : null;
  return {
    ...rest,
    balanceFils: null,
    totalFils: null,
    paidFils: null,
    costFils: null,
    invoiceItem: ii
      ? {
          ...ii,
          unitFils: null,
          totalFils: null,
        }
      : invoiceItem,
    product: product && typeof product === "object" ? redactProductForWorker(product as Record<string, unknown>) : product,
  };
}

/** Full invoice detail payload (from fetchInvoiceDetailWithMeta). */
export function redactInvoiceDetailForWorker(data: Record<string, unknown>): Record<string, unknown> {
  const items = (data.items as Record<string, unknown>[] | undefined)?.map(redactInvoiceItemForWorker) ?? [];
  const jobOrders = (data.jobOrders as Record<string, unknown>[] | undefined)?.map(redactJobOrderInInvoiceForWorker) ?? [];
  const relatedInvoices =
    (data.relatedInvoices as Record<string, unknown>[] | undefined)?.map((inv) => ({
      ...inv,
      totalFils: null,
      paidFils: null,
      balanceFils: null,
    })) ?? [];

  let customer = data.customer;
  if (customer && typeof customer === "object") {
    const c = { ...(customer as Record<string, unknown>) };
    c.balanceFils = null;
    customer = c;
  }

  return {
    ...data,
    financialsRedacted: true,
    subtotalFils: null,
    discountFils: null,
    vatFils: null,
    totalFils: null,
    paidFils: null,
    balanceFils: null,
    payments: [],
    items,
    jobOrders,
    relatedInvoices,
    customer,
  };
}

export function redactInvoiceListPayloadForWorker(payload: {
  items: Record<string, unknown>[];
  meta: Record<string, unknown>;
}): { items: Record<string, unknown>[]; meta: Record<string, unknown> } {
  const items = payload.items.map((inv) => ({
    ...inv,
    totalFils: null,
    paidFils: null,
    balanceFils: null,
  }));
  const meta = { ...payload.meta };
  delete meta.totalOutstandingFils;
  delete meta.invoiceCountWithBalance;
  delete meta.readyInvoiceCount;
  delete meta.totalReadyValueFils;
  return { items, meta: { ...meta, financialsRedacted: true } };
}

export function redactByCustomerMobileForWorker(data: Record<string, unknown>): Record<string, unknown> {
  const customer = data.customer;
  let nextCustomer = customer;
  if (customer && typeof customer === "object") {
    const c = { ...(customer as Record<string, unknown>) };
    if ("balanceFils" in c) c.balanceFils = null;
    nextCustomer = c;
  }
  const invoices = (data.invoices as Record<string, unknown>[] | undefined)?.map((inv) => ({
    ...inv,
    totalFils: null,
    paidFils: null,
    balanceFils: null,
  }));
  return {
    ...data,
    financialsRedacted: true,
    customer: nextCustomer,
    invoices: invoices ?? [],
  };
}

export function redactDashboardStatsForWorker(stats: Record<string, unknown>): Record<string, unknown> {
  return {
    financialsRedacted: true,
    jobOrdersCount: stats.jobOrdersCount ?? 0,
    jobOrdersOpenCount: stats.jobOrdersOpenCount ?? 0,
    jobOrdersReadyCount: stats.jobOrdersReadyCount ?? 0,
    jobOrdersOverdueCount: stats.jobOrdersOverdueCount ?? 0,
    jobOrdersDeliveredThisMonthCount: stats.jobOrdersDeliveredThisMonthCount ?? 0,
    lowStockFabricRolls: stats.lowStockFabricRolls ?? 0,
    customersCount: stats.customersCount ?? 0,
    workersActiveCount: stats.workersActiveCount ?? 0,
    salesMonthFils: null,
    expensesMonthFils: null,
    salesTodayFils: null,
    paymentsTodayFils: null,
    expensesTodayFils: null,
    wagesTodayFils: null,
    netTodayFils: null,
    customersOutstandingFils: null,
    invoicesOutstandingFils: null,
    invoicesWithBalanceCount: null,
    readyForDeliveryInvoiceCount: stats.readyForDeliveryInvoiceCount ?? 0,
    readyForDeliveryTotalFils: null,
  };
}

export function redactPendingTailoringItem(item: Record<string, unknown>): Record<string, unknown> {
  return {
    ...item,
    invoiceBalanceFils: null,
  };
}

export function redactJobOrderDetailForWorker(payload: Record<string, unknown>): Record<string, unknown> {
  const job = { ...(payload as Record<string, unknown>) };
  job.financialsRedacted = true;
  job.balanceFils = null;
  job.totalFils = null;
  job.paidFils = null;
  job.costFils = null;
  job.laborCostFils = null;
  job.totalCostFils = null;

  if (job.invoice && typeof job.invoice === "object") {
    job.invoice = {
      ...(job.invoice as Record<string, unknown>),
      totalFils: null,
      paidFils: null,
      balanceFils: null,
    };
  }
  if (job.invoiceItem && typeof job.invoiceItem === "object") {
    job.invoiceItem = {
      ...(job.invoiceItem as Record<string, unknown>),
      totalFils: null,
      unitFils: null,
    };
  }
  if (job.customer && typeof job.customer === "object") {
    job.customer = {
      ...(job.customer as Record<string, unknown>),
      balanceFils: null,
    };
  }
  if (job.product && typeof job.product === "object") {
    job.product = redactProductForWorker(job.product as Record<string, unknown>);
  }

  return job;
}
