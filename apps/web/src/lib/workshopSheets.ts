/** Types and helpers for «قراءة ورقة الورشة» — mirrors apps/api/src/modules/workshop-sheets. */

export type WorkKind = "CUTTING" | "SEWING" | "EMBROIDERY" | "FINISHING" | "ARI" | "PUSSOS";
export type SheetKind = "WORK" | "ALTERATION";

export type DraftEntry = {
  key: string;
  nameAsWritten: string;
  workerId: string | null;
  amountAed: number | null;
  work: WorkKind | null;
  writtenUnder: string | null;
  ignore: boolean;
  doubts: string[];
};

export type DraftRow = {
  key: string;
  invoiceNo: string;
  invoiceAlternatives: string[];
  pieces: number | null;
  modelText: string | null;
  dateText: string | null;
  jobIds: string[] | null;
  ignore: boolean;
  doubts: string[];
  entries: DraftEntry[];
};

export type StepState = "NEW" | "DONE_SAME" | "DONE_OTHER" | "SKIP" | "CLOSE" | "OPEN";
export type PlanStep = {
  kind: "STAGE" | "EXTRA";
  work: WorkKind;
  workerId: string | null;
  workerName: string | null;
  wageFils: number;
  state: StepState;
  auto: boolean;
  note: string | null;
};
export type PlanPiece = {
  jobId: string;
  jobNo: number;
  label: string;
  stageBefore: string;
  completedAt: string;
  steps: PlanStep[];
  becomesReady: boolean;
  needsPipeline: boolean;
};
export type RowStatus = "ok" | "warn" | "error" | "done" | "ignored";
export type ResolvedRow = {
  key: string;
  status: RowStatus;
  reasons: string[];
  invoice: { id: string; invoiceNo: number; customerName: string | null } | null;
  candidates: Array<{ id: string; jobNo: number; label: string; stage: string }>;
  pieces: PlanPiece[];
  entries: Array<{ key: string; workerName: string | null; work: WorkKind | null; amountFils: number | null; problems: string[] }>;
  /** A tailored abaya back for a free repair: only a note goes on the invoice. */
  freeRepair: { note: string; pieces: number; alreadyNoted: boolean } | null;
};
export type WorkerTotal = { workerId: string; workerName: string; pieces: number; totalFils: number; newFils: number };
export type SheetPlan = {
  rows: ResolvedRow[];
  totals: WorkerTotal[];
  grandTotalFils: number;
  newTotalFils: number;
  counts: Record<RowStatus, number>;
};

export type SheetRecord = {
  id: string;
  kind: SheetKind;
  sheetDate: string;
  status: "DRAFT" | "APPROVING" | "APPROVED";
  linesApplied: number;
  totalFils: number;
  createdAt: string;
  approvedAt: string | null;
  aiModel?: string | null;
  aiInputTokens?: number | null;
  aiOutputTokens?: number | null;
  createdBy?: { name: string } | null;
  approvedBy?: { name: string } | null;
};

export const WORK_LABEL_AR: Record<WorkKind, string> = {
  CUTTING: "قص",
  SEWING: "خياطة",
  EMBROIDERY: "تطريز",
  FINISHING: "شغل يدوي",
  ARI: "ARI",
  PUSSOS: "PUSSOS",
};

/** yyyy-mm-dd in local time. */
export function toDateInput(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** A yyyy-mm-dd day → that day at midday, as ISO (safely inside the day in any zone nearby). */
export function dateInputToIso(day: string): string {
  return new Date(`${day}T12:00:00`).toISOString();
}

/**
 * Phone photos are 3–8 MB; the reading needs far less. Re-encode as JPEG with the
 * long side at most `maxSide` px, upright (EXIF orientation applied).
 */
export async function shrinkPhoto(file: File, maxSide = 2400): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("تعذّر فتح الصورة — صوّر الورقة بصيغة JPG");
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("تعذّر تجهيز الصورة");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("تعذّر تجهيز الصورة");
  return blob;
}
