-- AlterTable
ALTER TABLE "JobOrderMaterial" ADD COLUMN "fabricDeducted" BOOLEAN NOT NULL DEFAULT false;

-- Legacy rows: stock was already reduced at order/checkout time before cutting-based deduction existed.
UPDATE "JobOrderMaterial" SET "fabricDeducted" = true;
