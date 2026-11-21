import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { WORK_TYPE_LABELS } from "@abaya-shop/shared";
import { prisma } from "../../config/db.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/rbac.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../middleware/error.middleware.js";
import { DEFAULT_READER_HINTS, SHEET_MODEL_DEFAULT, readSheetImage, type SheetKind, type SheetRead } from "./sheetAi.js";
import { draftFromRead, resolveSheet, sheetDateFromText, type DraftRow } from "./sheetResolve.js";
import { applySheet } from "./sheetApply.js";

/**
 * «قراءة ورقة الورشة»: photo → Claude reads → owner reviews → approve.
 * Nothing touches stages or wages before `/approve`.
 */

const PERM = "workshopSheets.import";
/** The API takes images up to ~5 MB base64; the web app downsizes before upload. */
const MAX_IMAGE_BYTES = 3_700_000;
/** Kept out of the public `/uploads` static route (see app.ts): wages and invoice numbers. */
const SHEET_DIR = path.join(process.cwd(), "uploads", "private", "workshop-sheets");

const MEDIA: Record<string, { ext: string; type: "image/jpeg" | "image/png" | "image/webp" }> = {
  "image/jpeg": { ext: ".jpg", type: "image/jpeg" },
  "image/jpg": { ext: ".jpg", type: "image/jpeg" },
  "image/png": { ext: ".png", type: "image/png" },
  "image/webp": { ext: ".webp", type: "image/webp" },
};

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const entrySchema = z.object({
  key: z.string(),
  nameAsWritten: z.string(),
  workerId: z.string().nullable(),
  amountAed: z.number().nullable(),
  work: z.enum(["CUTTING", "SEWING", "EMBROIDERY", "FINISHING", "ARI", "PUSSOS"]).nullable(),
  writtenUnder: z.string().nullable(),
  ignore: z.boolean(),
  doubts: z.array(z.string()),
});
const rowSchema = z.object({
  key: z.string(),
  invoiceNo: z.string(),
  invoiceAlternatives: z.array(z.string()),
  pieces: z.number().int().min(1).max(100).nullable(),
  modelText: z.string().nullable(),
  dateText: z.string().nullable(),
  jobIds: z.array(z.string()).nullable(),
  ignore: z.boolean(),
  doubts: z.array(z.string()),
  entries: z.array(entrySchema).max(30),
});
const reviewBody = z.object({
  sheetDate: z.string(),
  rows: z.array(rowSchema).max(200),
});

async function settingValue(key: string): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? "";
}

/** Settings first (the owner cannot use SSH); env only as a fallback. */
async function apiKey(): Promise<string> {
  const key = (await settingValue("anthropic_api_key")).trim() || process.env.ANTHROPIC_API_KEY?.trim() || "";
  if (!key) {
    throw new AppError(400, "أضف مفتاح Anthropic في الإعدادات ← قراءة أوراق الورشة", "AI_KEY_MISSING");
  }
  return key;
}

async function sheetModel(): Promise<string> {
  return (await settingValue("sheet_ai_model")).trim() || SHEET_MODEL_DEFAULT;
}

function parseSheetDate(raw: string): Date {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new AppError(400, "تاريخ الورقة غير صحيح", "VALIDATION_ERROR");
  if (d.getTime() > Date.now() + 86_400_000) throw new AppError(400, "تاريخ الورقة في المستقبل", "VALIDATION_ERROR");
  return d;
}

function sheetLabel(kind: string, d: Date): string {
  const day = d.toISOString().slice(0, 10);
  return kind === "ALTERATION" ? `دفتر التعديل ${day}` : day;
}

async function loadSheetOr404(id: string) {
  const sheet = await prisma.workshopSheet.findUnique({
    where: { id },
    include: {
      createdBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
    },
  });
  if (!sheet) throw new AppError(404, "الورقة غير موجودة", "NOT_FOUND");
  return sheet;
}

/** The same photo already approved, or another reading of it still open. */
async function samePhoto(sha: string, excludeId?: string) {
  return prisma.workshopSheet.findFirst({
    where: { imageSha256: sha, ...(excludeId ? { id: { not: excludeId } } : {}) },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, createdAt: true, approvedAt: true },
  });
}

export const workshopSheetsRouter = Router();
workshopSheetsRouter.use(authMiddleware);

/** History: newest first. */
workshopSheetsRouter.get(
  "/",
  requirePermission(PERM),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.workshopSheet.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        kind: true,
        sheetDate: true,
        status: true,
        linesApplied: true,
        totalFils: true,
        createdAt: true,
        approvedAt: true,
        aiInputTokens: true,
        aiOutputTokens: true,
        createdBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
      },
    });
    res.status(200).json({ success: true, data: rows });
  }),
);

/** Photo + kind → Claude reads it → a DRAFT sheet with the proposed rows and their check. */
workshopSheetsRouter.post(
  "/read",
  requirePermission(PERM),
  (req, res, next) => {
    upload.single("image")(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        next(new AppError(400, err.code === "LIMIT_FILE_SIZE" ? "الصورة كبيرة جدًا" : err.message, "UPLOAD_ERROR"));
        return;
      }
      if (err) {
        next(err);
        return;
      }
      next();
    });
  },
  asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    const file = req.file;
    if (!file) throw new AppError(400, "أرفق صورة الورقة", "VALIDATION_ERROR");
    const media = MEDIA[file.mimetype];
    if (!media) throw new AppError(400, "صوّر الورقة بصيغة JPG أو PNG", "VALIDATION_ERROR");
    if (file.size > MAX_IMAGE_BYTES) throw new AppError(400, "الصورة كبيرة — صوّرها مرة ثانية", "VALIDATION_ERROR");
    const kind: SheetKind = req.body?.kind === "ALTERATION" ? "ALTERATION" : "WORK";

    const key = await apiKey();
    const sha = createHash("sha256").update(file.buffer).digest("hex");
    const previous = await samePhoto(sha);

    const workers = await prisma.worker.findMany({
      where: { isActive: true },
      select: { id: true, name: true, specializations: true },
      orderBy: { name: "asc" },
    });
    const readerWorkers = workers.map((w) => {
      let jobs: string[] = [];
      try {
        const v: unknown = w.specializations ? JSON.parse(w.specializations) : [];
        if (Array.isArray(v)) jobs = v.map((x) => WORK_TYPE_LABELS[String(x)] ?? String(x));
      } catch {
        jobs = [];
      }
      return { name: w.name, jobs };
    });
    const hints = (await settingValue("sheet_reader_hints")).trim() || DEFAULT_READER_HINTS;

    const result = await readSheetImage({
      apiKey: key,
      model: await sheetModel(),
      kind,
      image: file.buffer,
      mediaType: media.type,
      workers: readerWorkers,
      hints,
    });

    const now = new Date();
    const bodyDate = typeof req.body?.sheetDate === "string" && req.body.sheetDate ? parseSheetDate(req.body.sheetDate) : null;
    const sheetDate = bodyDate ?? sheetDateFromText(result.read.sheetDateText, now) ?? now;

    fs.mkdirSync(SHEET_DIR, { recursive: true });
    const fileName = `${randomUUID()}${media.ext}`;
    fs.writeFileSync(path.join(SHEET_DIR, fileName), file.buffer);

    const sheet = await prisma.workshopSheet.create({
      data: {
        kind,
        sheetDate,
        imagePath: fileName,
        imageSha256: sha,
        aiModel: result.model,
        aiInputTokens: result.inputTokens,
        aiOutputTokens: result.outputTokens,
        readJson: JSON.stringify(result.read),
        createdById: userId,
      },
    });

    const rows = draftFromRead(result.read, workers);
    const plan = await resolveSheet(prisma, { kind, sheetDate, rows });
    res.status(201).json({
      success: true,
      data: { sheet, rows, plan, sheetDateText: result.read.sheetDateText, samePhoto: previous },
    });
  }),
);

/** A sheet with its rows: the approved ones, or a fresh draft from what was read. */
workshopSheetsRouter.get(
  "/:id",
  requirePermission(PERM),
  asyncHandler(async (req, res) => {
    const sheet = await loadSheetOr404(req.params.id!);
    let rows: DraftRow[] = [];
    if (sheet.approvedJson) rows = JSON.parse(sheet.approvedJson) as DraftRow[];
    else if (sheet.readJson) {
      const workers = await prisma.worker.findMany({ select: { id: true, name: true } });
      rows = draftFromRead(JSON.parse(sheet.readJson) as SheetRead, workers);
    }
    const plan =
      sheet.status === "DRAFT"
        ? await resolveSheet(prisma, { kind: sheet.kind as SheetKind, sheetDate: sheet.sheetDate, rows })
        : null;
    const { readJson: _r, approvedJson: _a, ...rest } = sheet;
    res.status(200).json({ success: true, data: { sheet: rest, rows, plan } });
  }),
);

/** The photo itself — only for people who may import sheets. */
workshopSheetsRouter.get(
  "/:id/image",
  requirePermission(PERM),
  asyncHandler(async (req, res) => {
    const sheet = await loadSheetOr404(req.params.id!);
    if (!sheet.imagePath) throw new AppError(404, "لا توجد صورة", "NOT_FOUND");
    const file = path.join(SHEET_DIR, path.basename(sheet.imagePath));
    if (!fs.existsSync(file)) throw new AppError(404, "الصورة غير موجودة", "NOT_FOUND");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.sendFile(file);
  }),
);

/** Re-check edited rows. Writes nothing. */
workshopSheetsRouter.post(
  "/:id/resolve",
  requirePermission(PERM),
  validateBody(reviewBody),
  asyncHandler(async (req, res) => {
    const sheet = await loadSheetOr404(req.params.id!);
    const body = req.body as z.infer<typeof reviewBody>;
    const plan = await resolveSheet(prisma, {
      kind: sheet.kind as SheetKind,
      sheetDate: parseSheetDate(body.sheetDate),
      rows: body.rows,
    });
    res.status(200).json({ success: true, data: { plan } });
  }),
);

/** Approve: check again, then write the whole sheet in one transaction. */
workshopSheetsRouter.post(
  "/:id/approve",
  requirePermission(PERM),
  validateBody(reviewBody),
  asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    const sheet = await loadSheetOr404(req.params.id!);
    if (sheet.status !== "DRAFT") throw new AppError(409, "هذه الورقة معتمدة من قبل", "ALREADY_APPROVED");
    const body = req.body as z.infer<typeof reviewBody>;
    const sheetDate = parseSheetDate(body.sheetDate);
    const plan = await resolveSheet(prisma, { kind: sheet.kind as SheetKind, sheetDate, rows: body.rows });
    if (plan.counts.error > 0) {
      res.status(400).json({
        success: false,
        error: { code: "SHEET_HAS_ERRORS", message: `فيه ${plan.counts.error} سطر أحمر — صحّحه أو احذفه أولًا` },
        data: { plan },
      });
      return;
    }

    // Claim the sheet first so two approvals of the same draft cannot both write.
    const claimed = await prisma.workshopSheet.updateMany({
      where: { id: sheet.id, status: "DRAFT" },
      data: { status: "APPROVING" },
    });
    if (claimed.count === 0) throw new AppError(409, "هذه الورقة معتمدة من قبل", "ALREADY_APPROVED");

    let result;
    try {
      result = await applySheet(prisma, {
        sheetId: sheet.id,
        userId,
        sheetLabel: sheetLabel(sheet.kind, sheetDate),
        plan,
      });
    } catch (err) {
      await prisma.workshopSheet.update({ where: { id: sheet.id }, data: { status: "DRAFT" } });
      throw err;
    }

    const approved = await prisma.workshopSheet.update({
      where: { id: sheet.id },
      data: {
        status: "APPROVED",
        sheetDate,
        approvedJson: JSON.stringify(body.rows),
        linesApplied: result.linesApplied,
        totalFils: result.totalFils,
        approvedById: userId,
        approvedAt: new Date(),
      },
    });
    await prisma.auditLog
      .create({
        data: {
          userId,
          action: "WORKSHOP_SHEET_APPROVED",
          entity: "WorkshopSheet",
          entityId: sheet.id,
          newValue: JSON.stringify({
            kind: sheet.kind,
            sheetDate: sheetDate.toISOString(),
            linesApplied: result.linesApplied,
            totalFils: result.totalFils,
            readyPieces: result.readyJobIds.length,
            freeRepairNotes: result.notesWritten,
          }),
        },
      })
      .catch(() => undefined);

    res.status(200).json({
      success: true,
      data: {
        sheet: approved,
        linesApplied: result.linesApplied,
        totalFils: result.totalFils,
        readyPieces: result.readyJobIds.length,
        freeRepairNotes: result.notesWritten,
      },
    });
  }),
);

/** Throw away a draft (nothing was written for it). */
workshopSheetsRouter.delete(
  "/:id",
  requirePermission(PERM),
  asyncHandler(async (req, res) => {
    const sheet = await loadSheetOr404(req.params.id!);
    if (sheet.status !== "DRAFT") throw new AppError(400, "لا يمكن حذف ورقة معتمدة", "ALREADY_APPROVED");
    await prisma.workshopSheet.delete({ where: { id: sheet.id } });
    if (sheet.imagePath) {
      fs.rm(path.join(SHEET_DIR, path.basename(sheet.imagePath)), { force: true }, () => undefined);
    }
    res.status(200).json({ success: true, data: { id: sheet.id } });
  }),
);

/** Settings ← «اختبار»: does the stored key work? Costs nothing (no tokens). */
export const workshopSheetsSettingsRouter = Router();
workshopSheetsSettingsRouter.use(authMiddleware);
workshopSheetsSettingsRouter.post(
  "/test-key",
  requirePermission("settings.manage"),
  asyncHandler(async (_req, res) => {
    const key = await apiKey();
    const model = await sheetModel();
    try {
      const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 20_000 });
      await client.models.retrieve(model);
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new AppError(400, "المفتاح غير صحيح", "AI_KEY_INVALID");
      }
      if (err instanceof Anthropic.NotFoundError) {
        throw new AppError(400, `النموذج ${model} غير متاح لهذا الحساب`, "AI_MODEL_UNAVAILABLE");
      }
      throw new AppError(502, "تعذّر الاتصال بـ Anthropic — حاول مرة أخرى", "AI_UNAVAILABLE");
    }
    res.status(200).json({ success: true, data: { ok: true, model } });
  }),
);
