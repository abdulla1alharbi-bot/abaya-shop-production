import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/db.js";
import { getDefaultBranchId, getVatRatePercent } from "../../config/shop.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { requireAllPermissions, requirePermission } from "../../middleware/rbac.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../middleware/error.middleware.js";
import { prismaSkipTake, buildPaginatedMeta } from "../../utils/pagination.js";
import { parsePageLimit, queryParamString } from "../../utils/queryParams.js";
import { nextInvoiceNo, nextJobNo } from "../../utils/counters.js";
import { allocateByLineShares } from "../../utils/invoiceAllocation.js";
import { syncInvoiceJobsFinancials } from "../../utils/invoiceJobSync.js";
import {
  activateJobPipeline,
  parseWageDefaults,
} from "../job-orders/jobStageHelpers.js";
import {
  canMarkInvoiceDelivered,
  computeInvoiceFulfillment,
  invoiceReadyForDeliveryWhere,
} from "../../utils/invoiceFulfillment.js";
import { reserveFabricForMaterial, restoreAllDeductedMaterialsForJob } from "../job-orders/fabricInventoryOnCutting.js";
import {
  isWorkerRequest,
  redactByCustomerMobileForWorker,
  redactInvoiceDetailForWorker,
  redactInvoiceListPayloadForWorker,
} from "../../utils/workerFinancialRedaction.js";

/**
 * Discount policy: any discount needs a written reason; a discount above
 * `max_discount_percent` (setting, default 10%) additionally needs the
 * `invoices.discountOverride` permission. Enforced server-side on all checkouts.
 */
async function enforceDiscountPolicy(params: {
  subtotalFils: number;
  totalDiscountFils: number;
  discountReason: string | undefined;
  userPermissions: string[] | undefined;
}): Promise<void> {
  if (params.totalDiscountFils <= 0) return;
  if (!params.discountReason || params.discountReason.trim().length < 2) {
    throw new AppError(400, "سبب الخصم مطلوب عند تطبيق أي خصم", "DISCOUNT_REASON_REQUIRED");
  }
  const s = await prisma.setting.findUnique({ where: { key: "max_discount_percent" } });
  const maxPct = Number.isFinite(parseFloat(s?.value ?? "")) ? parseFloat(s!.value) : 10;
  const pct = params.subtotalFils > 0 ? (params.totalDiscountFils / params.subtotalFils) * 100 : 100;
  if (pct > maxPct && !(params.userPermissions ?? []).includes("invoices.discountOverride")) {
    throw new AppError(
      403,
      `الخصم (${pct.toFixed(1)}%) يتجاوز الحد المسموح (${maxPct}%) — يتطلب موافقة إدارية`,
      "DISCOUNT_LIMIT_EXCEEDED",
    );
  }
}

/** Branch that new invoices are stamped with: the user's home branch, else the default. */
async function branchForUser(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { branchId: true } });
  return u?.branchId ?? (await getDefaultBranchId(prisma));
}

const invoiceDetailJobOrdersInclude = {
  orderBy: { jobNo: "asc" as const },
  include: {
    customer: { select: { id: true, name: true, mobile: true } },
    product: true,
    invoiceItem: {
      select: { id: true, description: true, totalFils: true, unitFils: true, qty: true },
    },
    materials: { include: { roll: { select: { rollCode: true, name: true, color: true } } } },
    workStages: {
      orderBy: { sortOrder: "asc" as const },
      include: { worker: { select: { id: true, name: true, phone: true } } },
    },
    convertedReadyProduct: {
      select: { id: true, sku: true, name: true, nameAr: true, stockQty: true, isActive: true },
    },
  },
} as const;


async function fetchInvoiceDetailWithMeta(invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      items: { include: { product: { include: { category: true } } } },
      payments: true,
      customer: true,
      branch: true,
      salesPerson: { select: { id: true, name: true, username: true } },
      jobOrders: invoiceDetailJobOrdersInclude,
    },
  });
  if (!invoice) return null;
  const fulfillmentStatus = computeInvoiceFulfillment(invoice, invoice.jobOrders);
  const relatedInvoices = invoice.customerId
    ? await prisma.invoice.findMany({
        where: { customerId: invoice.customerId, id: { not: invoice.id } },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          invoiceNo: true,
          createdAt: true,
          totalFils: true,
          paidFils: true,
          balanceFils: true,
          isVoid: true,
          deliveredAt: true,
        },
      })
    : [];
  return { ...invoice, fulfillmentStatus, relatedInvoices };
}

export const invoicesRouter = Router();
invoicesRouter.use(authMiddleware);

invoicesRouter.get(
  "/",
  requirePermission("invoices.view", "jobProcess.view"),
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const { page, limit } = parsePageLimit(q, { defaultLimit: 50, defaultPage: 1, maxLimit: 200 });
    const searchRaw = queryParamString(q, "q")?.trim() ?? "";
    const search = searchRaw.length > 0 ? searchRaw : undefined;
    const balanceDue =
      queryParamString(q, "balanceDue") === "true" || String(q.balanceDue ?? "") === "true";
    const readyForDelivery =
      queryParamString(q, "readyForDelivery") === "true" || String(q.readyForDelivery ?? "") === "true";

    const pagination = { page, limit };
    const { skip, take } = prismaSkipTake(pagination);

    /** Partial invoice number: SQLite CAST(invoiceNo AS TEXT) LIKE '%digits%' */
    let invoiceIdsByPartialNo: string[] = [];
    if (search) {
      const digits = search.replace(/\D/g, "");
      if (digits.length > 0) {
        const like = `%${digits}%`;
        const matched = await prisma.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT id FROM "Invoice" WHERE CAST("invoiceNo" AS VARCHAR) LIKE ${like}`,
        );
        invoiceIdsByPartialNo = matched.map((r) => r.id);
      }
    }

    const searchWhere: Prisma.InvoiceWhereInput | undefined = search
      ? {
          OR: [
            { notes: { contains: search } },
            { customer: { name: { contains: search } } },
            { customer: { mobile: { contains: search } } },
            ...(invoiceIdsByPartialNo.length > 0 ? [{ id: { in: invoiceIdsByPartialNo } }] : []),
          ],
        }
      : undefined;

    const filterParts: Prisma.InvoiceWhereInput[] = [];
    const branchIdFilter = queryParamString(q, "branchId");
    if (branchIdFilter) {
      filterParts.push({ branchId: branchIdFilter });
    }
    if (balanceDue) {
      filterParts.push({ isVoid: false, balanceFils: { gt: 0 } });
    }
    if (readyForDelivery) {
      filterParts.push(invoiceReadyForDeliveryWhere());
    }
    if (searchWhere) {
      filterParts.push(searchWhere);
    }

    let where: Prisma.InvoiceWhereInput = {};
    if (filterParts.length === 1) {
      where = filterParts[0]!;
    } else if (filterParts.length > 1) {
      where = { AND: filterParts };
    }

    const [total, rows, balanceAggregate, readyAggregate] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: {
          customer: { select: { id: true, name: true, mobile: true, code: true } },
          branch: { select: { id: true, name: true } },
          jobOrders: { select: { id: true, stage: true } },
        },
      }),
      balanceDue
        ? prisma.invoice.aggregate({
            where,
            _sum: { balanceFils: true },
          })
        : Promise.resolve(null),
      readyForDelivery
        ? prisma.invoice.aggregate({
            where,
            _sum: { totalFils: true },
          })
        : Promise.resolve(null),
    ]);

    const items = rows.map((inv) => {
      const fulfillmentStatus = computeInvoiceFulfillment(
        { isVoid: inv.isVoid, deliveredAt: inv.deliveredAt },
        inv.jobOrders,
      );
      const { jobOrders: jo, ...rest } = inv;
      return {
        ...rest,
        fulfillmentStatus,
        status:
          inv.isVoid ? "VOID" : inv.deliveredAt ? "DELIVERED" : inv.balanceFils > 0 ? "OPEN" : "PAID",
        jobOrders: jo.map((j) => ({ id: j.id, stage: j.stage })),
      };
    });

    const meta = {
      ...buildPaginatedMeta(total, pagination),
      ...(balanceDue && balanceAggregate
        ? {
            totalOutstandingFils: balanceAggregate._sum.balanceFils ?? 0,
            invoiceCountWithBalance: total,
          }
        : {}),
      ...(readyForDelivery && readyAggregate
        ? {
            readyInvoiceCount: total,
            totalReadyValueFils: readyAggregate._sum.totalFils ?? 0,
          }
        : {}),
    };

    const payload = { items, meta };
    res.status(200).json({
      success: true,
      data: isWorkerRequest(req)
        ? redactInvoiceListPayloadForWorker({
            items: items as Record<string, unknown>[],
            meta: meta as Record<string, unknown>,
          })
        : payload,
    });
  }),
);

/**
 * Must stay directly under GET / so it is never shadowed by GET /:id ("lookup" is not a cuid).
 * Returns full invoice payload (same shape as GET /:id).
 */
invoicesRouter.get(
  "/lookup",
  requirePermission("invoices.view", "jobProcess.view"),
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const no = queryParamString(q, "no");
    if (!no || !/^\d+$/.test(no.trim())) {
      throw new AppError(400, "Missing or invalid invoice number. Use ?no=1001", "VALIDATION_ERROR");
    }
    const invoiceNo = parseInt(no.trim(), 10);
    if (!Number.isFinite(invoiceNo) || invoiceNo < 1) {
      throw new AppError(400, "Invalid invoice number", "VALIDATION_ERROR");
    }

    const row = await prisma.invoice.findFirst({
      where: { invoiceNo },
      select: { id: true },
    });
    if (!row) {
      throw new AppError(404, `No invoice found with number ${invoiceNo}`, "NOT_FOUND");
    }

    const data = await fetchInvoiceDetailWithMeta(row.id);
    if (!data) throw new AppError(404, "Invoice not found", "NOT_FOUND");
    res.status(200).json({
      success: true,
      data: isWorkerRequest(req) ? redactInvoiceDetailForWorker(data as unknown as Record<string, unknown>) : data,
    });
  }),
);

const INVOICE_SEARCH_LIMIT = 25;

/**
 * Compact global search (dashboard / POS). Must be registered before GET /:id.
 * Same matching rules as GET / (partial invoice no via digits, name, mobile, notes).
 */
invoicesRouter.get(
  "/search",
  requirePermission("invoices.view", "jobProcess.view"),
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const searchRaw = queryParamString(q, "q")?.trim() ?? "";
    if (!searchRaw) {
      res.status(200).json({ success: true, data: { items: [], meta: {} } });
      return;
    }
    const search = searchRaw;

    let invoiceIdsByPartialNo: string[] = [];
    const digits = search.replace(/\D/g, "");
    if (digits.length > 0) {
      const like = `%${digits}%`;
      const matched = await prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM "Invoice" WHERE CAST("invoiceNo" AS VARCHAR) LIKE ${like}`,
      );
      invoiceIdsByPartialNo = matched.map((r) => r.id);
    }

    const searchWhere: Prisma.InvoiceWhereInput = {
      OR: [
        { notes: { contains: search } },
        { customer: { name: { contains: search } } },
        { customer: { mobile: { contains: search } } },
        ...(invoiceIdsByPartialNo.length > 0 ? [{ id: { in: invoiceIdsByPartialNo } }] : []),
      ],
    };

    const rows = await prisma.invoice.findMany({
      where: searchWhere,
      orderBy: { createdAt: "desc" },
      take: INVOICE_SEARCH_LIMIT,
      include: {
        customer: { select: { id: true, name: true, mobile: true, code: true } },
        branch: { select: { id: true, name: true } },
        jobOrders: { select: { id: true, stage: true } },
      },
    });

    const items = rows.map((inv) => {
      const fulfillmentStatus = computeInvoiceFulfillment(
        { isVoid: inv.isVoid, deliveredAt: inv.deliveredAt },
        inv.jobOrders,
      );
      const { jobOrders: jo, ...rest } = inv;
      return {
        ...rest,
        fulfillmentStatus,
        status:
          inv.isVoid ? "VOID" : inv.deliveredAt ? "DELIVERED" : inv.balanceFils > 0 ? "OPEN" : "PAID",
        jobOrders: jo.map((j) => ({ id: j.id, stage: j.stage })),
      };
    });

    const meta: Record<string, unknown> = {};
    const payload = { items, meta };
    res.status(200).json({
      success: true,
      data: isWorkerRequest(req)
        ? redactInvoiceListPayloadForWorker({
            items: items as Record<string, unknown>[],
            meta,
          })
        : payload,
    });
  }),
);

/** Workshop hub: all invoices for a customer found by mobile (no need to open each invoice). */
invoicesRouter.get(
  "/by-customer-mobile",
  requirePermission("invoices.view", "jobProcess.view"),
  asyncHandler(async (req, res) => {
    const raw = queryParamString(req.query as Record<string, unknown>, "mobile")?.trim() ?? "";
    if (!raw) {
      throw new AppError(400, "Missing mobile. Use ?mobile=0501234567", "VALIDATION_ERROR");
    }

    const digits = raw.replace(/\D/g, "");
    let customer =
      (await prisma.customer.findUnique({ where: { mobile: raw } })) ??
      (digits.length >= 7
        ? await prisma.customer.findFirst({
            where: { mobile: { contains: digits } },
          })
        : null);

    if (!customer) {
      res.status(200).json({
        success: true,
        data: { customer: null, invoices: [] as unknown[] },
      });
      return;
    }

    const invoices = await prisma.invoice.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        jobOrders: {
          select: {
            id: true,
            stage: true,
            workStages: { select: { status: true } },
          },
        },
      },
    });

    const WORKSHOP_DONE = new Set(["READY", "DELIVERED", "CONVERTED_TO_READY"]);
    const rows = invoices.map((inv) => {
      const fulfillmentStatus = computeInvoiceFulfillment(inv, inv.jobOrders);
      const tailoringCount = inv.jobOrders.length;
      const piecesReadyCount = inv.jobOrders.filter((j) => {
        if (WORKSHOP_DONE.has(j.stage)) return true;
        if (j.workStages.length === 0) return false;
        return j.workStages.every((w) => w.status === "DONE");
      }).length;

      return {
        id: inv.id,
        invoiceNo: inv.invoiceNo,
        createdAt: inv.createdAt,
        totalFils: inv.totalFils,
        paidFils: inv.paidFils,
        balanceFils: inv.balanceFils,
        deliveredAt: inv.deliveredAt,
        isVoid: inv.isVoid,
        fulfillmentStatus,
        deliveryStatus: inv.deliveredAt ? "DELIVERED" : "NOT_DELIVERED",
        processStatus: fulfillmentStatus,
        tailoringCount,
        piecesReadyCount,
        processSummary:
          tailoringCount === 0
            ? "NO_TAILORING"
            : `${piecesReadyCount}/${tailoringCount} قطعة جاهزة`,
      };
    });

    const byCustomerPayload = {
      customer: {
        id: customer.id,
        name: customer.name,
        mobile: customer.mobile,
        code: customer.code,
      },
      invoices: rows,
    };
    res.status(200).json({
      success: true,
      data: isWorkerRequest(req)
        ? redactByCustomerMobileForWorker(byCustomerPayload as unknown as Record<string, unknown>)
        : byCustomerPayload,
    });
  }),
);

const itemSchema = z.object({
  productId: z.string(),
  qty: z.number().positive(),
  unitFils: z.number().int().min(0),
  discountFils: z.number().int().min(0).optional().default(0),
});

const createBody = z.object({
  customerId: z.string().optional().nullable(),
  branchId: z.string().optional(),
  items: z.array(itemSchema).min(1),
  payments: z
    .array(
      z.object({
        method: z.string().min(1),
        amountFils: z.number().int().min(0),
        reference: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
  invoiceDiscountFils: z.number().int().min(0).optional().default(0),
  discountReason: z.string().optional(),
  notes: z.string().optional(),
});

invoicesRouter.post(
  "/",
  requirePermission("invoices.create"),
  validateBody(createBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createBody>;
    const salesPersonId = req.user?.id;
    if (!salesPersonId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

    const branchId = body.branchId ?? (await branchForUser(salesPersonId));
    const vatPercent = await getVatRatePercent(prisma);

    const totalLineDiscounts = body.items.reduce((a, i) => a + (i.discountFils ?? 0), 0);
    await enforceDiscountPolicy({
      subtotalFils: body.items.reduce((a, i) => a + Math.round(i.qty * i.unitFils), 0),
      totalDiscountFils: totalLineDiscounts + (body.invoiceDiscountFils ?? 0),
      discountReason: body.discountReason,
      userPermissions: req.user?.permissions,
    });

    const invoice = await prisma.$transaction(async (tx) => {
      const productIds = [...new Set(body.items.map((i) => i.productId))];
      const products = await tx.product.findMany({ where: { id: { in: productIds } } });
      if (products.length !== productIds.length) {
        throw new AppError(400, "One or more products not found", "NOT_FOUND");
      }

      let subtotalFils = 0;
      const lineData: Array<{
        productId: string;
        qty: number;
        unitFils: number;
        discountFils: number;
        totalFils: number;
      }> = [];

      for (const line of body.items) {
        const p = products.find((x) => x.id === line.productId)!;
        const lineTotal = Math.round(line.qty * line.unitFils) - line.discountFils;
        if (lineTotal < 0) throw new AppError(400, "Invalid line total", "VALIDATION_ERROR");
        subtotalFils += lineTotal;
        lineData.push({
          productId: p.id,
          qty: line.qty,
          unitFils: line.unitFils,
          discountFils: line.discountFils,
          totalFils: lineTotal,
        });
      }

      const discountFils = body.invoiceDiscountFils ?? 0;
      const taxable = Math.max(0, subtotalFils - discountFils);
      const vatFils = Math.round((taxable * vatPercent) / 100);
      const totalFils = taxable + vatFils;

      const payments = body.payments ?? [];
      const paidFils = payments.reduce((a, p) => a + p.amountFils, 0);
      if (paidFils > totalFils) {
        throw new AppError(400, "Payments exceed invoice total", "VALIDATION_ERROR");
      }
      const balanceFils = totalFils - paidFils;

      const invoiceNo = await nextInvoiceNo(tx);

      const inv = await tx.invoice.create({
        data: {
          invoiceNo,
          customerId: body.customerId ?? undefined,
          branchId,
          salesPersonId,
          subtotalFils,
          discountFils,
          vatFils,
          totalFils,
          paidFils,
          balanceFils,
          discountReason: body.discountReason?.trim(),
          notes: body.notes?.trim(),
          items: {
            create: lineData.map((l) => ({
              productId: l.productId,
              qty: l.qty,
              unitFils: l.unitFils,
              discountFils: l.discountFils,
              totalFils: l.totalFils,
            })),
          },
          payments:
            payments.length > 0
              ? {
                  create: payments.map((p) => ({
                    method: p.method,
                    amountFils: p.amountFils,
                    reference: p.reference,
                  })),
                }
              : undefined,
        },
        include: {
          items: { include: { product: true } },
          payments: true,
          customer: true,
          branch: true,
        },
      });

      const qtyByProduct = new Map<string, number>();
      for (const line of body.items) {
        const q = Math.max(1, Math.round(line.qty));
        qtyByProduct.set(line.productId, (qtyByProduct.get(line.productId) ?? 0) + q);
      }
      for (const [productId, qtyInt] of qtyByProduct) {
        const p = products.find((x) => x.id === productId)!;
        if (p.isService) continue;
        if (p.stockQty < qtyInt) {
          throw new AppError(400, `Insufficient stock for ${p.name}`, "INSUFFICIENT_STOCK");
        }
        await tx.product.update({
          where: { id: productId },
          data: { stockQty: { decrement: qtyInt } },
        });
      }

      if (body.customerId && balanceFils > 0) {
        await tx.customer.update({
          where: { id: body.customerId },
          data: { balanceFils: { increment: balanceFils } },
        });
      }

      return inv;
    });

    res.status(201).json({ success: true, data: invoice });
  }),
);

const materialSchema = z.object({
  rollId: z.string(),
  meters: z.number().positive(),
});

const assignmentSchema = z.object({
  workerId: z.string(),
  workType: z.string().min(1),
});

const tailoringItemSchema = z.object({
  productStyle: z.string().min(1),
  /** Catalog abaya model — used for default stage wages and workshop pipeline */
  productId: z.string().optional(),
  lineLabel: z.string().optional(),
  dueDate: z.string().datetime(),
  measurements: z.string().optional(),
  notes: z.string().optional(),
  costFils: z.number().int().min(0),
  totalFils: z.number().int().min(0),
  measurementId: z.string().optional(),
  materials: z.array(materialSchema).default([]),
  assignments: z.array(assignmentSchema).default([]),
  abayaTypeId: z.string().optional(),
  abayaModelId: z.string().optional(),
  sourceDisplaySampleJobId: z.string().optional(),
  sourceDisplayModelId: z.string().optional(),
  customStyleText: z.string().optional().nullable(),
});

const tailoringCheckoutBody = z.object({
  customerId: z.string().min(1),
  items: z.array(tailoringItemSchema).min(1),
  payments: z
    .array(
      z.object({
        method: z.string().min(1),
        amountFils: z.number().int().min(0),
        reference: z.string().optional(),
      }),
    )
    .default([]),
  invoiceDiscountFils: z.number().int().min(0).optional().default(0),
  discountReason: z.string().optional(),
  notes: z.string().optional(),
  creditOverride: z.boolean().optional().default(false),
});

const posCheckoutBody = z
  .object({
    customerId: z.string().optional().nullable(),
    retailItems: z.array(itemSchema).default([]),
    tailoringItems: z.array(tailoringItemSchema).default([]),
    payments: z
      .array(
        z.object({
          method: z.string().min(1),
          amountFils: z.number().int().min(0),
          reference: z.string().optional(),
        }),
      )
      .default([]),
    invoiceDiscountFils: z.number().int().min(0).optional().default(0),
    discountReason: z.string().optional(),
    notes: z.string().optional(),
    creditOverride: z.boolean().optional().default(false),
  })
  .superRefine((data, ctx) => {
    const r = data.retailItems.length;
    const t = data.tailoringItems.length;
    if (r === 0 && t === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Cart is empty",
        path: ["retailItems"],
      });
    }
    if (t > 0 && !data.customerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Customer is required when the order includes tailoring",
        path: ["customerId"],
      });
    }
  });

invoicesRouter.post(
  "/tailoring-checkout",
  requireAllPermissions("invoices.create", "pos.tailoring"),
  validateBody(tailoringCheckoutBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof tailoringCheckoutBody>;
    const salesPersonId = req.user?.id;
    if (!salesPersonId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

    const branchId = await branchForUser(salesPersonId);
    const vatPercent = await getVatRatePercent(prisma);

    await enforceDiscountPolicy({
      subtotalFils: body.items.reduce((a, it) => a + it.totalFils, 0),
      totalDiscountFils: body.invoiceDiscountFils ?? 0,
      discountReason: body.discountReason,
      userPermissions: req.user?.permissions,
    });

    const data = await prisma.$transaction(async (tx) => {
      const serviceProduct = await tx.product.findUnique({ where: { sku: "SYS-TAILORING-LINE" } });
      if (!serviceProduct?.isService) {
        throw new AppError(
          500,
          "Tailoring service product missing. Run: pnpm --filter api exec prisma db seed",
          "CONFIG",
        );
      }

      let subtotalFils = 0;
      for (const it of body.items) {
        subtotalFils += it.totalFils;
      }

      const discountFils = body.invoiceDiscountFils ?? 0;
      const taxable = Math.max(0, subtotalFils - discountFils);
      const vatFils = Math.round((taxable * vatPercent) / 100);
      const totalFils = taxable + vatFils;

      const payments = body.payments ?? [];
      const paidFils = payments.reduce((a, p) => a + p.amountFils, 0);
      if (paidFils > totalFils) {
        throw new AppError(400, "Payments exceed invoice total", "VALIDATION_ERROR");
      }
      const balanceFils = totalFils - paidFils;

      // Credit limit check
      if (balanceFils > 0 && body.customerId) {
        const cust = await tx.customer.findUnique({
          where: { id: body.customerId },
          select: { id: true, balanceFils: true, creditLimitFils: true },
        });
        if (cust && cust.creditLimitFils > 0 && cust.balanceFils + balanceFils > cust.creditLimitFils) {
          if (!body.creditOverride) {
            throw new AppError(409, "Credit limit exceeded", "CREDIT_LIMIT_EXCEEDED", {
              currentBalance: cust.balanceFils,
              creditLimit: cust.creditLimitFils,
              requested: balanceFils,
            });
          }
          const userPerms = (req.user?.permissions as string[] | undefined) ?? [];
          if (!userPerms.includes("invoices.creditOverride")) {
            throw new AppError(403, "Permission denied: invoices.creditOverride required", "FORBIDDEN");
          }
          await tx.auditLog.create({
            data: {
              userId: salesPersonId,
              action: "CREDIT_OVERRIDE",
              entity: "Customer",
              entityId: cust.id,
              newValue: JSON.stringify({ currentBalance: cust.balanceFils, creditLimit: cust.creditLimitFils, requested: balanceFils }),
            },
          });
        }
      }

      const invoiceNo = await nextInvoiceNo(tx);

      const inv = await tx.invoice.create({
        data: {
          invoiceNo,
          customerId: body.customerId,
          branchId,
          salesPersonId,
          orderType: "TAILORING",
          subtotalFils,
          discountFils,
          vatFils,
          totalFils,
          paidFils,
          balanceFils,
          discountReason: body.discountReason?.trim(),
          notes: body.notes?.trim(),
          items: {
            create: body.items.map((it) => {
              const label = (it.lineLabel?.trim() || it.productStyle.trim()).slice(0, 500);
              return {
                productId: serviceProduct.id,
                description: label,
                qty: 1,
                unitFils: it.totalFils,
                discountFils: 0,
                totalFils: it.totalFils,
              };
            }),
          },
          payments:
            payments.length > 0
              ? {
                  create: payments.map((p) => ({
                    method: p.method,
                    amountFils: p.amountFils,
                    reference: p.reference,
                  })),
                }
              : undefined,
        },
        include: { items: true },
      });

      const tailoringAmounts = body.items.map((it) => it.totalFils);
      const { shareTotal, sharePaid } = allocateByLineShares(
        tailoringAmounts,
        subtotalFils,
        totalFils,
        paidFils,
      );

      const jobRows: Awaited<ReturnType<typeof tx.jobOrder.findUnique>>[] = [];

      if (inv.items.length !== body.items.length) {
        throw new AppError(500, "Invoice items out of sync", "CONFIG");
      }

      const settingsRows = await tx.setting.findMany();
      const wageDefaults = parseWageDefaults(
        Object.fromEntries(settingsRows.map((s) => [s.key, s.value])),
      );

      for (let k = 0; k < body.items.length; k++) {
        const it = body.items[k]!;
        const invoiceItem = inv.items[k]!;
        if (it.measurementId) {
          const m = await tx.measurement.findFirst({
            where: { id: it.measurementId, customerId: body.customerId },
          });
          if (!m) throw new AppError(400, "Measurement does not belong to this customer", "VALIDATION_ERROR");
        }
        const jobNo = await nextJobNo(tx);
        const bal = (shareTotal[k] ?? 0) - (sharePaid[k] ?? 0);
        const j = await tx.jobOrder.create({
          data: {
            jobNo,
            invoiceId: inv.id,
            invoiceItemId: invoiceItem.id,
            customerId: body.customerId,
            measurementId: it.measurementId,
            productStyle: it.productStyle.trim(),
            stage: "NEW",
            priority: "NORMAL",
            dueDate: new Date(it.dueDate),
            fabricSource: "STOCK",
            measurements: it.measurements,
            notes: it.notes?.trim(),
            costFils: it.costFils,
            totalFils: shareTotal[k] ?? 0,
            paidFils: sharePaid[k] ?? 0,
            balanceFils: Math.max(0, bal),
            isPaid: bal <= 0,
            ...(it.productId ? { productId: it.productId } : {}),
            ...(it.abayaTypeId ? { abayaTypeId: it.abayaTypeId } : {}),
            ...(it.abayaModelId ? { abayaModelId: it.abayaModelId } : {}),
            ...(it.sourceDisplaySampleJobId ? { sourceDisplaySampleJobId: it.sourceDisplaySampleJobId } : {}),
            ...(it.sourceDisplayModelId ? { sourceDisplayModelId: it.sourceDisplayModelId } : {}),
            ...(it.customStyleText?.trim() ? { customStyleText: it.customStyleText.trim() } : {}),
          },
        });

        // Always activate the workshop pipeline (cutting/sewing/…) so every
        // tailoring piece is ready to work — using the linked catalog model's
        // wages when present, or default wages for exempt types / no model.
        const stage0 = await activateJobPipeline(tx, {
          jobId: j.id,
          productId: it.productId ?? null,
          abayaModelId: it.abayaModelId ?? null,
          wageDefaults,
        });

        await tx.jobStageLog.create({
          data: {
            jobOrderId: j.id,
            stage: stage0,
            changedById: salesPersonId,
            notes: `Invoice #${invoiceNo}`,
          },
        });

        for (const m of it.materials) {
          const materialCostFils = await reserveFabricForMaterial(tx, m.rollId, m.meters);
          await tx.jobOrderMaterial.create({
            data: {
              jobOrderId: j.id,
              rollId: m.rollId,
              meters: m.meters,
              materialCostFils,
              fabricDeducted: false,
            },
          });
        }

        for (const a of it.assignments) {
          await tx.jobAssignment.create({
            data: {
              jobOrderId: j.id,
              workerId: a.workerId,
              workType: a.workType,
            },
          });
        }

        const full = await tx.jobOrder.findUnique({
          where: { id: j.id },
          include: {
            materials: { include: { roll: true } },
            assignments: { include: { worker: true } },
          },
        });
        jobRows.push(full);
      }

      if (balanceFils > 0) {
        await tx.customer.update({
          where: { id: body.customerId },
          data: { balanceFils: { increment: balanceFils } },
        });
      }

      const invoiceFull = await tx.invoice.findUnique({
        where: { id: inv.id },
        include: {
          items: { include: { product: true } },
          payments: true,
          customer: true,
          branch: true,
        },
      });

      return { invoice: invoiceFull, jobOrders: jobRows };
    });

    res.status(201).json({ success: true, data });
  }),
);

/** Expected next invoice number (draft preview for POS). Not reserved — the
 * real number is assigned at checkout, so concurrent sales may shift it. */
invoicesRouter.get(
  "/next-invoice-no",
  requirePermission("pos.use", "invoices.create"),
  asyncHandler(async (_req, res) => {
    const invoiceNo = await nextInvoiceNo(prisma);
    res.json({ success: true, data: { invoiceNo } });
  }),
);

invoicesRouter.post(
  "/pos-checkout",
  requireAllPermissions("invoices.create", "pos.use", "pos.checkout"),
  validateBody(posCheckoutBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof posCheckoutBody>;
    const salesPersonId = req.user?.id;
    if (!salesPersonId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

    const branchId = await branchForUser(salesPersonId);
    const vatPercent = await getVatRatePercent(prisma);
    const retail = body.retailItems;
    const tailoring = body.tailoringItems;

    const retailSubtotal = retail.reduce((a, i) => a + Math.round(i.qty * i.unitFils), 0);
    const tailoringSubtotal = tailoring.reduce((a, i) => a + i.totalFils, 0);
    const retailLineDiscounts = retail.reduce((a, i) => a + (i.discountFils ?? 0), 0);
    await enforceDiscountPolicy({
      subtotalFils: retailSubtotal + tailoringSubtotal,
      totalDiscountFils: retailLineDiscounts + (body.invoiceDiscountFils ?? 0),
      discountReason: body.discountReason,
      userPermissions: req.user?.permissions,
    });

    const data = await prisma.$transaction(async (tx) => {
      let subtotalFils = 0;
      const lineKinds: Array<"retail" | "tailoring"> = [];
      const lineCreates: Array<{
        productId: string;
        description?: string;
        qty: number;
        unitFils: number;
        discountFils: number;
        totalFils: number;
      }> = [];

      const productsById = new Map<
        string,
        { id: string; name: string; stockQty: number; isService: boolean; costFils: number }
      >();

      // Ready-made lines sold below their cost floor — the seller may edit the
      // POS price freely, but selling under cost alerts the owner/manager.
      const belowFloor: Array<{ name: string; unitFils: number; floorFils: number }> = [];

      if (retail.length > 0) {
        const productIds = [...new Set(retail.map((i) => i.productId))];
        const products = await tx.product.findMany({ where: { id: { in: productIds } } });
        if (products.length !== productIds.length) {
          throw new AppError(400, "One or more products not found", "NOT_FOUND");
        }
        for (const p of products) {
          productsById.set(p.id, p);
        }

        for (const line of retail) {
          const p = productsById.get(line.productId)!;
          const lineTotal = Math.round(line.qty * line.unitFils) - line.discountFils;
          if (lineTotal < 0) throw new AppError(400, "Invalid line total", "VALIDATION_ERROR");
          subtotalFils += lineTotal;
          lineKinds.push("retail");
          lineCreates.push({
            productId: p.id,
            qty: line.qty,
            unitFils: line.unitFils,
            discountFils: line.discountFils,
            totalFils: lineTotal,
          });
          if (!p.isService && p.costFils > 0 && line.unitFils < p.costFils) {
            belowFloor.push({ name: p.name, unitFils: line.unitFils, floorFils: p.costFils });
          }
        }
      }

      let serviceProduct: { id: string; sku: string } | null = null;
      if (tailoring.length > 0) {
        const sp = await tx.product.findUnique({ where: { sku: "SYS-TAILORING-LINE" } });
        if (!sp?.isService) {
          throw new AppError(
            500,
            "Tailoring service product missing. Run: pnpm --filter api exec prisma db seed",
            "CONFIG",
          );
        }
        serviceProduct = sp;
        for (const it of tailoring) {
          subtotalFils += it.totalFils;
          const label = (it.lineLabel?.trim() || it.productStyle.trim()).slice(0, 500);
          lineKinds.push("tailoring");
          lineCreates.push({
            productId: sp.id,
            description: label,
            qty: 1,
            unitFils: it.totalFils,
            discountFils: 0,
            totalFils: it.totalFils,
          });
        }
      }

      const discountFils = body.invoiceDiscountFils ?? 0;
      const taxable = Math.max(0, subtotalFils - discountFils);
      const vatFils = Math.round((taxable * vatPercent) / 100);
      const totalFils = taxable + vatFils;

      const payments = body.payments ?? [];
      const paidFils = payments.reduce((a, p) => a + p.amountFils, 0);
      if (paidFils > totalFils) {
        throw new AppError(400, "Payments exceed invoice total", "VALIDATION_ERROR");
      }
      const balanceFils = totalFils - paidFils;

      // Credit limit check
      if (balanceFils > 0 && body.customerId) {
        const cust = await tx.customer.findUnique({
          where: { id: body.customerId },
          select: { id: true, balanceFils: true, creditLimitFils: true },
        });
        if (cust && cust.creditLimitFils > 0 && cust.balanceFils + balanceFils > cust.creditLimitFils) {
          if (!body.creditOverride) {
            throw new AppError(409, "Credit limit exceeded", "CREDIT_LIMIT_EXCEEDED", {
              currentBalance: cust.balanceFils,
              creditLimit: cust.creditLimitFils,
              requested: balanceFils,
            });
          }
          const userPerms = (req.user?.permissions as string[] | undefined) ?? [];
          if (!userPerms.includes("invoices.creditOverride")) {
            throw new AppError(403, "Permission denied: invoices.creditOverride required", "FORBIDDEN");
          }
          await tx.auditLog.create({
            data: {
              userId: salesPersonId,
              action: "CREDIT_OVERRIDE",
              entity: "Customer",
              entityId: cust.id,
              newValue: JSON.stringify({ currentBalance: cust.balanceFils, creditLimit: cust.creditLimitFils, requested: balanceFils }),
            },
          });
        }
      }

      const invoiceNo = await nextInvoiceNo(tx);

      const orderType =
        retail.length > 0 && tailoring.length > 0
          ? "MIXED"
          : tailoring.length > 0
            ? "TAILORING"
            : "NORMAL";

      const inv = await tx.invoice.create({
        data: {
          invoiceNo,
          customerId: body.customerId ?? undefined,
          branchId,
          salesPersonId,
          orderType,
          subtotalFils,
          discountFils,
          vatFils,
          totalFils,
          paidFils,
          balanceFils,
          discountReason: body.discountReason?.trim(),
          notes: body.notes?.trim(),
          items: {
            create: lineCreates.map((l) => ({
              productId: l.productId,
              description: l.description,
              qty: l.qty,
              unitFils: l.unitFils,
              discountFils: l.discountFils,
              totalFils: l.totalFils,
            })),
          },
          payments:
            payments.length > 0
              ? {
                  create: payments.map((p) => ({
                    method: p.method,
                    amountFils: p.amountFils,
                    reference: p.reference,
                  })),
                }
              : undefined,
        },
        include: { items: true },
      });

      if (retail.length > 0) {
        const qtyByProduct = new Map<string, number>();
        for (const line of retail) {
          const q = Math.max(1, Math.round(line.qty));
          qtyByProduct.set(line.productId, (qtyByProduct.get(line.productId) ?? 0) + q);
        }
        for (const [productId, qtyInt] of qtyByProduct) {
          const p = productsById.get(productId)!;
          if (p.isService) continue;
          if (p.stockQty < qtyInt) {
            throw new AppError(400, `Insufficient stock for ${p.name}`, "INSUFFICIENT_STOCK");
          }
          await tx.product.update({
            where: { id: productId },
            data: { stockQty: { decrement: qtyInt } },
          });
        }
      }

      // Alert owner/manager when any ready-made item was sold below its cost floor.
      if (belowFloor.length > 0) {
        const sellerName = req.user?.name ?? "بائع";
        const details = belowFloor
          .map((b) => `${b.name} (${(b.unitFils / 100).toFixed(2)} < ${(b.floorFils / 100).toFixed(2)})`)
          .join("، ");
        const message = `فاتورة #${inv.invoiceNo} — باع ${sellerName} بسعر أقل من الحد: ${details}`;
        for (const role of ["OWNER", "MANAGER"]) {
          await tx.notification.create({
            data: {
              targetRole: role,
              type: "PRICE_BELOW_FLOOR",
              title: "بيع تحت حد التكلفة",
              message,
              link: `/invoices/${inv.id}`,
            },
          });
        }
      }

      const jobRows: Awaited<ReturnType<typeof tx.jobOrder.findUnique>>[] = [];

      if (tailoring.length > 0 && serviceProduct) {
        const tailoringItemRows = inv.items.filter((_, idx) => lineKinds[idx] === "tailoring");
        if (tailoringItemRows.length !== tailoring.length) {
          throw new AppError(500, "Invoice tailoring lines out of sync", "CONFIG");
        }
        const tailoringAmounts = tailoring.map((it) => it.totalFils);
        const { shareTotal, sharePaid } = allocateByLineShares(
          tailoringAmounts,
          subtotalFils,
          totalFils,
          paidFils,
        );
        const settingsRows = await tx.setting.findMany();
        const wageDefaults = parseWageDefaults(
          Object.fromEntries(settingsRows.map((s) => [s.key, s.value])),
        );
        for (let k = 0; k < tailoring.length; k++) {
          const it = tailoring[k]!;
          const invItem = tailoringItemRows[k]!;
          if (it.measurementId) {
            const m = await tx.measurement.findFirst({
              where: { id: it.measurementId, customerId: body.customerId! },
            });
            if (!m) throw new AppError(400, "Measurement does not belong to this customer", "VALIDATION_ERROR");
          }
          const jobNo = await nextJobNo(tx);
          const bal = (shareTotal[k] ?? 0) - (sharePaid[k] ?? 0);
          const j = await tx.jobOrder.create({
            data: {
              jobNo,
              invoiceId: inv.id,
              invoiceItemId: invItem.id,
              customerId: body.customerId!,
              measurementId: it.measurementId,
              productStyle: it.productStyle.trim(),
              stage: "NEW",
              priority: "NORMAL",
              dueDate: new Date(it.dueDate),
              fabricSource: "STOCK",
              measurements: it.measurements,
              notes: it.notes?.trim(),
              costFils: it.costFils,
              totalFils: shareTotal[k] ?? 0,
              paidFils: sharePaid[k] ?? 0,
              balanceFils: Math.max(0, bal),
              isPaid: bal <= 0,
              ...(it.productId ? { productId: it.productId } : {}),
              ...(it.abayaTypeId ? { abayaTypeId: it.abayaTypeId } : {}),
              ...(it.abayaModelId ? { abayaModelId: it.abayaModelId } : {}),
              ...(it.sourceDisplaySampleJobId ? { sourceDisplaySampleJobId: it.sourceDisplaySampleJobId } : {}),
              ...(it.sourceDisplayModelId ? { sourceDisplayModelId: it.sourceDisplayModelId } : {}),
              ...(it.customStyleText?.trim() ? { customStyleText: it.customStyleText.trim() } : {}),
            },
          });

          // Always activate the workshop pipeline so every tailoring piece is
          // ready to work — model wages when linked, default wages otherwise.
          const stage0 = await activateJobPipeline(tx, {
            jobId: j.id,
            productId: it.productId ?? null,
            abayaModelId: it.abayaModelId ?? null,
            wageDefaults,
          });

          await tx.jobStageLog.create({
            data: {
              jobOrderId: j.id,
              stage: stage0,
              changedById: salesPersonId,
              notes: `Invoice #${invoiceNo}`,
            },
          });

          for (const m of it.materials) {
            const materialCostFils = await reserveFabricForMaterial(tx, m.rollId, m.meters);
            await tx.jobOrderMaterial.create({
              data: {
                jobOrderId: j.id,
                rollId: m.rollId,
                meters: m.meters,
                materialCostFils,
                fabricDeducted: false,
              },
            });
          }

          for (const a of it.assignments) {
            await tx.jobAssignment.create({
              data: {
                jobOrderId: j.id,
                workerId: a.workerId,
                workType: a.workType,
              },
            });
          }

          const full = await tx.jobOrder.findUnique({
            where: { id: j.id },
            include: {
              materials: { include: { roll: true } },
              assignments: { include: { worker: true } },
            },
          });
          jobRows.push(full);
        }
      }

      if (body.customerId && balanceFils > 0) {
        await tx.customer.update({
          where: { id: body.customerId },
          data: { balanceFils: { increment: balanceFils } },
        });
      }

      const invoiceFull = await tx.invoice.findUnique({
        where: { id: inv.id },
        include: {
          items: { include: { product: true } },
          payments: true,
          customer: true,
          branch: true,
        },
      });

      return { invoice: invoiceFull, jobOrders: jobRows };
    });

    res.status(201).json({ success: true, data });
  }),
);

const addPaymentsBody = z.object({
  payments: z
    .array(
      z.object({
        method: z.string().min(1),
        amountFils: z.number().int().min(1),
        reference: z.string().optional(),
      }),
    )
    .min(1),
});

invoicesRouter.post(
  "/:id/payments",
  requirePermission("invoices.payment"),
  validateBody(addPaymentsBody),
  asyncHandler(async (req, res) => {
    const invoiceId = req.params.id;
    if (!invoiceId) throw new AppError(400, "Missing invoice id", "VALIDATION_ERROR");
    const body = req.body as z.infer<typeof addPaymentsBody>;
    const userId = req.user?.id ?? "system";

    await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
      if (!inv || inv.isVoid) throw new AppError(404, "Invoice not found", "NOT_FOUND");

      const add = body.payments.reduce((a, p) => a + p.amountFils, 0);
      const newPaid = inv.paidFils + add;
      if (newPaid > inv.totalFils) {
        throw new AppError(400, "Payments exceed invoice remaining balance", "VALIDATION_ERROR");
      }
      const newBalance = inv.totalFils - newPaid;

      await tx.payment.createMany({
        data: body.payments.map((p) => ({
          invoiceId,
          method: p.method,
          amountFils: p.amountFils,
          reference: p.reference,
        })),
      });

      await tx.invoice.update({
        where: { id: invoiceId },
        data: { paidFils: newPaid, balanceFils: newBalance },
      });

      if (inv.customerId && add > 0) {
        await tx.customer.update({
          where: { id: inv.customerId },
          data: { balanceFils: { decrement: add } },
        });
      }

      await syncInvoiceJobsFinancials(tx, invoiceId);

      await tx.auditLog.create({
        data: {
          userId,
          action: "PAYMENT_ADDED",
          entity: "Invoice",
          entityId: invoiceId,
          oldValue: JSON.stringify({ paidFils: inv.paidFils, balanceFils: inv.balanceFils }),
          newValue: JSON.stringify({ paidFils: newPaid, balanceFils: newBalance, amountAdded: add }),
        },
      });
    });

    const data = await fetchInvoiceDetailWithMeta(invoiceId);
    if (!data) throw new AppError(404, "Invoice not found", "NOT_FOUND");
    res.status(200).json({ success: true, data });
  }),
);

const patchInvoiceBody = z.object({
  deliveryDate: z.string().datetime().optional().nullable(),
});

invoicesRouter.patch(
  "/:id",
  requirePermission("invoices.edit"),
  validateBody(patchInvoiceBody),
  asyncHandler(async (req, res) => {
    const invoiceId = req.params.id;
    if (!invoiceId) throw new AppError(400, "Missing invoice id", "VALIDATION_ERROR");
    const body = req.body as z.infer<typeof patchInvoiceBody>;

    const existing = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!existing) throw new AppError(404, "Invoice not found", "NOT_FOUND");
    if (existing.isVoid) throw new AppError(400, "Cannot modify a voided invoice", "INVOICE_VOID");

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        deliveryDate:
          body.deliveryDate === undefined
            ? undefined
            : body.deliveryDate === null
              ? null
              : new Date(body.deliveryDate),
      },
    });

    const data = await fetchInvoiceDetailWithMeta(invoiceId);
    if (!data) throw new AppError(404, "Invoice not found", "NOT_FOUND");
    res.status(200).json({ success: true, data });
  }),
);

const VOID_CATEGORY_VALUES = ["DEFECT", "WRONG_SIZE", "CUSTOMER_CHANGED_MIND", "DATA_ENTRY_ERROR", "OTHER"] as const;

const voidInvoiceBody = z.object({
  voidReason: z.string().min(1, "Void reason is required"),
  voidCategory: z.enum(VOID_CATEGORY_VALUES),
});

invoicesRouter.post(
  "/:id/void",
  requirePermission("invoices.edit"),
  validateBody(voidInvoiceBody),
  asyncHandler(async (req, res) => {
    const invoiceId = req.params.id;
    if (!invoiceId) throw new AppError(400, "Missing invoice id", "VALIDATION_ERROR");
    const body = req.body as z.infer<typeof voidInvoiceBody>;
    const userId = req.user?.id ?? "system";
    const userName = req.user?.name ?? "مستخدم";

    await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findUnique({
        where: { id: invoiceId },
        include: { jobOrders: true, customer: { select: { id: true, name: true, balanceFils: true } } },
      });
      if (!inv) throw new AppError(404, "Invoice not found", "NOT_FOUND");
      if (inv.isVoid) throw new AppError(400, "Invoice already void", "ALREADY_VOID");

      for (const j of inv.jobOrders) {
        await restoreAllDeductedMaterialsForJob(tx, {
          jobOrderId: j.id,
          jobNo: j.jobNo,
          reason: "[VOID] invoice void — fabric restored",
        });
      }

      // Reverse customer balance: remove the unpaid debt, then apply credit for paid amount
      if (inv.customerId && inv.customer) {
        let balanceDelta = 0;
        if (inv.balanceFils > 0) balanceDelta -= inv.balanceFils; // remove debt
        if (inv.paidFils > 0) balanceDelta -= inv.paidFils;       // create store credit
        if (balanceDelta !== 0) {
          await tx.customer.update({
            where: { id: inv.customerId },
            data: { balanceFils: { increment: balanceDelta } },
          });
        }
      }

      await tx.invoice.update({
        where: { id: inv.id },
        data: {
          isVoid: true,
          voidReason: body.voidReason.trim(),
          voidCategory: body.voidCategory,
          voidedAt: new Date(),
          voidedById: userId === "system" ? null : userId,
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: "INVOICE_VOID",
          entity: "Invoice",
          entityId: inv.id,
          oldValue: JSON.stringify({ isVoid: false, totalFils: inv.totalFils, paidFils: inv.paidFils }),
          newValue: JSON.stringify({
            isVoid: true,
            voidCategory: body.voidCategory,
            voidReason: body.voidReason.trim(),
            invoiceNo: inv.invoiceNo,
            customerBalanceReversed: inv.balanceFils + inv.paidFils,
          }),
        },
      });

      // Notify OWNER and MANAGER roles
      await tx.notification.create({
        data: {
          targetRole: "OWNER",
          type: "INVOICE_VOIDED",
          title: "تم إلغاء فاتورة",
          message: `تم إلغاء فاتورة #${inv.invoiceNo} بواسطة ${userName}`,
          link: `/invoices/${inv.id}`,
        },
      });
      await tx.notification.create({
        data: {
          targetRole: "MANAGER",
          type: "INVOICE_VOIDED",
          title: "تم إلغاء فاتورة",
          message: `تم إلغاء فاتورة #${inv.invoiceNo} بواسطة ${userName}`,
          link: `/invoices/${inv.id}`,
        },
      });
    });

    const data = await fetchInvoiceDetailWithMeta(invoiceId);
    if (!data) throw new AppError(404, "Invoice not found", "NOT_FOUND");
    res.status(200).json({ success: true, data });
  }),
);

invoicesRouter.post(
  "/:id/deliver",
  requirePermission("invoices.deliver"),
  asyncHandler(async (req, res) => {
    const invoiceId = req.params.id;
    if (!invoiceId) throw new AppError(400, "Missing invoice id", "VALIDATION_ERROR");
    const userId = req.user?.id;
    if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

    /** Fabric inventory is tied to Cutting completion only — delivery does not deduct or restore fabric. */
    await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findUnique({
        where: { id: invoiceId },
        include: { jobOrders: true },
      });
      if (!inv || inv.isVoid) throw new AppError(404, "Invoice not found", "NOT_FOUND");

      const check = canMarkInvoiceDelivered(inv, inv.jobOrders);
      if (!check.ok) throw new AppError(400, check.reason, "NOT_READY");

      const now = new Date();
      await tx.invoice.update({
        where: { id: inv.id },
        data: { deliveredAt: now },
      });

      for (const j of inv.jobOrders) {
        if (j.stage === "READY") {
          await tx.jobOrder.update({
            where: { id: j.id },
            data: { stage: "DELIVERED", deliveredAt: now },
          });
          await tx.jobStageLog.create({
            data: {
              jobOrderId: j.id,
              stage: "DELIVERED",
              changedById: userId,
              notes: "تسليم مع الفاتورة",
            },
          });
        }
      }
    });

    const data = await fetchInvoiceDetailWithMeta(invoiceId);
    if (!data) throw new AppError(404, "Invoice not found", "NOT_FOUND");
    res.status(200).json({ success: true, data });
  }),
);

invoicesRouter.get(
  "/:id",
  requirePermission("invoices.view", "jobProcess.view"),
  asyncHandler(async (req, res) => {
    const invoiceId = req.params.id;
    if (!invoiceId) throw new AppError(400, "Missing invoice id", "VALIDATION_ERROR");
    const data = await fetchInvoiceDetailWithMeta(invoiceId);
    if (!data) throw new AppError(404, "Invoice not found", "NOT_FOUND");
    res.status(200).json({
      success: true,
      data: isWorkerRequest(req) ? redactInvoiceDetailForWorker(data as unknown as Record<string, unknown>) : data,
    });
  }),
);

// ─── RETURNS / EXCHANGE ──────────────────────────────────────────────────────

const returnBody = z.object({
  reason: z.string().min(2),
  /** CASH | TRANSFER | CARD → money out of drawer; CREDIT → customer account credit */
  refundMethod: z.enum(["CASH", "TRANSFER", "CARD", "CREDIT"]).default("CREDIT"),
  items: z
    .array(
      z.object({
        invoiceItemId: z.string().min(1),
        qty: z.number().positive(),
      }),
    )
    .min(1),
});

invoicesRouter.get(
  "/:id/returns",
  requirePermission("invoices.view"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.invoiceReturn.findMany({
      where: { invoiceId: req.params.id },
      orderBy: { createdAt: "desc" },
      include: {
        items: { include: { invoiceItem: { select: { id: true, description: true, qty: true } } } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    res.status(200).json({ success: true, data: rows });
  }),
);

/**
 * Register a customer return (or the return half of an exchange — the new piece
 * is sold on a fresh invoice). Per line: qty capped at (purchased − already
 * returned). Refund = line share incl. its VAT share. Money flow:
 *   1) cancels the invoice's unpaid balance first (customer owes less),
 *   2) any remainder is either store credit (CREDIT) or a drawer refund
 *      recorded as a negative payment so shift/Z-report totals stay honest.
 * Ready-made lines go back to stock; tailoring/service lines never restock.
 */
invoicesRouter.post(
  "/:id/returns",
  requirePermission("invoices.return"),
  validateBody(returnBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof returnBody>;
    const userId = req.user?.id;
    if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    const invoiceId = req.params.id;

    const result = await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          items: { include: { product: { select: { id: true, isService: true } }, returnItems: true } },
        },
      });
      if (!inv) throw new AppError(404, "Invoice not found", "NOT_FOUND");
      if (inv.isVoid) throw new AppError(400, "لا يمكن الإرجاع على فاتورة ملغاة", "INVOICE_VOID");

      // VAT share per net dirham of the invoice (discount already applied at invoice level).
      const taxableFils = Math.max(1, inv.subtotalFils - inv.discountFils);
      const vatFactor = inv.vatFils / taxableFils;

      let totalReturnFils = 0;
      const lineCreates: Array<{ invoiceItemId: string; qty: number; amountFils: number; restocked: boolean }> = [];

      for (const rl of body.items) {
        const item = inv.items.find((i) => i.id === rl.invoiceItemId);
        if (!item) throw new AppError(400, "بند غير موجود في هذه الفاتورة", "VALIDATION_ERROR");
        const alreadyReturned = item.returnItems.reduce((a, r) => a + r.qty, 0);
        const remaining = item.qty - alreadyReturned;
        if (rl.qty > remaining + 1e-9) {
          throw new AppError(
            400,
            `الكمية المرتجعة (${rl.qty}) أكبر من المتبقي القابل للإرجاع (${remaining})`,
            "RETURN_QTY_EXCEEDED",
          );
        }
        // Line share of the invoice-level discount is proportional to line total.
        const invoiceDiscountShare =
          inv.subtotalFils > 0 ? (item.totalFils / inv.subtotalFils) * inv.discountFils : 0;
        const netLineFils = item.totalFils - invoiceDiscountShare;
        const share = item.qty > 0 ? rl.qty / item.qty : 0;
        const amountFils = Math.round(netLineFils * share * (1 + vatFactor));
        totalReturnFils += amountFils;

        const restock = !item.product.isService;
        if (restock) {
          await tx.product.update({
            where: { id: item.product.id },
            data: { stockQty: { increment: Math.round(rl.qty) } },
          });
        }
        lineCreates.push({ invoiceItemId: item.id, qty: rl.qty, amountFils, restocked: restock });
      }

      const ret = await tx.invoiceReturn.create({
        data: {
          invoiceId: inv.id,
          reason: body.reason.trim(),
          refundMethod: body.refundMethod,
          totalFils: totalReturnFils,
          createdById: userId,
          items: { create: lineCreates },
        },
        include: { items: true },
      });

      // 1) cancel unpaid balance first
      const appliedToBalance = Math.min(totalReturnFils, inv.balanceFils);
      if (appliedToBalance > 0) {
        await tx.invoice.update({
          where: { id: inv.id },
          data: { balanceFils: { decrement: appliedToBalance } },
        });
        if (inv.customerId) {
          await tx.customer.update({
            where: { id: inv.customerId },
            data: { balanceFils: { decrement: appliedToBalance } },
          });
        }
      }

      // 2) remainder: store credit or drawer refund
      const remainder = totalReturnFils - appliedToBalance;
      if (remainder > 0) {
        if (body.refundMethod === "CREDIT") {
          if (!inv.customerId) {
            throw new AppError(400, "فاتورة بدون عميل — اختر استرداد نقدي بدلاً من الرصيد", "VALIDATION_ERROR");
          }
          await tx.customer.update({
            where: { id: inv.customerId },
            data: { balanceFils: { decrement: remainder } },
          });
        } else {
          await tx.payment.create({
            data: {
              invoiceId: inv.id,
              method: body.refundMethod,
              amountFils: -remainder,
              reference: `RETURN:${ret.id}`,
            },
          });
          await tx.invoice.update({
            where: { id: inv.id },
            data: { paidFils: { decrement: remainder } },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          userId,
          action: "INVOICE_RETURN",
          entity: "Invoice",
          entityId: inv.id,
          newValue: JSON.stringify({
            returnId: ret.id,
            invoiceNo: inv.invoiceNo,
            totalReturnFils,
            refundMethod: body.refundMethod,
            reason: body.reason,
            lines: lineCreates.length,
          }),
        },
      });

      return ret;
    });

    res.status(201).json({ success: true, data: result });
  }),
);
