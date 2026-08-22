import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { AppError } from "../../middleware/error.middleware.js";
import { requirePermission } from "../../middleware/rbac.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { buildDailyReport, currentShopDateKey } from "../../utils/dailyReport.js";
import {
  DAILY_REPORT_KEYS,
  type DailyReportConfig,
  formatSendTime,
  parseSendTime,
  readDailyReportConfig,
} from "../../utils/dailyReportConfig.js";
import { dailyReportSubject, renderDailyReportHtml, renderDailyReportText } from "../../utils/dailyReportEmail.js";
import { sendDailyReport } from "../../utils/dailyReportSender.js";
import { SMTP_KEYS, isEmail, mailConfigSummary, parseRecipients, verifyMailConnection } from "../../utils/mailer.js";
import { parseDateKey } from "../../utils/shopTime.js";
import { queryParamString } from "../../utils/queryParams.js";
import { logger } from "../../utils/logger.js";

/**
 * The nightly owner report: read the figures, see the exact email that will go out,
 * change when and to whom it goes, and send one on demand.
 *
 * Mounted under the reports router, which already applies `authMiddleware`.
 */
export const dailyReportRouter = Router();

/** `?date=YYYY-MM-DD`, defaulting to the shop's own today — not the server's UTC today. */
async function resolveDateKey(raw: string | undefined): Promise<string> {
  const requested = (raw ?? "").trim();
  if (!requested) return currentShopDateKey(prisma);
  if (!parseDateKey(requested)) {
    throw new AppError(400, "تاريخ غير صالح — الصيغة المطلوبة YYYY-MM-DD", "INVALID_DATE");
  }
  return requested;
}

/** What the settings screen reads. Never includes the SMTP password. */
async function publicConfig(config: DailyReportConfig) {
  return {
    enabled: config.enabled,
    time: config.time,
    recipients: config.recipients,
    timeZone: config.timeZone,
    lastSentDateKey: config.lastSentDateKey,
    smtp: await mailConfigSummary(prisma),
  };
}

dailyReportRouter.get(
  "/",
  requirePermission("reports.financial"),
  asyncHandler(async (req, res) => {
    const dateKey = await resolveDateKey(queryParamString(req.query, "date"));
    const report = await buildDailyReport(prisma, dateKey);
    res.status(200).json({ success: true, data: report });
  }),
);

/** The rendered email itself, so the settings screen can show exactly what will arrive. */
dailyReportRouter.get(
  "/preview",
  requirePermission("reports.financial"),
  asyncHandler(async (req, res) => {
    const dateKey = await resolveDateKey(queryParamString(req.query, "date"));
    const report = await buildDailyReport(prisma, dateKey);
    res.status(200).json({
      success: true,
      data: {
        dateKey,
        subject: dailyReportSubject(report),
        html: renderDailyReportHtml(report),
        text: renderDailyReportText(report),
      },
    });
  }),
);

dailyReportRouter.get(
  "/config",
  requirePermission("settings.view"),
  asyncHandler(async (_req, res) => {
    res.status(200).json({ success: true, data: await publicConfig(await readDailyReportConfig(prisma)) });
  }),
);

const configBody = z.object({
  enabled: z.boolean().optional(),
  /** `HH:mm` in shop time. */
  time: z.string().optional(),
  /** Comma/space separated, or a list. */
  recipients: z.union([z.string(), z.array(z.string())]).optional(),
  /**
   * Mail-server fields. `smtpPass` is write-only: omit it (or send "") to keep the
   * stored password untouched, which is what the UI does on every ordinary save —
   * it never receives the value, so it cannot echo it back.
   */
  smtpHost: z.string().optional(),
  smtpPort: z.string().optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().optional(),
  smtpPass: z.string().optional(),
  smtpFrom: z.string().optional(),
});

dailyReportRouter.patch(
  "/config",
  requirePermission("settings.manage"),
  validateBody(configBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof configBody>;
    const updates: Array<{ key: string; value: string }> = [];

    if (body.enabled !== undefined) {
      updates.push({ key: DAILY_REPORT_KEYS.enabled, value: body.enabled ? "true" : "false" });
    }
    if (body.time !== undefined) {
      const minutes = parseSendTime(body.time);
      if (minutes === null) throw new AppError(400, "وقت غير صالح — الصيغة المطلوبة HH:mm", "INVALID_TIME");
      updates.push({ key: DAILY_REPORT_KEYS.time, value: formatSendTime(minutes) });
    }
    if (body.recipients !== undefined) {
      const raw = Array.isArray(body.recipients) ? body.recipients.join(",") : body.recipients;
      const parsed = parseRecipients(raw);
      // An owner who mistypes one address should be told, not left thinking it saved.
      const supplied = raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
      if (supplied.length !== parsed.length) {
        throw new AppError(400, "أحد عناوين البريد غير صالح", "INVALID_EMAIL");
      }
      updates.push({ key: DAILY_REPORT_KEYS.emails, value: parsed.join(", ") });
    }

    if (body.smtpHost !== undefined) updates.push({ key: SMTP_KEYS.host, value: body.smtpHost.trim() });
    if (body.smtpUser !== undefined) updates.push({ key: SMTP_KEYS.user, value: body.smtpUser.trim() });
    if (body.smtpSecure !== undefined) {
      updates.push({ key: SMTP_KEYS.secure, value: body.smtpSecure ? "true" : "false" });
    }
    if (body.smtpPort !== undefined) {
      const port = Number(body.smtpPort.trim());
      if (body.smtpPort.trim() && (!Number.isInteger(port) || port < 1 || port > 65535)) {
        throw new AppError(400, "رقم المنفذ غير صالح", "INVALID_PORT");
      }
      updates.push({ key: SMTP_KEYS.port, value: body.smtpPort.trim() });
    }
    if (body.smtpFrom !== undefined) {
      const from = body.smtpFrom.trim();
      // Accept a bare address or the `Name <addr>` form, but reject free text —
      // a malformed From is rejected by the relay hours later, at 22:45.
      const bare = /<([^>]+)>\s*$/.exec(from)?.[1]?.trim() ?? from;
      if (from && !isEmail(bare)) {
        throw new AppError(400, "عنوان المُرسِل غير صالح", "INVALID_FROM");
      }
      updates.push({ key: SMTP_KEYS.from, value: from });
    }
    if (body.smtpPass !== undefined && body.smtpPass.length > 0) {
      // Gmail shows App Passwords in groups of four; strip the spaces so pasting
      // "abcd efgh ijkl mnop" works, which is how it lands on the clipboard.
      updates.push({ key: SMTP_KEYS.pass, value: body.smtpPass.replace(/\s+/g, "") });
    }

    if (updates.length > 0) {
      await prisma.$transaction(
        updates.map((u) =>
          prisma.setting.upsert({ where: { key: u.key }, update: { value: u.value }, create: u }),
        ),
      );
    }

    res.status(200).json({ success: true, data: await publicConfig(await readDailyReportConfig(prisma)) });
  }),
);

const sendBody = z.object({
  date: z.string().optional(),
  /** Override recipients for a one-off test; falls back to the configured list. */
  to: z.union([z.string(), z.array(z.string())]).optional(),
});

/**
 * Send one now. Deliberately does NOT stamp `daily_report_last_sent` — a test at
 * 3pm must not cancel that night's real report.
 */
dailyReportRouter.post(
  "/send",
  requirePermission("settings.manage"),
  validateBody(sendBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof sendBody>;
    const dateKey = await resolveDateKey(body.date);
    const config = await readDailyReportConfig(prisma);
    const override =
      body.to === undefined ? null : parseRecipients(Array.isArray(body.to) ? body.to.join(",") : body.to);
    const recipients = override && override.length > 0 ? override : config.recipients;

    if (recipients.length === 0) {
      throw new AppError(400, "لا يوجد بريد مستلِم — أضف عنواناً أولاً", "NO_RECIPIENTS");
    }

    try {
      await sendDailyReport(prisma, dateKey, recipients);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Manual daily report send failed", { error: message, dateKey });
      throw new AppError(502, `تعذّر إرسال البريد: ${message}`, "MAIL_SEND_FAILED");
    }

    res.status(200).json({ success: true, data: { dateKey, recipients } });
  }),
);

/** Handshake with the SMTP host so a wrong password surfaces here, not at 22:45. */
dailyReportRouter.post(
  "/verify-smtp",
  requirePermission("settings.manage"),
  asyncHandler(async (_req, res) => {
    try {
      await verifyMailConnection(prisma);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new AppError(502, `تعذّر الاتصال بخادم البريد: ${message}`, "SMTP_VERIFY_FAILED");
    }
    res.status(200).json({ success: true, data: await mailConfigSummary(prisma) });
  }),
);
