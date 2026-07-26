import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/db.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/rbac.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { invoiceReadyForDeliveryWhere, invoiceTailoringReadyWhere } from "../../utils/invoiceFulfillment.js";
import {
  isWorkerRequest,
  redactDashboardStatsForWorker,
  redactPendingTailoringItem,
} from "../../utils/workerFinancialRedaction.js";
import { notify } from "../../utils/notify.js";
import {
  NOT_NOTIFIED_ALERT_AFTER_MS,
  alertUncontactedReadyInvoices,
} from "../../utils/invoiceReadyNotify.js";
import { countCustomerMessageQueue, noReadyNoticeWhere } from "../../utils/customerMessageQueue.js";
import {
  findPendingJobsByUrgency,
  oldestOverdueDays,
  pendingCustomerJobsWhere,
  summarizePendingJobs,
} from "../../utils/jobUrgency.js";

export const dashboardRouter = Router();
dashboardRouter.use(authMiddleware);

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
      where: pendingCustomerJobsWhere(),
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

    // Counted in SQL over *all* pending jobs — `items` is capped at 200 rows, so
    // summing the rendered rows would silently under-report on a busy day.
    const summary = await summarizePendingJobs(
      prisma,
      startOfLocalDay(now),
      endExclusiveNextLocalDay(now),
    );

    const payload = {
      summary,
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

/**
 * Line-by-line backing for every money figure on today's dashboard strip, so a
 * card can answer "what IS this number?" without sending the owner to another
 * screen.
 *
 * It also separates two things the old strip conflated: cash that arrived today
 * (`collections` — may be settling last week's invoice) and what today's selling
 * actually earned (`invoicedToday` — of which most may still be unpaid). An
 * AED 700 abaya sold today against a AED 100 deposit is 100 of collections and
 * 700 of invoiced work, with 600 still to come.
 */
dashboardRouter.get(
  "/today",
  requirePermission("dashboard.view"),
  asyncHandler(async (req, res) => {
    if (isWorkerRequest(req)) {
      res.status(403).json({ success: false, error: "Financial breakdown not available" });
      return;
    }

    const now = new Date();
    const startOfToday = startOfLocalDay(now);
    const endOfTodayExclusive = endExclusiveNextLocalDay(now);
    const todayRange = { gte: startOfToday, lt: endOfTodayExclusive };

    const [payments, invoicesToday, expenses, wageStages] = await Promise.all([
      prisma.payment.findMany({
        where: { createdAt: todayRange, invoice: { isVoid: false } },
        select: {
          id: true,
          amountFils: true,
          method: true,
          createdAt: true,
          invoice: {
            select: { id: true, invoiceNo: true, customer: { select: { name: true } } },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.invoice.findMany({
        where: { isVoid: false, createdAt: todayRange },
        select: {
          id: true,
          invoiceNo: true,
          totalFils: true,
          paidFils: true,
          balanceFils: true,
          createdAt: true,
          customer: { select: { name: true } },
          items: {
            select: {
              qty: true,
              totalFils: true,
              description: true,
              // Presence of a job order is what makes a line "tailoring" —
              // everything else is ready-made stock off the shelf.
              jobOrder: { select: { id: true } },
              product: { select: { name: true, nameAr: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.expense.findMany({
        where: { date: todayRange },
        select: {
          id: true,
          amountFils: true,
          description: true,
          date: true,
          category: { select: { name: true } },
        },
        orderBy: { date: "desc" },
      }),
      prisma.jobOrderWorkStage.findMany({
        where: {
          isCompleted: true,
          jobOrder: { stage: { in: [...COMPLETED_WAGE_JOB_STAGES] } },
          OR: [
            { completedAt: todayRange },
            { completedAt: null, productionEntry: { date: todayRange } },
          ],
        },
        select: {
          id: true,
          stageKey: true,
          wageFils: true,
          completedAt: true,
          workerNameSnapshot: true,
          worker: { select: { name: true } },
          jobOrder: { select: { jobNo: true, productStyle: true } },
        },
        orderBy: { completedAt: "desc" },
      }),
    ]);

    let tailoringFils = 0;
    let tailoringPieces = 0;
    let readyMadeFils = 0;
    let readyMadePieces = 0;
    for (const inv of invoicesToday) {
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

    const sum = <T>(rows: T[], pick: (row: T) => number) => rows.reduce((a, r) => a + pick(r), 0);

    res.status(200).json({
      success: true,
      data: {
        collections: {
          totalFils: sum(payments, (p) => p.amountFils),
          items: payments.map((p) => ({
            id: p.id,
            amountFils: p.amountFils,
            method: p.method,
            at: p.createdAt.toISOString(),
            invoiceId: p.invoice.id,
            invoiceNo: p.invoice.invoiceNo,
            customerName: p.invoice.customer?.name ?? null,
          })),
        },
        invoicedToday: {
          totalFils: sum(invoicesToday, (i) => i.totalFils),
          paidFils: sum(invoicesToday, (i) => i.paidFils),
          /** Still owed on work sold today — the figure the strip never showed. */
          balanceFils: sum(invoicesToday, (i) => i.balanceFils),
          invoiceCount: invoicesToday.length,
          tailoring: { totalFils: tailoringFils, pieces: tailoringPieces },
          readyMade: { totalFils: readyMadeFils, pieces: readyMadePieces },
          items: invoicesToday.map((i) => ({
            id: i.id,
            invoiceNo: i.invoiceNo,
            customerName: i.customer?.name ?? null,
            totalFils: i.totalFils,
            paidFils: i.paidFils,
            balanceFils: i.balanceFils,
            at: i.createdAt.toISOString(),
            tailoringFils: sum(
              i.items.filter((it) => it.jobOrder),
              (it) => it.totalFils,
            ),
            pieces: i.items.map((it) => ({
              label: it.description?.trim() || it.product?.nameAr || it.product?.name || "—",
              qty: it.qty,
              totalFils: it.totalFils,
              isTailoring: Boolean(it.jobOrder),
            })),
          })),
        },
        expenses: {
          totalFils: sum(expenses, (e) => e.amountFils),
          items: expenses.map((e) => ({
            id: e.id,
            amountFils: e.amountFils,
            description: e.description,
            category: e.category?.name ?? null,
            at: e.date.toISOString(),
          })),
        },
        wages: {
          totalFils: sum(wageStages, (w) => w.wageFils),
          items: wageStages.map((w) => ({
            id: w.id,
            amountFils: w.wageFils,
            stageKey: w.stageKey,
            workerName: w.worker?.name ?? w.workerNameSnapshot ?? "—",
            jobNo: w.jobOrder?.jobNo ?? null,
            productStyle: w.jobOrder?.productStyle ?? null,
            at: w.completedAt ? w.completedAt.toISOString() : null,
          })),
        },
      },
    });
  }),
);

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
      pendingSummary,
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
      summarizePendingJobs(prisma, startOfToday, endOfTodayExclusive),
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

    await alertUncontactedReadyInvoices(prisma);

    const paymentsTodayFils = paymentsTodayAgg._sum.amountFils ?? 0;
    const wagesTodayFils = wagesTodayAgg._sum.wageFils ?? 0;
    const expensesTodayFils = expensesTodayAgg._sum.amountFils ?? 0;
    const netTodayFils = paymentsTodayFils - expensesTodayFils - wagesTodayFils;

    const stats = {
      jobOrdersCount: jobOrdersTotal,
      jobOrdersOpenCount: jobOrdersOpen,
      jobOrdersReadyCount: jobOrdersReady,
      jobOrdersOverdueCount: pendingSummary.overdueCount,
      jobOrdersDueTodayCount: pendingSummary.dueTodayCount,
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
 * The "needs action now" feed: only the things somebody has to *do* something
 * about today, each with the count and money at stake so the owner can triage
 * without opening four screens. Empty array = nothing on fire.
 */
dashboardRouter.get(
  "/attention",
  requirePermission("dashboard.view"),
  asyncHandler(async (req, res) => {
    const now = new Date();
    const startOfToday = startOfLocalDay(now);
    const endOfTodayExclusive = endExclusiveNextLocalDay(now);
    const worker = isWorkerRequest(req);
    const readyCutoff = new Date(now.getTime() - NOT_NOTIFIED_ALERT_AFTER_MS);

    /** Ready for over a day with nobody logged as having called the customer. */
    const uncontactedWhere = {
      ...invoiceTailoringReadyWhere(),
      readyAt: { not: null, lte: readyCutoff },
      ...noReadyNoticeWhere(),
    };

    const [
      pending,
      oldestLateDays,
      uncontactedCount,
      uncontactedValue,
      lowStockRolls,
      overCreditRows,
    ] = await Promise.all([
      summarizePendingJobs(prisma, startOfToday, endOfTodayExclusive),
      oldestOverdueDays(prisma, startOfToday),
      prisma.invoice.count({ where: uncontactedWhere }),
      worker
        ? Promise.resolve(null)
        : prisma.invoice.aggregate({ where: uncontactedWhere, _sum: { totalFils: true } }),
      prisma.fabricRoll.findMany({
        where: { isActive: true },
        select: { id: true, name: true, rollCode: true, availableMeters: true, lowStockAt: true },
      }),
      worker
        ? Promise.resolve([])
        : prisma.$queryRaw<{ c: number; excess: number | null }[]>(
            Prisma.sql`SELECT COUNT(*)::int AS c, SUM("balanceFils" - "creditLimitFils")::int AS excess
                       FROM "Customer"
                       WHERE "creditLimitFils" > 0 AND "balanceFils" > "creditLimitFils"`,
          ),
    ]);

    const lowStock = lowStockRolls.filter((r) => r.availableMeters <= r.lowStockAt);
    const overCredit = overCreditRows[0];

    type AttentionItem = {
      id: string;
      severity: "critical" | "warning";
      count: number;
      /** Money at stake, when there is any. Withheld from workers. */
      amountFils?: number;
      /** Extra context for the label, e.g. days late or the fabric names. */
      detail?: string;
      link: string;
    };

    const items: AttentionItem[] = [];

    if (pending.overdueCount > 0) {
      items.push({
        id: "overdueJobs",
        severity: "critical",
        count: pending.overdueCount,
        detail: String(oldestLateDays),
        link: "/invoices",
      });
    }
    if (pending.dueTodayCount > 0) {
      items.push({
        id: "dueToday",
        severity: "warning",
        count: pending.dueTodayCount,
        link: "/invoices",
      });
    }
    if (uncontactedCount > 0) {
      items.push({
        id: "readyUncontacted",
        severity: "critical",
        count: uncontactedCount,
        ...(uncontactedValue ? { amountFils: uncontactedValue._sum.totalFils ?? 0 } : {}),
        // Straight to the screen that can actually clear it, not just list it.
        link: "/invoices/messages",
      });
    }
    if (lowStock.length > 0) {
      items.push({
        id: "lowStock",
        severity: "warning",
        count: lowStock.length,
        detail: lowStock
          .slice(0, 3)
          .map((r) => r.name)
          .join("، "),
        link: "/fabrics",
      });
    }
    if (!worker && overCredit && overCredit.c > 0) {
      items.push({
        id: "overCredit",
        severity: "warning",
        count: Number(overCredit.c),
        amountFils: Number(overCredit.excess ?? 0),
        link: "/customers",
      });
    }

    res.status(200).json({ success: true, data: { items } });
  }),
);

/**
 * Rows behind one attention item, fetched only when its dialog opens. Kept out
 * of `/attention` itself so the dashboard's first paint stays a count query.
 *
 * Every branch returns the same row shape so the dialog renders one way.
 */
dashboardRouter.get(
  "/attention/:itemId/rows",
  requirePermission("dashboard.view"),
  asyncHandler(async (req, res) => {
    const { itemId } = req.params;
    const worker = isWorkerRequest(req);
    const now = new Date();
    const startOfToday = startOfLocalDay(now);
    const endOfTodayExclusive = endExclusiveNextLocalDay(now);
    const TAKE = 100;

    type Row = {
      id: string;
      title: string;
      subtitle: string | null;
      amountFils: number | null;
      meta: string | null;
      link: string;
    };
    let rows: Row[] = [];

    if (itemId === "overdueJobs" || itemId === "dueToday") {
      const jobs = await findPendingJobsByUrgency(
        prisma,
        itemId === "overdueJobs" ? "overdue" : "due_today",
        startOfToday,
        endOfTodayExclusive,
        TAKE,
      );
      rows = jobs.map((j) => ({
        id: j.jobId,
        title: `#${j.invoiceNo} — ${j.customerName}`,
        subtitle: `${j.pieceDescription?.trim() || j.productStyle} · ${j.stage}`,
        amountFils: worker ? null : j.invoiceBalanceFils,
        meta: new Date(j.effectiveDue).toISOString(),
        link: `/invoices/${j.invoiceId}`,
      }));
    } else if (itemId === "readyUncontacted") {
      const cutoff = new Date(now.getTime() - NOT_NOTIFIED_ALERT_AFTER_MS);
      const invoices = await prisma.invoice.findMany({
        where: {
          ...invoiceTailoringReadyWhere(),
          readyAt: { not: null, lte: cutoff },
          ...noReadyNoticeWhere(),
        },
        select: {
          id: true,
          invoiceNo: true,
          totalFils: true,
          readyAt: true,
          customer: { select: { name: true, mobile: true } },
        },
        orderBy: { readyAt: "asc" },
        take: TAKE,
      });
      rows = invoices.map((i) => ({
        id: i.id,
        title: `#${i.invoiceNo} — ${i.customer?.name ?? "—"}`,
        subtitle: i.customer?.mobile ?? null,
        amountFils: worker ? null : i.totalFils,
        meta: i.readyAt ? i.readyAt.toISOString() : null,
        link: `/invoices/${i.id}`,
      }));
    } else if (itemId === "lowStock") {
      const all = await prisma.fabricRoll.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          rollCode: true,
          color: true,
          availableMeters: true,
          lowStockAt: true,
        },
      });
      rows = all
        .filter((r) => r.availableMeters <= r.lowStockAt)
        .sort((a, b) => a.availableMeters - b.availableMeters)
        .slice(0, TAKE)
        .map((r) => ({
          id: r.id,
          title: `${r.name} (${r.rollCode})`,
          subtitle: r.color,
          amountFils: null,
          // Metres, not money — the dialog renders this branch as a quantity.
          meta: `${r.availableMeters.toFixed(2)}/${r.lowStockAt.toFixed(2)}`,
          link: `/fabrics/${r.id}/edit`,
        }));
    } else if (itemId === "openJobs" || itemId === "readyJobs") {
      // Steady-state workshop counts from the "Balances & Inventory" strip.
      const jobs = await prisma.jobOrder.findMany({
        where:
          itemId === "readyJobs"
            ? { stage: "READY" }
            : { stage: { notIn: ["DELIVERED", "CONVERTED_TO_READY"] } },
        select: {
          id: true,
          jobNo: true,
          stage: true,
          productStyle: true,
          dueDate: true,
          customer: { select: { name: true } },
          invoice: { select: { id: true, invoiceNo: true, balanceFils: true } },
        },
        orderBy: { dueDate: "asc" },
        take: TAKE,
      });
      rows = jobs.map((j) => ({
        id: j.id,
        title: j.invoice ? `#${j.invoice.invoiceNo} — ${j.customer.name}` : `#${j.jobNo} — ${j.customer.name}`,
        subtitle: `${j.productStyle} · ${j.stage}`,
        amountFils: worker ? null : (j.invoice?.balanceFils ?? null),
        meta: j.dueDate.toISOString(),
        link: j.invoice ? `/invoices/${j.invoice.id}` : `/job-orders/${j.id}`,
      }));
    } else if (itemId === "customerBalances" && !worker) {
      const customers = await prisma.customer.findMany({
        where: { balanceFils: { not: 0 } },
        select: { id: true, name: true, mobile: true, balanceFils: true },
        orderBy: { balanceFils: "desc" },
        take: TAKE,
      });
      rows = customers.map((c) => ({
        id: c.id,
        title: c.name,
        subtitle: c.mobile,
        amountFils: c.balanceFils,
        meta: null,
        link: `/customers/${c.id}`,
      }));
    } else if (itemId === "overCredit" && !worker) {
      const overs = await prisma.$queryRaw<
        { id: string; name: string; mobile: string; excess: number }[]
      >(
        Prisma.sql`SELECT "id", "name", "mobile", ("balanceFils" - "creditLimitFils")::int AS excess
                   FROM "Customer"
                   WHERE "creditLimitFils" > 0 AND "balanceFils" > "creditLimitFils"
                   ORDER BY excess DESC
                   LIMIT ${TAKE}`,
      );
      rows = overs.map((c) => ({
        id: c.id,
        title: c.name,
        subtitle: c.mobile,
        amountFils: Number(c.excess),
        meta: null,
        link: `/customers/${c.id}`,
      }));
    }

    res.status(200).json({ success: true, data: { items: rows } });
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

    const [workshopDueToday, invoicesUnpaid, fabricsLow, customersOver, messageQueue] = await Promise.all([
      // Workshop jobs due today and still needing work — same effective due date
      // (invoice delivery date first) the dashboard counts with.
      can("jobProcess.view")
        ? summarizePendingJobs(prisma, startToday, endToday).then((s) => s.dueTodayCount)
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
      // Customers owed a message today (order ready, or money still due)
      can("invoices.view") ? countCustomerMessageQueue(prisma) : Promise.resolve(0),
    ]);

    res.status(200).json({
      success: true,
      data: {
        workshopDueToday,
        invoicesUnpaid,
        fabricsLowStock: Number(fabricsLow[0]?.c ?? 0),
        customersOverCredit: Number(customersOver[0]?.c ?? 0),
        customerMessages: messageQueue,
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

    // Same overdue definition the rest of the dashboard uses — see utils/jobUrgency.
    const { overdueCount: overdueJobsCount } = await summarizePendingJobs(
      prisma,
      startOfToday,
      endOfToday,
    );

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
