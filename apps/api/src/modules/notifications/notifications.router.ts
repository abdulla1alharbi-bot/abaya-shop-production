import { Router } from "express";
import { prisma } from "../../config/db.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

export const notificationsRouter = Router();
notificationsRouter.use(authMiddleware);

/** GET /notifications — caller's unread+read notifications, unread first, limit 50 */
notificationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const role = req.user!.role;

    const items = await prisma.notification.findMany({
      where: {
        OR: [{ userId }, { targetRole: role }],
      },
      orderBy: [{ isRead: "asc" }, { createdAt: "desc" }],
      take: 50,
    });

    res.json({ success: true, data: { items } });
  }),
);

/** GET /notifications/unread-count */
notificationsRouter.get(
  "/unread-count",
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const role = req.user!.role;

    const count = await prisma.notification.count({
      where: {
        OR: [{ userId }, { targetRole: role }],
        isRead: false,
      },
    });

    res.json({ success: true, data: { count } });
  }),
);

/** POST /notifications/:id/read — mark one notification read */
notificationsRouter.post(
  "/:id/read",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    await prisma.notification.updateMany({
      where: { id },
      data: { isRead: true },
    });
    res.json({ success: true });
  }),
);

/** POST /notifications/read-all — mark all notifications read for caller */
notificationsRouter.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const role = req.user!.role;

    await prisma.notification.updateMany({
      where: {
        OR: [{ userId }, { targetRole: role }],
        isRead: false,
      },
      data: { isRead: true },
    });

    res.json({ success: true });
  }),
);
