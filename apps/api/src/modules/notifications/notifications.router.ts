import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { normalizeAppRole } from "@abaya-shop/shared";
import { prisma } from "../../config/db.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../middleware/error.middleware.js";

export const notificationsRouter = Router();
notificationsRouter.use(authMiddleware);

const LIST_LIMIT = 50;

/**
 * Which `targetRole` values a caller should receive.
 *
 * ADMIN also gets everything sent to MANAGER: the two roles carry an identical
 * permission matrix (ADMIN exists for accounts stored that way in legacy DBs),
 * but every `notify()` call in the app addresses OWNER and MANAGER only — so an
 * ADMIN account used to see no void alerts, no shift variances, nothing at all.
 */
function targetRolesFor(role: string): string[] {
  const normalized = normalizeAppRole(role);
  return normalized === "ADMIN" ? ["ADMIN", "MANAGER"] : [normalized];
}

/** Everything addressed to this caller, personally or through a role. */
function addressedTo(userId: string, roles: string[]): Prisma.NotificationWhereInput {
  return { OR: [{ userId }, { targetRole: { in: roles } }] };
}

/**
 * Unread means different things for the two kinds of row: a personal one carries
 * its own `isRead`, a role-addressed one is unread until *this* user has a
 * NotificationRead row for it.
 */
function unreadFor(userId: string, roles: string[]): Prisma.NotificationWhereInput {
  return {
    OR: [
      { userId, isRead: false },
      { targetRole: { in: roles }, reads: { none: { userId } } },
    ],
  };
}

/** GET /notifications — the caller's notifications, unread first, newest first. */
notificationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const roles = targetRolesFor(req.user!.role);

    const rows = await prisma.notification.findMany({
      where: addressedTo(userId, roles),
      orderBy: { createdAt: "desc" },
      take: LIST_LIMIT,
      include: { reads: { where: { userId }, select: { id: true } } },
    });

    // `isRead` is resolved per caller before it leaves the server, so the client
    // keeps treating it as a plain boolean.
    const items = rows
      .map(({ reads, ...n }) => ({
        ...n,
        isRead: n.targetRole ? reads.length > 0 : n.isRead,
      }))
      .sort((a, b) => Number(a.isRead) - Number(b.isRead));

    res.json({ success: true, data: { items } });
  }),
);

/** GET /notifications/unread-count */
notificationsRouter.get(
  "/unread-count",
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const roles = targetRolesFor(req.user!.role);
    const count = await prisma.notification.count({ where: unreadFor(userId, roles) });
    res.json({ success: true, data: { count } });
  }),
);

/** POST /notifications/:id/read — mark one notification read for the caller. */
notificationsRouter.post(
  "/:id/read",
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const roles = targetRolesFor(req.user!.role);
    const id = req.params.id;
    if (!id) throw new AppError(400, "Missing notification id", "VALIDATION_ERROR");

    const notification = await prisma.notification.findUnique({ where: { id } });
    // Ownership check: without it any signed-in user could mark somebody else's
    // alert — a shift variance, a voided invoice — as read and hide it.
    const mine =
      notification &&
      (notification.userId === userId ||
        (notification.targetRole !== null && roles.includes(notification.targetRole)));
    if (!mine) throw new AppError(404, "Notification not found", "NOT_FOUND");

    if (notification.targetRole) {
      // upsert, so a double click (or two tabs) is not a unique-constraint error.
      await prisma.notificationRead.upsert({
        where: { notificationId_userId: { notificationId: id, userId } },
        update: {},
        create: { notificationId: id, userId },
      });
    } else {
      await prisma.notification.update({ where: { id }, data: { isRead: true } });
    }

    res.json({ success: true });
  }),
);

/** POST /notifications/read-all — mark everything currently unread as read. */
notificationsRouter.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const roles = targetRolesFor(req.user!.role);

    const unreadRoleRows = await prisma.notification.findMany({
      where: { targetRole: { in: roles }, reads: { none: { userId } } },
      select: { id: true },
    });

    await prisma.$transaction([
      prisma.notification.updateMany({
        where: { userId, isRead: false },
        data: { isRead: true },
      }),
      prisma.notificationRead.createMany({
        data: unreadRoleRows.map((n) => ({ notificationId: n.id, userId })),
        skipDuplicates: true,
      }),
    ]);

    res.json({ success: true });
  }),
);
