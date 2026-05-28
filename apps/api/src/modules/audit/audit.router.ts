import { Router } from "express";
import { prisma } from "../../config/db.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/rbac.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../middleware/error.middleware.js";

export const auditRouter = Router();
auditRouter.use(authMiddleware);

/**
 * GET /api/audit
 * Returns audit log entries, newest first.
 * Query params: entity, action, userId, limit (default 100), offset (default 0)
 */
auditRouter.get(
  "/",
  requirePermission("audit.view"),
  asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 500);
    const offset = parseInt(String(req.query.offset ?? "0"), 10) || 0;
    const entity = typeof req.query.entity === "string" ? req.query.entity : undefined;
    const action = typeof req.query.action === "string" ? req.query.action : undefined;
    const filterUserId = typeof req.query.userId === "string" ? req.query.userId : undefined;

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: {
          ...(entity ? { entity } : {}),
          ...(action ? { action } : {}),
          ...(filterUserId ? { userId: filterUserId } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        include: {
          user: { select: { id: true, name: true, username: true, role: true } },
        },
      }),
      prisma.auditLog.count({
        where: {
          ...(entity ? { entity } : {}),
          ...(action ? { action } : {}),
          ...(filterUserId ? { userId: filterUserId } : {}),
        },
      }),
    ]);

    res.status(200).json({ success: true, data: { items, total, limit, offset } });
  }),
);

/**
 * GET /api/audit/:id
 * Returns a single audit log entry by id.
 */
auditRouter.get(
  "/:id",
  requirePermission("audit.view"),
  asyncHandler(async (req, res) => {
    const entry = await prisma.auditLog.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, name: true, username: true, role: true } },
      },
    });
    if (!entry) throw new AppError(404, "Audit log entry not found", "NOT_FOUND");
    res.status(200).json({ success: true, data: entry });
  }),
);
