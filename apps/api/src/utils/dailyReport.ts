import type { PrismaClient } from "@prisma/client";
import { getCustomerFacingShopName, getShopTimezone } from "../config/shop.js";
import { type DateKey, dayRangeUtc, shopWallClock } from "./shopTime.js";

/**
 * The end-of-day figures the owner asked to receive without opening the app:
 * how much tailoring was sold, how much cash actually came in (deposits vs
 * collections on older invoices), what the workshop finished, and what was spent.
 *
 * Every definition here is deliberately the SAME one the dashboard's "today" strip
 * uses (`GET /api/dashboard/today`) — a nightly email that disagrees with the screen
 * is worse than no email. The one difference is the day boundary: this slices the day
 * on the SHOP's wall clock (setting `timezone`, default Asia/Dubai), because the
 * server runs in UTC and would otherwise cut the day at 04:00 shop time.
 */

/** Invoice line rollups are keyed off "does this line have a job order" — same as the dashboard. */
const COMPLETED_WAGE_JOB_STAGES = ["READY", "DELIVERED"] as const;

/** How many of today's invoices to list line-by-line in the email before summarising. */
const INVOICE_LIST_LIMIT = 25;

export type DailyReportMethodRow = { method: string; count: number; totalFils: number };
export type DailyReportStageRow = { stageKey: string; count: number; wagesFils: number };
export type DailyReportInvoiceRow = {
  invoiceNo: number;
  customerName: string | null;
  totalFils: number;
  paidFils: number;
  balanceFils: number;
  tailoringFils: number;
  pieces: number;
};

export type DailyReport = {
  dateKey: DateKey;
  timeZone: string;
  from: string;
  to: string;
  shopName: string | null;
  currency: string;
  sales: {
    invoiceCount: number;
    totalFils: number;
    paidFils: number;
    balanceFils: number;
    tailoring: { totalFils: number; pieces: number };
    readyMade: { totalFils: number; pieces: number };
  };
  collections: {
    totalFils: number;
    count: number;
    byMethod: DailyReportMethodRow[];
    /** Paid against an invoice raised today — the deposit/down-payment at the counter. */
    depositsFils: number;
    /** Paid against an invoice from an earlier day — collections on delivery or on debt. */
    settlementsFils: number;
  };
  workshop: {
    stagesCompleted: number;
    wagesFils: number;
    byStage: DailyReportStageRow[];
    /** Tailoring pieces that entered the workshop today. */
    newJobs: number;
    /** Orders whose last piece became ready today. */
    ordersReady: number;
    /** Tailoring pieces handed to the customer today. */
    piecesDelivered: number;
  };
  expenses: { totalFils: number; count: number };
  /** Cash position for the day: what came in, minus what went out. */
  netFils: number;
  /** Debt position at the moment the report is built — not a today-only figure. */
  outstanding: { totalFils: number; invoiceCount: number };
  invoices: DailyReportInvoiceRow[];
  /** True when today produced more invoices than `invoices` lists. */
  invoicesTruncated: boolean;
};

async function getCurrency(db: PrismaClient): Promise<string> {
  const s = await db.setting.findUnique({ where: { key: "currency" } });
  return s?.value?.trim() || "AED";
}

/** The shop-local calendar day `at` falls on. Used to label "today's" report. */
export async function currentShopDateKey(db: PrismaClient, at: Date = new Date()): Promise<DateKey> {
  const tz = await getShopTimezone(db);
  return shopWallClock(tz, at).dateKey;
}

export async function buildDailyReport(
  db: PrismaClient,
  dateKey: DateKey,
  timeZoneOverride?: string,
): Promise<DailyReport> {
  const timeZone = timeZoneOverride ?? (await getShopTimezone(db));
  const { from, to } = dayRangeUtc(dateKey, timeZone);
  const range = { gte: from, lt: to };

  const [
    shopName,
    currency,
    payments,
    invoicesToday,
    expenseAgg,
    wageStages,
    newJobs,
    ordersReady,
    piecesDelivered,
    outstandingAgg,
  ] = await Promise.all([
    getCustomerFacingShopName(db),
    getCurrency(db),
    db.payment.findMany({
      where: { createdAt: range, invoice: { isVoid: false } },
      select: {
        amountFils: true,
        method: true,
        invoice: { select: { createdAt: true } },
      },
    }),
    db.invoice.findMany({
      where: { isVoid: false, createdAt: range },
      select: {
        invoiceNo: true,
        totalFils: true,
        paidFils: true,
        balanceFils: true,
        customer: { select: { name: true } },
        items: {
          select: {
            qty: true,
            totalFils: true,
            // A line is "tailoring" iff it carries a job order — everything else
            // is ready-made stock off the shelf.
            jobOrder: { select: { id: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.expense.aggregate({ where: { date: range }, _sum: { amountFils: true }, _count: true }),
    db.jobOrderWorkStage.findMany({
      where: {
        isCompleted: true,
        jobOrder: { stage: { in: [...COMPLETED_WAGE_JOB_STAGES] } },
        OR: [
          { completedAt: range },
          // Legacy rows finished before `completedAt` existed still carry the date
          // on their production entry — the dashboard counts those too.
          { completedAt: null, productionEntry: { date: range } },
        ],
      },
      select: { stageKey: true, wageFils: true },
    }),
    // A cancelled sale is not work the shop took in, so voided invoices are
    // excluded here exactly as they are from the money figures. Walk-in job
    // orders carry no invoice at all, hence the explicit null branch.
    db.jobOrder.count({ where: { createdAt: range, OR: [{ invoice: null }, { invoice: { isVoid: false } }] } }),
    db.invoice.count({ where: { isVoid: false, readyAt: range } }),
    db.jobOrder.count({ where: { deliveredAt: range, OR: [{ invoice: null }, { invoice: { isVoid: false } }] } }),
    db.invoice.aggregate({
      where: { isVoid: false, balanceFils: { gt: 0 } },
      _sum: { balanceFils: true },
      _count: true,
    }),
  ]);

  let tailoringFils = 0;
  let tailoringPieces = 0;
  let readyMadeFils = 0;
  let readyMadePieces = 0;
  let salesTotal = 0;
  let salesPaid = 0;
  let salesBalance = 0;
  const invoiceRows: DailyReportInvoiceRow[] = [];

  for (const inv of invoicesToday) {
    salesTotal += inv.totalFils;
    salesPaid += inv.paidFils;
    salesBalance += inv.balanceFils;
    let rowTailoring = 0;
    let rowPieces = 0;
    for (const item of inv.items) {
      rowPieces += item.qty;
      if (item.jobOrder) {
        rowTailoring += item.totalFils;
        tailoringFils += item.totalFils;
        tailoringPieces += item.qty;
      } else {
        readyMadeFils += item.totalFils;
        readyMadePieces += item.qty;
      }
    }
    if (invoiceRows.length < INVOICE_LIST_LIMIT) {
      invoiceRows.push({
        invoiceNo: inv.invoiceNo,
        customerName: inv.customer?.name ?? null,
        totalFils: inv.totalFils,
        paidFils: inv.paidFils,
        balanceFils: inv.balanceFils,
        tailoringFils: rowTailoring,
        pieces: rowPieces,
      });
    }
  }

  const byMethod = new Map<string, DailyReportMethodRow>();
  let collectionsTotal = 0;
  let depositsFils = 0;
  let settlementsFils = 0;
  for (const p of payments) {
    collectionsTotal += p.amountFils;
    const row = byMethod.get(p.method) ?? { method: p.method, count: 0, totalFils: 0 };
    row.count += 1;
    row.totalFils += p.amountFils;
    byMethod.set(p.method, row);
    // Same-day invoice ⇒ money taken when the order was written up (deposit or paid
    // in full); older invoice ⇒ money collected later, on handover or chase.
    if (p.invoice.createdAt >= from && p.invoice.createdAt < to) depositsFils += p.amountFils;
    else settlementsFils += p.amountFils;
  }

  const byStage = new Map<string, DailyReportStageRow>();
  let wagesFils = 0;
  for (const w of wageStages) {
    wagesFils += w.wageFils;
    const row = byStage.get(w.stageKey) ?? { stageKey: w.stageKey, count: 0, wagesFils: 0 };
    row.count += 1;
    row.wagesFils += w.wageFils;
    byStage.set(w.stageKey, row);
  }

  const expensesFils = expenseAgg._sum.amountFils ?? 0;

  return {
    dateKey,
    timeZone,
    from: from.toISOString(),
    to: to.toISOString(),
    shopName,
    currency,
    sales: {
      invoiceCount: invoicesToday.length,
      totalFils: salesTotal,
      paidFils: salesPaid,
      balanceFils: salesBalance,
      tailoring: { totalFils: tailoringFils, pieces: tailoringPieces },
      readyMade: { totalFils: readyMadeFils, pieces: readyMadePieces },
    },
    collections: {
      totalFils: collectionsTotal,
      count: payments.length,
      byMethod: [...byMethod.values()].sort((a, b) => b.totalFils - a.totalFils),
      depositsFils,
      settlementsFils,
    },
    workshop: {
      stagesCompleted: wageStages.length,
      wagesFils,
      byStage: [...byStage.values()].sort((a, b) => b.wagesFils - a.wagesFils),
      newJobs,
      ordersReady,
      piecesDelivered,
    },
    expenses: { totalFils: expensesFils, count: expenseAgg._count },
    netFils: collectionsTotal - expensesFils,
    outstanding: {
      totalFils: outstandingAgg._sum.balanceFils ?? 0,
      invoiceCount: outstandingAgg._count,
    },
    invoices: invoiceRows,
    invoicesTruncated: invoicesToday.length > invoiceRows.length,
  };
}
