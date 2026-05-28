import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/rbac.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../middleware/error.middleware.js";
import { nextCustomerCode } from "../../utils/counters.js";
import { prismaSkipTake, buildPaginatedMeta } from "../../utils/pagination.js";
import { parsePageLimit, queryParamString } from "../../utils/queryParams.js";
import { logger } from "../../utils/logger.js";

export const customersRouter = Router();
customersRouter.use(authMiddleware);

customersRouter.get(
  "/",
  requirePermission("customers.view"),
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const { page, limit } = parsePageLimit(q, { defaultLimit: 20 });
    const search = queryParamString(q, "q");
    const pagination = { page, limit };
    const { skip, take } = prismaSkipTake(pagination);

    const codeNum = search && /^\d+$/.test(search) ? Number(search) : undefined;
    const where = search
      ? {
          OR: [
            { name: { contains: search } },
            { mobile: { contains: search } },
            ...(codeNum !== undefined ? [{ code: codeNum }] : []),
          ],
        }
      : {};

    const [total, rows] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: {
          id: true,
          code: true,
          name: true,
          mobile: true,
          balanceFils: true,
          segment: true,
          createdAt: true,
        },
      }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        items: rows,
        meta: buildPaginatedMeta(total, pagination),
      },
    });
  }),
);

const measurementBody = z.object({
  label: z.string().optional(),
  shoulder: z.number().optional(),
  chest: z.number().optional(),
  waist: z.number().optional(),
  hip: z.number().optional(),
  length: z.number().optional(),
  sleeve: z.number().optional(),
  notes: z.string().optional(),
});

const createBody = z.object({
  name: z.string().min(1),
  mobile: z.string().min(5),
  whatsapp: z.string().optional(),
  address: z.string().optional(),
  nationality: z.string().optional(),
  notes: z.string().optional(),
  /** Phase 3 F2: credit limit in fils (0 = no credit allowed). */
  creditLimitFils: z.number().int().min(0).optional(),
  /** Saved with the new customer in one step (POS quick add). */
  initialMeasurement: measurementBody.optional(),
});

const customerNoteBody = z.object({
  body: z.string().min(1).max(2000),
});

customersRouter.get(
  "/:id/measurements",
  requirePermission("customers.view"),
  asyncHandler(async (req, res) => {
    const raw = req.query.limit;
    const limitNum =
      raw !== undefined ? Math.min(100, Math.max(1, parseInt(String(raw), 10) || 50)) : undefined;
    const rows = await prisma.measurement.findMany({
      where: { customerId: req.params.id },
      orderBy: { updatedAt: "desc" },
      ...(limitNum !== undefined ? { take: limitNum } : {}),
    });
    res.status(200).json({ success: true, data: rows });
  }),
);

/** Parsed JSON from JobOrder.measurements (invoice / tailoring snapshot). */
function parseJobMeasurementsJson(s: string): {
  shoulder: number | null;
  chest: number | null;
  waist: number | null;
  hip: number | null;
  length: number | null;
  sleeve: number | null;
} {
  const empty = {
    shoulder: null as number | null,
    chest: null as number | null,
    waist: null as number | null,
    hip: null as number | null,
    length: null as number | null,
    sleeve: null as number | null,
  };
  try {
    const o = JSON.parse(s) as Record<string, unknown>;
    const n = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) ? v : null;
    return {
      shoulder: n(o.shoulder),
      chest: n(o.chest),
      waist: n(o.waist),
      hip: n(o.hip),
      length: n(o.length),
      sleeve: n(o.sleeve),
    };
  } catch (err) {
    logger.warn("Failed to parse measurement JSON — returning empty", { err, raw: s });
    return empty;
  }
}

function hasNumericBodyFields(f: {
  shoulder: number | null;
  chest: number | null;
  waist: number | null;
  hip: number | null;
  length: number | null;
  sleeve: number | null;
}): boolean {
  return (
    f.shoulder != null ||
    f.chest != null ||
    f.waist != null ||
    f.hip != null ||
    f.length != null ||
    f.sleeve != null
  );
}

/**
 * POS tailoring: latest saved body measurements — Measurement row first, else last job order JSON.
 */
customersRouter.get(
  "/:id/pos-measurement-hint",
  requirePermission("pos.tailoring"),
  asyncHandler(async (req, res) => {
    const customerId = req.params.id;
    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!customer) throw new AppError(404, "Customer not found", "NOT_FOUND");

    const row = await prisma.measurement.findFirst({
      where: { customerId },
      orderBy: { updatedAt: "desc" },
    });

    if (row) {
      const f = {
        shoulder: row.shoulder ?? null,
        chest: row.chest ?? null,
        waist: row.waist ?? null,
        hip: row.hip ?? null,
        length: row.length ?? null,
        sleeve: row.sleeve ?? null,
      };
      if (hasNumericBodyFields(f)) {
        res.status(200).json({
          success: true,
          data: {
            source: "measurement",
            measurementId: row.id,
            shoulder: row.shoulder,
            chest: row.chest,
            waist: row.waist,
            hip: row.hip,
            length: row.length,
            sleeve: row.sleeve,
            notes: row.notes,
          },
        });
        return;
      }
    }

    const job = await prisma.jobOrder.findFirst({
      where: { customerId, measurements: { not: null } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, measurements: true },
    });

    if (job?.measurements) {
      const p = parseJobMeasurementsJson(job.measurements);
      if (hasNumericBodyFields(p)) {
        res.status(200).json({
          success: true,
          data: {
            source: "job_order",
            measurementId: null,
            jobOrderId: job.id,
            shoulder: p.shoulder,
            chest: p.chest,
            waist: p.waist,
            hip: p.hip,
            length: p.length,
            sleeve: p.sleeve,
            notes: null as string | null,
          },
        });
        return;
      }
    }

    if (row) {
      res.status(200).json({
        success: true,
        data: {
          source: "none",
          measurementId: row.id,
          shoulder: null,
          chest: null,
          waist: null,
          hip: null,
          length: null,
          sleeve: null,
          notes: row.notes,
        },
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        source: "none",
        measurementId: null,
        shoulder: null,
        chest: null,
        waist: null,
        hip: null,
        length: null,
        sleeve: null,
        notes: null as string | null,
      },
    });
  }),
);

customersRouter.post(
  "/:id/measurements",
  requirePermission("customers.edit"),
  validateBody(measurementBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof measurementBody>;
    const customerId = req.params.id;
    if (!customerId) throw new AppError(400, "Missing customer id", "VALIDATION_ERROR");
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new AppError(404, "Customer not found", "NOT_FOUND");
    const row = await prisma.measurement.create({
      data: {
        customerId,
        label: body.label?.trim(),
        shoulder: body.shoulder,
        chest: body.chest,
        waist: body.waist,
        hip: body.hip,
        length: body.length,
        sleeve: body.sleeve,
        notes: body.notes?.trim(),
      },
    });
    res.status(201).json({ success: true, data: row });
  }),
);

customersRouter.patch(
  "/measurements/:measurementId",
  requirePermission("customers.edit"),
  validateBody(measurementBody.partial()),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof measurementBody>;
    const row = await prisma.measurement.update({
      where: { id: req.params.measurementId },
      data: {
        label: body.label?.trim(),
        shoulder: body.shoulder,
        chest: body.chest,
        waist: body.waist,
        hip: body.hip,
        length: body.length,
        sleeve: body.sleeve,
        notes: body.notes?.trim(),
      },
    });
    res.status(200).json({ success: true, data: row });
  }),
);

customersRouter.post(
  "/",
  requirePermission("customers.create"),
  validateBody(createBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createBody>;
    const exists = await prisma.customer.findUnique({ where: { mobile: body.mobile } });
    if (exists) {
      throw new AppError(409, "Mobile already registered", "DUPLICATE");
    }
    const code = await nextCustomerCode(prisma);
    const im = body.initialMeasurement;
    const customer = await prisma.$transaction(async (tx) => {
      const c = await tx.customer.create({
        data: {
          code,
          name: body.name.trim(),
          mobile: body.mobile.trim(),
          whatsapp: body.whatsapp?.trim(),
          address: body.address?.trim(),
          nationality: body.nationality?.trim(),
          notes: body.notes?.trim(),
          ...(body.creditLimitFils !== undefined ? { creditLimitFils: body.creditLimitFils } : {}),
        },
      });
      if (im) {
        const hasAny =
          (im.label != null && im.label.trim() !== "") ||
          im.shoulder != null ||
          im.chest != null ||
          im.waist != null ||
          im.hip != null ||
          im.length != null ||
          im.sleeve != null ||
          (im.notes != null && im.notes.trim() !== "");
        if (hasAny) {
          await tx.measurement.create({
            data: {
              customerId: c.id,
              label: im.label?.trim(),
              shoulder: im.shoulder,
              chest: im.chest,
              waist: im.waist,
              hip: im.hip,
              length: im.length,
              sleeve: im.sleeve,
              notes: im.notes?.trim(),
            },
          });
        }
      }
      return c;
    });
    res.status(201).json({ success: true, data: customer });
  }),
);

const updateBody = createBody.partial();

customersRouter.get(
  "/:id",
  requirePermission("customers.view"),
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: {
        measurements: { orderBy: { updatedAt: "desc" }, take: 20 },
        invoices: {
          orderBy: { createdAt: "desc" },
          take: 50,
          select: {
            id: true,
            invoiceNo: true,
            totalFils: true,
            balanceFils: true,
            paidFils: true,
            createdAt: true,
            isVoid: true,
          },
        },
        jobOrders: {
          orderBy: { createdAt: "desc" },
          take: 50,
          select: {
            id: true,
            jobNo: true,
            stage: true,
            totalFils: true,
            balanceFils: true,
            paidFils: true,
            dueDate: true,
            createdAt: true,
            invoiceId: true,
          },
        },
        customerNotes: {
          orderBy: { createdAt: "desc" },
          take: 20,
          include: { author: { select: { id: true, name: true, username: true } } },
        },
      },
    });
    if (!customer) {
      throw new AppError(404, "Customer not found", "NOT_FOUND");
    }

    // Phase 3 F7: LTV, AOV, tier from all-time non-void invoices
    const allInvoicesAgg = await prisma.invoice.aggregate({
      where: { customerId: req.params.id, isVoid: false },
      _sum: { totalFils: true },
      _count: { _all: true },
      _max: { createdAt: true },
    });
    const lifetimeValueFils = allInvoicesAgg._sum.totalFils ?? 0;
    const orderCount = allInvoicesAgg._count._all;
    const averageOrderValueFils = orderCount > 0 ? Math.round(lifetimeValueFils / orderCount) : 0;
    const lastVisitAt = allInvoicesAgg._max.createdAt;

    // Tier thresholds from settings, with sensible defaults
    const settings = await prisma.setting.findMany({
      where: { key: { in: ["customer_tier_silver_fils", "customer_tier_gold_fils"] } },
    });
    const silverThreshold = parseInt(
      settings.find((s) => s.key === "customer_tier_silver_fils")?.value ?? "500000",
      10,
    );
    const goldThreshold = parseInt(
      settings.find((s) => s.key === "customer_tier_gold_fils")?.value ?? "2000000",
      10,
    );
    const tier =
      lifetimeValueFils >= goldThreshold
        ? "GOLD"
        : lifetimeValueFils >= silverThreshold
          ? "SILVER"
          : "BRONZE";

    res.status(200).json({
      success: true,
      data: {
        ...customer,
        lifetimeValueFils,
        orderCount,
        averageOrderValueFils,
        lastVisitAt,
        tier,
      },
    });
  }),
);

/** Phase 3 F7: add a note/comm-log entry on a customer. */
customersRouter.post(
  "/:id/notes",
  requirePermission("customers.edit"),
  validateBody(customerNoteBody),
  asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    const body = req.body as z.infer<typeof customerNoteBody>;
    const customerId = req.params.id as string;
    const exists = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!exists) throw new AppError(404, "Customer not found", "NOT_FOUND");
    const note = await prisma.customerNote.create({
      data: { customerId, authorId: userId, body: body.body.trim() },
      include: { author: { select: { id: true, name: true, username: true } } },
    });
    res.status(201).json({ success: true, data: note });
  }),
);

/** Phase 3 F7: delete a note (author or owner). */
customersRouter.delete(
  "/notes/:noteId",
  requirePermission("customers.edit"),
  asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    const note = await prisma.customerNote.findUnique({ where: { id: req.params.noteId } });
    if (!note) throw new AppError(404, "Note not found", "NOT_FOUND");
    if (note.authorId !== userId && userRole !== "OWNER") {
      throw new AppError(403, "Only the author or OWNER can delete this note", "FORBIDDEN");
    }
    await prisma.customerNote.delete({ where: { id: req.params.noteId } });
    res.status(200).json({ success: true, data: { deleted: true } });
  }),
);

customersRouter.patch(
  "/:id",
  requirePermission("customers.edit"),
  validateBody(updateBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof updateBody>;
    const id = req.params.id;
    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError(404, "Customer not found", "NOT_FOUND");
    }
    if (body.mobile && body.mobile !== existing.mobile) {
      const clash = await prisma.customer.findUnique({ where: { mobile: body.mobile } });
      if (clash) throw new AppError(409, "Mobile already in use", "DUPLICATE");
    }
    const customer = await prisma.customer.update({
      where: { id },
      data: {
        name: body.name?.trim() ?? undefined,
        mobile: body.mobile?.trim() ?? undefined,
        whatsapp: body.whatsapp?.trim(),
        address: body.address?.trim(),
        nationality: body.nationality?.trim(),
        notes: body.notes?.trim(),
        ...(body.creditLimitFils !== undefined ? { creditLimitFils: body.creditLimitFils } : {}),
      },
    });
    res.status(200).json({ success: true, data: customer });
  }),
);

customersRouter.delete(
  "/:id",
  requirePermission("customers.edit"),
  asyncHandler(async (req, res) => {
    try {
      await prisma.customer.delete({ where: { id: req.params.id } });
    } catch {
      throw new AppError(404, "Customer not found", "NOT_FOUND");
    }
    res.status(200).json({ success: true, data: { deleted: true } });
  }),
);
