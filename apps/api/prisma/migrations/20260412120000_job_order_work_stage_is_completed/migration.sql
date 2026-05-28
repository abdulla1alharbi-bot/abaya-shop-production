-- Redundant with status=DONE but required for reporting / explicit APIs.
ALTER TABLE "JobOrderWorkStage" ADD COLUMN "isCompleted" BOOLEAN NOT NULL DEFAULT false;

UPDATE "JobOrderWorkStage" SET "isCompleted" = true WHERE "status" = 'DONE';
