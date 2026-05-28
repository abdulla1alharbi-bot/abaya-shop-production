import type { PrismaClient } from "@prisma/client";
import { AppError } from "../middleware/error.middleware.js";

export async function getVatRatePercent(prisma: PrismaClient): Promise<number> {
  const s = await prisma.setting.findUnique({ where: { key: "vat_rate" } });
  const v = parseFloat(s?.value ?? "5");
  return Number.isFinite(v) ? v : 5;
}

export async function getDefaultBranchId(prisma: PrismaClient): Promise<string> {
  const b = await prisma.branch.findFirst({ where: { isDefault: true } });
  if (b) return b.id;
  const any = await prisma.branch.findFirst();
  if (!any) {
    throw new AppError(500, "No branch configured. Run database seed.", "NO_BRANCH");
  }
  return any.id;
}
