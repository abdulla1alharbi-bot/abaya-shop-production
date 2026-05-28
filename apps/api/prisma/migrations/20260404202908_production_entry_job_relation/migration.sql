-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_JobOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobNo" INTEGER NOT NULL,
    "invoiceId" TEXT,
    "customerId" TEXT NOT NULL,
    "productStyle" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'NEW',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "dueDate" DATETIME NOT NULL,
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
    CONSTRAINT "JobOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_JobOrder" ("balanceFils", "costFils", "createdAt", "customerId", "dueDate", "fabricSource", "id", "invoiceId", "isPaid", "jobNo", "measurements", "notes", "paidFils", "priority", "productStyle", "stage", "totalFils", "updatedAt") SELECT "balanceFils", "costFils", "createdAt", "customerId", "dueDate", "fabricSource", "id", "invoiceId", "isPaid", "jobNo", "measurements", "notes", "paidFils", "priority", "productStyle", "stage", "totalFils", "updatedAt" FROM "JobOrder";
DROP TABLE "JobOrder";
ALTER TABLE "new_JobOrder" RENAME TO "JobOrder";
CREATE UNIQUE INDEX "JobOrder_jobNo_key" ON "JobOrder"("jobNo");
CREATE TABLE "new_ProductionEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workerId" TEXT NOT NULL,
    "jobOrderId" TEXT,
    "workType" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "rateFils" INTEGER NOT NULL,
    "totalFils" INTEGER NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "approvedBy" TEXT,
    "notes" TEXT,
    CONSTRAINT "ProductionEntry_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProductionEntry_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "JobOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ProductionEntry" ("approvedBy", "date", "id", "isApproved", "jobOrderId", "notes", "qty", "rateFils", "totalFils", "workType", "workerId") SELECT "approvedBy", "date", "id", "isApproved", "jobOrderId", "notes", "qty", "rateFils", "totalFils", "workType", "workerId" FROM "ProductionEntry";
DROP TABLE "ProductionEntry";
ALTER TABLE "new_ProductionEntry" RENAME TO "ProductionEntry";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
