-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'SELLER',
    "extraPermissions" TEXT,
    "revokedPermissions" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "whatsapp" TEXT,
    "address" TEXT,
    "nationality" TEXT,
    "birthday" DATETIME,
    "segment" TEXT NOT NULL DEFAULT 'REGULAR',
    "loyaltyPoints" INTEGER NOT NULL DEFAULT 0,
    "balanceFils" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Measurement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "label" TEXT,
    "shoulder" REAL,
    "chest" REAL,
    "waist" REAL,
    "hip" REAL,
    "length" REAL,
    "sleeve" REAL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Measurement_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "nameAr" TEXT
);

-- CreateTable
CREATE TABLE "AbayaType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,
    "labelEn" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "subFieldKind" TEXT NOT NULL DEFAULT 'NONE'
);

-- CreateTable
CREATE TABLE "AbayaModel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "abayaTypeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "workflowStagesJson" TEXT,
    "defaultPriceFils" INTEGER NOT NULL DEFAULT 0,
    "cuttingWageFils" INTEGER NOT NULL DEFAULT 500,
    "sewingWageFils" INTEGER NOT NULL DEFAULT 2000,
    "finishingWageFils" INTEGER NOT NULL DEFAULT 500,
    "embroideryWageFils" INTEGER NOT NULL DEFAULT 300,
    "productId" TEXT,
    "defaultFabricRollId" TEXT,
    "defaultDeliveryDays" INTEGER NOT NULL DEFAULT 7,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "hasActiveDisplaySample" BOOLEAN NOT NULL DEFAULT false,
    "latestDisplaySampleAt" DATETIME,
    CONSTRAINT "AbayaModel_abayaTypeId_fkey" FOREIGN KEY ("abayaTypeId") REFERENCES "AbayaType" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AbayaModel_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AbayaModel_defaultFabricRollId_fkey" FOREIGN KEY ("defaultFabricRollId") REFERENCES "FabricRoll" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Product" (
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
    "createdFromInvoiceId" TEXT,
    "createdFromInvoiceNo" INTEGER,
    "createdFromJobId" TEXT,
    "createdFromJobNo" INTEGER,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "sampleModelId" TEXT,
    "sampleJobId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isService" BOOLEAN NOT NULL DEFAULT false,
    "catalogImageUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Product_sampleModelId_fkey" FOREIGN KEY ("sampleModelId") REFERENCES "AbayaModel" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Product_sampleJobId_fkey" FOREIGN KEY ("sampleJobId") REFERENCES "JobOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "cloudId" TEXT NOT NULL,
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FabricRoll" (
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

-- CreateTable
CREATE TABLE "FabricRecipe" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "rollId" TEXT,
    "fabricType" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "meters" REAL NOT NULL,
    "notes" TEXT,
    CONSTRAINT "FabricRecipe_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FabricRecipe_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "FabricRoll" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FabricTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rollId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "meters" REAL NOT NULL,
    "reason" TEXT,
    "invoiceId" TEXT,
    "jobOrderId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FabricTransaction_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "FabricRoll" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceNo" INTEGER NOT NULL,
    "customerId" TEXT,
    "branchId" TEXT NOT NULL,
    "salesPersonId" TEXT NOT NULL,
    "orderType" TEXT NOT NULL DEFAULT 'NORMAL',
    "deliveryDate" DATETIME,
    "subtotalFils" INTEGER NOT NULL,
    "discountFils" INTEGER NOT NULL DEFAULT 0,
    "vatFils" INTEGER NOT NULL,
    "totalFils" INTEGER NOT NULL,
    "paidFils" INTEGER NOT NULL DEFAULT 0,
    "balanceFils" INTEGER NOT NULL,
    "isVoid" BOOLEAN NOT NULL DEFAULT false,
    "voidReason" TEXT,
    "notes" TEXT,
    "deliveredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_salesPersonId_fkey" FOREIGN KEY ("salesPersonId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "description" TEXT,
    "qty" REAL NOT NULL,
    "unitFils" INTEGER NOT NULL,
    "discountFils" INTEGER NOT NULL DEFAULT 0,
    "totalFils" INTEGER NOT NULL,
    CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InvoiceItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amountFils" INTEGER NOT NULL,
    "reference" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobNo" INTEGER NOT NULL,
    "invoiceId" TEXT,
    "invoiceItemId" TEXT,
    "customerId" TEXT NOT NULL,
    "measurementId" TEXT,
    "productId" TEXT,
    "abayaTypeId" TEXT,
    "abayaModelId" TEXT,
    "sourceDisplaySampleJobId" TEXT,
    "sourceDisplayModelId" TEXT,
    "customStyleText" TEXT,
    "productStyle" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'NEW',
    "isConvertedToReady" BOOLEAN NOT NULL DEFAULT false,
    "convertedAt" DATETIME,
    "convertedReadyProductId" TEXT,
    "productionBatchId" TEXT,
    "productionStockAddedAt" DATETIME,
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
    CONSTRAINT "JobOrder_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobOrder_abayaTypeId_fkey" FOREIGN KEY ("abayaTypeId") REFERENCES "AbayaType" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobOrder_abayaModelId_fkey" FOREIGN KEY ("abayaModelId") REFERENCES "AbayaModel" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobOrder_convertedReadyProductId_fkey" FOREIGN KEY ("convertedReadyProductId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobOrder_productionBatchId_fkey" FOREIGN KEY ("productionBatchId") REFERENCES "ProductionBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductionBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchNo" INTEGER NOT NULL,
    "modelId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'BATCH',
    "color" TEXT,
    "fabricId" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductionBatch_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "AbayaModel" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProductionBatch_fabricId_fkey" FOREIGN KEY ("fabricId") REFERENCES "FabricRoll" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProductionBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConversionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT,
    "jobId" TEXT NOT NULL,
    "readyProductId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "convertedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    CONSTRAINT "ConversionLog_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ConversionLog_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConversionLog_readyProductId_fkey" FOREIGN KEY ("readyProductId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SampleSaleLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "sampleModelId" TEXT,
    "sampleJobId" TEXT,
    "invoiceId" TEXT NOT NULL,
    "soldAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "soldPriceFils" INTEGER NOT NULL,
    CONSTRAINT "SampleSaleLog_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SampleSaleLog_sampleModelId_fkey" FOREIGN KEY ("sampleModelId") REFERENCES "AbayaModel" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SampleSaleLog_sampleJobId_fkey" FOREIGN KEY ("sampleJobId") REFERENCES "JobOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SampleSaleLog_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobOrderWorkStage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobOrderId" TEXT NOT NULL,
    "stageKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
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

-- CreateTable
CREATE TABLE "JobOrderMaterial" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobOrderId" TEXT NOT NULL,
    "rollId" TEXT NOT NULL,
    "meters" REAL NOT NULL,
    "fabricDeducted" BOOLEAN NOT NULL DEFAULT false,
    "deductedMeters" REAL,
    "deductedRollId" TEXT,
    CONSTRAINT "JobOrderMaterial_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "JobOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JobOrderMaterial_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "FabricRoll" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobStageLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobOrderId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobStageLog_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "JobOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JobStageLog_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobOrderId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "workType" TEXT NOT NULL,
    "assignedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobAssignment_jobOrderId_fkey" FOREIGN KEY ("jobOrderId") REFERENCES "JobOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JobAssignment_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Worker" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "nationality" TEXT,
    "passportNo" TEXT,
    "residencyExpiry" DATETIME,
    "phone" TEXT,
    "role" TEXT NOT NULL,
    "specializations" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "joinDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WorkerPayout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workerId" TEXT NOT NULL,
    "amountFils" INTEGER NOT NULL,
    "method" TEXT,
    "notes" TEXT,
    "paidAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkerPayout_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkerBalanceAdjustment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workerId" TEXT NOT NULL,
    "amountFils" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkerBalanceAdjustment_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PieceRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workerId" TEXT,
    "workType" TEXT NOT NULL,
    "rateFils" INTEGER NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "PieceRate_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductionEntry" (
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

-- CreateTable
CREATE TABLE "Payroll" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workerId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "productionFils" INTEGER NOT NULL,
    "bonusFils" INTEGER NOT NULL DEFAULT 0,
    "deductionFils" INTEGER NOT NULL DEFAULT 0,
    "advanceFils" INTEGER NOT NULL DEFAULT 0,
    "netFils" INTEGER NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" DATETIME,
    "payMethod" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payroll_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "categoryId" TEXT NOT NULL,
    "amountFils" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "notes" TEXT,
    "receiptUrl" TEXT,
    "paidBy" TEXT,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_code_key" ON "Customer"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_mobile_key" ON "Customer"("mobile");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_name_key" ON "ProductCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "AbayaType_code_key" ON "AbayaType"("code");

-- CreateIndex
CREATE INDEX "AbayaModel_abayaTypeId_idx" ON "AbayaModel"("abayaTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "AbayaModel_abayaTypeId_code_key" ON "AbayaModel"("abayaTypeId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "FabricRoll_rollCode_key" ON "FabricRoll"("rollCode");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNo_key" ON "Invoice"("invoiceNo");

-- CreateIndex
CREATE UNIQUE INDEX "JobOrder_jobNo_key" ON "JobOrder"("jobNo");

-- CreateIndex
CREATE UNIQUE INDEX "JobOrder_invoiceItemId_key" ON "JobOrder"("invoiceItemId");

-- CreateIndex
CREATE UNIQUE INDEX "JobOrder_convertedReadyProductId_key" ON "JobOrder"("convertedReadyProductId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionBatch_batchNo_key" ON "ProductionBatch"("batchNo");

-- CreateIndex
CREATE INDEX "ProductionBatch_createdAt_idx" ON "ProductionBatch"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConversionLog_jobId_key" ON "ConversionLog"("jobId");

-- CreateIndex
CREATE INDEX "ConversionLog_convertedAt_idx" ON "ConversionLog"("convertedAt");

-- CreateIndex
CREATE INDEX "ConversionLog_customerName_idx" ON "ConversionLog"("customerName");

-- CreateIndex
CREATE INDEX "ConversionLog_model_idx" ON "ConversionLog"("model");

-- CreateIndex
CREATE INDEX "SampleSaleLog_soldAt_idx" ON "SampleSaleLog"("soldAt");

-- CreateIndex
CREATE INDEX "SampleSaleLog_sampleModelId_idx" ON "SampleSaleLog"("sampleModelId");

-- CreateIndex
CREATE INDEX "SampleSaleLog_invoiceId_idx" ON "SampleSaleLog"("invoiceId");

-- CreateIndex
CREATE INDEX "SampleSaleLog_sampleJobId_idx" ON "SampleSaleLog"("sampleJobId");

-- CreateIndex
CREATE UNIQUE INDEX "SampleSaleLog_productId_key" ON "SampleSaleLog"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "JobOrderWorkStage_productionEntryId_key" ON "JobOrderWorkStage"("productionEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "JobOrderWorkStage_jobOrderId_stageKey_key" ON "JobOrderWorkStage"("jobOrderId", "stageKey");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_name_key" ON "ExpenseCategory"("name");
