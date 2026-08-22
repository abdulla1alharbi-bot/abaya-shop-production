import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/** Values `FabricRoll.status` can hold. */
export const ROLL_STATUS = {
  full: "FULL",
  low: "LOW",
  empty: "EMPTY",
} as const;

/**
 * Status a roll should be in, given what is physically left on it.
 *
 * `availableMeters` moves through atomic increments in six places, and none of
 * them used to touch `status` — it was stamped "FULL" at creation and never
 * written again, so a roll with nothing left still read as full. Nothing in the
 * app displayed it (the roll list shows `isActive`), which is exactly why the
 * drift went unnoticed.
 */
export function rollStatusFor(availableMeters: number, lowStockAt: number): string {
  if (availableMeters <= 0) return ROLL_STATUS.empty;
  if (availableMeters <= lowStockAt) return ROLL_STATUS.low;
  return ROLL_STATUS.full;
}

/**
 * Bring a roll's stored status in line with the row that was just written.
 *
 * Takes the row returned by the update rather than re-reading it, and writes
 * only when the status actually changed — which is rare, so the common path
 * costs nothing.
 */
export async function syncRollStatus(
  db: Db,
  row: { id: string; availableMeters: number; lowStockAt: number; status: string },
): Promise<void> {
  const next = rollStatusFor(row.availableMeters, row.lowStockAt);
  if (next === row.status) return;
  await db.fabricRoll.update({ where: { id: row.id }, data: { status: next } });
}
