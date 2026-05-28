-- CreateTable
CREATE TABLE "JobOrderMaterial" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobOrderId" TEXT NOT NULL,
    "rollId" TEXT NOT NULL,
    "meters" REAL NOT NULL,
    CONSTRAINT "JobOrderMaterial_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "JobOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JobOrderMaterial_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "FabricRoll" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Income" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "amountFils" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_JobOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobNo" INTEGER NOT NULL,
    "invoiceId" TEXT,
    "customerId" TEXT NOT NULL,
    "productStyle" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'RECEIVED',
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
INSERT INTO "new_JobOrder" ("createdAt", "customerId", "dueDate", "fabricSource", "id", "invoiceId", "isPaid", "jobNo", "measurements", "notes", "priority", "productStyle", "stage", "totalFils", "updatedAt") SELECT "createdAt", "customerId", "dueDate", "fabricSource", "id", "invoiceId", "isPaid", "jobNo", "measurements", "notes", "priority", "productStyle", "stage", "totalFils", "updatedAt" FROM "JobOrder";
DROP TABLE "JobOrder";
ALTER TABLE "new_JobOrder" RENAME TO "JobOrder";
CREATE UNIQUE INDEX "JobOrder_jobNo_key" ON "JobOrder"("jobNo");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
