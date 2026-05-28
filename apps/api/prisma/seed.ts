import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { syncLinkedProductForAbayaModelId } from "../src/utils/abayaModelProductSync.js";

const prisma = new PrismaClient();

const DEFAULT_RATES: Record<string, number> = {
  SEW_BASIC: 1500,
  SEW_LINING: 2000,
  HAND_EMBROIDERY: 3500,
  MACHINE_EMBROIDERY: 2500,
  CUTTING: 800,
  FINISHING: 500,
  CUSTOM: 0,
};

const WORK_TYPES = Object.keys(DEFAULT_RATES);

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash("Admin@123", 12);

  const owner = await prisma.user.upsert({
    where: { username: "owner" },
    update: {
      password: passwordHash,
      name: "Shop Owner",
      email: "owner@abayashop.ae",
      role: "OWNER",
      phone: "+971500000000",
      isActive: true,
    },
    create: {
      username: "owner",
      email: "owner@abayashop.ae",
      name: "Shop Owner",
      password: passwordHash,
      role: "OWNER",
      phone: "+971500000000",
      isActive: true,
    },
  });

  const branch = await prisma.branch.upsert({
    where: { id: "seed-main-branch" },
    update: {},
    create: {
      id: "seed-main-branch",
      name: "Main Shop",
      address: "Dubai, UAE",
      phone: "+971400000000",
      isDefault: true,
    },
  });

  const seedFabricRoll = await prisma.fabricRoll.upsert({
    where: { rollCode: "R-000001" },
    update: {},
    create: {
      rollCode: "R-000001",
      name: "Nida Black",
      type: "NIDA",
      color: "Black",
      branchId: branch.id,
      totalMeters: 50,
      usedMeters: 0,
      availableMeters: 50,
      costPerMeter: 4500,
      lowStockAt: 5,
      status: "FULL",
    },
  });

  const categories = [
    "WALTER",
    "SHALIA",
    "GASHWA",
    "NICKAB",
    "MODEL",
    "EMBROIDERY",
    "H&T",
    "NORMAL",
  ] as const;

  for (const name of categories) {
    await prisma.productCategory.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  const expenseNames = [
    "Rent",
    "Electricity",
    "Utilities",
    "Supplies",
    "Fabric purchases",
    "Salaries",
    "Maintenance",
    "Delivery",
    "Miscellaneous",
    "Other",
  ] as const;

  for (const name of expenseNames) {
    await prisma.expenseCategory.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  for (const workType of WORK_TYPES) {
    const existing = await prisma.pieceRate.findFirst({
      where: { workerId: null, workType, isDefault: true },
    });
    if (!existing) {
      await prisma.pieceRate.create({
        data: {
          workerId: null,
          workType,
          rateFils: DEFAULT_RATES[workType] ?? 0,
          isDefault: true,
        },
      });
    }
  }

  const settings: Array<{ key: string; value: string }> = [
    { key: "shop_name", value: "Abaya Shop" },
    { key: "shop_name_ar", value: "محل العبايات" },
    { key: "vat_number", value: "" },
    { key: "vat_rate", value: "5" },
    { key: "currency", value: "AED" },
    { key: "timezone", value: "Asia/Dubai" },
    { key: "default_cutting_wage_fils", value: "500" },
    { key: "default_sewing_wage_fils", value: "2000" },
    { key: "default_embroidery_wage_fils", value: "300" },
    { key: "default_finishing_wage_fils", value: "500" },
  ];

  for (const s of settings) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: { value: s.value },
      create: { key: s.key, value: s.value },
    });
  }

  const normalCat = await prisma.productCategory.findFirst({ where: { name: "NORMAL" } });
  if (normalCat) {
    await prisma.product.upsert({
      where: { sku: "ABY-READY-001" },
      update: {
        cuttingWageFils: 500,
        sewingWageFils: 2000,
        embroideryWageFils: 300,
        finishingWageFils: 500,
      },
      create: {
        sku: "ABY-READY-001",
        name: "عباية جاهزة — قياس قياسي",
        categoryId: normalCat.id,
        costFils: 8000,
        priceFils: 14900,
        stockQty: 25,
        cuttingWageFils: 500,
        sewingWageFils: 2000,
        embroideryWageFils: 300,
        finishingWageFils: 500,
      },
    });
    await prisma.product.upsert({
      where: { sku: "ABY-READY-002" },
      update: {
        cuttingWageFils: 500,
        sewingWageFils: 2000,
        embroideryWageFils: 300,
        finishingWageFils: 500,
      },
      create: {
        sku: "ABY-READY-002",
        name: "عباية جاهزة — موديل فاخر",
        categoryId: normalCat.id,
        costFils: 12000,
        priceFils: 19900,
        stockQty: 15,
        cuttingWageFils: 500,
        sewingWageFils: 2000,
        embroideryWageFils: 300,
        finishingWageFils: 500,
      },
    });
    await prisma.product.upsert({
      where: { sku: "SYS-TAILORING-LINE" },
      update: {
        isService: true,
        cuttingWageFils: 500,
        sewingWageFils: 2000,
        embroideryWageFils: 300,
        finishingWageFils: 500,
      },
      create: {
        sku: "SYS-TAILORING-LINE",
        name: "تفصيل — بند خدمة",
        nameAr: "تفصيل",
        categoryId: normalCat.id,
        costFils: 0,
        priceFils: 0,
        stockQty: 0,
        isService: true,
        isActive: true,
        cuttingWageFils: 500,
        sewingWageFils: 2000,
        embroideryWageFils: 300,
        finishingWageFils: 500,
      },
    });
  }

  const abayaTypesSeed: Array<{
    code: string;
    labelAr: string;
    labelEn?: string;
    sortOrder: number;
    subFieldKind: string;
  }> = [
    { code: "WALTER", labelAr: "Walter / ولف", labelEn: "Walter", sortOrder: 10, subFieldKind: "NONE" },
    { code: "SHALIA", labelAr: "Shalia / شاليه", labelEn: "Shalia", sortOrder: 20, subFieldKind: "NONE" },
    { code: "GASHWA", labelAr: "Gashwa / قشوة", labelEn: "Gashwa", sortOrder: 30, subFieldKind: "NONE" },
    { code: "NICKAB", labelAr: "Nickab / نقاب", labelEn: "Nickab", sortOrder: 40, subFieldKind: "NONE" },
    { code: "MODEL", labelAr: "Model / موديل", labelEn: "Model", sortOrder: 50, subFieldKind: "MODEL_PICK" },
    { code: "EMBROIDERY", labelAr: "Embroidery / تطريز", labelEn: "Embroidery", sortOrder: 60, subFieldKind: "EMBROIDERY_PICK" },
    { code: "CUSTOM", labelAr: "Custom / تفصيل حسب الطلب", labelEn: "Custom", sortOrder: 70, subFieldKind: "CUSTOM_TEXT" },
  ];

  for (const t of abayaTypesSeed) {
    await prisma.abayaType.upsert({
      where: { code: t.code },
      update: {
        labelAr: t.labelAr,
        labelEn: t.labelEn,
        sortOrder: t.sortOrder,
        subFieldKind: t.subFieldKind,
      },
      create: {
        code: t.code,
        labelAr: t.labelAr,
        labelEn: t.labelEn,
        sortOrder: t.sortOrder,
        subFieldKind: t.subFieldKind,
      },
    });
  }

  const modelType = await prisma.abayaType.findUnique({ where: { code: "MODEL" } });
  const embType = await prisma.abayaType.findUnique({ where: { code: "EMBROIDERY" } });
  const prodLux = await prisma.product.findUnique({ where: { sku: "ABY-READY-002" } });
  const prodStd = await prisma.product.findUnique({ where: { sku: "ABY-READY-001" } });

  if (modelType) {
    const models: Array<{
      code: string;
      name: string;
      defaultPriceFils: number;
      defaultDeliveryDays: number;
      cuttingWageFils: number;
      sewingWageFils: number;
      finishingWageFils: number;
      embroideryWageFils: number;
    }> = [
      {
        code: "M-101",
        name: "Royal Sleeve",
        defaultPriceFils: prodLux?.priceFils ?? 19900,
        defaultDeliveryDays: 3,
        cuttingWageFils: prodLux?.cuttingWageFils ?? 500,
        sewingWageFils: prodLux?.sewingWageFils ?? 2000,
        finishingWageFils: prodLux?.finishingWageFils ?? 500,
        embroideryWageFils: prodLux?.embroideryWageFils ?? 300,
      },
      {
        code: "M-102",
        name: "Butterfly Cut",
        defaultPriceFils: prodStd?.priceFils ?? 14900,
        defaultDeliveryDays: 5,
        cuttingWageFils: prodStd?.cuttingWageFils ?? 500,
        sewingWageFils: prodStd?.sewingWageFils ?? 2000,
        finishingWageFils: prodStd?.finishingWageFils ?? 500,
        embroideryWageFils: prodStd?.embroideryWageFils ?? 300,
      },
      {
        code: "M-103",
        name: "Classic Front",
        defaultPriceFils: prodStd?.priceFils ?? 14900,
        defaultDeliveryDays: 5,
        cuttingWageFils: prodStd?.cuttingWageFils ?? 500,
        sewingWageFils: prodStd?.sewingWageFils ?? 2000,
        finishingWageFils: prodStd?.finishingWageFils ?? 500,
        embroideryWageFils: prodStd?.embroideryWageFils ?? 300,
      },
    ];
    const defaultWorkflowStagesJson = '["CUTTING","SEWING","EMBROIDERY","FINISHING"]';
    for (let i = 0; i < models.length; i++) {
      const m = models[i]!;
      await prisma.abayaModel.upsert({
        where: { abayaTypeId_code: { abayaTypeId: modelType.id, code: m.code } },
        update: {
          name: m.name,
          defaultPriceFils: m.defaultPriceFils,
          defaultFabricRollId: seedFabricRoll.id,
          defaultDeliveryDays: m.defaultDeliveryDays,
          cuttingWageFils: m.cuttingWageFils,
          sewingWageFils: m.sewingWageFils,
          finishingWageFils: m.finishingWageFils,
          embroideryWageFils: m.embroideryWageFils,
          workflowStagesJson: defaultWorkflowStagesJson,
          sortOrder: (i + 1) * 10,
        },
        create: {
          abayaTypeId: modelType.id,
          code: m.code,
          name: m.name,
          defaultPriceFils: m.defaultPriceFils,
          defaultFabricRollId: seedFabricRoll.id,
          defaultDeliveryDays: m.defaultDeliveryDays,
          cuttingWageFils: m.cuttingWageFils,
          sewingWageFils: m.sewingWageFils,
          finishingWageFils: m.finishingWageFils,
          embroideryWageFils: m.embroideryWageFils,
          workflowStagesJson: defaultWorkflowStagesJson,
          sortOrder: (i + 1) * 10,
        },
      });
    }
  }

  if (embType) {
    const emods: Array<{
      code: string;
      name: string;
      defaultPriceFils: number;
      defaultDeliveryDays: number;
      cuttingWageFils: number;
      sewingWageFils: number;
      finishingWageFils: number;
      embroideryWageFils: number;
    }> = [
      {
        code: "E-01",
        name: "Floral Border",
        defaultPriceFils: 25000,
        defaultDeliveryDays: 7,
        cuttingWageFils: 500,
        sewingWageFils: 2000,
        finishingWageFils: 500,
        embroideryWageFils: 3500,
      },
      {
        code: "E-02",
        name: "Geometric Panel",
        defaultPriceFils: 23000,
        defaultDeliveryDays: 7,
        cuttingWageFils: 500,
        sewingWageFils: 2000,
        finishingWageFils: 500,
        embroideryWageFils: 3000,
      },
    ];
    const embWorkflowStagesJson = '["CUTTING","SEWING","EMBROIDERY","FINISHING"]';
    for (let i = 0; i < emods.length; i++) {
      const m = emods[i]!;
      await prisma.abayaModel.upsert({
        where: { abayaTypeId_code: { abayaTypeId: embType.id, code: m.code } },
        update: {
          name: m.name,
          defaultPriceFils: m.defaultPriceFils,
          defaultFabricRollId: seedFabricRoll.id,
          defaultDeliveryDays: m.defaultDeliveryDays,
          cuttingWageFils: m.cuttingWageFils,
          sewingWageFils: m.sewingWageFils,
          finishingWageFils: m.finishingWageFils,
          embroideryWageFils: m.embroideryWageFils,
          workflowStagesJson: embWorkflowStagesJson,
          sortOrder: (i + 1) * 10,
        },
        create: {
          abayaTypeId: embType.id,
          code: m.code,
          name: m.name,
          defaultPriceFils: m.defaultPriceFils,
          defaultFabricRollId: seedFabricRoll.id,
          defaultDeliveryDays: m.defaultDeliveryDays,
          cuttingWageFils: m.cuttingWageFils,
          sewingWageFils: m.sewingWageFils,
          finishingWageFils: m.finishingWageFils,
          embroideryWageFils: m.embroideryWageFils,
          workflowStagesJson: embWorkflowStagesJson,
          sortOrder: (i + 1) * 10,
        },
      });
    }
  }

  const allAbayaModels = await prisma.abayaModel.findMany({ select: { id: true } });
  for (const row of allAbayaModels) {
    await syncLinkedProductForAbayaModelId(row.id);
  }

  await prisma.customer.upsert({
    where: { mobile: "+971500000001" },
    update: {},
    create: {
      code: 2001,
      name: "عميل تجريبي",
      mobile: "+971500000001",
      segment: "REGULAR",
    },
  });

  const existingWorker = await prisma.worker.findFirst({
    where: { phone: "+971500000002" },
  });
  if (!existingWorker) {
    await prisma.worker.create({
      data: {
        name: "خياط رئيسي",
        role: "TAILOR",
        phone: "+971500000002",
        isActive: true,
      },
    });
  }

  console.log("");
  console.log("══════════════════════════════════════════════════════════");
  console.log("  SEED COMPLETED SUCCESSFULLY (SQLite)");
  console.log("══════════════════════════════════════════════════════════");
  console.log("  Login:");
  console.log("    Username: owner");
  console.log("    Password: Admin@123");
  console.log("    (optional contact email: owner@abayashop.ae)");
  console.log("  Owner user id:", owner.id);
  console.log("  Branch id:", branch.id);
  console.log("══════════════════════════════════════════════════════════");
  console.log("");
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
