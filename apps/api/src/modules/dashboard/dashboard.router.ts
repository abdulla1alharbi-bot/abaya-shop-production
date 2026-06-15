import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/db.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/rbac.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { invoiceReadyForDeliveryWhere } from "../../utils/invoiceFulfillment.js";
import {
  isWorkerRequest,
  redactDashboardStatsForWorker,
  redactPendingTailoringItem,
} from "../../utils/workerFinancialRedaction.js";
import { notify } from "../../utils/notify.js";

export const dashboardRouter = Router();
dashboardRouter.use(authMiddleware);

const FINISHED_STAGES = ["READY", "DELIVERED", "CONVERTED_TO_READY"] as const;
const COMPLETED_WAGE_JOB_STAGES = ["READY", "DELIVERED"] as const;

/** Calendar midnight in local server TZ — compare due instants to this for “before today”. */
function startOfCalendarDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export type TailoringUrgency = "overdue" | "due_today" | "future";

function computeUrgency(effectiveDue: Date, now: Date): TailoringUrgency {
  const startToday = startOfCalendarDay(now);
  if (effectiveDue < startToday) return "overdue";
  if (isSameCalendarDay(effectiveDue, now)) return "due_today";
  return "future";
}

dashboardRouter.get(
  "/pending-tailoring",
  requirePermission("dashboard.view"),
  asyncHandler(async (req, res) => {
    const now = new Date();

    const jobs = await prisma.jobOrder.findMany({
      where: {
        invoiceId: { not: null },
        stage: { notIn: [...FINISHED_STAGES] },
        invoice: {
          isVoid: false,
          deliveredAt: null,
        },
      },
      include: {
        invoice: {
          select: {
            id: true,
            invoiceNo: true,
            deliveryDate: true,
            balanceFils: true,
          },
        },
        customer: { select: { name: true, mobile: true } },
        invoiceItem: { select: { description: true } },
      },
      orderBy: { dueDate: "asc" },
      take: 200,
    });

    type Row = {
      jobId: string;
      jobNo: number;
      stage: string;
      productStyle: string;
      pieceLabel: string | null;
      effectiveDueAt: string;
      urgency: TailoringUrgency;
      invoiceId: string;
      invoiceNo: number;
      invoiceDeliveryDate: string | null;
      jobDueDate: string;
      invoiceBalanceFils: number;
      customerName: string;
      customerMobile: string;
    };

    const items: Row[] = [];

    for (const j of jobs) {
      const inv = j.invoice;
      if (!inv) continue;

      const effectiveDue = inv.deliveryDate ?? j.dueDate;
      const urgency = computeUrgency(effectiveDue, now);

      const pieceLabel =
        j.invoiceItem?.description?.trim() ||
        (j.productStyle?.trim() ? j.productStyle : null);

      items.push({
        jobId: j.id,
        jobNo: j.jobNo,
        stage: j.stage,
        productStyle: j.productStyle,
        pieceLabel,
        effectiveDueAt: effectiveDue.toISOString(),
        urgency,
        invoiceId: inv.id,
        invoiceNo: inv.invoiceNo,
        invoiceDeliveryDate: inv.deliveryDate ? inv.deliveryDate.toISOString() : null,
        jobDueDate: j.dueDate.toISOString(),
        invoiceBalanceFils: inv.balanceFils,
        customerName: j.customer.name,
        customerMobile: j.customer.mobile,
      });
    }

    /** Urgency first (overdue → due today → future), then earliest effective due, then job number. */
    items.sort((a, b) => {
      const rank = { overdue: 0, due_today: 1, future: 2 };
      const dr = rank[a.urgency] - rank[b.urgency];
      if (dr !== 0) return dr;
      const t = new Date(a.effectiveDueAt).getTime() - new Date(b.effectiveDueAt).getTime();
      if (t !== 0) return t;
      return a.jobNo - b.jobNo;
    });

    let overdueCount = 0;
    let dueTodayCount = 0;
    let inProgressCount = 0;
    for (const it of items) {
      if (it.urgency === "overdue") overdueCount += 1;
      else if (it.urgency === "due_today") dueTodayCount += 1;
      else inProgressCount += 1;
    }

    const payload = {
      summary: {
        overdueCount,
        dueTodayCount,
        inProgressCount,
      },
      items: isWorkerRequest(req)
        ? items.map((it) => redactPendingTailoringItem(it as unknown as Record<string, unknown>))
        : items,
    };
    res.status(200).json({
      success: true,
      data: isWorkerRequest(req) ? { ...payload, financialsRedacted: true as const } : payload,
    });
  }),
);

/** Start of local calendar day; use with `endExclusive` for same-day ranges. */
function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function endExclusiveNextLocalDay(d: Date): Date {
  const s = startOfLocalDay(d);
  return new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1);
}

dashboardRouter.get(
  "/stats",
  requirePermission("dashboard.view"),
  asyncHandler(async (req, res) => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfToday = startOfLocalDay(now);
    const endOfTodayExclusive = endExclusiveNextLocalDay(now);

    const [
      jobOrdersTotal,
      jobOrdersOpen,
      jobOrdersReady,
      jobOrdersOverdue,
      jobOrdersDeliveredMonth,
      invoicesMonth,
      expensesMonth,
      customersCount,
      workersActive,
      salesTodayAgg,
      expensesTodayAgg,
      paymentsTodayAgg,
      wagesTodayAgg,
      allRolls,
      customersBalanceAgg,
      invoicesBalanceAgg,
      invoicesWithBalanceCount,
      readyForDeliveryInvoiceCount,
      readyForDeliveryValueAgg,
    ] = await Promise.all([
      prisma.jobOrder.count(),
      prisma.jobOrder.count({ where: { stage: { notIn: ["DELIVERED", "CONVERTED_TO_READY"] } } }),
      prisma.jobOrder.count({ where: { stage: "READY" } }),
      prisma.jobOrder.count({
        where: {
          dueDate: { lt: startOfToday },
          stage: { notIn: ["DELIVERED", "CONVERTED_TO_READY"] },
        },
      }),
      prisma.jobOrder.count({
        where: {
          stage: "DELIVERED",
          deliveredAt: { gte: startOfMonth },
        },
      }),
      prisma.invoice.findMany({
        where: { isVoid: false, createdAt: { gte: startOfMonth } },
        select: { totalFils: true },
      }),
      prisma.expense.findMany({
        where: { date: { gte: startOfMonth } },
        select: { amountFils: true },
      }),
      prisma.customer.count(),
      prisma.worker.count({ where: { isActive: true } }),
      prisma.invoice.aggregate({
        where: {
          isVoid: false,
          createdAt: { gte: startOfToday, lt: endOfTodayExclusive },
        },
        _sum: { totalFils: true },
      }),
      prisma.expense.aggregate({
        where: { date: { gte: startOfToday, lt: endOfTodayExclusive } },
        _sum: { amountFils: true },
      }),
      prisma.payment.aggregate({
        where: {
          createdAt: { gte: startOfToday, lt: endOfTodayExclusive },
          invoice: { isVoid: false },
        },
        _sum: { amountFils: true },
      }),
      prisma.jobOrderWorkStage.aggregate({
        where: {
          isCompleted: true,
          jobOrder: { stage: { in: [...COMPLETED_WAGE_JOB_STAGES] } },
          OR: [
            { completedAt: { gte: startOfToday, lt: endOfTodayExclusive } },
            {
              completedAt: null,
              productionEntry: { date: { gte: startOfToday, lt: endOfTodayExclusive } },
            },
          ],
        },
        _sum: { wageFils: true },
      }),
      prisma.fabricRoll.findMany({
        select: { id: true, rollCode: true, name: true, availableMeters: true, lowStockAt: true },
      }),
      prisma.customer.aggregate({ _sum: { balanceFils: true } }),
      prisma.invoice.aggregate({
        where: { isVoid: false, balanceFils: { gt: 0 } },
        _sum: { balanceFils: true },
      }),
      prisma.invoice.count({ where: { isVoid: false, balanceFils: { gt: 0 } } }),
      prisma.invoice.count({ where: invoiceReadyForDeliveryWhere() }),
      prisma.invoice.aggregate({
        where: invoiceReadyForDeliveryWhere(),
        _sum: { totalFils: true },
      }),
    ]);

    const salesMonthFils = invoicesMonth.reduce((a, i) => a + i.totalFils, 0);
    const expensesMonthFils = expensesMonth.reduce((a, e) => a + e.amountFils, 0);
    const lowStockRolls = allRolls.filter((r) => r.availableMeters <= r.lowStockAt);
    const lowStockCount = lowStockRolls.length;

    // Fire low-stock notifications (max once per roll per 24 h)
    if (lowStockRolls.length > 0) {
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentlyNotified = await prisma.notification.findMany({
        where: {
          type: "LOW_STOCK",
          createdAt: { gte: since24h },
        },
        select: { link: true },
      });
      const notifiedLinks = new Set(recentlyNotified.map((n) => n.link ?? ""));
      for (const roll of lowStockRolls) {
        const link = `/fabrics/${roll.id}`;
        if (!notifiedLinks.has(link)) {
          await notify(prisma, {
            targetRole: "OWNER",
            type: "LOW_STOCK",
            title: "قماش على وشك النفاد",
            message: `${roll.name} (${roll.rollCode}) — المتاح: ${roll.availableMeters.toFixed(2)} م`,
            link,
          });
        }
      }
    }

    const paymentsTodayFils = paymentsTodayAgg._sum.amountFils ?? 0;
    const wagesTodayFils = wagesTodayAgg._sum.wageFils ?? 0;
    const expensesTodayFils = expensesTodayAgg._sum.amountFils ?? 0;
    const netTodayFils = paymentsTodayFils - expensesTodayFils - wagesTodayFils;

    const stats = {
      jobOrdersCount: jobOrdersTotal,
      jobOrdersOpenCount: jobOrdersOpen,
      jobOrdersReadyCount: jobOrdersReady,
      jobOrdersOverdueCount: jobOrdersOverdue,
      jobOrdersDeliveredThisMonthCount: jobOrdersDeliveredMonth,
      salesMonthFils,
      expensesMonthFils,
      customersCount,
      workersActiveCount: workersActive,
      lowStockFabricRolls: lowStockCount,
      /** Invoice totals for invoices *created* today (accrual-by-invoice-date, not cash). */
      salesTodayFils: salesTodayAgg._sum.totalFils ?? 0,
      /** Cash received today (payment rows on non-void invoices). */
      paymentsTodayFils,
      expensesTodayFils,
      wagesTodayFils,
      netTodayFils,
      customersOutstandingFils: customersBalanceAgg._sum.balanceFils ?? 0,
      invoicesOutstandingFils: invoicesBalanceAgg._sum.balanceFils ?? 0,
      invoicesWithBalanceCount,
      readyForDeliveryInvoiceCount,
      readyForDeliveryTotalFils: readyForDeliveryValueAgg._sum.totalFils ?? 0,
    };
    res.status(200).json({
      success: true,
      data: isWorkerRequest(req) ? redactDashboardStatsForWorker(stats as Record<string, unknown>) : stats,
    });
  }),
);

/**
 * Lightweight live counts for sidebar nav badges. Auth-only (no extra
 * permission) — the frontend renders each badge only on nav items the user
 * can already see.
 */
dashboardRouter.get(
  "/nav-badges",
  asyncHandler(async (req, res) => {
    // Only return the counts the caller is permitted to see — the financial
    // ones (unpaid invoices, customers over credit) must not leak to roles the
    // redaction layer hides them from (e.g. WORKER).
    const perms = req.user?.permissions ?? [];
    const can = (p: string) => perms.includes(p);

    const now = new Date();
    const startToday = startOfLocalDay(now);
    const endToday = endExclusiveNextLocalDay(now);
    const zeroRows: { c: number }[] = [{ c: 0 }];

    const [workshopDueToday, invoicesUnpaid, fabricsLow, customersOver] = await Promise.all([
      // Workshop jobs whose due date is today and still need work
      can("jobProcess.view")
        ? prisma.jobOrder.count({
            where: {
              stage: { notIn: [...FINISHED_STAGES, "CANCELLED"] },
              deliveredAt: null,
              dueDate: { gte: startToday, lt: endToday },
            },
          })
        : Promise.resolve(0),
      // Non-void invoices with an outstanding balance
      can("invoices.view")
        ? prisma.invoice.count({ where: { isVoid: false, balanceFils: { gt: 0 } } })
        : Promise.resolve(0),
      // Active fabric rolls at or below their low-stock threshold
      can("fabrics.view")
        ? prisma.$queryRaw<{ c: number }[]>(
            Prisma.sql`SELECT COUNT(*)::int AS c FROM "FabricRoll" WHERE "isActive" = true AND "availableMeters" <= "lowStockAt"`,
          )
        : Promise.resolve(zeroRows),
      // Customers whose balance exceeds a set credit limit
      can("customers.view")
        ? prisma.$queryRaw<{ c: number }[]>(
            Prisma.sql`SELECT COUNT(*)::int AS c FROM "Customer" WHERE "creditLimitFils" > 0 AND "balanceFils" > "creditLimitFils"`,
          )
        : Promise.resolve(zeroRows),
    ]);

    res.status(200).json({
      success: true,
      data: {
        workshopDueToday,
        invoicesUnpaid,
        fabricsLowStock: Number(fabricsLow[0]?.c ?? 0),
        customersOverCredit: Number(customersOver[0]?.c ?? 0),
      },
    });
  }),
);

/**
 * Phase 3 F4: Trends & KPIs dashboard endpoint.
 * Sales today vs yesterday vs same-day-last-week, last-7-days sparkline, top products,
 * on-time delivery rate, top workers this week.
 */
dashboardRouter.get(
  "/trends",
  requirePermission("dashboard.view"),
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const startOfToday = startOfLocalDay(now);
    const startOfYesterday = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), startOfToday.getDate() - 1);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), startOfToday.getDate() - 7);

    // Sales for a given day
    const sumPaymentsBetween = async (start: Date, end: Date): Promise<number> => {
      const agg = await prisma.payment.aggregate({
        _sum: { amountFils: true },
        where: {
          createdAt: { gte: start, lt: end },
          invoice: { isVoid: false },
        },
      });
      return agg._sum.amountFils ?? 0;
    };

    const endOfToday = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), startOfToday.getDate() + 1);
    const salesToday = await sumPaymentsBetween(startOfToday, endOfToday);
    const salesYesterday = await sumPaymentsBetween(startOfYesterday, startOfToday);
    const startSameDayLastWeek = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), startOfToday.getDate() - 7);
    const endSameDayLastWeek = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), startOfToday.getDate() - 6);
    const salesSameDayLastWeek = await sumPaymentsBetween(startSameDayLastWeek, endSameDayLastWeek);

    // Last 7 days sparkline (oldest first)
    const salesLast7Days: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), startOfToday.getDate() - i);
      const dayEnd = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1);
      salesLast7Days.push(await sumPaymentsBetween(dayStart, dayEnd));
    }

    // Top products this month — from InvoiceItem
    const itemsThisMonth = await prisma.invoiceItem.findMany({
      where: {
        invoice: { isVoid: false, createdAt: { gte: startOfMonth } },
      },
      select: {
        productId: true,
        qty: true,
        totalFils: true,
        product: { select: { name: true, nameAr: true } },
      },
    });
    const byProduct = new Map<string, { name: string; qty: number; totalFils: number }>();
    for (const it of itemsThisMonth) {
      if (!it.productId) continue;
      const key = it.productId;
      const cur = byProduct.get(key) ?? {
        name: it.product?.nameAr ?? it.product?.name ?? "—",
        qty: 0,
        totalFils: 0,
      };
      cur.qty += it.qty;
      cur.totalFils += it.totalFils;
      byProduct.set(key, cur);
    }
    const topProductsThisMonth = [...byProduct.values()]
      .sort((a, b) => b.totalFils - a.totalFils)
      .slice(0, 5);

    // On-time delivery rate — last 30 days of delivered jobs
    const start30Ago = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), startOfToday.getDate() - 30);
    const deliveredJobs = await prisma.jobOrder.findMany({
      where: { deliveredAt: { gte: start30Ago, not: null } },
      select: { deliveredAt: true, dueDate: true },
    });
    const onTimeCount = deliveredJobs.filter(
      (j) => j.deliveredAt && j.dueDate && j.deliveredAt <= j.dueDate,
    ).length;
    const onTimeDeliveryRate30d =
      deliveredJobs.length > 0 ? Math.round((onTimeCount / deliveredJobs.length) * 100) : 0;

    // Top workers this week — from ProductionEntry
    const wagesThisWeek = await prisma.productionEntry.findMany({
      where: {
        date: { gte: startOfWeek },
        jobOrder: { stage: { in: [...COMPLETED_WAGE_JOB_STAGES] } },
      },
      include: { worker: { select: { id: true, name: true } } },
    });
    const byWorker = new Map<string, { name: string; qty: number; wageFils: number }>();
    for (const e of wagesThisWeek) {
      const cur = byWorker.get(e.workerId) ?? { name: e.worker.name, qty: 0, wageFils: 0 };
      cur.qty += e.qty;
      cur.wageFils += e.totalFils;
      byWorker.set(e.workerId, cur);
    }
    const topWorkersThisWeek = [...byWorker.values()]
      .sort((a, b) => b.wageFils - a.wageFils)
      .slice(0, 5);

    // Overdue jobs (non-finished, past due)
    const overdueJobsCount = await prisma.jobOrder.count({
      where: {
        stage: { notIn: [...FINISHED_STAGES, "CANCELLED"] },
        dueDate: { lt: startOfToday },
        deliveredAt: null,
      },
    });

    res.status(200).json({
      success: true,
      data: {
        salesToday,
        salesYesterday,
        salesSameDayLastWeek,
        salesLast7Days,
        topProductsThisMonth,
        onTimeDeliveryRate30d,
        deliveredJobsLast30Days: deliveredJobs.length,
        topWorkersThisWeek,
        overdueJobsCount,
      },
    });
  }),
);
