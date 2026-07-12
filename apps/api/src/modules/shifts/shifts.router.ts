import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/rbac.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../middleware/error.middleware.js";
import { notify } from "../../utils/notify.js";

const PAYMENT_METHODS = ["CASH", "CARD", "TRANSFER"] as const;

/** Per-method payment totals for one cashier between two instants. */
async function paymentBreakdownForShift(params: {
  userId: string;
  from: Date;
  to: Date;
}): Promise<{ method: string; totalFils: number; count: number }[]> {
  const grouped = await prisma.payment.groupBy({
    by: ["method"],
    _sum: { amountFils: true },
    _count: { _all: true },
    where: {
      createdAt: { gte: params.from, lte: params.to },
      invoice: { salesPersonId: params.userId, isVoid: false },
    },
  });
  return PAYMENT_METHODS.map((m) => {
    const g = grouped.find((x) => x.method === m);
    return { method: m, totalFils: g?._sum.amountFils ?? 0, count: g?._count._all ?? 0 };
  });
}

export const shiftsRouter = Router();
shiftsRouter.use(authMiddleware);

const openShiftBody = z.object({
  openingBalanceFils: z.number().int().min(0).default(0),
  branchId: z.string().optional(),
  notes: z.string().optional(),
});

const closeShiftBody = z.object({
  closingBalanceFils: z.number().int().min(0),
  notes: z.string().optional(),
});

/** Open a new shift — one OPEN shift per user at a time. */
shiftsRouter.post(
  "/open",
  requirePermission("pos.use"),
  validateBody(openShiftBody),
  asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    const body = req.body as z.infer<typeof openShiftBody>;

    const existing = await prisma.cashierShift.findFirst({
      where: { userId, status: "OPEN" },
    });
    if (existing) {
      throw new AppError(409, "لديك وردية مفتوحة بالفعل — أغلقها أولاً", "SHIFT_ALREADY_OPEN");
    }

    const shift = await prisma.cashierShift.create({
      data: {
        userId,
        branchId: body.branchId,
        openingBalanceFils: body.openingBalanceFils,
        notes: body.notes,
      },
    });

    res.status(201).json({ success: true, data: shift });
  }),
);

/** Get the caller's current open shift (with computed cash sales so far). */
shiftsRouter.get(
  "/current",
  requirePermission("pos.use"),
  asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

    const shift = await prisma.cashierShift.findFirst({
      where: { userId, status: "OPEN" },
      include: { user: { select: { id: true, name: true, username: true } } },
    });
    if (!shift) {
      return res.status(200).json({ success: true, data: null });
    }

    // Compute cash sales since shift opened
    const cashPayments = await prisma.payment.aggregate({
      _sum: { amountFils: true },
      where: {
        method: "CASH",
        createdAt: { gte: shift.openedAt },
        invoice: { salesPersonId: userId },
      },
    });
    const cashSalesFils = cashPayments._sum.amountFils ?? 0;

    return res.status(200).json({
      success: true,
      data: { ...shift, cashSalesFils, expectedCashFils: shift.openingBalanceFils + cashSalesFils },
    });
  }),
);

/** Close shift — record closing balance, compute expected cash and variance. */
shiftsRouter.post(
  "/:id/close",
  requirePermission("pos.use"),
  validateBody(closeShiftBody),
  asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    const body = req.body as z.infer<typeof closeShiftBody>;

    const shift = await prisma.cashierShift.findUnique({ where: { id: req.params.id } });
    if (!shift) throw new AppError(404, "Shift not found", "NOT_FOUND");
    if (shift.userId !== userId) throw new AppError(403, "ليس وردية خاصتك", "FORBIDDEN");
    if (shift.status !== "OPEN") throw new AppError(400, "الوردية مغلقة بالفعل", "ALREADY_CLOSED");

    // Compute cash sales during shift
    const cashPayments = await prisma.payment.aggregate({
      _sum: { amountFils: true },
      where: {
        method: "CASH",
        createdAt: { gte: shift.openedAt, lte: new Date() },
        invoice: { salesPersonId: userId },
      },
    });
    const cashSalesFils = cashPayments._sum.amountFils ?? 0;
    const expectedCashFils = shift.openingBalanceFils + cashSalesFils;
    const varianceFils = body.closingBalanceFils - expectedCashFils;

    const updated = await prisma.cashierShift.update({
      where: { id: shift.id },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        closingBalanceFils: body.closingBalanceFils,
        cashSalesFils,
        expectedCashFils,
        varianceFils,
        notes: body.notes ?? shift.notes,
      },
    });

    // Owner is alerted whenever the drawer doesn't reconcile.
    if (varianceFils !== 0) {
      const dir = varianceFils > 0 ? "زيادة" : "عجز";
      await notify(prisma, {
        targetRole: "OWNER",
        type: "SHIFT_VARIANCE",
        title: `${dir} في وردية الكاشير`,
        message: `${req.user?.name ?? "كاشير"}: ${dir} ${(Math.abs(varianceFils) / 100).toFixed(2)} في إقفال الوردية`,
        link: "/shifts",
      });
    }

    res.status(200).json({ success: true, data: updated });
  }),
);

/** Z-report for a closed shift: per-method payment breakdown + reconciliation. */
shiftsRouter.get(
  "/:id/z-report",
  requirePermission("pos.use", "reports.financial"),
  asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

    const shift = await prisma.cashierShift.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, name: true, username: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });
    if (!shift) throw new AppError(404, "Shift not found", "NOT_FOUND");
    // Cashiers may read their own shift; financial viewers may read any.
    const canViewAll = req.user?.permissions?.includes("reports.financial");
    if (shift.userId !== userId && !canViewAll) {
      throw new AppError(403, "ليست وردية خاصتك", "FORBIDDEN");
    }

    const to = shift.closedAt ?? new Date();
    const byMethod = await paymentBreakdownForShift({ userId: shift.userId, from: shift.openedAt, to });

    const invoices = await prisma.invoice.findMany({
      where: { salesPersonId: shift.userId, isVoid: false, createdAt: { gte: shift.openedAt, lte: to } },
      orderBy: { createdAt: "asc" },
      select: { id: true, invoiceNo: true, totalFils: true, paidFils: true, createdAt: true },
    });

    res.status(200).json({
      success: true,
      data: {
        shift,
        byMethod,
        totalCollectedFils: byMethod.reduce((s, m) => s + m.totalFils, 0),
        invoiceCount: invoices.length,
        invoices,
      },
    });
  }),
);

/** Manager: list all shifts with filters. */
shiftsRouter.get(
  "/",
  requirePermission("reports.financial"),
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const status = typeof q.status === "string" ? q.status : undefined;

    const shifts = await prisma.cashierShift.findMany({
      where: status ? { status } : undefined,
      orderBy: { openedAt: "desc" },
      take: 100,
      include: {
        user: { select: { id: true, name: true, username: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });

    res.status(200).json({ success: true, data: shifts });
  }),
);

/** Manager: approve a closed shift. */
shiftsRouter.post(
  "/:id/approve",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

    const shift = await prisma.cashierShift.findUnique({ where: { id: req.params.id } });
    if (!shift) throw new AppError(404, "Shift not found", "NOT_FOUND");
    if (shift.status !== "CLOSED") throw new AppError(400, "الوردية يجب أن تكون مغلقة أولاً", "INVALID_STATE");

    const updated = await prisma.cashierShift.update({
      where: { id: shift.id },
      data: { status: "APPROVED", approvedById: userId, approvedAt: new Date() },
    });

    res.status(200).json({ success: true, data: updated });
  }),
);
