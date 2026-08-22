import { PrismaClient } from "@prisma/client";
import { rollStatusFor } from "../src/utils/fabricRollStatus.js";

/**
 * Recompute `FabricRoll.status` from what is actually left on each roll.
 *
 * The column was stamped "FULL" when the roll was created and never written
 * again, while `availableMeters` kept moving — so an empty roll still reads as
 * full. The API now keeps the two in step on every movement; this brings the
 * rows that already drifted back in line.
 *
 * Derived and therefore idempotent: it computes the same value every run and
 * only writes rows whose stored status disagrees.
 *
 * Usage:
 *   tsx apps/api/prisma/backfill-fabric-roll-status.ts --dry-run
 *   tsx apps/api/prisma/backfill-fabric-roll-status.ts
 */

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  const rolls = await prisma.fabricRoll.findMany({
    select: { id: true, rollCode: true, availableMeters: true, lowStockAt: true, status: true },
    orderBy: { rollCode: "asc" },
  });

  const stale = rolls
    .map((r) => ({ ...r, next: rollStatusFor(r.availableMeters, r.lowStockAt) }))
    .filter((r) => r.next !== r.status);

  console.log(`${rolls.length} rolls, ${stale.length} with a stale status.`);
  for (const r of stale) {
    console.log(`  ${r.rollCode}: ${r.status} → ${r.next}  (${r.availableMeters}m left, low at ${r.lowStockAt}m)`);
  }

  if (dryRun) {
    console.log("\nDry run — nothing written.");
    return;
  }
  if (stale.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  for (const r of stale) {
    await prisma.fabricRoll.update({ where: { id: r.id }, data: { status: r.next } });
  }
  console.log(`\nUpdated ${stale.length} rolls.`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
