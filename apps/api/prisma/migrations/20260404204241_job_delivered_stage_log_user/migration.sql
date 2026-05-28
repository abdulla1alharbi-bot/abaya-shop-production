-- AlterTable
ALTER TABLE "JobOrder" ADD COLUMN "deliveredAt" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_JobStageLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobOrderId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobStageLog_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "JobOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JobStageLog_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_JobStageLog" ("changedById", "createdAt", "id", "jobOrderId", "notes", "stage") SELECT "changedById", "createdAt", "id", "jobOrderId", "notes", "stage" FROM "JobStageLog";
DROP TABLE "JobStageLog";
ALTER TABLE "new_JobStageLog" RENAME TO "JobStageLog";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
