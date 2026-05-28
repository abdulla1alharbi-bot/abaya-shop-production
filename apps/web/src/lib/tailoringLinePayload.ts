import type { TailoringCartLine } from "@/types/posCart";
import type { AbayaCatalogType } from "@/lib/abayaTailoringCatalog";
import { needsCustomText, resolveAbayaType } from "@/lib/abayaTailoringCatalog";

export interface FabricRollRow {
  id: string;
  rollCode: string;
  name: string;
  type: string;
  color: string;
  availableMeters: number;
  category?: string;
}

export function sizeSummary(line: TailoringCartLine): string {
  if (line.sizeMode === "STANDARD") return `جاهز ${line.standardSize}`;
  const parts = [line.shoulder, line.chest, line.waist, line.hip, line.lengthVal, line.sleeve].filter(
    Boolean,
  );
  return parts.length ? `خاص: ${parts.join(" / ")}` : "مقاس خاص";
}

export function lineToMeasurementPayload(
  line: TailoringCartLine,
  roll: FabricRollRow | undefined,
  m: number,
): Record<string, unknown> {
  return {
    sizeType: line.sizeMode,
    standardSize: line.sizeMode === "STANDARD" ? line.standardSize : undefined,
    shoulder: line.sizeMode === "CUSTOM" && line.shoulder ? Number(line.shoulder) : undefined,
    chest: line.sizeMode === "CUSTOM" && line.chest ? Number(line.chest) : undefined,
    waist: line.sizeMode === "CUSTOM" && line.waist ? Number(line.waist) : undefined,
    hip: line.sizeMode === "CUSTOM" && line.hip ? Number(line.hip) : undefined,
    length: line.sizeMode === "CUSTOM" && line.lengthVal ? Number(line.lengthVal) : undefined,
    sleeve: line.sizeMode === "CUSTOM" && line.sleeve ? Number(line.sleeve) : undefined,
    fabricRollCode: roll?.rollCode,
    fabricName: roll?.name,
    fabricType: roll?.type,
    fabricColor: roll?.color,
    colorNote: line.colorNote.trim() || undefined,
    meters: m,
  };
}

export function tailoringLineToCheckoutItem(
  line: TailoringCartLine,
  rolls: FabricRollRow[] | undefined,
  catalog: { types: AbayaCatalogType[] } | undefined,
) {
  const roll = rolls?.find((r) => r.id === line.rollId);
  const m = parseFloat(line.meters);
  const typeRow = resolveAbayaType(line.abayaTypeId, catalog);
  const modelRow = typeRow?.models.find((mod) => mod.id === line.abayaModelId);

  let productStyle = typeRow?.labelAr ?? line.abayaTypeId;
  if (modelRow) {
    productStyle = `${typeRow?.labelAr ?? ""} — ${modelRow.code} — ${modelRow.name}`.trim();
  } else if (needsCustomText(typeRow) && line.customStyleText?.trim()) {
    productStyle = `${typeRow?.labelAr ?? "Custom"} — ${line.customStyleText.trim()}`;
  }

  const productId = modelRow?.productId ?? undefined;

  const lineLabel = [productStyle, roll ? `${roll.rollCode} · ${roll.name}` : "", roll?.color, sizeSummary(line)]
    .filter(Boolean)
    .join(" · ");

  return {
    productStyle,
    lineLabel: lineLabel.slice(0, 500),
    dueDate: new Date(line.dueDate).toISOString(),
    measurements: JSON.stringify(lineToMeasurementPayload(line, roll, m)),
    notes: line.itemNotes.trim() || undefined,
    costFils: Math.round((parseFloat(line.materialCostAed) || 0) * 100),
    totalFils: Math.round((parseFloat(line.saleAed) || 0) * 100),
    measurementId: line.measurementId ?? undefined,
    sourceDisplaySampleJobId: line.sourceDisplaySampleJobId ?? undefined,
    sourceDisplayModelId: line.sourceDisplayModelId ?? undefined,
    materials: [
      ...(line.rollId ? [{ rollId: line.rollId, meters: m }] : []),
      ...(line.laceRollId ? [{ rollId: line.laceRollId, meters: parseFloat(line.laceMeters) || 1 }] : []),
    ],
    assignments: [] as { workerId: string; workType: string }[],
    productId,
    abayaTypeId: typeRow?.id,
    abayaModelId: modelRow?.id,
    customStyleText: needsCustomText(typeRow) ? line.customStyleText.trim() || undefined : undefined,
  };
}

/** Short label for cart row */
export function tailoringLineDisplayLabel(line: TailoringCartLine, catalog: { types: AbayaCatalogType[] } | undefined): string {
  const typeRow = resolveAbayaType(line.abayaTypeId, catalog);
  const modelRow = typeRow?.models.find((mod) => mod.id === line.abayaModelId);
  if (modelRow) return `${typeRow?.labelAr ?? ""} — ${modelRow.code} — ${modelRow.name}`;
  if (needsCustomText(typeRow) && line.customStyleText?.trim()) {
    return `${typeRow?.labelAr ?? ""} — ${line.customStyleText.trim()}`;
  }
  return typeRow?.labelAr ?? (line.abayaTypeId || "تفصيل");
}
