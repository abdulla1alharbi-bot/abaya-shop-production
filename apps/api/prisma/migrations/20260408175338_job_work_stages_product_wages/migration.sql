-- CreateTable
CREATE TABLE "JobOrderWorkStage" (
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
    CONSTRAINT "JobOrderWorkStage_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "JobOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JobOrderWorkStage_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_JobOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobNo" INTEGER NOT NULL,
    "invoiceId" TEXT,
    "invoiceItemId" TEXT,
    "customerId" TEXT NOT NULL,
    "measurementId" TEXT,
    "productId" TEXT,
    "productStyle" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'NEW',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "dueDate" DATETIME NOT NULL,
    "deliveredAt" DATETIME,
    "fabricSource" TEXT NOT NULL DEFAULT 'STOCK',
    "measurements" TEXT,
    "notes" TEXT,
    "costFils" INTEGER NOT NULL DEFAULT 0,
    "totalFils" INTEGER NOT NULL DEFAULT 0,
    "paidFils" INTEGER NOT NULL DEFAULT 0,
    "balanceFils" INTEGER NOT NULL DEFAULT 0,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "JobOrder_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobOrder_invoiceItemId_fkey" FOREIGN KEY ("invoiceItemId") REFERENCES "InvoiceItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JobOrder_measurementId_fkey" FOREIGN KEY ("measurementId") REFERENCES "Measurement" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobOrder_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_JobOrder" ("balanceFils", "costFils", "createdAt", "customerId", "deliveredAt", "dueDate", "fabricSource", "id", "invoiceId", "invoiceItemId", "isPaid", "jobNo", "measurementId", "measurements", "notes", "paidFils", "priority", "productStyle", "stage", "totalFils", "updatedAt") SELECT "balanceFils", "costFils", "createdAt", "customerId", "deliveredAt", "dueDate", "fabricSource", "id", "invoiceId", "invoiceItemId", "isPaid", "jobNo", "measurementId", "measurements", "notes", "paidFils", "priority", "productStyle", "stage", "totalFils", "updatedAt" FROM "JobOrder";
DROP TABLE "JobOrder";
ALTER TABLE "new_JobOrder" RENAME TO "JobOrder";
CREATE UNIQUE INDEX "JobOrder_jobNo_key" ON "JobOrder"("jobNo");
CREATE UNIQUE INDEX "JobOrder_invoiceItemId_key" ON "JobOrder"("invoiceItemId");
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
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isService" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Product" ("barcode", "categoryId", "costFils", "createdAt", "id", "isActive", "isService", "name", "nameAr", "priceFils", "sku", "stockQty") SELECT "barcode", "categoryId", "costFils", "createdAt", "id", "isActive", "isService", "name", "nameAr", "priceFils", "sku", "stockQty" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "JobOrderWorkStage_jobOrderId_stageKey_key" ON "JobOrderWorkStage"("jobOrderId", "stageKey");
