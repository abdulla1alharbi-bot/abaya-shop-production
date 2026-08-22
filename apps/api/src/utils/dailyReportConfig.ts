import type { PrismaClient } from "@prisma/client";
import { getShopTimezone } from "../config/shop.js";
import { parseRecipients } from "./mailer.js";

/** Owner-editable knobs for the nightly report. Credentials are NOT here — see `mailer.ts`. */
export const DAILY_REPORT_KEYS = {
  enabled: "daily_report_enabled",
  time: "daily_report_time",
  emails: "daily_report_emails",
  /** Written by the scheduler: the last shop-local day it successfully sent for. */
  lastSent: "daily_report_last_sent",
} as const;

/** The shop closes at 22:30, so the default fires once the till is settled. */
export const DEFAULT_SEND_TIME = "22:45";

export type DailyReportConfig = {
  enabled: boolean;
  /** `HH:mm` in shop time. */
  time: string;
  minutesSinceMidnight: number;
  recipients: string[];
  timeZone: string;
  lastSentDateKey: string | null;
};

const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** `HH:mm` → minutes past midnight, or null when unparseable/out of range. */
export function parseSendTime(raw: string | null | undefined): number | null {
  const m = TIME_RE.exec((raw ?? "").trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** `HH:mm`, zero-padded — the canonical form stored in settings. */
export function formatSendTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export async function readDailyReportConfig(db: PrismaClient): Promise<DailyReportConfig> {
  const [rows, timeZone] = await Promise.all([
    db.setting.findMany({ where: { key: { in: Object.values(DAILY_REPORT_KEYS) } } }),
    getShopTimezone(db),
  ]);
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const minutes = parseSendTime(byKey.get(DAILY_REPORT_KEYS.time)) ?? parseSendTime(DEFAULT_SEND_TIME)!;
  return {
    enabled: byKey.get(DAILY_REPORT_KEYS.enabled) === "true",
    time: formatSendTime(minutes),
    minutesSinceMidnight: minutes,
    recipients: parseRecipients(byKey.get(DAILY_REPORT_KEYS.emails)),
    timeZone,
    lastSentDateKey: byKey.get(DAILY_REPORT_KEYS.lastSent) ?? null,
  };
}

export async function markDailyReportSent(db: PrismaClient, dateKey: string): Promise<void> {
  await db.setting.upsert({
    where: { key: DAILY_REPORT_KEYS.lastSent },
    update: { value: dateKey },
    create: { key: DAILY_REPORT_KEYS.lastSent, value: dateKey },
  });
}
