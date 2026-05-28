-- Normalize legacy stage to tailoring pipeline
UPDATE "JobOrder" SET "stage" = 'NEW' WHERE "stage" = 'RECEIVED';
