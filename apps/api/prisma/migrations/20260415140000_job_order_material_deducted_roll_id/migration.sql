-- AlterTable
ALTER TABLE "JobOrderMaterial" ADD COLUMN "deductedRollId" TEXT;

-- Backfill: physical stock was removed from current roll when only rollId was tracked
UPDATE "JobOrderMaterial" SET "deductedRollId" = "rollId" WHERE "fabricDeducted" = 1;
