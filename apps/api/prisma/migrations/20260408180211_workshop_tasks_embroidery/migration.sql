-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_JobOrderWorkStage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobOrderId" TEXT NOT NULL,
    "stageKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "workerId" TEXT,
    "wageFils" INTEGER NOT NULL DEFAULT 0,
    "workerNameSnapshot" TEXT,
    "assignedAt" DATETIME,
    "completedAt" DATETIME,
    "notes" TEXT,
    "productionEntryId" TEXT,
    CONSTRAINT "JobOrderWorkStage_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "JobOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JobOrderWorkStage_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobOrderWorkStage_productionEntryId_fkey" FOREIGN KEY ("productionEntryId") REFERENCES "ProductionEntry" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_JobOrderWorkStage" ("assignedAt", "completedAt", "id", "jobOrderId", "sortOrder", "stageKey", "status", "wageFils", "workerId", "workerNameSnapshot") SELECT "assignedAt", "completedAt", "id", "jobOrderId", "sortOrder", "stageKey", "status", "wageFils", "workerId", "workerNameSnapshot" FROM "JobOrderWorkStage";
DROP TABLE "JobOrderWorkStage";
ALTER TABLE "new_JobOrderWorkStage" RENAME TO "JobOrderWorkStage";
CREATE UNIQUE INDEX "JobOrderWorkStage_productionEntryId_key" ON "JobOrderWorkStage"("productionEntryId");
CREATE UNIQUE INDEX "JobOrderWorkStage_jobOrderId_stageKey_key" ON "JobOrderWorkStage"("jobOrderId", "stageKey");
CREATE TABLE "new_Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "categoryId" TEXT NOT NULL,
    "costFils" INTEGER NOT NULL,
    "priceFils" INTEGER NOT NULL,
    "stockQty" INTEGER NOT NULL DEFAULT 0,
    "cuttingWageFils" INTEGER NOT NULL DEFAULT 500,
    "sewingWageFils" INTEGER NOT NULL DEFAULT 2000,
    "finishingWageFils" INTEGER NOT NULL DEFAULT 500,
    "embroideryWageFils" INTEGER NOT NULL DEFAULT 300,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isService" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Product" ("barcode", "categoryId", "costFils", "createdAt", "cuttingWageFils", "finishingWageFils", "id", "isActive", "isService", "name", "nameAr", "priceFils", "sewingWageFils", "sku", "stockQty") SELECT "barcode", "categoryId", "costFils", "createdAt", "cuttingWageFils", "finishingWageFils", "id", "isActive", "isService", "name", "nameAr", "priceFils", "sewingWageFils", "sku", "stockQty" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
