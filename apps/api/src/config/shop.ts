import type { PrismaClient } from "@prisma/client";

export async function getVatRatePercent(prisma: PrismaClient): Promise<number> {
  const s = await prisma.setting.findUnique({ where: { key: "vat_rate" } });
  const v = parseFloat(s?.value ?? "5");
  return Number.isFinite(v) ? v : 5;
}

/**
 * The name to sign customer-facing Arabic messages with. Prefers `shop_name_ar`, falls
 * back to the Latin `shop_name` for Latin-only brands; null when neither is filled in,
 * so callers can drop the line rather than send a placeholder.
 *
 * Derived server-side on purpose: SELLER and ACCOUNTANT send these messages but lack
 * `settings.view`, so the web app cannot read the setting for itself.
 */
export async function getCustomerFacingShopName(prisma: PrismaClient): Promise<string | null> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: ["shop_name_ar", "shop_name"] } },
    select: { key: true, value: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value?.trim() ?? ""]));
  return byKey.get("shop_name_ar") || byKey.get("shop_name") || null;
}

/** The shop's IANA timezone (setting `timezone`), used to slice reporting periods. */
export async function getShopTimezone(prisma: PrismaClient): Promise<string> {
  const s = await prisma.setting.findUnique({ where: { key: "timezone" } });
  const tz = s?.value?.trim();
  return tz && tz.length > 0 ? tz : "Asia/Dubai";
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
