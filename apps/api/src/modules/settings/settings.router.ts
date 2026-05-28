import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/rbac.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

export const settingsRouter = Router();
settingsRouter.use(authMiddleware);

settingsRouter.get(
  "/",
  requirePermission("settings.view"),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.setting.findMany({ orderBy: { key: "asc" } });
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    res.status(200).json({ success: true, data: map });
  }),
);

const patchBody = z.record(z.string(), z.string());

settingsRouter.patch(
  "/",
  requirePermission("settings.manage"),
  validateBody(patchBody),
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, string>;
    await prisma.$transaction(
      Object.entries(body).map(([key, value]) =>
        prisma.setting.upsert({
          where: { key },
          update: { value: String(value) },
          create: { key, value: String(value) },
        }),
      ),
    );
    const rows = await prisma.setting.findMany();
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    res.status(200).json({ success: true, data: map });
  }),
);
