import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/db.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/rbac.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { computeInvoiceFulfillment } from "../../utils/invoiceFulfillment.js";
import { parseDateRangeOrDefault, parseOptionalDate, queryParamString } from "../../utils/queryParams.js";

export const reportsRouter = Router();
reportsRouter.use(authMiddleware);
const COMPLETED_WAGE_JOB_STAGES = ["READY", "DELIVERED"] as const;

reportsRouter.get(
  "/worker-productivity",
  requirePermission("reports.wages"),
  asyncHandler(async (req, res) => {
    const { from, to } = parseDateRangeOrDefault(req.query as Record<string, unknown>);

    const entries = await prisma.productionEntry.findMany({
      where: {
        date: { gte: from, lte: to },
        jobOrder: { stage: { in: [...COMPLETED_WAGE_JOB_STAGES] } },
      },
      include: { worker: { select: { id: true, name: true, isActive: true } } },
    });

    const byWorker = new Map<
      string,
      { workerId: string; name: string; isActive: boolean; qty: number; totalFils: number; entries: number }
    >();
    for (const e of entries) {
      const cur = byWorker.get(e.workerId) ?? {
        workerId: e.workerId,
        name: e.worker.name,
        isActive: e.worker.isActive,
        qty: 0,
        totalFils: 0,
        entries: 0,
      };
      cur.qty += e.qty;
      cur.totalFils += e.totalFils;
      cur.entries += 1;
      byWorker.set(e.workerId, cur);
    }

    res.status(200).json({
      success: true,
      data: {
        from: from.toISOString(),
        to: to.toISOString(),
        productionRows: [...byWorker.values()].sort((a, b) => b.totalFils - a.totalFils),
      },
    });
  }),
);

reportsRouter.get(
  "/receivables",
  requirePermission("reports.balances"),
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const from = parseOptionalDate(q, "from");
    const to = parseOptionalDate(q, "to");
    const filterByInvoiceDate = Boolean(from && to);

    const invoiceWhere: Prisma.InvoiceWhereInput = {
      isVoid: false,
      balanceFils: { gt: 0 },
      customerId: { not: null },
      ...(filterByInvoiceDate && from && to ? { createdAt: { gte: from, lte: to } } : {}),
    };

    const [invoiceRows, customerRows] = await Promise.all([
      prisma.invoice.findMany({
        where: invoiceWhere,
        orderBy: { createdAt: "asc" },
        take: 500,
        select: {
          id: true,
          invoiceNo: true,
          totalFils: true,
          paidFils: true,
          balanceFils: true,
          createdAt: true,
          customer: { select: { id: true, name: true, mobile: true, code: true } },
        },
      }),
      prisma.customer.findMany({
        where: { balanceFils: { gt: 0 } },
        orderBy: { balanceFils: "desc" },
        take: 100,
        select: { id: true, code: true, name: true, mobile: true, balanceFils: true },
      }),
    ]);

    const now = Date.now();
    type AgingBucket = "current" | "31to60" | "61to90" | "over90";
    const agingTotals: Record<AgingBucket, number> = { current: 0, "31to60": 0, "61to90": 0, over90: 0 };

    const unpaidInvoices = invoiceRows.map((inv) => {
      const daysSince = Math.floor((now - inv.createdAt.getTime()) / 86_400_000);
      let agingBucket: AgingBucket;
      if (daysSince <= 30) agingBucket = "current";
      else if (daysSince <= 60) agingBucket = "31to60";
      else if (daysSince <= 90) agingBucket = "61to90";
      else agingBucket = "over90";
      agingTotals[agingBucket] += inv.balanceFils;
      return { ...inv, daysSince, agingBucket };
    });

    // Sort: oldest (most overdue) first
    unpaidInvoices.sort((a, b) => b.daysSince - a.daysSince);

    res.status(200).json({
      success: true,
      data: {
        unpaidInvoices,
        customersWithBalance: customerRows,
        agingTotals,
        filteredByInvoiceCreatedAt: filterByInvoiceDate,
      },
    });
  }),
);

/** Invoices created in range (non-void) with payment totals — for sales / invoice reports. */
reportsRouter.get(
  "/invoices",
  requirePermission("reports.sales"),
  asyncHandler(async (req, res) => {
    const { from, to } = parseDateRangeOrDefault(req.query as Record<string, unknown>);

    const where: Prisma.InvoiceWhereInput = {
      isVoid: false,
      createdAt: { gte: from, lte: to },
    };

    const [invoiceRows, sums] = await Promise.all([
      prisma.invoice.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 500,
        include: {
          customer: { select: { name: true, mobile: true } },
          jobOrders: { select: { stage: true } },
        },
      }),
      prisma.invoice.aggregate({
        where,
        _sum: { totalFils: true, paidFils: true, balanceFils: true },
        _count: { _all: true },
      }),
    ]);

    const items = invoiceRows.map((inv) => {
      const fulfillmentStatus = computeInvoiceFulfillment(
        { isVoid: inv.isVoid, deliveredAt: inv.deliveredAt },
        inv.jobOrders,
      );
      const { jobOrders: jo, ...rest } = inv;
      return {
        ...rest,
        fulfillmentStatus,
        paymentStatus:
          inv.balanceFils <= 0 ? "PAID" : inv.paidFils <= 0 ? "UNPAID" : "PARTIAL",
      };
    });

    res.status(200).json({
      success: true,
      data: {
        from: from.toISOString(),
        to: to.toISOString(),
        items,
        summary: {
          invoiceCount: sums._count._all,
          totalSalesFils: sums._sum.totalFils ?? 0,
          totalPaidFils: sums._sum.paidFils ?? 0,
          totalRemainingFils: sums._sum.balanceFils ?? 0,
        },
      },
    });
  }),
);

/** Per production entry lines in range (detail for worker wages). */
reportsRouter.get(
  "/production-entries",
  requirePermission("reports.wages"),
  asyncHandler(async (req, res) => {
    const { from, to } = parseDateRangeOrDefault(req.query as Record<string, unknown>);

    const entries = await prisma.productionEntry.findMany({
      where: {
        date: { gte: from, lte: to },
        jobOrder: { stage: { in: [...COMPLETED_WAGE_JOB_STAGES] } },
      },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: 2000,
      include: {
        worker: { select: { id: true, name: true } },
        jobOrder: { select: { id: true, jobNo: true, productStyle: true } },
      },
    });

    const rows = entries.map((e) => ({
      id: e.id,
      date: e.date.toISOString(),
      workType: e.workType,
      qty: e.qty,
      rateFils: e.rateFils,
      totalFils: e.totalFils,
      isApproved: e.isApproved,
      workerName: e.worker.name,
      workerId: e.workerId,
      jobNo: e.jobOrder?.jobNo ?? null,
      productStyle: e.jobOrder?.productStyle ?? null,
    }));

    res.status(200).json({
      success: true,
      data: {
        from: from.toISOString(),
        to: to.toISOString(),
        entries: rows,
      },
    });
  }),
);

/**
 * Workshop wages from completed pipeline stages (JobOrderWorkStage) in range.
 * Aligns with financial-activity wage lines — wageFils per completed stage.
 */
reportsRouter.get(
  "/workshop-wages",
  requirePermission("reports.wages"),
  asyncHandler(async (req, res) => {
    const { from, to } = parseDateRangeOrDefault(req.query as Record<string, unknown>);

    const stages = await prisma.jobOrderWorkStage.findMany({
      where: {
        isCompleted: true,
        jobOrder: { stage: { in: [...COMPLETED_WAGE_JOB_STAGES] } },
        OR: [
          { completedAt: { gte: from, lte: to } },
          {
            completedAt: null,
            productionEntry: { date: { gte: from, lte: to } },
          },
        ],
      },
      include: {
        worker: { select: { id: true, name: true } },
      },
    });

    type Agg = { workerId: string | null; name: string; completedTasks: number; totalWageFils: number };
    const byWorker = new Map<string, Agg>();

    for (const s of stages) {
      const name = (s.worker?.name ?? s.workerNameSnapshot?.trim()) || "غير محدد";
      const mapKey = s.workerId ?? `snap:${name}`;
      const cur =
        byWorker.get(mapKey) ??
        ({
          workerId: s.workerId,
          name,
          completedTasks: 0,
          totalWageFils: 0,
        } as Agg);
      cur.completedTasks += 1;
      cur.totalWageFils += s.wageFils;
      byWorker.set(mapKey, cur);
    }

    const rows = [...byWorker.values()].sort((a, b) => b.totalWageFils - a.totalWageFils);
    const totalWageFils = rows.reduce((sum, r) => sum + r.totalWageFils, 0);

    res.status(200).json({
      success: true,
      data: {
        from: from.toISOString(),
        to: to.toISOString(),
        rows,
        totalWageFils,
        note:
          "يُحسب من مراحل التشغيل المكتملة للفِقرات المكتملة بالكامل فقط (الطلب في حالة جاهز/مُسلّم) مع أجر كل مرحلة كما هو محفوظ عند الإكمال.",
      },
    });
  }),
);

/** Tailoring job orders created in range. */
reportsRouter.get(
  "/tailoring-orders",
  requirePermission("reports.sales"),
  asyncHandler(async (req, res) => {
    const { from, to } = parseDateRangeOrDefault(req.query as Record<string, unknown>);

    const jobs = await prisma.jobOrder.findMany({
      where: { createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        jobNo: true,
        productStyle: true,
        stage: true,
        dueDate: true,
        createdAt: true,
        customer: { select: { name: true, mobile: true } },
        invoice: { select: { id: true, invoiceNo: true } },
      },
    });

    res.status(200).json({
      success: true,
      data: {
        from: from.toISOString(),
        to: to.toISOString(),
        jobOrders: jobs,
        count: jobs.length,
      },
    });
  }),
);

reportsRouter.get(
  "/monthly-production",
  requirePermission("reports.sales"),
  asyncHandler(async (req, res) => {
    const { from, to } = parseDateRangeOrDefault(req.query as Record<string, unknown>);
    const modelId = queryParamString(req.query as Record<string, unknown>, "modelId");

    const batches = await prisma.productionBatch.findMany({
      where: {
        ...(modelId ? { modelId } : {}),
        createdAt: { gte: from, lte: to },
      },
      include: {
        model: { select: { id: true, code: true, name: true } },
        jobs: {
          include: {
            productionEntries: { select: { totalFils: true } },
            materials: { include: { roll: { select: { costPerMeter: true } } } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });

    const rows = batches.map((b: (typeof batches)[number]) => {
      const completedJobs = b.jobs.filter((j: (typeof b.jobs)[number]) =>
        ["READY", "DELIVERED", "CONVERTED_TO_READY"].includes(j.stage),
      );
      const quantityProduced = completedJobs.length;
      const wagesFils = completedJobs.reduce(
        (sum: number, j: (typeof completedJobs)[number]) =>
          sum + j.productionEntries.reduce((s: number, p: (typeof j.productionEntries)[number]) => s + p.totalFils, 0),
        0,
      );
      const materialCostFils = completedJobs.reduce(
        (sum: number, j: (typeof completedJobs)[number]) =>
          sum +
          j.materials.reduce(
            (m: number, mat: (typeof j.materials)[number]) =>
              m + Math.round((mat.roll?.costPerMeter ?? 0) * (mat.deductedMeters ?? mat.meters)),
            0,
          ),
        0,
      );
      const totalCostFils = wagesFils + materialCostFils;
      return {
        batchId: b.id,
        batchNo: b.batchNo,
        modelId: b.model.id,
        modelCode: b.model.code,
        modelName: b.model.name,
        quantityPlanned: b.quantity,
        quantityProduced,
        totalWagesFils: wagesFils,
        totalCostFils,
        createdAt: b.createdAt.toISOString(),
      };
    });

    const summary = {
      totalBatches: rows.length,
      totalProducedQty: rows.reduce((s: number, r: (typeof rows)[number]) => s + r.quantityProduced, 0),
      totalWagesFils: rows.reduce((s: number, r: (typeof rows)[number]) => s + r.totalWagesFils, 0),
      totalCostFils: rows.reduce((s: number, r: (typeof rows)[number]) => s + r.totalCostFils, 0),
    };

    res.status(200).json({
      success: true,
      data: {
        from: from.toISOString(),
        to: to.toISOString(),
        rows,
        summary,
      },
    });
  }),
);

reportsRouter.get(
  "/sample-production",
  requirePermission("reports.sales"),
  asyncHandler(async (req, res) => {
    const { from, to } = parseDateRangeOrDefault(req.query as Record<string, unknown>);
    const modelId = queryParamString(req.query as Record<string, unknown>, "modelId");

    const batches = await prisma.productionBatch.findMany({
      where: {
        type: "SAMPLE",
        ...(modelId ? { modelId } : {}),
        createdAt: { gte: from, lte: to },
      },
      include: {
        model: { select: { id: true, code: true, name: true } },
        jobs: { include: { productionEntries: { select: { totalFils: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });

    const rows = batches.map((b: (typeof batches)[number]) => {
      const pieces = b.jobs.length;
      const wagesFils = b.jobs.reduce(
        (sum: number, j: (typeof b.jobs)[number]) =>
          sum + j.productionEntries.reduce((s: number, p: (typeof j.productionEntries)[number]) => s + p.totalFils, 0),
        0,
      );
      return {
        batchId: b.id,
        batchNo: b.batchNo,
        modelId: b.model.id,
        modelCode: b.model.code,
        modelName: b.model.name,
        pieces,
        totalWagesFils: wagesFils,
        createdAt: b.createdAt.toISOString(),
      };
    });

    res.status(200).json({
      success: true,
      data: {
        from: from.toISOString(),
        to: to.toISOString(),
        rows,
        summary: {
          piecesCount: rows.reduce((s: number, r: (typeof rows)[number]) => s + r.pieces, 0),
          totalWagesFils: rows.reduce((s: number, r: (typeof rows)[number]) => s + r.totalWagesFils, 0),
        },
      },
    });
  }),
);

reportsRouter.get(
  "/sample-model-performance",
  requirePermission("reports.sales"),
  asyncHandler(async (req, res) => {
    const { from, to } = parseDateRangeOrDefault(req.query as Record<string, unknown>);
    const modelId = queryParamString(req.query as Record<string, unknown>, "modelId");
    const sampleJobs = await prisma.jobOrder.findMany({
      where: {
        productionBatch: { is: { type: "SAMPLE" } },
        ...(modelId ? { abayaModelId: modelId } : {}),
        createdAt: { gte: from, lte: to },
      },
      orderBy: { createdAt: "desc" },
      include: {
        abayaModel: { select: { id: true, code: true, name: true } },
        productionEntries: { select: { totalFils: true } },
        materials: { include: { roll: { select: { costPerMeter: true } } } },
      },
      take: 2000,
    });

    const sampleIds = sampleJobs.map((s) => s.id);
    const sourcedOrders = sampleIds.length
      ? await prisma.jobOrder.findMany({
          where: {
            sourceDisplaySampleJobId: { in: sampleIds },
            invoice: { is: { isVoid: false, createdAt: { gte: from, lte: to } } },
          },
          select: {
            sourceDisplaySampleJobId: true,
            totalFils: true,
            invoiceId: true,
            abayaModelId: true,
          },
        })
      : [];

    const ordersBySample = new Map<string, { count: number; revenue: number }>();
    for (const o of sourcedOrders) {
      if (!o.sourceDisplaySampleJobId) continue;
      const prev = ordersBySample.get(o.sourceDisplaySampleJobId) ?? { count: 0, revenue: 0 };
      prev.count += 1;
      prev.revenue += o.totalFils;
      ordersBySample.set(o.sourceDisplaySampleJobId, prev);
    }

    const rows = sampleJobs.map((s) => {
      const wagesFils = s.productionEntries.reduce((a, p) => a + p.totalFils, 0);
      const materialCostFils = s.materials.reduce(
        (a, m) => a + Math.round((m.roll?.costPerMeter ?? 0) * (m.deductedMeters ?? m.meters)),
        0,
      );
      const sampleCostFils = wagesFils + materialCostFils;
      const stats = ordersBySample.get(s.id) ?? { count: 0, revenue: 0 };
      return {
        sampleJobId: s.id,
        sampleCreatedAt: s.createdAt.toISOString(),
        modelId: s.abayaModel?.id ?? s.abayaModelId ?? "",
        modelCode: s.abayaModel?.code ?? "—",
        modelName: s.abayaModel?.name ?? s.productStyle,
        tailoringOrdersCount: stats.count,
        totalTailoringRevenueFils: stats.revenue,
        sampleProductionCostFils: sampleCostFils,
        estimatedReturnFils: stats.revenue - sampleCostFils,
      };
    });

    const byModel = new Map<string, { modelId: string; modelCode: string; modelName: string; count: number; revenue: number }>();
    for (const r of rows) {
      const key = r.modelId || `name:${r.modelName}`;
      const cur = byModel.get(key) ?? {
        modelId: r.modelId,
        modelCode: r.modelCode,
        modelName: r.modelName,
        count: 0,
        revenue: 0,
      };
      cur.count += r.tailoringOrdersCount;
      cur.revenue += r.totalTailoringRevenueFils;
      byModel.set(key, cur);
    }
    const topByOrders = [...byModel.values()]
      .sort((a, b) => b.count - a.count || b.revenue - a.revenue)
      .slice(0, 5);
    const noOrderRows = rows.filter((r) => r.tailoringOrdersCount === 0).slice(0, 10);

    res.status(200).json({
      success: true,
      data: {
        from: from.toISOString(),
        to: to.toISOString(),
        rows,
        topModels: { byOrders: topByOrders },
        noOrderSamples: noOrderRows,
      },
    });
  }),
);

/**
 * All catalog products with invoice-line aggregates for the date range (LEFT JOIN).
 * Products with no lines in range get lineCount/invoiceCount/qty/sales = 0. Sorted by lineCount DESC.
 */
reportsRouter.get(
  "/most-requested-items",
  requirePermission("reports.mostRequested"),
  asyncHandler(async (req, res) => {
    const { from, to } = parseDateRangeOrDefault(req.query as Record<string, unknown>);

    const rows = await prisma.$queryRaw<
      Array<{
        productId: string;
        sku: string;
        name: string;
        nameAr: string | null;
        isService: number | boolean;
        categoryName: string;
        categoryNameAr: string | null;
        lineCount: bigint | number;
        invoiceCount: bigint | number;
        totalQty: number | null;
        totalSalesFils: bigint | number | null;
      }>
    >(Prisma.sql`
      SELECT
        p."id"        AS "productId",
        p."sku"       AS sku,
        p."name"      AS name,
        p."nameAr"    AS "nameAr",
        p."isService" AS "isService",
        c."name"      AS "categoryName",
        c."nameAr"    AS "categoryNameAr",
        COALESCE(agg."lineCount",      0) AS "lineCount",
        COALESCE(agg."invoiceCount",   0) AS "invoiceCount",
        COALESCE(agg."totalQty",       0) AS "totalQty",
        COALESCE(agg."totalSalesFils", 0) AS "totalSalesFils"
      FROM "Product" p
      INNER JOIN "ProductCategory" c ON c."id" = p."categoryId"
      LEFT JOIN (
        SELECT
          ii."productId"                 AS "productId",
          COUNT(*)                       AS "lineCount",
          COUNT(DISTINCT ii."invoiceId") AS "invoiceCount",
          SUM(ii."qty")                  AS "totalQty",
          SUM(ii."totalFils")            AS "totalSalesFils"
        FROM "InvoiceItem" ii
        INNER JOIN "Invoice" inv ON inv."id" = ii."invoiceId"
        WHERE inv."isVoid" = false
          AND inv."createdAt" >= ${from}
          AND inv."createdAt" <= ${to}
        GROUP BY ii."productId"
      ) AS agg ON agg."productId" = p."id"
      ORDER BY "lineCount" DESC, LOWER(p."name") ASC
    `);

    const items = rows.map((row) => {
      const isService = Boolean(row.isService);
      const categoryName = row.categoryNameAr?.trim() || row.categoryName || "—";
      const displayName = row.nameAr?.trim() || row.name || row.productId;
      return {
        productId: row.productId,
        sku: row.sku,
        name: displayName,
        categoryName,
        kind: isService ? ("tailoring" as const) : ("retail" as const),
        lineCount: Number(row.lineCount),
        invoiceCount: Number(row.invoiceCount),
        totalQty: Number(row.totalQty ?? 0),
        totalSalesFils: Number(row.totalSalesFils ?? 0),
      };
    });

    res.status(200).json({
      success: true,
      data: {
        from: from.toISOString(),
        to: to.toISOString(),
        items,
        productCount: items.length,
        note:
          "جميع أصناف الكتالوج: يُحسب النشاط من بنود الفواتير غير الملغاة ضمن الفترة فقط؛ الأصناف بلا مبيعات تظهر بأصفار. تفصيل = خدمة، جاهز = بيع مخزون. الترتيب: الأعلى طلباً أولاً.",
      },
    });
  }),
);

type FinancialActivityPaymentRow = Prisma.PaymentGetPayload<{
  include: { invoice: { select: { id: true; invoiceNo: true } } };
}>;

/** Pipeline stage keys → short Arabic labels (aligned with workshop UI) */
const PIPELINE_STAGE_AR: Record<string, string> = {
  CUTTING: "قص",
  SEWING: "خياطة",
  EMBROIDERY: "تطريز",
  FINISHING: "تجهيز",
};

/**
 * Cash-flow style report: payments received (income), expenses, workshop stage wages.
 * Income = sum of Payment.amountFils in range on non-void invoices (cash-basis collections).
 * Wages = completed JobOrderWorkStage rows in range (wageFils), by completedAt or production entry date.
 */
reportsRouter.get(
  "/financial-activity",
  requirePermission("reports.financial"),
  asyncHandler(async (req, res) => {
    const { from, to } = parseDateRangeOrDefault(req.query as Record<string, unknown>);
    const q = req.query as Record<string, unknown>;
    const detailedIncome =
      q.detailedIncome === "true" || q.detailedIncome === "1" || q.detailedPayments === "true";
    const detailedWages =
      q.detailedWages === "true" || q.detailedWages === "1" || q.wageDetail === "true";

    const paymentWhere: Prisma.PaymentWhereInput = {
      createdAt: { gte: from, lte: to },
      invoice: { isVoid: false },
    };

    const wageWhere: Prisma.JobOrderWorkStageWhereInput = {
      isCompleted: true,
      jobOrder: { stage: { in: [...COMPLETED_WAGE_JOB_STAGES] } },
      OR: [
        { completedAt: { gte: from, lte: to } },
        {
          AND: [
            { completedAt: null },
            { productionEntry: { date: { gte: from, lte: to } } },
          ],
        },
      ],
    };

    const expenses = await prisma.expense.findMany({
      where: { date: { gte: from, lte: to } },
      include: { category: { select: { name: true } } },
      orderBy: { date: "desc" },
    });

    let totalIncomeFils: number;
    let paymentsDetailed: FinancialActivityPaymentRow[] | null = null;

    if (detailedIncome) {
      paymentsDetailed = await prisma.payment.findMany({
        where: paymentWhere,
        include: {
          invoice: { select: { id: true, invoiceNo: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      totalIncomeFils = paymentsDetailed.reduce((s, p) => s + p.amountFils, 0);
    } else {
      const incAgg = await prisma.payment.aggregate({
        where: paymentWhere,
        _sum: { amountFils: true },
      });
      totalIncomeFils = incAgg._sum.amountFils ?? 0;
    }
    const totalExpensesFils = expenses.reduce((s, e) => s + e.amountFils, 0);

    let totalWagesFils: number;
    const wageStagesInclude = {
      jobOrder: { select: { jobNo: true, productStyle: true, updatedAt: true } },
      worker: { select: { name: true } },
      productionEntry: { select: { date: true } },
    } as const;

    let wageStagesDetailed: Awaited<
      ReturnType<
        typeof prisma.jobOrderWorkStage.findMany<{ include: typeof wageStagesInclude }>
      >
    > | null = null;

    if (detailedWages) {
      wageStagesDetailed = await prisma.jobOrderWorkStage.findMany({
        where: wageWhere,
        include: wageStagesInclude,
        orderBy: [{ completedAt: "desc" }, { id: "desc" }],
      });
      totalWagesFils = wageStagesDetailed.reduce((s, w) => s + w.wageFils, 0);
    } else {
      const wageAgg = await prisma.jobOrderWorkStage.aggregate({
        where: wageWhere,
        _sum: { wageFils: true },
      });
      totalWagesFils = wageAgg._sum.wageFils ?? 0;
    }

    const netProfitFils = totalIncomeFils - totalExpensesFils - totalWagesFils;

    type EntryRow = {
      id: string;
      type: "income" | "expense" | "wage";
      description: string;
      amountFils: number;
      date: string;
    };

    const entries: EntryRow[] = [];

    if (detailedIncome && paymentsDetailed) {
      for (const p of paymentsDetailed) {
        entries.push({
          id: `pay:${p.id}`,
          type: "income",
          description: `تحصيل فاتورة #${p.invoice.invoiceNo}${p.reference ? ` — ${p.reference}` : ""}`,
          amountFils: p.amountFils,
          date: p.createdAt.toISOString(),
        });
      }
    } else {
      entries.push({
        id: "income:total",
        type: "income",
        description: "إجمالي الدخل",
        amountFils: totalIncomeFils,
        date: to.toISOString(),
      });
    }

    for (const e of expenses) {
      const cat = e.category?.name?.trim();
      entries.push({
        id: `exp:${e.id}`,
        type: "expense",
        description: cat ? `${e.description.trim()} (${cat})` : e.description.trim(),
        amountFils: e.amountFils,
        date: e.date.toISOString(),
      });
    }

    if (detailedWages && wageStagesDetailed) {
      for (const w of wageStagesDetailed) {
        const stageLabel = PIPELINE_STAGE_AR[w.stageKey] ?? w.stageKey;
        const workerName = w.worker?.name ?? w.workerNameSnapshot ?? "—";
        const jobNo = w.jobOrder.jobNo;
        const d = w.completedAt ?? w.productionEntry?.date ?? w.jobOrder.updatedAt;

        entries.push({
          id: `wage:${w.id}`,
          type: "wage",
          description: `أجر ${stageLabel} — طلب #${jobNo} — ${workerName}`,
          amountFils: w.wageFils,
          date: d.toISOString(),
        });
      }
    } else {
      entries.push({
        id: "wage:total",
        type: "wage",
        description: "إجمالي أجور العمال",
        amountFils: totalWagesFils,
        date: to.toISOString(),
      });
    }

    entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    res.status(200).json({
      success: true,
      data: {
        from: from.toISOString(),
        to: to.toISOString(),
        summary: {
          totalIncomeFils,
          totalExpensesFils,
          totalWagesFils,
          netProfitFils,
          incomeBasis: "payments" as const,
        },
        entries,
        incomeRowsMode: detailedIncome ? ("detailed" as const) : ("aggregate" as const),
        wageRowsMode: detailedWages ? ("detailed" as const) : ("aggregate" as const),
        note: (() => {
          const base =
            "المصروفات: سطر لكل مصروف بتاريخ ضمن الفترة. صافي الربح = إجمالي الدخل − المصروفات − إجمالي الأجور.";
          const inc = detailedIncome
            ? "الدخل: سطر لكل دفعة مسجّلة في الفترة على فواتير غير ملغاة."
            : "الدخل: سطر إجمالي واحد يطابق «إجمالي الدخل» في الملخص (مجموع المدفوعات في الفترة). لتفصيل كل دفعة، فعّل «عرض تحصيلات تفصيلية».";
          const wag = detailedWages
            ? "الأجور: سطر لكل مرحلة ورشة مكتملة ضمن طلب مكتمل بالكامل (جاهز/مُسلّم) في الفترة."
            : "الأجور: سطر إجمالي واحد يطابق الملخص (من الطلبات المكتملة بالكامل فقط). لتفصيل المراحل، فعّل «عرض أجور تفصيلية».";
          return `${inc} ${wag} ${base}`;
        })(),
      },
    });
  }),
);

reportsRouter.get(
  "/summary",
  requirePermission("reports.sales", "reports.balances", "reports.financial", "reports.wages"),
  asyncHandler(async (req, res) => {
    const { from, to } = parseDateRangeOrDefault(req.query as Record<string, unknown>);

    const [salesAgg, invoicesCount, expenses, income, jobCount] = await Promise.all([
      prisma.invoice.aggregate({
        where: { isVoid: false, createdAt: { gte: from, lte: to } },
        _sum: { totalFils: true, paidFils: true },
      }),
      prisma.invoice.count({
        where: { isVoid: false, createdAt: { gte: from, lte: to } },
      }),
      prisma.expense.aggregate({
        where: { date: { gte: from, lte: to } },
        _sum: { amountFils: true },
      }),
      prisma.income.aggregate({
        where: { date: { gte: from, lte: to } },
        _sum: { amountFils: true },
      }),
      prisma.jobOrder.count({
        where: { createdAt: { gte: from, lte: to } },
      }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        from: from.toISOString(),
        to: to.toISOString(),
        invoicesCount,
        salesTotalFils: salesAgg._sum.totalFils ?? 0,
        collectedFils: salesAgg._sum.paidFils ?? 0,
        expensesTotalFils: expenses._sum.amountFils ?? 0,
        incomeTotalFils: income._sum.amountFils ?? 0,
        jobOrdersCount: jobCount,
      },
    });
  }),
);
