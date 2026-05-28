import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/rbac.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../middleware/error.middleware.js";

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

    res.status(200).json({ success: true, data: updated });
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
