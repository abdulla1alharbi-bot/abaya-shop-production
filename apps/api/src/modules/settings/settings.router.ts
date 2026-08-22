import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/rbac.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { SMTP_KEYS } from "../../utils/mailer.js";

export const settingsRouter = Router();
settingsRouter.use(authMiddleware);

/**
 * Settings whose value must never leave the server. This endpoint hands back the
 * whole table, so anything secret has to be filtered HERE — adding a write-only
 * setting elsewhere without listing it here silently publishes it to every user
 * holding `settings.view`, which is most of the staff.
 */
const WRITE_ONLY_KEYS = new Set<string>([SMTP_KEYS.pass]);

/** Replaced by a boolean-ish marker so the UI can still show "saved" vs "empty". */
const REDACTED = "__SET__";

function redact(rows: Array<{ key: string; value: string }>): Record<string, string> {
  return Object.fromEntries(
    rows.map((r) => [r.key, WRITE_ONLY_KEYS.has(r.key) ? (r.value ? REDACTED : "") : r.value]),
  );
}

settingsRouter.get(
  "/",
  requirePermission("settings.view"),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.setting.findMany({ orderBy: { key: "asc" } });
    res.status(200).json({ success: true, data: redact(rows) });
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
    res.status(200).json({ success: true, data: redact(rows) });
  }),
);
