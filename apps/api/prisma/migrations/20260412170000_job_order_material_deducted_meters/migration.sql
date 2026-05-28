-- AlterTable
ALTER TABLE "JobOrderMaterial" ADD COLUMN "deductedMeters" REAL;

-- Lines already deducted: keep physical qty in sync with inventory
UPDATE "JobOrderMaterial" SET "deductedMeters" = "meters" WHERE "fabricDeducted" = 1;
