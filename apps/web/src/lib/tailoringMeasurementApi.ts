import { resolveAbayaType, needsCustomText } from "@/lib/abayaTailoringCatalog";
import type { AbayaCatalogType } from "@/lib/abayaTailoringCatalog";
import type { TailoringDraft } from "@/types/posCart";

function num(s: string): number | undefined {
  const x = parseFloat(s);
  return Number.isFinite(x) ? x : undefined;
}

function abayaLabelFromDraft(
  draft: TailoringDraft,
  catalog: { types: AbayaCatalogType[] } | undefined,
): string {
  const type = resolveAbayaType(draft.abayaTypeId, catalog);
  const model = type?.models.find((m) => m.id === draft.abayaModelId);
  if (model && type) return `${type.labelAr} — ${model.code} — ${model.name}`;
  if (needsCustomText(type) && draft.customStyleText?.trim()) {
    return `${type?.labelAr ?? "Custom"} — ${draft.customStyleText.trim()}`;
  }
  return type?.labelAr ?? draft.abayaTypeId ?? "";
}

/** Body for POST/PATCH customer measurements from current tailoring draft. */
export function tailoringDraftToMeasurementBody(
  draft: TailoringDraft,
  catalog?: { types: AbayaCatalogType[] },
) {
  if (draft.sizeMode === "STANDARD") {
    const abayaLabel = abayaLabelFromDraft(draft, catalog);
    const line = `مقاس قياسي: ${draft.standardSize} — ${abayaLabel}`;
    const notes = draft.itemNotes.trim() ? `${line} — ${draft.itemNotes.trim()}` : line;
    return { notes };
  }

  const shoulder = num(draft.shoulder);
  const chest = num(draft.chest);
  const waist = num(draft.waist);
  const hip = num(draft.hip);
  const length = num(draft.lengthVal);
  const sleeve = num(draft.sleeve);
  const notes = draft.itemNotes.trim() || undefined;
  const out: {
    shoulder?: number;
    chest?: number;
    waist?: number;
    hip?: number;
    length?: number;
    sleeve?: number;
    notes?: string;
  } = {};
  if (shoulder !== undefined) out.shoulder = shoulder;
  if (chest !== undefined) out.chest = chest;
  if (waist !== undefined) out.waist = waist;
  if (hip !== undefined) out.hip = hip;
  if (length !== undefined) out.length = length;
  if (sleeve !== undefined) out.sleeve = sleeve;
  if (notes) out.notes = notes;
  return out;
}
