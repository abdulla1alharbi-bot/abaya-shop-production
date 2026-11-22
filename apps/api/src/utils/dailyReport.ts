import type { PrismaClient } from "@prisma/client";
import { getCustomerFacingShopName, getShopTimezone } from "../config/shop.js";
import { type DateKey, dayRangeUtc, shopWallClock } from "./shopTime.js";
import { extraWorkWagesWhere } from "./extraWorkWages.js";
import { SALES_DAY_INVOICE_SELECT, type SalesDayRow, buildSalesDay } from "./salesDay.js";

/**
 * The end-of-day figures the owner asked to receive without opening the app:
 * how much money came in (new orders / delivery / payments on older invoices,
 * the same split and table as the sales report), plus a line each for the
 * workshop, expenses and what customers still owe.
 *
 * Every definition here is deliberately the SAME one the dashboard's "today" strip
 * uses (`GET /api/dashboard/today`) — a nightly email that disagrees with the screen
 * is worse than no email. The one difference is the day boundary: this slices the day
 * on the SHOP's wall clock (setting `timezone`, default Asia/Dubai), because the
 * server runs in UTC and would otherwise cut the day at 04:00 shop time.
 */

/** Invoice line rollups are keyed off "does this line have a job order" — same as the dashboard. */

/** How many invoices to list line-by-line in the email before summarising. */
const INVOICE_LIST_LIMIT = 40;

export type DailyReportMethodRow = { method: string; count: number; totalFils: number };
export type DailyReportStageRow = { stageKey: string; count: number; wagesFils: number };

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
    /** Paid on invoices raised today: new orders (طلبيات جديدة). */
    newFils: number;
    /** Paid on older invoices delivered today (ديلفري). */
    deliveryFils: number;
    /** Paid on older invoices without delivery (دفعات على فواتير قديمة). */
    oldPaymentFils: number;
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
  /** Every invoice issued, delivered or paid today — the sales report's table (see salesDay.ts). */
  rows: SalesDayRow[];
  /** How many rows there were before the list was cut to INVOICE_LIST_LIMIT. */
  rowCount: number;
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
    deliveredOlder,
    expenseAgg,
    wageStages,
    extraWork,
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
        invoice: { select: SALES_DAY_INVOICE_SELECT },
      },
    }),
    db.invoice.findMany({
      where: { isVoid: false, createdAt: range },
      select: {
        ...SALES_DAY_INVOICE_SELECT,
        paidFils: true,
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
    // Older invoices handed over today: the «ديلفري» rows, even when nothing was paid.
    db.invoice.findMany({
      where: { isVoid: false, deliveredAt: range, createdAt: { lt: from } },
      select: SALES_DAY_INVOICE_SELECT,
    }),
    db.expense.aggregate({ where: { date: range }, _sum: { amountFils: true }, _count: true }),
    db.jobOrderWorkStage.findMany({
      where: {
        isCompleted: true,
        OR: [
          { completedAt: range },
          // Legacy rows finished before `completedAt` existed still carry the date
          // on their production entry — the dashboard counts those too.
          { completedAt: null, productionEntry: { date: range } },
        ],
      },
      select: { stageKey: true, wageFils: true },
    }),
    // «شغل إضافي» (ARI / PUSSOS) is a wage but not a stage — same as the dashboard.
    db.productionEntry.findMany({
      where: extraWorkWagesWhere(range),
      select: { workType: true, totalFils: true },
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

  for (const inv of invoicesToday) {
    salesTotal += inv.totalFils;
    salesPaid += inv.paidFils;
    salesBalance += inv.balanceFils;
    for (const item of inv.items) {
      if (item.jobOrder) {
        tailoringFils += item.totalFils;
        tailoringPieces += item.qty;
      } else {
        readyMadeFils += item.totalFils;
        readyMadePieces += item.qty;
      }
    }
  }

  const byMethod = new Map<string, DailyReportMethodRow>();
  let collectionsTotal = 0;
  for (const p of payments) {
    collectionsTotal += p.amountFils;
    const row = byMethod.get(p.method) ?? { method: p.method, count: 0, totalFils: 0 };
    row.count += 1;
    row.totalFils += p.amountFils;
    byMethod.set(p.method, row);
  }
  const day = buildSalesDay({ from, to, issued: invoicesToday, delivered: deliveredOlder, payments });

  const byStage = new Map<string, DailyReportStageRow>();
  let wagesFils = 0;
  for (const w of wageStages) {
    wagesFils += w.wageFils;
    const row = byStage.get(w.stageKey) ?? { stageKey: w.stageKey, count: 0, wagesFils: 0 };
    row.count += 1;
    row.wagesFils += w.wageFils;
    byStage.set(w.stageKey, row);
  }
  for (const e of extraWork) {
    wagesFils += e.totalFils;
    const row = byStage.get(e.workType) ?? { stageKey: e.workType, count: 0, wagesFils: 0 };
    row.count += 1;
    row.wagesFils += e.totalFils;
    byStage.set(e.workType, row);
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
      newFils: day.newFils,
      deliveryFils: day.deliveryFils,
      oldPaymentFils: day.oldPaymentFils,
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
    rows: day.rows.slice(0, INVOICE_LIST_LIMIT),
    rowCount: day.rows.length,
  };
}
