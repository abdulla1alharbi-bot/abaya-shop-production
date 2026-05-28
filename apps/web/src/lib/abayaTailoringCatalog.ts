/** Matches GET /abaya-catalog response */
export type AbayaCatalogModel = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  /** Thumbnail for model picker (optional). */
  imageUrl: string | null;
  /** JSON array of pipeline stage keys, e.g. ["CUTTING","SEWING","FINISHING"]. */
  workflowStagesJson: string | null;
  defaultPriceFils: number;
  defaultFabricRollId: string | null;
  defaultDeliveryDays: number;
  cuttingWageFils: number;
  sewingWageFils: number;
  finishingWageFils: number;
  embroideryWageFils: number;
  productId: string | null;
  product: { id: string; name: string; sku: string } | null;
  defaultFabricRoll: {
    id: string;
    rollCode: string;
    name: string;
    color: string;
  } | null;
};

export type AbayaCatalogType = {
  id: string;
  code: string;
  labelAr: string;
  labelEn: string | null;
  sortOrder: number;
  subFieldKind: string;
  models: AbayaCatalogModel[];
};

/** Default customer price (AED string) from catalog model; empty if unset. */
export function defaultSaleAedFromCatalogModel(m: AbayaCatalogModel | undefined): string {
  if (m == null || !Number.isFinite(m.defaultPriceFils) || m.defaultPriceFils < 0) return "";
  return (m.defaultPriceFils / 100).toFixed(2);
}

/**
 * Local datetime string for `<input type="datetime-local" />`:
 * today + `days` calendar days, keeping the current clock time.
 */
export function dueDateTimeLocalFromNowCalendarDays(days: number): string {
  const add = Math.max(0, Math.floor(Number(days)) || 0);
  const d = new Date();
  d.setDate(d.getDate() + add);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${da}T${h}:${mi}`;
}

export function resolveAbayaType(
  abayaTypeId: string,
  catalog: { types: AbayaCatalogType[] } | undefined,
): AbayaCatalogType | undefined {
  if (!catalog?.types.length || !abayaTypeId) return undefined;
  const byId = catalog.types.find((t) => t.id === abayaTypeId);
  if (byId) return byId;
  return catalog.types.find((t) => t.code === abayaTypeId);
}

export function needsModelPicker(t: AbayaCatalogType | undefined): boolean {
  if (!t) return false;
  return t.subFieldKind === "MODEL_PICK" || t.subFieldKind === "EMBROIDERY_PICK";
}

export function needsCustomText(t: AbayaCatalogType | undefined): boolean {
  return t?.subFieldKind === "CUSTOM_TEXT";
}

/** @returns error message in Arabic or null if OK */
export function validateTailoringAbayaSelection(
  abayaTypeId: string,
  abayaModelId: string,
  customStyleText: string,
  catalog: { types: AbayaCatalogType[] } | undefined,
): string | null {
  if (!abayaTypeId?.trim()) return "اختر نوع العباية.";
  const t = resolveAbayaType(abayaTypeId, catalog);
  if (!t) return "نوع العباية غير صالح.";
  if (needsModelPicker(t)) {
    if (!abayaModelId?.trim()) return "اختر الموديل أو التصميم.";
  }
  if (needsCustomText(t)) {
    if (!customStyleText?.trim()) return "اكتب وصف التفصيل المخصص.";
  }
  return null;
}

export function formatModelOption(m: { code: string; name: string }): string {
  return `${m.code} — ${m.name}`;
}
