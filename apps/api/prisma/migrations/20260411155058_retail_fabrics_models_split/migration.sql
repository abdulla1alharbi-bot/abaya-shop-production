-- AlterTable
ALTER TABLE "AbayaModel" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "AbayaModel" ADD COLUMN "workflowStagesJson" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "catalogImageUrl" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FabricRoll" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rollCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "supplierId" TEXT,
    "branchId" TEXT NOT NULL,
    "totalMeters" REAL NOT NULL,
    "usedMeters" REAL NOT NULL DEFAULT 0,
    "availableMeters" REAL NOT NULL,
    "costPerMeter" INTEGER NOT NULL,
    "lowStockAt" REAL NOT NULL DEFAULT 5,
    "status" TEXT NOT NULL DEFAULT 'FULL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FabricRoll_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_FabricRoll" ("availableMeters", "branchId", "color", "costPerMeter", "id", "lowStockAt", "name", "receivedAt", "rollCode", "status", "supplierId", "totalMeters", "type", "usedMeters") SELECT "availableMeters", "branchId", "color", "costPerMeter", "id", "lowStockAt", "name", "receivedAt", "rollCode", "status", "supplierId", "totalMeters", "type", "usedMeters" FROM "FabricRoll";
DROP TABLE "FabricRoll";
ALTER TABLE "new_FabricRoll" RENAME TO "FabricRoll";
CREATE UNIQUE INDEX "FabricRoll_rollCode_key" ON "FabricRoll"("rollCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
