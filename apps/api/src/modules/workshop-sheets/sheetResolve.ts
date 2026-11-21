import type { PrismaClient } from "@prisma/client";
import { EXTRA_WORK_TYPES } from "@abaya-shop/shared";
import { resolvePipelineStageKeysFromModelJson } from "../job-orders/jobStageHelpers.js";
import type { SheetKind, SheetRead } from "./sheetAi.js";

/**
 * Turns the rows of a workshop sheet into a concrete plan — which invoice, which
 * pieces, which stage gets which worker and wage — WITHOUT writing anything.
 * The review screen shows this plan; approval re-runs it and applies exactly it.
 *
 * Owner's rules (2026-11-21/22 discussion):
 * - Each "name + amount" is a worker who worked the piece and their pay; the
 *   stage comes from the worker's own job, never from the column it sits in.
 * - Cutting is never written: always the shop cutter (Mahbob, 5 AED) — except on
 *   alteration ("W") rows.
 * - A multi-piece row ("3P") carries the total for all pieces: split equally.
 * - W = تعديل: the written workers are paid and the piece becomes ready.
 * - Alteration notebook: every open stage of every piece → Ahsan, 0 AED → ready.
 * - A stage already completed (by hand or an earlier sheet) is never paid twice.
 */

export type StageKey = "CUTTING" | "SEWING" | "EMBROIDERY" | "FINISHING";
export type WorkKind = StageKey | "ARI" | "PUSSOS";
const STAGE_KEYS: readonly StageKey[] = ["CUTTING", "SEWING", "EMBROIDERY", "FINISHING"];
const OPTIONAL_STAGES: readonly StageKey[] = ["EMBROIDERY", "FINISHING"];
const FINISHED_JOB_STAGES = new Set(["READY", "DELIVERED", "CANCELLED", "CONVERTED_TO_READY"]);

// ─── editable rows (what the review screen sends back) ───────────────────

export type DraftEntry = {
  key: string;
  nameAsWritten: string;
  workerId: string | null;
  /** AED as written — the total for the row. */
  amountAed: number | null;
  /** Owner override of the kind of work; null = from the worker's card. */
  work: WorkKind | null;
  /** Printed column the name sat under (from the reading; a fallback only). */
  writtenUnder: string | null;
  ignore: boolean;
  /** Reading doubts still to look at (Arabic). Cleared when the owner edits or confirms. */
  doubts: string[];
};

export type DraftRow = {
  key: string;
  invoiceNo: string;
  invoiceAlternatives: string[];
  pieces: number | null;
  modelText: string | null;
  /** Notebook only: the date heading the line was under ("29-9"). */
  dateText: string | null;
  /** Owner-picked pieces; null = pick automatically. */
  jobIds: string[] | null;
  ignore: boolean;
  doubts: string[];
  entries: DraftEntry[];
};

// ─── plan (what the server answers) ───────────────────────────────────────

export type StepState =
  | "NEW" // will be written on approval
  | "DONE_SAME" // already recorded exactly like this
  | "DONE_OTHER" // already recorded with another worker or wage — left as it is
  | "SKIP" // nobody did this stage on this piece — removed from the piece
  | "CLOSE" // nobody did it, but it is the piece's last stage row: closed with no worker, 0 AED
  | "OPEN"; // not done, nobody on the sheet — the piece stays in the workshop

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
  /** Pipeline rows must be created first (piece never entered the workshop). */
  needsPipeline: boolean;
};

export type RowStatus = "ok" | "warn" | "error" | "done" | "ignored";

export type ResolvedEntry = {
  key: string;
  workerName: string | null;
  work: WorkKind | null;
  amountFils: number | null;
  problems: string[];
};

export type ResolvedRow = {
  key: string;
  status: RowStatus;
  reasons: string[];
  invoice: { id: string; invoiceNo: number; customerName: string | null } | null;
  candidates: Array<{ id: string; jobNo: number; label: string; stage: string }>;
  pieces: PlanPiece[];
  entries: ResolvedEntry[];
  /**
   * Notebook line whose invoice has no alteration piece: an abaya that came back
   * for a specific FREE repair. Approval writes `note` on the invoice and touches
   * no stage (so the tailor's own wages stay correct). Null otherwise.
   */
  freeRepair: { note: string; pieces: number; alreadyNoted: boolean } | null;
};

export type WorkerTotal = {
  workerId: string;
  workerName: string;
  /** Distinct pieces and money as written on the paper (plus the automatic cutting). */
  pieces: number;
  totalFils: number;
  /** What approval will actually add (excludes lines already recorded). */
  newFils: number;
};

export type ResolveResult = {
  rows: ResolvedRow[];
  totals: WorkerTotal[];
  grandTotalFils: number;
  newTotalFils: number;
  counts: Record<RowStatus, number>;
};

// ─── pure helpers (unit-tested) ───────────────────────────────────────────

export function digitsOnly(s: string | null | undefined): string {
  return (s ?? "").replace(/[^\d]/g, "");
}

/** Equal split in fils; the first pieces absorb the remainder so the sum is exact. */
export function splitFils(totalFils: number, parts: number): number[] {
  const n = Math.max(1, parts);
  const base = Math.floor(totalFils / n);
  const rest = totalFils - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}

/** Worker card specializations → the kinds of sheet work they do. */
export function workKindsFromSpecializations(raw: string | null | undefined): WorkKind[] {
  let list: unknown = [];
  try {
    list = raw ? JSON.parse(raw) : [];
  } catch {
    list = [];
  }
  if (!Array.isArray(list)) return [];
  const out = new Set<WorkKind>();
  for (const v of list) {
    switch (v) {
      case "CUTTING":
        out.add("CUTTING");
        break;
      case "SEWING":
      case "SEW_BASIC":
      case "SEW_LINING":
        out.add("SEWING");
        break;
      case "MACHINE_EMBROIDERY":
      case "EMBROIDERY":
        out.add("EMBROIDERY");
        break;
      // In the shop's Arabic UI HAND_EMBROIDERY reads «عمل يدوي» — the same
      // handwork as FINISHING («الشغل اليدوي»).
      case "HAND_EMBROIDERY":
      case "FINISHING":
        out.add("FINISHING");
        break;
      case "ARI":
        out.add("ARI");
        break;
      case "PUSSOS":
        out.add("PUSSOS");
        break;
      default:
        break;
    }
  }
  return [...out];
}

export function workKindFromColumn(col: string | null | undefined): WorkKind | null {
  switch (col) {
    case "CUTTING":
      return "CUTTING";
    case "TAILORING":
      return "SEWING";
    case "HANDWORK":
      return "FINISHING";
    case "EMBROIDERY":
      return "EMBROIDERY";
    default:
      return null;
  }
}

export type ModelWord = "ALTERATION" | "PLAIN" | "SHAYLA" | "NIQAB" | "GASHWA" | "DRESS" | null;

export function modelWord(modelText: string | null | undefined): ModelWord {
  const t = (modelText ?? "").trim().toLowerCase();
  if (!t) return null;
  if (t === "w" || t === "ω" || t.includes("تعديل")) return "ALTERATION";
  if (t.startsWith("shd") || t.startsWith("shad") || t.startsWith("sad") || t.includes("سادة")) return "PLAIN";
  if (t.includes("sel") || t.includes("shay") || t.includes("شيل")) return "SHAYLA";
  if (t.includes("nik") || t.includes("niq") || t.includes("نقاب")) return "NIQAB";
  if (t.includes("gash") || t.includes("gon") || t.includes("قشو")) return "GASHWA";
  if (t.includes("dress") || t.includes("فستان")) return "DRESS";
  return null;
}

/** "29-9" / "3-10" → a date in the latest year that is not in the future. */
export function notebookDate(dateText: string | null | undefined, now: Date): Date | null {
  const m = (dateText ?? "").match(/(\d{1,2})\s*[-./]\s*(\d{1,2})/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (!(day >= 1 && day <= 31 && month >= 1 && month <= 12)) return null;
  let d = new Date(now.getFullYear(), month - 1, day, 12, 0, 0);
  if (d.getTime() > now.getTime()) d = new Date(now.getFullYear() - 1, month - 1, day, 12, 0, 0);
  return d;
}

/** "D: 24-10-26 - 25-10-26" → the LAST date (the day the sheet was closed), at midday. */
export function sheetDateFromText(text: string | null | undefined, now: Date): Date | null {
  const all = [...(text ?? "").matchAll(/(\d{1,2})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{2,4})/g)];
  const last = all[all.length - 1];
  if (!last) return null;
  const day = Number(last[1]);
  const month = Number(last[2]);
  let year = Number(last[3]);
  if (year < 100) year += 2000;
  if (!(day >= 1 && day <= 31 && month >= 1 && month <= 12)) return null;
  const d = new Date(year, month - 1, day, 12, 0, 0);
  if (Number.isNaN(d.getTime()) || d.getTime() > now.getTime() + 86_400_000) return null;
  return d;
}

/**
 * A spelling-tolerant key for a worker name: case, spaces, punctuation and
 * doubled letters are ignored, so "Mahbob" finds the card saved as "mahboob"
 * and "Shajahan" finds "Sahajahan" only if spelled closely enough — never a
 * different person.
 */
export function looseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z؀-ۿ]/g, "")
    .replace(/(.)\1+/g, "$1");
}

/** The one worker whose name matches (exact first, then spelling-tolerant); null when none or ambiguous. */
export function findWorkerByName<W extends { name: string; isActive?: boolean }>(workers: W[], name: string): W | null {
  const exact = workers.filter((w) => w.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (exact.length === 1) return exact[0]!;
  const key = looseName(name);
  if (!key) return null;
  const loose = workers.filter((w) => looseName(w.name) === key);
  const active = loose.filter((w) => w.isActive !== false);
  if (active.length === 1) return active[0]!;
  return loose.length === 1 ? loose[0]! : null;
}

/** Converts what Claude read into editable rows for the review screen. */
export function draftFromRead(
  read: SheetRead,
  workers: Array<{ id: string; name: string; isActive?: boolean }>,
): DraftRow[] {
  return read.rows.map((r, i) => {
    const rowDoubts: string[] = [];
    if (r.invoiceAlternatives.length) {
      rowDoubts.push(`رقم الفاتورة: ${[r.invoiceNo, ...r.invoiceAlternatives].filter(Boolean).join(" أو ")}؟`);
    }
    if (r.confidence !== "high") rowDoubts.push("السطر غير واضح في الصورة");
    if (r.note) rowDoubts.push(r.note);
    return {
      key: `r${i + 1}`,
      invoiceNo: digitsOnly(r.invoiceNo),
      invoiceAlternatives: r.invoiceAlternatives.map(digitsOnly).filter(Boolean),
      pieces: r.pieces,
      modelText: r.modelText,
      dateText: r.dateText,
      jobIds: null,
      ignore: r.struckOut,
      doubts: rowDoubts,
      entries: r.entries.map((e, j) => {
        const doubts: string[] = [];
        if (!e.sameLineAsInvoice) doubts.push("الاسم مكتوب بين سطرين — تأكد لأي فاتورة");
        if (e.amountAlternatives.length) doubts.push(`المبلغ: ${[e.amount, ...e.amountAlternatives].join(" أو ")}؟`);
        if (e.confidence !== "high") doubts.push(`الاسم «${e.nameAsWritten}» غير واضح`);
        return {
          key: `r${i + 1}e${j + 1}`,
          nameAsWritten: e.nameAsWritten,
          workerId: e.workerName ? (findWorkerByName(workers, e.workerName)?.id ?? null) : null,
          amountAed: e.amount,
          work: null,
          writtenUnder: e.writtenUnder,
          ignore: e.struckOut,
          doubts,
        };
      }),
    };
  });
}

// ─── database-backed resolution ───────────────────────────────────────────

export type SheetSettings = { cutterName: string; cutterWageFils: number; alterationWorkerName: string };

export async function loadSheetSettings(db: PrismaClient): Promise<SheetSettings> {
  const rows = await db.setting.findMany({
    where: { key: { in: ["sheet_cutter_name", "sheet_cutter_wage_fils", "sheet_alteration_worker_name"] } },
  });
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const wage = parseInt(s.sheet_cutter_wage_fils ?? "", 10);
  return {
    cutterName: s.sheet_cutter_name?.trim() || "Mahbob",
    cutterWageFils: Number.isFinite(wage) && wage >= 0 ? wage : 500,
    alterationWorkerName: s.sheet_alteration_worker_name?.trim() || "Ahsan",
  };
}

const EXTRA_TYPES: string[] = [...EXTRA_WORK_TYPES];

const jobSelect = {
  id: true,
  jobNo: true,
  stage: true,
  createdAt: true,
  productStyle: true,
  customStyleText: true,
  productionBatchId: true,
  isConvertedToReady: true,
  abayaModel: { select: { code: true, name: true, workflowStagesJson: true } },
  abayaType: { select: { code: true } },
  workStages: {
    select: {
      id: true,
      stageKey: true,
      sortOrder: true,
      status: true,
      workerId: true,
      wageFils: true,
      worker: { select: { name: true } },
    },
    orderBy: { sortOrder: "asc" as const },
  },
  productionEntries: {
    where: { workType: { in: EXTRA_TYPES } },
    select: { workerId: true, workType: true, totalFils: true },
  },
} as const;

type LoadedInvoice = {
  id: string;
  invoiceNo: number;
  isVoid: boolean;
  notes: string | null;
  customer: { name: string } | null;
  jobOrders: Array<{
    id: string;
    jobNo: number;
    stage: string;
    createdAt: Date;
    productStyle: string;
    customStyleText: string | null;
    productionBatchId: string | null;
    isConvertedToReady: boolean;
    abayaModel: { code: string; name: string; workflowStagesJson: string | null } | null;
    abayaType: { code: string } | null;
    workStages: Array<{
      id: string;
      stageKey: string;
      sortOrder: number;
      status: string;
      workerId: string | null;
      wageFils: number;
      worker: { name: string } | null;
    }>;
    productionEntries: Array<{ workerId: string; workType: string; totalFils: number }>;
  }>;
};
type LoadedJob = LoadedInvoice["jobOrders"][number];

function jobLabel(j: LoadedJob): string {
  const model = j.abayaModel?.code ? `موديل ${j.abayaModel.code}` : null;
  return [`#${j.jobNo}`, model ?? j.productStyle].filter(Boolean).join(" · ");
}

/** An alteration piece («تعديل» / Walter type) — the only pieces an alteration line may close. */
function isAlterationPiece(j: LoadedJob): boolean {
  const text = `${j.productStyle} ${j.customStyleText ?? ""} ${j.abayaModel?.name ?? ""}`;
  return j.abayaType?.code === "WALTER" || /تعديل|ولف/.test(text);
}

/** "إصلاح مجاني — ahsan — 30-09-2026 — 2 قطعة (دفتر التعديل)" */
export function freeRepairNote(workerName: string, date: Date, pieces: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const day = `${p(date.getDate())}-${p(date.getMonth() + 1)}-${date.getFullYear()}`;
  return `إصلاح مجاني — ${workerName} — ${day} — ${pieces} قطعة (دفتر التعديل)`;
}

function jobMatchesModel(j: LoadedJob, modelText: string | null): boolean {
  const code = digitsOnly(modelText);
  if (code) return digitsOnly(j.abayaModel?.code) === code;
  const word = modelWord(modelText);
  const text = `${j.productStyle} ${j.customStyleText ?? ""} ${j.abayaModel?.name ?? ""}`;
  switch (word) {
    case "ALTERATION":
      return j.abayaType?.code === "WALTER" || /تعديل|ولف/.test(text);
    case "PLAIN":
      return /سادة|سادا/.test(text);
    case "SHAYLA":
      return j.abayaType?.code === "SHALIA" || /شيل|شال/.test(text);
    case "NIQAB":
      return j.abayaType?.code === "NICKAB" || /نقاب/.test(text);
    case "GASHWA":
      return j.abayaType?.code === "GASHWA" || /قشو/.test(text);
    case "DRESS":
      return /فستان|dress/i.test(text);
    default:
      return true;
  }
}

function addTotal(
  map: Map<string, WorkerTotal & { jobs: Set<string> }>,
  workerId: string,
  workerName: string,
  jobId: string,
  fils: number,
  isNew: boolean,
) {
  const t = map.get(workerId) ?? { workerId, workerName, pieces: 0, totalFils: 0, newFils: 0, jobs: new Set<string>() };
  t.jobs.add(jobId);
  t.pieces = t.jobs.size;
  t.totalFils += fils;
  if (isNew) t.newFils += fils;
  map.set(workerId, t);
}

export async function resolveSheet(
  db: PrismaClient,
  input: { kind: SheetKind; sheetDate: Date; rows: DraftRow[]; now?: Date },
): Promise<ResolveResult> {
  const now = input.now ?? new Date();
  const settings = await loadSheetSettings(db);
  const workers = await db.worker.findMany({ select: { id: true, name: true, isActive: true, specializations: true } });
  const workerById = new Map(workers.map((w) => [w.id, w]));
  const cutter = findWorkerByName(workers, settings.cutterName);
  const altWorker = findWorkerByName(workers, settings.alterationWorkerName);

  const numbers = new Set<number>();
  for (const r of input.rows) {
    for (const s of [r.invoiceNo, ...r.invoiceAlternatives]) {
      const n = parseInt(digitsOnly(s), 10);
      if (Number.isFinite(n)) numbers.add(n);
    }
  }
  const invoices = (await db.invoice.findMany({
    where: { invoiceNo: { in: [...numbers] } },
    select: {
      id: true,
      invoiceNo: true,
      isVoid: true,
      notes: true,
      customer: { select: { name: true } },
      jobOrders: { select: jobSelect, orderBy: { jobNo: "asc" } },
    },
  })) as unknown as LoadedInvoice[];
  const invoiceByNo = new Map(invoices.map((i) => [i.invoiceNo, i]));

  const totals = new Map<string, WorkerTotal & { jobs: Set<string> }>();
  /** Stages planned by earlier rows of this same sheet — a later row must not plan them again. */
  const plannedStage = new Set<string>();
  const out: ResolvedRow[] = [];

  for (const row of input.rows) {
    const reasons: string[] = [];
    const errors: string[] = [];
    const resolved: ResolvedRow = {
      key: row.key,
      status: "ok",
      reasons,
      invoice: null,
      candidates: [],
      pieces: [],
      entries: [],
      freeRepair: null,
    };
    out.push(resolved);
    if (row.ignore) {
      resolved.status = "ignored";
      continue;
    }

    // 1) invoice — the number as read, else a plausible alternative reading.
    // An alteration line prefers an invoice that has alteration pieces.
    const isAlterationRow = input.kind === "ALTERATION" || modelWord(row.modelText) === "ALTERATION";
    const fits = (a: LoadedInvoice) =>
      isAlterationRow ? a.jobOrders.some(isAlterationPiece) : a.jobOrders.some((j) => jobMatchesModel(j, row.modelText));
    const primary = parseInt(digitsOnly(row.invoiceNo), 10);
    let inv = Number.isFinite(primary) ? invoiceByNo.get(primary) : undefined;
    if (!inv || inv.isVoid || !fits(inv)) {
      const alt = row.invoiceAlternatives
        .map((s) => invoiceByNo.get(parseInt(digitsOnly(s), 10)))
        .find((a) => a && !a.isVoid && fits(a));
      if (alt) {
        reasons.push(
          inv
            ? `الفاتورة ${row.invoiceNo} ما فيها هذا الموديل — اختيرت ${alt.invoiceNo}`
            : `الرقم ${row.invoiceNo || "؟"} غير موجود — اختيرت ${alt.invoiceNo}`,
        );
        inv = alt;
      }
    }
    if (!inv) {
      errors.push(row.invoiceNo ? `الفاتورة ${row.invoiceNo} غير موجودة` : "رقم الفاتورة ناقص");
    } else if (inv.isVoid) {
      errors.push(`الفاتورة ${inv.invoiceNo} ملغاة`);
    }

    // 2) entries — worker, kind of work, amount.
    for (const e of row.entries) {
      const problems: string[] = [];
      const w = e.workerId ? workerById.get(e.workerId) : undefined;
      let work: WorkKind | null = e.work;
      if (!e.ignore) {
        if (!w) problems.push(`اختر العامل لـ «${e.nameAsWritten || "؟"}»`);
        if (!work && w) {
          const kinds = workKindsFromSpecializations(w.specializations);
          const fromColumn = workKindFromColumn(e.writtenUnder);
          if (kinds.length === 1) work = kinds[0]!;
          else if (kinds.length > 1) work = fromColumn && kinds.includes(fromColumn) ? fromColumn : null;
          else work = fromColumn;
          if (!work) problems.push(`حدد شغل ${w.name} (لا يوجد شغل واحد في بطاقته)`);
        }
        if (e.amountAed === null || Number.isNaN(e.amountAed)) problems.push(`المبلغ ناقص لـ ${w?.name ?? e.nameAsWritten}`);
        else if (e.amountAed < 0) problems.push("المبلغ لا يكون بالسالب");
      }
      resolved.entries.push({
        key: e.key,
        workerName: w?.name ?? null,
        work,
        amountFils: e.amountAed === null ? null : Math.round(e.amountAed * 100),
        problems,
      });
      errors.push(...problems);
    }
    // Two entries on one stage cannot both be paid through the stage.
    const stageWorks = resolved.entries
      .filter((e, i) => !row.entries[i]!.ignore && e.work && STAGE_KEYS.includes(e.work as StageKey))
      .map((e) => e.work);
    const dup = stageWorks.find((w, i) => stageWorks.indexOf(w) !== i);
    if (dup) errors.push(`عاملان على نفس المرحلة (${dup}) — غيّر شغل أحدهما أو احذفه`);

    if (inv) {
      resolved.invoice = { id: inv.id, invoiceNo: inv.invoiceNo, customerName: inv.customer?.name ?? null };
      const usable = inv.jobOrders.filter((j) => j.stage !== "CANCELLED" && !j.isConvertedToReady);
      resolved.candidates = usable.map((j) => ({ id: j.id, jobNo: j.jobNo, label: jobLabel(j), stage: j.stage }));

      // 3) pieces — owner's pick, else by model, preferring unfinished ones.
      let chosen: LoadedJob[];
      const want = Math.max(1, row.pieces ?? 1);
      if (row.jobIds?.length) {
        chosen = usable.filter((j) => row.jobIds!.includes(j.id));
        if (chosen.length !== row.jobIds.length) errors.push("قطعة مختارة لا تتبع هذه الفاتورة");
      } else if (isAlterationRow && !usable.some(isAlterationPiece)) {
        chosen = [];
        if (input.kind === "ALTERATION") {
          // A tailored abaya that came back for a specific free repair.
          const date = notebookDate(row.dateText, now) ?? input.sheetDate;
          const note = freeRepairNote(altWorker?.name ?? settings.alterationWorkerName, date, want);
          resolved.freeRepair = { note, pieces: want, alreadyNoted: (inv.notes ?? "").includes(note) };
          reasons.push(
            "فاتورة تفصيل بدون قطعة تعديل — غالبًا عباية رجعت لإصلاح مجاني. عند الاعتماد تنكتب ملاحظة على الفاتورة فقط، ولا تتغير المراحل",
          );
        } else {
          errors.push(`الفاتورة ${inv.invoiceNo} ما فيها قطعة تعديل — تأكد من الرقم، أو اختر القطعة بنفسك`);
        }
      } else {
        const byModel = usable.filter((j) => (isAlterationRow ? isAlterationPiece(j) : jobMatchesModel(j, row.modelText)));
        const pool = byModel.length ? byModel : usable;
        if (!byModel.length && row.modelText && usable.length) {
          reasons.push(`ما فيه قطعة «${row.modelText}» في الفاتورة — اختر القطعة`);
        }
        const open = pool.filter((j) => !FINISHED_JOB_STAGES.has(j.stage));
        const ordered = [...open, ...pool.filter((j) => FINISHED_JOB_STAGES.has(j.stage))];
        chosen = ordered.slice(0, want);
        if (pool.length > want && row.pieces === null && !digitsOnly(row.modelText)) {
          reasons.push(`الفاتورة فيها ${pool.length} قطع — تأكد من القطعة`);
        }
        if (row.pieces !== null && pool.length < want) {
          reasons.push(`الورقة تقول ${want} قطع والفاتورة فيها ${pool.length}`);
        }
      }
      if (!chosen.length && !resolved.freeRepair && !errors.some((e) => e.includes("قطعة تعديل"))) {
        errors.push("ما فيه قطعة على هذه الفاتورة");
      }

      // 4) per piece: what each stage gets.
      const rowDate =
        input.kind === "ALTERATION" ? (notebookDate(row.dateText, now) ?? input.sheetDate) : input.sheetDate;
      const shares = new Map<string, number[]>();
      resolved.entries.forEach((e, i) => {
        if (!row.entries[i]!.ignore && e.amountFils !== null) shares.set(e.key, splitFils(e.amountFils, chosen.length));
      });

      chosen.forEach((job, pieceIdx) => {
        if (job.productionBatchId) errors.push(`#${job.jobNo} قطعة إنتاج داخلي — أدخلها يدويًا`);
        const completedAt = rowDate.getTime() < job.createdAt.getTime() ? job.createdAt : rowDate;
        const needsPipeline = job.workStages.length === 0;
        const rows = needsPipeline
          ? resolvePipelineStageKeysFromModelJson(job.abayaModel?.workflowStagesJson).map((k, i) => ({
              id: "",
              stageKey: k,
              sortOrder: i,
              status: "PENDING",
              workerId: null as string | null,
              wageFils: 0,
              worker: null as { name: string } | null,
            }))
          : job.workStages;
        const steps: PlanStep[] = [];

        for (const st of rows) {
          const key = st.stageKey as StageKey;
          const entryIdx = resolved.entries.findIndex((e, i) => !row.entries[i]!.ignore && e.work === key);
          const entry = entryIdx >= 0 ? resolved.entries[entryIdx]! : null;
          const entryWorkerId = entry ? row.entries[entryIdx]!.workerId : null;
          const entryWage = entry ? (shares.get(entry.key)?.[pieceIdx] ?? 0) : 0;
          const plannedKey = `${job.id}:${key}`;

          if (plannedStage.has(plannedKey)) {
            steps.push({
              kind: "STAGE",
              work: key,
              workerId: null,
              workerName: null,
              wageFils: 0,
              state: "DONE_OTHER",
              auto: false,
              note: "سطر سابق في نفس الورقة يسجّل هذه المرحلة",
            });
            reasons.push(`#${job.jobNo} مكررة في نفس الورقة — تأكد`);
            continue;
          }
          if (st.status === "DONE") {
            const same = !entry || (st.workerId === entryWorkerId && st.wageFils === entryWage);
            steps.push({
              kind: "STAGE",
              work: key,
              workerId: st.workerId,
              workerName: st.worker?.name ?? null,
              wageFils: st.wageFils,
              state: same ? "DONE_SAME" : "DONE_OTHER",
              auto: false,
              note: same
                ? null
                : `مسجّلة من قبل باسم ${st.worker?.name ?? "—"} بأجر ${(st.wageFils / 100).toFixed(2)} — لن تتغير`,
            });
            continue;
          }
          if (st.status === "IN_PROGRESS" && st.workerId && !(entryWorkerId && entryWorkerId === st.workerId)) {
            errors.push(`#${job.jobNo}: ${key} عند ${st.worker?.name ?? "عامل"} ولم تكتمل — أكملها يدويًا أولًا`);
          }

          if (input.kind === "ALTERATION") {
            if (!altWorker) errors.push(`أضف العامل ${settings.alterationWorkerName} أولًا`);
            steps.push({
              kind: "STAGE",
              work: key,
              workerId: altWorker?.id ?? null,
              workerName: altWorker?.name ?? settings.alterationWorkerName,
              wageFils: 0,
              state: "NEW",
              auto: true,
              note: null,
            });
          } else if (entry && entryWorkerId) {
            steps.push({
              kind: "STAGE",
              work: key,
              workerId: entryWorkerId,
              workerName: entry.workerName,
              wageFils: entryWage,
              state: "NEW",
              auto: false,
              note: null,
            });
          } else if (key === "CUTTING" && !isAlterationRow) {
            if (!cutter) errors.push(`أضف العامل ${settings.cutterName} (القص) أولًا`);
            steps.push({
              kind: "STAGE",
              work: key,
              workerId: cutter?.id ?? null,
              workerName: cutter?.name ?? settings.cutterName,
              wageFils: settings.cutterWageFils,
              state: "NEW",
              auto: true,
              note: "قص تلقائي",
            });
          } else if (isAlterationRow || OPTIONAL_STAGES.includes(key)) {
            steps.push({
              kind: "STAGE",
              work: key,
              workerId: null,
              workerName: null,
              wageFils: 0,
              state: "SKIP",
              auto: true,
              note: isAlterationRow ? "تعديل — بدون هذه المرحلة" : "ما انكتب أحد — بدون هذه المرحلة",
            });
          } else {
            steps.push({
              kind: "STAGE",
              work: key,
              workerId: null,
              workerName: null,
              wageFils: 0,
              state: "OPEN",
              auto: false,
              note: "ما انكتب أحد — القطعة تبقى في الورشة",
            });
            reasons.push(`#${job.jobNo}: ${key === "SEWING" ? "الخياطة" : key} ما انكتبت`);
          }
          plannedStage.add(plannedKey);
        }

        // A stage written on the paper that this piece does not have.
        resolved.entries.forEach((e, i) => {
          if (row.entries[i]!.ignore || !e.work || !STAGE_KEYS.includes(e.work as StageKey)) return;
          if (!rows.some((r) => r.stageKey === e.work)) {
            errors.push(`#${job.jobNo} ما فيها مرحلة ${e.work} — غيّر شغل ${e.workerName ?? "العامل"}`);
          }
        });

        // Extra work (ARI / PUSSOS).
        resolved.entries.forEach((e, i) => {
          if (row.entries[i]!.ignore || (e.work !== "ARI" && e.work !== "PUSSOS")) return;
          const wid = row.entries[i]!.workerId;
          const wage = shares.get(e.key)?.[pieceIdx] ?? 0;
          const exists = job.productionEntries.some((p) => p.workType === e.work && p.workerId === wid);
          steps.push({
            kind: "EXTRA",
            work: e.work,
            workerId: wid,
            workerName: e.workerName,
            wageFils: wage,
            state: exists ? "DONE_SAME" : "NEW",
            auto: false,
            note: exists ? "مسجّل من قبل" : null,
          });
        });

        // Never remove every stage of a piece — keep the first, closed with no worker.
        const stageSteps = steps.filter((s) => s.kind === "STAGE");
        if (stageSteps.length && stageSteps.every((s) => s.state === "SKIP")) {
          stageSteps[0]!.state = "CLOSE";
          stageSteps[0]!.note = "تعديل — تُغلق بدون عامل";
        }

        const becomesReady = stageSteps.every((s) => s.state !== "OPEN");
        resolved.pieces.push({
          jobId: job.id,
          jobNo: job.jobNo,
          label: jobLabel(job),
          stageBefore: job.stage,
          completedAt: completedAt.toISOString(),
          steps,
          becomesReady,
          needsPipeline,
        });

        for (const s of steps) {
          if (!s.workerId || (s.state !== "NEW" && s.state !== "DONE_SAME")) continue;
          addTotal(totals, s.workerId, s.workerName ?? "—", job.id, s.wageFils, s.state === "NEW");
        }
      });
    }

    // 5) status
    const doubts = [...row.doubts, ...row.entries.filter((e) => !e.ignore).flatMap((e) => e.doubts)];
    reasons.push(...doubts);
    const anyNew = resolved.pieces.some((p) =>
      p.steps.some((s) => s.state === "NEW" || s.state === "SKIP" || s.state === "CLOSE"),
    );
    if (errors.length) {
      resolved.status = "error";
      reasons.unshift(...errors);
    } else if (resolved.freeRepair) {
      // Always worth a look: no stage changes, only a note on the invoice.
      resolved.status = resolved.freeRepair.alreadyNoted ? "done" : "warn";
      if (resolved.freeRepair.alreadyNoted) reasons.unshift("الإصلاح مكتوب على الفاتورة من قبل — لن يتكرر");
    } else if (!anyNew && resolved.pieces.length) {
      resolved.status = "done";
      reasons.unshift("مسجّل من قبل — لن يتكرر");
    } else if (reasons.length || resolved.pieces.some((p) => p.steps.some((s) => s.state === "DONE_OTHER"))) {
      resolved.status = "warn";
    }
  }

  const totalList: WorkerTotal[] = [...totals.values()]
    .map(({ jobs: _jobs, ...t }) => t)
    .sort((a, b) => b.totalFils - a.totalFils);
  const counts: Record<RowStatus, number> = { ok: 0, warn: 0, error: 0, done: 0, ignored: 0 };
  for (const r of out) counts[r.status] += 1;
  return {
    rows: out,
    totals: totalList,
    grandTotalFils: totalList.reduce((s, t) => s + t.totalFils, 0),
    newTotalFils: totalList.reduce((s, t) => s + t.newFils, 0),
    counts,
  };
}
