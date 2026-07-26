import type { Prisma, PrismaClient } from "@prisma/client";
import { getCustomerFacingShopName } from "../config/shop.js";
import { invoiceTailoringReadyWhere } from "./invoiceFulfillment.js";

/**
 * The daily "who do we message today" queue.
 *
 * The shop has no automated messaging — a human opens WhatsApp and types. What was
 * missing was not the sending, it was knowing WHO is owed a message right now, so
 * ready pieces sat uncollected for weeks. This builds that list and nothing more.
 */

/** "Your order is ready to collect." */
export const NOTICE_KIND_READY = "READY";
/** "You still owe us money." */
export const NOTICE_KIND_BALANCE = "BALANCE";
export const NOTICE_KINDS = [NOTICE_KIND_READY, NOTICE_KIND_BALANCE] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/**
 * Prisma fragment for "nobody has told this customer her order is ready".
 * Payment chases carry kind=BALANCE and deliberately do NOT satisfy it — otherwise
 * chasing a debt would silently mark the order as announced.
 */
export function noReadyNoticeWhere(): Prisma.InvoiceWhereInput {
  return { customerNotices: { none: { kind: NOTICE_KIND_READY } } };
}

/** How long to wait before the same customer resurfaces for another reminder. */
export const DEFAULT_REMINDER_DAYS = 2;
export const MAX_REMINDER_DAYS = 60;

/**
 * Don't chase a bill the customer incurred hours ago — she has only just walked out
 * of the shop. Readiness messages have no such grace: those are good news.
 */
const BALANCE_GRACE_MS = 24 * 60 * 60 * 1000;

/** Per group. Beyond this the UI says "showing the oldest N" rather than lying by omission. */
const GROUP_LIMIT = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

export type MessageQueueRow = {
  invoiceId: string;
  invoiceNo: number;
  customer: { id: string; name: string; mobile: string; whatsapp: string | null };
  totalFils: number;
  balanceFils: number;
  /** Tailoring pieces on the invoice (0 for a pure retail sale). */
  pieceCount: number;
  /** READY: when the last piece was finished. BALANCE: when the invoice was raised. */
  since: string | null;
  /** Whole days since `since`. Drives the "waiting 12 days" urgency colour. */
  daysWaiting: number;
  /** Times this customer was already contacted for THIS reason on THIS invoice. */
  noticeCount: number;
  lastNoticeAt: string | null;
  lastNoticeBy: string | null;
};

export type MessageQueue = {
  reminderDays: number;
  /** Signed onto every message. Null when the shop never set a name — line is dropped. */
  shopName: string | null;
  ready: { rows: MessageQueueRow[]; total: number; valueFils: number; truncated: boolean };
  balance: { rows: MessageQueueRow[]; total: number; valueFils: number; truncated: boolean };
};

const rowSelect = {
  id: true,
  invoiceNo: true,
  totalFils: true,
  balanceFils: true,
  readyAt: true,
  deliveredAt: true,
  createdAt: true,
  customer: { select: { id: true, name: true, mobile: true, whatsapp: true } },
  jobOrders: { select: { id: true } },
} satisfies Prisma.InvoiceSelect;

type RawRow = Prisma.InvoiceGetPayload<{ select: typeof rowSelect }>;

type NoticeSummary = { count: number; lastAt: Date | null; lastBy: string | null };

/**
 * Count + latest contact per invoice, in one query for the whole page rather than an
 * include per row — the queue is read on every visit. Rows per invoice are a handful
 * (one per reminder actually sent), so fetching them all is cheaper than two passes.
 */
async function summarizeNotices(
  db: PrismaClient,
  invoiceIds: string[],
  kind: NoticeKind,
): Promise<Map<string, NoticeSummary>> {
  const out = new Map<string, NoticeSummary>();
  if (invoiceIds.length === 0) return out;

  const notices = await db.invoiceCustomerNotice.findMany({
    where: { invoiceId: { in: invoiceIds }, kind },
    orderBy: { createdAt: "desc" },
    select: { invoiceId: true, createdAt: true, user: { select: { name: true } } },
  });

  // Newest-first, so the first row seen for an invoice is its latest contact.
  for (const n of notices) {
    const entry = out.get(n.invoiceId);
    if (entry) {
      entry.count += 1;
    } else {
      out.set(n.invoiceId, { count: 1, lastAt: n.createdAt, lastBy: n.user?.name ?? null });
    }
  }
  return out;
}

function toRow(inv: RawRow, since: Date | null, notices: NoticeSummary | undefined, now: number): MessageQueueRow {
  // customerId is filtered non-null by both queries, so `customer` is always present here.
  const c = inv.customer!;
  return {
    invoiceId: inv.id,
    invoiceNo: inv.invoiceNo,
    customer: { id: c.id, name: c.name, mobile: c.mobile, whatsapp: c.whatsapp },
    totalFils: inv.totalFils,
    balanceFils: inv.balanceFils,
    pieceCount: inv.jobOrders.length,
    since: since ? since.toISOString() : null,
    daysWaiting: since ? Math.max(0, Math.floor((now - since.getTime()) / DAY_MS)) : 0,
    noticeCount: notices?.count ?? 0,
    lastNoticeAt: notices?.lastAt ? notices.lastAt.toISOString() : null,
    lastNoticeBy: notices?.lastBy ?? null,
  };
}

function clampDays(reminderDays: number): number {
  return Math.min(MAX_REMINDER_DAYS, Math.max(0, Math.floor(reminderDays)));
}

/** The two group filters, shared by the full queue and the cheap badge count. */
function queueFilters(days: number, now: number): {
  readyWhere: Prisma.InvoiceWhereInput;
  balanceWhere: Prisma.InvoiceWhereInput;
} {
  const quietCutoff = new Date(now - days * DAY_MS);
  const balanceGraceCutoff = new Date(now - BALANCE_GRACE_MS);
  return {
    /**
     * Every piece finished, not handed over, and not contacted about readiness within
     * the quiet window. A never-contacted invoice satisfies this too — it has no READY
     * notice at all, let alone a recent one.
     */
    readyWhere: {
      ...invoiceTailoringReadyWhere(),
      customerId: { not: null },
      customerNotices: { none: { kind: NOTICE_KIND_READY, createdAt: { gt: quietCutoff } } },
    },
    /** Customer already has the goods and still owes: collected order, or a retail sale. */
    balanceWhere: {
      isVoid: false,
      balanceFils: { gt: 0 },
      customerId: { not: null },
      OR: [
        { deliveredAt: { lte: balanceGraceCutoff } },
        { AND: [{ jobOrders: { none: {} } }, { createdAt: { lte: balanceGraceCutoff } }] },
      ],
      customerNotices: { none: { kind: NOTICE_KIND_BALANCE, createdAt: { gt: quietCutoff } } },
    },
  };
}

/** Just how many people are owed a message — for the sidebar badge, which polls. */
export async function countCustomerMessageQueue(
  db: PrismaClient,
  reminderDays: number = DEFAULT_REMINDER_DAYS,
): Promise<number> {
  const { readyWhere, balanceWhere } = queueFilters(clampDays(reminderDays), Date.now());
  const [ready, balance] = await Promise.all([
    db.invoice.count({ where: readyWhere }),
    db.invoice.count({ where: balanceWhere }),
  ]);
  return ready + balance;
}

export async function buildCustomerMessageQueue(
  db: PrismaClient,
  reminderDays: number = DEFAULT_REMINDER_DAYS,
): Promise<MessageQueue> {
  const days = clampDays(reminderDays);
  const now = Date.now();
  const { readyWhere, balanceWhere } = queueFilters(days, now);

  const [shopName, readyTotal, readyRaw, readyAgg, balanceTotal, balanceRaw, balanceAgg] = await Promise.all([
    getCustomerFacingShopName(db),
    db.invoice.count({ where: readyWhere }),
    db.invoice.findMany({
      where: readyWhere,
      select: rowSelect,
      // Longest-waiting first: those are the ones about to become dead stock.
      orderBy: [{ readyAt: "asc" }, { createdAt: "asc" }],
      take: GROUP_LIMIT,
    }),
    db.invoice.aggregate({ where: readyWhere, _sum: { totalFils: true } }),
    db.invoice.count({ where: balanceWhere }),
    db.invoice.findMany({
      where: balanceWhere,
      select: rowSelect,
      // Oldest debt first — the standard collections order.
      orderBy: { createdAt: "asc" },
      take: GROUP_LIMIT,
    }),
    db.invoice.aggregate({ where: balanceWhere, _sum: { balanceFils: true } }),
  ]);

  const [readyNotices, balanceNotices] = await Promise.all([
    summarizeNotices(db, readyRaw.map((r) => r.id), NOTICE_KIND_READY),
    summarizeNotices(db, balanceRaw.map((r) => r.id), NOTICE_KIND_BALANCE),
  ]);

  return {
    reminderDays: days,
    shopName,
    ready: {
      rows: readyRaw.map((inv) => toRow(inv, inv.readyAt, readyNotices.get(inv.id), now)),
      total: readyTotal,
      valueFils: readyAgg._sum.totalFils ?? 0,
      truncated: readyTotal > readyRaw.length,
    },
    balance: {
      // Aged from the invoice date, which is when the debt started and also what the
      // list is ordered by — ageing from delivery instead would make the rows look
      // unsorted. (Delivery only gates the 24h grace, in `queueFilters`.)
      rows: balanceRaw.map((inv) => toRow(inv, inv.createdAt, balanceNotices.get(inv.id), now)),
      total: balanceTotal,
      valueFils: balanceAgg._sum.balanceFils ?? 0,
      truncated: balanceTotal > balanceRaw.length,
    },
  };
}
