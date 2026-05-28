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
  createPipelineRowsForJob,
  initialPipelineStage,
  parseWageDefaults,
  resolvePipelineStageKeysFromModelJson,
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
          Prisma.sql`SELECT id FROM "Invoice" WHERE CAST("invoiceNo" AS TEXT) LIKE ${like}`,
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
        Prisma.sql`SELECT id FROM "Invoice" WHERE CAST("invoiceNo" AS TEXT) LIKE ${like}`,
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

    const branchId = body.branchId ?? (await getDefaultBranchId(prisma));
    const vatPercent = await getVatRatePercent(prisma);

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

    const branchId = await getDefaultBranchId(prisma);
    const vatPercent = await getVatRatePercent(prisma);

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
            stage: it.productId ? "CUTTING" : "NEW",
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

        await tx.jobStageLog.create({
          data: {
            jobOrderId: j.id,
            stage: j.stage,
            changedById: salesPersonId,
            notes: `Invoice #${invoiceNo}`,
          },
        });

        if (it.productId) {
          const productRow = await tx.product.findUnique({ where: { id: it.productId } });
          if (!productRow) throw new AppError(400, "Catalog product not found", "NOT_FOUND");
          const settingsRows = await tx.setting.findMany();
          const settingsMap = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));
          const wageDefaults = parseWageDefaults(settingsMap);
          let pipelineKeys = resolvePipelineStageKeysFromModelJson(null);
          if (it.abayaModelId) {
            const am = await tx.abayaModel.findUnique({ where: { id: it.abayaModelId } });
            if (am) pipelineKeys = resolvePipelineStageKeysFromModelJson(am.workflowStagesJson);
          }
          await createPipelineRowsForJob(tx, j.id, productRow, wageDefaults, pipelineKeys);
          await tx.jobOrder.update({
            where: { id: j.id },
            data: { productId: productRow.id, stage: initialPipelineStage(pipelineKeys) },
          });
        }

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

invoicesRouter.post(
  "/pos-checkout",
  requireAllPermissions("invoices.create", "pos.use", "pos.checkout"),
  validateBody(posCheckoutBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof posCheckoutBody>;
    const salesPersonId = req.user?.id;
    if (!salesPersonId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

    const branchId = await getDefaultBranchId(prisma);
    const vatPercent = await getVatRatePercent(prisma);
    const retail = body.retailItems;
    const tailoring = body.tailoringItems;

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
        { id: string; name: string; stockQty: number; isService: boolean }
      >();

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
              stage: it.productId ? "CUTTING" : "NEW",
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

          await tx.jobStageLog.create({
            data: {
              jobOrderId: j.id,
              stage: j.stage,
              changedById: salesPersonId,
              notes: `Invoice #${invoiceNo}`,
            },
          });

          if (it.productId) {
            const productRow = await tx.product.findUnique({ where: { id: it.productId } });
            if (!productRow) throw new AppError(400, "Catalog product not found", "NOT_FOUND");
            const settingsRows = await tx.setting.findMany();
            const settingsMap = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));
            const wageDefaults = parseWageDefaults(settingsMap);
            let pipelineKeys = resolvePipelineStageKeysFromModelJson(null);
            if (it.abayaModelId) {
              const am = await tx.abayaModel.findUnique({ where: { id: it.abayaModelId } });
              if (am) pipelineKeys = resolvePipelineStageKeysFromModelJson(am.workflowStagesJson);
            }
            await createPipelineRowsForJob(tx, j.id, productRow, wageDefaults, pipelineKeys);
            await tx.jobOrder.update({
              where: { id: j.id },
              data: { productId: productRow.id, stage: initialPipelineStage(pipelineKeys) },
            });
          }

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
