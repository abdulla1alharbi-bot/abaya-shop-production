-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AbayaModel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "abayaTypeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultPriceFils" INTEGER NOT NULL DEFAULT 0,
    "cuttingWageFils" INTEGER NOT NULL DEFAULT 500,
    "sewingWageFils" INTEGER NOT NULL DEFAULT 2000,
    "finishingWageFils" INTEGER NOT NULL DEFAULT 500,
    "embroideryWageFils" INTEGER NOT NULL DEFAULT 300,
    "productId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "AbayaModel_abayaTypeId_fkey" FOREIGN KEY ("abayaTypeId") REFERENCES "AbayaType" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AbayaModel_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AbayaModel" ("abayaTypeId", "code", "id", "isActive", "name", "productId", "sortOrder") SELECT "abayaTypeId", "code", "id", "isActive", "name", "productId", "sortOrder" FROM "AbayaModel";
DROP TABLE "AbayaModel";
ALTER TABLE "new_AbayaModel" RENAME TO "AbayaModel";
CREATE INDEX "AbayaModel_abayaTypeId_idx" ON "AbayaModel"("abayaTypeId");
CREATE UNIQUE INDEX "AbayaModel_abayaTypeId_code_key" ON "AbayaModel"("abayaTypeId", "code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
