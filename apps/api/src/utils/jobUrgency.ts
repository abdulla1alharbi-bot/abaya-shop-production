import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

/**
 * Single source of truth for "is this job late?".
 *
 * Before this module three endpoints answered that question with three different
 * filters, so the dashboard could show three different overdue counts at once.
 * Everything that reports lateness must go through here.
 */

/** Workshop work is finished — the piece exists, nobody is waiting on a tailor. */
export const JOB_FINISHED_STAGES = ["READY", "DELIVERED", "CONVERTED_TO_READY"] as const;

/** Finished *or* abandoned. A cancelled job can never be "late". */
export const JOB_INACTIVE_STAGES = [...JOB_FINISHED_STAGES, "CANCELLED"] as const;

/**
 * The set of jobs a customer is actually waiting on: attached to a live invoice,
 * not handed over, and still needing workshop work.
 *
 * Jobs with no invoice are internal stock production — no customer was promised a
 * date, so they are deliberately out of scope for every lateness figure.
 */
export function pendingCustomerJobsWhere(): Prisma.JobOrderWhereInput {
  return {
    invoiceId: { not: null },
    stage: { notIn: [...JOB_INACTIVE_STAGES] },
    deliveredAt: null,
    invoice: { isVoid: false, deliveredAt: null },
  };
}

/**
 * The date that counts is the one promised to the customer on the invoice; the
 * internal job due date is only a fallback when the invoice has none. Mirrors the
 * `effectiveDue` used to sort the pending-tailoring list.
 */
const EFFECTIVE_DUE = Prisma.sql`COALESCE(i."deliveryDate", j."dueDate")`;

const PENDING_JOBS_FROM = Prisma.sql`
  FROM "JobOrder" j
  JOIN "Invoice" i ON i."id" = j."invoiceId"
  WHERE j."stage" NOT IN (${Prisma.join([...JOB_INACTIVE_STAGES])})
    AND j."deliveredAt" IS NULL
    AND i."isVoid" = false
    AND i."deliveredAt" IS NULL
`;

export interface PendingJobsSummary {
  overdueCount: number;
  dueTodayCount: number;
  inProgressCount: number;
}

/**
 * Bucket every pending job by urgency in one pass. Counted in SQL rather than in JS
 * so the totals stay correct even when the caller only renders the first N rows.
 */
export async function summarizePendingJobs(
  db: PrismaClient,
  startOfToday: Date,
  endOfTodayExclusive: Date,
): Promise<PendingJobsSummary> {
  const rows = await db.$queryRaw<{ overdue: number; due_today: number; future: number }[]>(Prisma.sql`
    SELECT
      COUNT(*) FILTER (WHERE ${EFFECTIVE_DUE} < ${startOfToday})::int AS overdue,
      COUNT(*) FILTER (
        WHERE ${EFFECTIVE_DUE} >= ${startOfToday} AND ${EFFECTIVE_DUE} < ${endOfTodayExclusive}
      )::int AS due_today,
      COUNT(*) FILTER (WHERE ${EFFECTIVE_DUE} >= ${endOfTodayExclusive})::int AS future
    ${PENDING_JOBS_FROM}
  `);
  const row = rows[0];
  return {
    overdueCount: Number(row?.overdue ?? 0),
    dueTodayCount: Number(row?.due_today ?? 0),
    inProgressCount: Number(row?.future ?? 0),
  };
}

/** How many days late the oldest pending job is — 0 when nothing is late. */
export async function oldestOverdueDays(db: PrismaClient, startOfToday: Date): Promise<number> {
  const rows = await db.$queryRaw<{ due: Date | null }[]>(Prisma.sql`
    SELECT MIN(${EFFECTIVE_DUE}) AS due
    ${PENDING_JOBS_FROM}
      AND ${EFFECTIVE_DUE} < ${startOfToday}
  `);
  const due = rows[0]?.due;
  if (!due) return 0;
  // Calendar days, not elapsed 24 h blocks: a piece promised for the 3rd is "3 days
  // late" on the 6th, whatever hour of the 3rd was on the invoice.
  const d = new Date(due);
  const dueMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.max(0, Math.round((startOfToday.getTime() - dueMidnight.getTime()) / 86_400_000));
}
