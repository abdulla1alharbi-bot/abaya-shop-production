import { PrismaClient } from "@prisma/client";

/**
 * Backfill `AbayaModel.createdAt` from the timestamp inside each row's cuid.
 *
 * Adding the column stamps every existing row with the migration instant, which
 * would make "newest first" a meaningless tie across the whole catalog. Every id in
 * this table is a cuid v1 — `c` followed by the creation time in base36 — so the
 * real dates are already sitting in the primary key. Decoding them gives an ordering
 * that matches how the catalog actually grew.
 *
 * Deterministic and therefore idempotent: it always writes the decoded value, so
 * re-running changes nothing. Rows whose id is not a cuid v1, or whose decoded time
 * is implausible, are left alone and reported.
 *
 * Usage:
 *   tsx apps/api/prisma/backfill-abaya-model-created-at.ts --dry-run
 *   tsx apps/api/prisma/backfill-abaya-model-created-at.ts
 */

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");

/** cuid v1: 'c' + 8 base36 chars of epoch millis + counter + fingerprint + random. */
const CUID_V1 = /^c[a-z0-9]{24}$/;
/** Nothing in this shop predates the project; anything outside is a bad decode. */
const PLAUSIBLE_FROM = new Date("2024-01-01T00:00:00.000Z").getTime();

function createdAtFromCuid(id: string): Date | null {
  if (!CUID_V1.test(id)) return null;
  const ms = parseInt(id.slice(1, 9), 36);
  if (!Number.isFinite(ms) || ms < PLAUSIBLE_FROM || ms > Date.now()) return null;
  return new Date(ms);
}

async function main(): Promise<void> {
  console.log(DRY_RUN ? "=== DRY RUN — nothing will be written ===" : "=== APPLYING ===");

  const models = await prisma.abayaModel.findMany({
    select: { id: true, code: true, name: true, createdAt: true },
  });
  console.log(`models: ${models.length}`);

  let updated = 0;
  let unchanged = 0;
  const skipped: string[] = [];

  for (const m of models) {
    const decoded = createdAtFromCuid(m.id);
    if (!decoded) {
      skipped.push(`${m.code} (${m.id})`);
      continue;
    }
    // Sub-second drift is not worth a write; anything larger is the migration stamp.
    if (Math.abs(decoded.getTime() - m.createdAt.getTime()) < 1000) {
      unchanged += 1;
      continue;
    }
    if (!DRY_RUN) {
      await prisma.abayaModel.update({ where: { id: m.id }, data: { createdAt: decoded } });
    }
    updated += 1;
  }

  console.log(`${DRY_RUN ? "would update" : "updated"}: ${updated}`);
  console.log(`already correct: ${unchanged}`);
  if (skipped.length > 0) {
    console.log(`skipped (id is not a decodable cuid v1): ${skipped.length}`);
    for (const s of skipped.slice(0, 10)) console.log(`  ${s}`);
    console.log("  → these keep the column default; they sort as newest.");
  }

  const sample = await prisma.abayaModel.findMany({
    select: { code: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  console.log("newest three after this run:");
  for (const s of sample) console.log(`  ${s.code} — ${s.createdAt.toISOString()}`);
}

main()
  .catch((err: unknown) => {
    console.error("FAILED:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
