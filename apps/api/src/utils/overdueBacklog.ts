import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { IMPOSSIBLE_DUE_BEFORE, dueBoundary } from "./jobUrgency.js";

/**
 * "Why are 888 pieces late?"
 *
 * The dashboard could only say how many were overdue and list the first hundred,
 * which is useless once the backlog is in the hundreds — the owner cannot act on a
 * number, only on a reason. Production told the real story: two thirds of the
 * backlog had NO recorded workshop work at all, while the pieces sitting in
 * INSPECTION were all actively worked and recent. Those are different problems and
 * they need different answers, so every row is classified here.
 *
 * Lateness itself is defined once in `jobUrgency.ts`; this module reuses the exact
 * same predicate so the breakdown always adds up to the badge.
 */

/** No work recorded and nothing touched for this long = abandoned, not queued. */
const STALLED_AFTER_DAYS = 30;

export const OVERDUE_REASONS = [
  /** Due date is a data-entry error — excluded from "oldest late" so it stops skewing it. */
  "badDueDate",
  /** Every workshop stage done, waiting on quality check. */
  "awaitingQa",
  /** Nothing recorded and untouched for over a month — almost certainly dead. */
  "stalled",
  /** Nothing recorded yet, but recently touched — a genuine queue. */
  "notStarted",
  /** Some stages complete, still moving. */
  "inProgress",
] as const;
export type OverdueReason = (typeof OVERDUE_REASONS)[number];

export const AGE_BUCKETS = ["badDate", "over90", "d31to90", "d8to30", "under7"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

const EFFECTIVE_DUE = Prisma.sql`COALESCE(i."deliveryDate", j."dueDate")`;

/**
 * Every overdue job, with the facts each classification needs. Kept as one CTE so
 * the summary and the row list can never disagree about who is in the set.
 */
function overdueCte(startOfToday: Date, stalledCutoff: Date): Prisma.Sql {
  return Prisma.sql`
    WITH overdue AS (
      SELECT
        j."id"              AS job_id,
        j."jobNo"           AS job_no,
        j."stage"           AS stage,
        j."productStyle"    AS product_style,
        j."updatedAt"       AS updated_at,
        ii."description"    AS piece_description,
        ${EFFECTIVE_DUE}    AS due,
        i."id"              AS invoice_id,
        i."invoiceNo"       AS invoice_no,
        i."totalFils"       AS total_fils,
        i."balanceFils"     AS balance_fils,
        c."name"            AS customer_name,
        c."mobile"          AS customer_mobile,
        COALESCE(ws.done, 0) AS stages_done,
        CASE
          WHEN ${EFFECTIVE_DUE} < ${dueBoundary(IMPOSSIBLE_DUE_BEFORE)} THEN 'badDueDate'
          WHEN j."stage" = 'INSPECTION' THEN 'awaitingQa'
          WHEN COALESCE(ws.done, 0) = 0 AND j."updatedAt" < ${dueBoundary(stalledCutoff)} THEN 'stalled'
          WHEN COALESCE(ws.done, 0) = 0 THEN 'notStarted'
          ELSE 'inProgress'
        END AS reason
      FROM "JobOrder" j
      JOIN "Invoice"  i  ON i."id" = j."invoiceId"
      JOIN "Customer" c  ON c."id" = j."customerId"
      LEFT JOIN "InvoiceItem" ii ON ii."id" = j."invoiceItemId"
      LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE w."isCompleted") AS done
        FROM "JobOrderWorkStage" w
        WHERE w."jobOrderId" = j."id"
      ) ws ON TRUE
      WHERE j."stage" NOT IN ('READY', 'DELIVERED', 'CONVERTED_TO_READY', 'CANCELLED')
        AND j."deliveredAt" IS NULL
        AND i."isVoid" = false
        AND i."deliveredAt" IS NULL
        AND ${EFFECTIVE_DUE} < ${dueBoundary(startOfToday)}
    )
  `;
}

export type OverdueGroup = {
  key: string;
  count: number;
  valueFils: number;
  unpaidFils: number;
};

export type OverdueSummary = {
  total: number;
  valueFils: number;
  /** Still owed on those invoices. */
  unpaidFils: number;
  /** Already collected for work not delivered — the figure that should worry an owner. */
  prepaidFils: number;
  /** Days late for the oldest piece, ignoring impossible dates. */
  oldestDays: number;
  byReason: OverdueGroup[];
  byStage: OverdueGroup[];
  byAge: OverdueGroup[];
};

type GroupRow = { key: string; count: bigint | number; value: bigint | number | null; unpaid: bigint | number | null };

function toGroups(rows: GroupRow[]): OverdueGroup[] {
  return rows
    .map((r) => ({
      key: r.key,
      count: Number(r.count),
      valueFils: Number(r.value ?? 0),
      unpaidFils: Number(r.unpaid ?? 0),
    }))
    .sort((a, b) => b.count - a.count);
}

export async function summarizeOverdueBacklog(
  db: PrismaClient,
  startOfToday: Date,
): Promise<OverdueSummary> {
  const stalledCutoff = new Date(startOfToday.getTime() - STALLED_AFTER_DAYS * 86_400_000);
  const cte = overdueCte(startOfToday, stalledCutoff);

  const [totals, byReason, byStage, byAge] = await Promise.all([
    db.$queryRaw<{ total: bigint; value: bigint | null; unpaid: bigint | null; oldest: Date | null }[]>(Prisma.sql`
      ${cte}
      SELECT COUNT(*) AS total,
             SUM(total_fils) AS value,
             SUM(balance_fils) AS unpaid,
             MIN(due) FILTER (WHERE reason <> 'badDueDate') AS oldest
      FROM overdue
    `),
    db.$queryRaw<GroupRow[]>(Prisma.sql`
      ${cte}
      SELECT reason AS key, COUNT(*) AS count, SUM(total_fils) AS value, SUM(balance_fils) AS unpaid
      FROM overdue GROUP BY reason
    `),
    db.$queryRaw<GroupRow[]>(Prisma.sql`
      ${cte}
      SELECT stage AS key, COUNT(*) AS count, SUM(total_fils) AS value, SUM(balance_fils) AS unpaid
      FROM overdue GROUP BY stage
    `),
    db.$queryRaw<GroupRow[]>(Prisma.sql`
      ${cte}
      SELECT CASE
               WHEN reason = 'badDueDate' THEN 'badDate'
               WHEN due < ${dueBoundary(startOfToday)} - INTERVAL '90 days' THEN 'over90'
               WHEN due < ${dueBoundary(startOfToday)} - INTERVAL '30 days' THEN 'd31to90'
               WHEN due < ${dueBoundary(startOfToday)} - INTERVAL '7 days'  THEN 'd8to30'
               ELSE 'under7'
             END AS key,
             COUNT(*) AS count, SUM(total_fils) AS value, SUM(balance_fils) AS unpaid
      FROM overdue GROUP BY 1
    `),
  ]);

  const row = totals[0];
  const valueFils = Number(row?.value ?? 0);
  const unpaidFils = Number(row?.unpaid ?? 0);
  const oldest = row?.oldest ? new Date(row.oldest) : null;

  return {
    total: Number(row?.total ?? 0),
    valueFils,
    unpaidFils,
    prepaidFils: Math.max(0, valueFils - unpaidFils),
    oldestDays: oldest
      ? Math.max(
          0,
          Math.round(
            (startOfToday.getTime() -
              new Date(oldest.getFullYear(), oldest.getMonth(), oldest.getDate()).getTime()) /
              86_400_000,
          ),
        )
      : 0,
    byReason: toGroups(byReason),
    byStage: toGroups(byStage),
    byAge: toGroups(byAge),
  };
}

export type OverdueRow = {
  jobId: string;
  jobNo: number;
  invoiceId: string;
  invoiceNo: number;
  customerName: string;
  customerMobile: string;
  piece: string;
  stage: string;
  reason: OverdueReason;
  daysLate: number;
  due: string;
  stagesDone: number;
  totalFils: number | null;
  balanceFils: number | null;
};

export type OverdueRowsQuery = {
  reason?: string;
  stage?: string;
  search?: string;
  page: number;
  limit: number;
  /** Workers must not see invoice money. */
  hideMoney: boolean;
};

/**
 * One page of the backlog. Paginated rather than capped: a silent `LIMIT 100` is
 * what made the old dialog claim 888 and show 100, which reads as a broken screen.
 */
export async function findOverdueJobs(
  db: PrismaClient,
  startOfToday: Date,
  query: OverdueRowsQuery,
): Promise<{ items: OverdueRow[]; total: number }> {
  const stalledCutoff = new Date(startOfToday.getTime() - STALLED_AFTER_DAYS * 86_400_000);
  const cte = overdueCte(startOfToday, stalledCutoff);

  const filters: Prisma.Sql[] = [];
  if (query.reason && (OVERDUE_REASONS as readonly string[]).includes(query.reason)) {
    filters.push(Prisma.sql`reason = ${query.reason}`);
  }
  if (query.stage) filters.push(Prisma.sql`stage = ${query.stage}`);
  if (query.search?.trim()) {
    const like = `%${query.search.trim()}%`;
    const asNumber = Number(query.search.trim());
    filters.push(
      Prisma.sql`(
        customer_name ILIKE ${like}
        OR customer_mobile ILIKE ${like}
        OR ${Number.isFinite(asNumber) ? Prisma.sql`invoice_no = ${Math.trunc(asNumber)}` : Prisma.sql`false`}
      )`,
    );
  }
  const where = filters.length > 0 ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}` : Prisma.empty;

  const offset = (query.page - 1) * query.limit;

  const [countRows, rows] = await Promise.all([
    db.$queryRaw<{ total: bigint }[]>(Prisma.sql`${cte} SELECT COUNT(*) AS total FROM overdue ${where}`),
    db.$queryRaw<
      {
        job_id: string;
        job_no: number;
        invoice_id: string;
        invoice_no: number;
        customer_name: string;
        customer_mobile: string;
        piece_description: string | null;
        product_style: string;
        stage: string;
        reason: OverdueReason;
        due: Date;
        stages_done: bigint | number;
        total_fils: number;
        balance_fils: number;
      }[]
    >(Prisma.sql`
      ${cte}
      SELECT job_id, job_no, invoice_id, invoice_no, customer_name, customer_mobile,
             piece_description, product_style, stage, reason, due, stages_done,
             total_fils, balance_fils
      FROM overdue
      ${where}
      -- Longest overdue first, but impossible dates last: they are data errors, not
      -- the most urgent work, and they would otherwise own the top of every page.
      ORDER BY (reason = 'badDueDate') ASC, due ASC, invoice_no ASC
      LIMIT ${query.limit} OFFSET ${offset}
    `),
  ]);

  return {
    total: Number(countRows[0]?.total ?? 0),
    items: rows.map((r) => {
      const due = new Date(r.due);
      const dueMidnight = new Date(due.getFullYear(), due.getMonth(), due.getDate());
      return {
        jobId: r.job_id,
        jobNo: r.job_no,
        invoiceId: r.invoice_id,
        invoiceNo: r.invoice_no,
        customerName: r.customer_name,
        customerMobile: r.customer_mobile,
        piece: r.piece_description?.trim() || r.product_style,
        stage: r.stage,
        reason: r.reason,
        daysLate:
          r.reason === "badDueDate"
            ? 0
            : Math.max(0, Math.round((startOfToday.getTime() - dueMidnight.getTime()) / 86_400_000)),
        due: due.toISOString(),
        stagesDone: Number(r.stages_done),
        totalFils: query.hideMoney ? null : r.total_fils,
        balanceFils: query.hideMoney ? null : r.balance_fils,
      };
    }),
  };
}
