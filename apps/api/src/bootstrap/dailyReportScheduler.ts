import { prisma } from "../config/db.js";
import { markDailyReportSent, readDailyReportConfig } from "../utils/dailyReportConfig.js";
import { sendDailyReport } from "../utils/dailyReportSender.js";
import { isMailConfigured } from "../utils/mailer.js";
import { shopWallClock } from "../utils/shopTime.js";
import { logger } from "../utils/logger.js";

/**
 * Fires the end-of-day report once per shop-local day.
 *
 * A plain in-process timer rather than a cron container: the API is a single
 * always-on process, and an external cron would need its own copy of the DB
 * credentials. The tick re-reads settings every minute, so changing the time or
 * the recipient list in the app takes effect without a redeploy.
 *
 * "Once per day" is enforced by the `daily_report_last_sent` setting, not by
 * matching the clock exactly — matching HH:mm exactly would silently skip the
 * whole day whenever the container happened to be restarting at that minute.
 * Instead any tick AFTER the configured time sends, if today hasn't been sent yet.
 */

const TICK_MS = 60_000;

let timer: NodeJS.Timeout | null = null;
let inFlight = false;
/**
 * Day already complained about. A misconfiguration cannot be marked "sent", so
 * without this the same warning would repeat every tick until midnight.
 */
let warnedForDateKey: string | null = null;

/**
 * Failed sends are retried on the next tick, but not forever: a wrong SMTP password
 * would otherwise mean ~75 rejected logins a night, which is exactly the pattern
 * Google treats as abuse. After this many tries the day is abandoned, loudly.
 */
const MAX_ATTEMPTS_PER_DAY = 5;
let attempts = { dateKey: "", count: 0 };

async function tick(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const config = await readDailyReportConfig(prisma);
    if (!config.enabled) return;

    const now = shopWallClock(config.timeZone);
    if (config.lastSentDateKey === now.dateKey) return;
    if (now.minutesSinceMidnight < config.minutesSinceMidnight) return;

    const blocker = !(await isMailConfigured(prisma))
      ? "SMTP is not configured"
      : config.recipients.length === 0
        ? "no recipients are set"
        : null;
    if (blocker) {
      if (warnedForDateKey !== now.dateKey) {
        warnedForDateKey = now.dateKey;
        logger.warn(`Daily report is enabled but ${blocker} — skipping`, { dateKey: now.dateKey });
      }
      return;
    }

    if (attempts.dateKey !== now.dateKey) attempts = { dateKey: now.dateKey, count: 0 };
    if (attempts.count >= MAX_ATTEMPTS_PER_DAY) return;
    attempts.count += 1;

    await sendDailyReport(prisma, now.dateKey, config.recipients);
    await markDailyReportSent(prisma, now.dateKey);
    logger.info("Daily report emailed", {
      dateKey: now.dateKey,
      recipients: config.recipients.length,
      scheduledFor: config.time,
      timeZone: config.timeZone,
      attempt: attempts.count,
    });
  } catch (err: unknown) {
    // Deliberately do NOT mark the day as sent — the next tick retries in a minute,
    // up to MAX_ATTEMPTS_PER_DAY. Transient SMTP hiccups recover; a bad password
    // gives up after five tries and says so.
    const giveUp = attempts.count >= MAX_ATTEMPTS_PER_DAY;
    logger.error(`Daily report send failed${giveUp ? " — giving up for today" : ", will retry"}`, {
      error: err instanceof Error ? err.message : String(err),
      attempt: attempts.count,
      maxAttempts: MAX_ATTEMPTS_PER_DAY,
    });
  } finally {
    inFlight = false;
  }
}

export function startDailyReportScheduler(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  // Don't hold the process open on shutdown for a timer that has nothing pending.
  timer.unref();
  logger.info("Daily report scheduler started", { intervalMs: TICK_MS });
  void tick();
}

export function stopDailyReportScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
