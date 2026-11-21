import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";
import { DEFAULT_SHEET_READER_HINTS } from "@abaya-shop/shared";
import { AppError } from "../../middleware/error.middleware.js";

/**
 * Reading a photographed workshop sheet with Claude.
 *
 * Claude only TRANSCRIBES: invoice numbers, piece counts, model words and every
 * "name + amount" pair, with its doubts. Matching to real invoices, pieces and
 * stages happens in `sheetResolve.ts` against the database, and nothing is
 * saved until the owner approves the reviewed rows.
 */

export const SHEET_MODEL_DEFAULT = "claude-opus-5-5";

const confidence = z.enum(["high", "medium", "low"]);

const SheetEntrySchema = z.object({
  /** The name exactly as handwritten (Latin letters as best read). */
  nameAsWritten: z.string(),
  /** The matching worker from the provided list, spelled exactly as listed — null when no listed worker fits. */
  workerName: z.string().nullable(),
  /** AED written next to the name — the TOTAL for the whole row. Null when no amount is written. */
  amount: z.number().nullable(),
  /** Other plausible readings of the amount (e.g. 17 for a 12 with a tail). */
  amountAlternatives: z.array(z.number()),
  /** Printed column the name sits under (informational only — names drift across columns). */
  writtenUnder: z.enum(["CUTTING", "TAILORING", "HANDWORK", "EMBROIDERY", "RIGHT_EDGE", "OTHER"]),
  /** False when the name+amount sits between two invoice lines and could belong to either. */
  sameLineAsInvoice: z.boolean(),
  /** The whole entry is crossed out. */
  struckOut: z.boolean(),
  confidence,
});

const SheetRowSchema = z.object({
  /** Invoice number digits as best read; empty string when unreadable or absent. */
  invoiceNo: z.string(),
  /** Other plausible readings of the invoice number (1/7/9, 0/9, 4/9 confusions). */
  invoiceAlternatives: z.array(z.string()),
  /** Pieces from a "3P"/"5P" mark before the number; null when there is no mark. */
  pieces: z.number().int().nullable(),
  /** The MODEL column as written: a model code ("731") or a word ("W", "Shda", "Sela", "Nikab"...). */
  modelText: z.string().nullable(),
  /** Alteration notebook only: the date heading this line falls under, as written (e.g. "29-9"). */
  dateText: z.string().nullable(),
  /** The whole line is crossed out. */
  struckOut: z.boolean(),
  entries: z.array(SheetEntrySchema),
  confidence,
  /** One short note IN ARABIC about anything doubtful on this line; null when clear. */
  note: z.string().nullable(),
});

export const SheetReadSchema = z.object({
  /** The date range written at the top of a work sheet, as written (e.g. "24-10-26 - 25-10-26"). */
  sheetDateText: z.string().nullable(),
  rows: z.array(SheetRowSchema),
});

export type SheetRead = z.infer<typeof SheetReadSchema>;
export type SheetReadRow = z.infer<typeof SheetRowSchema>;
export type SheetKind = "WORK" | "ALTERATION";

/** Default reading hints; the owner can edit them in Settings (`sheet_reader_hints`). */
export const DEFAULT_READER_HINTS = DEFAULT_SHEET_READER_HINTS;

const SYSTEM_PROMPT = `You transcribe handwritten workshop sheets from an abaya tailoring shop (Pure Diamond, UAE) so the owner does not have to retype them. You never decide anything about payments: you report exactly what is written, plus your doubts, and the owner reviews every line before anything is saved.

There are two kinds of sheet:

WORK SHEET — a printed table with a handwritten date range at the top. Printed columns: INVOICE NO, MODEL, AED, CUTTING (name, AED), TEXTILE USED, TAILORING (name, AED), HANDWORK (name, AED), EMBROIDERY (name, AED), COST MATERIAL, TOTAL COST. Each line is one invoice (sometimes with a "3P"-style piece count before it). Workers write their name and their pay next to it, but they do NOT respect the columns: a model code can sit under AED, a name can sit under COST MATERIAL or past the right edge, and a name+amount can drift between two lines. Report every name+amount pair on a line as an entry, wherever it is written, and say where (writtenUnder). If a pair sits between two invoice lines, attach it to the line it is closest to and set sameLineAsInvoice=false.

ALTERATION NOTEBOOK — handwritten pages: a date heading (like "29-9"), then lines "invoice number — pieces" (like "33950 — 3P"). There are no names or amounts: return one row per invoice line with its dateText and pieces, and an empty entries list. Ignore running totals such as "48-P" that are not an invoice number.

Rules:
- Transcribe; do not invent. If something is unreadable, say so in the note and lower the confidence instead of guessing silently.
- When a digit is ambiguous, give your best reading and list the other plausible readings (invoiceAlternatives / amountAlternatives).
- Map each handwritten name to a worker from the list you are given (workerName, spelled exactly as listed), using the shop's hints. If no listed worker fits, set workerName to null.
- Keep rows in the order they appear on the paper. Skip empty printed lines.
- Notes must be short and in Arabic.`;

export type ReaderWorker = { name: string; jobs: string[] };

function buildContext(kind: SheetKind, workers: ReaderWorker[], hints: string): string {
  const list = workers.map((w) => `- ${w.name}${w.jobs.length ? ` (${w.jobs.join(", ")})` : ""}`).join("\n");
  return [
    `Sheet kind: ${kind === "WORK" ? "WORK SHEET" : "ALTERATION NOTEBOOK"}.`,
    "",
    "Workers in the shop (name and job):",
    list || "- (none listed)",
    "",
    "The shop's own reading hints:",
    hints.trim() || DEFAULT_READER_HINTS,
  ].join("\n");
}

export type SheetReadResult = {
  read: SheetRead;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
};

function fakeReadForTests(): SheetReadResult | null {
  const file = process.env.SHEET_AI_FAKE_RESPONSE_FILE;
  if (process.env.NODE_ENV !== "test" || !file) return null;
  const read = SheetReadSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  return { read, model: "fake", inputTokens: 0, outputTokens: 0 };
}

export async function readSheetImage(args: {
  apiKey: string;
  model: string;
  kind: SheetKind;
  image: Buffer;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  workers: ReaderWorker[];
  hints: string;
}): Promise<SheetReadResult> {
  const fake = fakeReadForTests();
  if (fake) return fake;

  const client = new Anthropic({ apiKey: args.apiKey, maxRetries: 2, timeout: 240_000 });
  let response;
  try {
    response = await client.beta.messages.parse({
      model: args.model,
      max_tokens: 16000,
      // Opus 5.5 can decline on a safety classifier; let the API retry on its
      // default fallback model instead of failing the owner's upload.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(SheetReadSchema) },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: buildContext(args.kind, args.workers, args.hints) },
            {
              type: "image",
              source: { type: "base64", media_type: args.mediaType, data: args.image.toString("base64") },
            },
            { type: "text", text: "Transcribe this sheet." },
          ],
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw new AppError(400, "مفتاح Anthropic غير صحيح أو منتهي — راجعه في الإعدادات", "AI_KEY_INVALID");
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new AppError(429, "خدمة القراءة مشغولة — حاول بعد دقيقة", "AI_RATE_LIMITED");
    }
    if (err instanceof Anthropic.BadRequestError) {
      // Usually an empty balance or an image the API cannot take.
      throw new AppError(400, `تعذّرت القراءة: ${err.message}`, "AI_BAD_REQUEST");
    }
    if (err instanceof Anthropic.APIError) {
      throw new AppError(502, "خدمة القراءة لا تستجيب الآن — حاول مرة أخرى", "AI_UNAVAILABLE");
    }
    throw err;
  }

  if (response.stop_reason === "refusal") {
    throw new AppError(422, "تعذّرت قراءة هذه الصورة — جرّب صورة أوضح", "AI_REFUSED");
  }
  if (response.stop_reason === "max_tokens") {
    throw new AppError(422, "الورقة أطول من المسموح في صورة واحدة — صوّرها على جزأين", "AI_TOO_LONG");
  }
  const read = response.parsed_output;
  if (!read) {
    throw new AppError(502, "رجعت القراءة بشكل غير مفهوم — حاول مرة أخرى", "AI_UNPARSEABLE");
  }
  return {
    read,
    model: response.model,
    inputTokens: response.usage?.input_tokens ?? null,
    outputTokens: response.usage?.output_tokens ?? null,
  };
}
