import type { PrismaClient } from "@prisma/client";
import { type DailyReport, buildDailyReport } from "./dailyReport.js";
import { dailyReportSubject, renderDailyReportHtml, renderDailyReportText } from "./dailyReportEmail.js";
import { isMailConfigured, sendMail } from "./mailer.js";

export type SendDailyReportResult = {
  dateKey: string;
  recipients: string[];
  report: DailyReport;
};

/**
 * Build the report for `dateKey` and email it. Shared by the nightly scheduler and
 * the "send me one now" button, so a test send is byte-for-byte the real thing —
 * a preview that renders differently from the 22:45 mail is not a test.
 */
export async function sendDailyReport(
  db: PrismaClient,
  dateKey: string,
  recipients: string[],
): Promise<SendDailyReportResult> {
  if (!isMailConfigured()) throw new Error("SMTP is not configured (set SMTP_HOST and SMTP_FROM)");
  if (recipients.length === 0) throw new Error("No recipients configured");

  const report = await buildDailyReport(db, dateKey);
  await sendMail({
    to: recipients,
    subject: dailyReportSubject(report),
    html: renderDailyReportHtml(report),
    text: renderDailyReportText(report),
  });
  return { dateKey, recipients, report };
}
