-- AlterTable
ALTER TABLE "Measurement" ADD COLUMN "label" TEXT;

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
    CONSTRAINT "JobOrder_measurementId_fkey" FOREIGN KEY ("measurementId") REFERENCES "Measurement" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_JobOrder" ("balanceFils", "costFils", "createdAt", "customerId", "deliveredAt", "dueDate", "fabricSource", "id", "invoiceId", "isPaid", "jobNo", "measurements", "notes", "paidFils", "priority", "productStyle", "stage", "totalFils", "updatedAt") SELECT "balanceFils", "costFils", "createdAt", "customerId", "deliveredAt", "dueDate", "fabricSource", "id", "invoiceId", "isPaid", "jobNo", "measurements", "notes", "paidFils", "priority", "productStyle", "stage", "totalFils", "updatedAt" FROM "JobOrder";
DROP TABLE "JobOrder";
ALTER TABLE "new_JobOrder" RENAME TO "JobOrder";
CREATE UNIQUE INDEX "JobOrder_jobNo_key" ON "JobOrder"("jobNo");
CREATE UNIQUE INDEX "JobOrder_invoiceItemId_key" ON "JobOrder"("invoiceItemId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
