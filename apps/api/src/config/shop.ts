import type { PrismaClient } from "@prisma/client";

export async function getVatRatePercent(prisma: PrismaClient): Promise<number> {
  const s = await prisma.setting.findUnique({ where: { key: "vat_rate" } });
  const v = parseFloat(s?.value ?? "5");
  return Number.isFinite(v) ? v : 5;
}

export async function getDefaultBranchId(prisma: PrismaClient): Promise<string> {
  const b = await prisma.branch.findFirst({ where: { isDefault: true } });
  if (b) return b.id;
  const any = await prisma.branch.findFirst();
  if (any) return any.id;
  // No branch exists — auto-create one so the app works out of the box
  const created = await prisma.branch.create({
    data: { name: "Main Shop", isDefault: true },
  });
  return created.id;
}
