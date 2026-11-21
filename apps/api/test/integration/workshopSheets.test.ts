/**
 * «قراءة ورقة الورشة» end to end with a fixed, fake reading (no Claude call):
 * read → check → refuse while a line is red → approve → stages, wages, extra
 * work and READY exactly as the owner decided; the same sheet again is "already
 * recorded"; the alteration notebook goes to Ahsan at 0; a sheet cannot be
 * approved twice; and the photo is never public.
 *
 * Needs TEST_DATABASE_URL (see harness.ts).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

const FAKE = path.join(os.tmpdir(), `sheet-fake-${process.pid}.json`);
process.env.SHEET_AI_FAKE_RESPONSE_FILE = FAKE;
process.env.ANTHROPIC_API_KEY = "test-key-not-used";

const { startApi } = await import("./harness.js");
type Api = Awaited<ReturnType<typeof startApi>>;

type Step = { kind: string; work: string; workerName: string | null; wageFils: number; state: string };
type Piece = { jobId: string; jobNo: number; steps: Step[]; becomesReady: boolean };
type Plan = {
  rows: Array<{ key: string; status: string; reasons: string[]; pieces: Piece[] }>;
  totals: Array<{ workerName: string; pieces: number; totalFils: number; newFils: number }>;
  counts: Record<string, number>;
};
type Row = Record<string, unknown> & { key: string; ignore: boolean };
type ReadResponse = { sheet: { id: string; sheetDate: string }; rows: Row[]; plan: Plan; samePhoto: unknown };
type Job = { id: string; stage: string; workStages: Array<{ stageKey: string; status: string; wageFils: number; workerId: string | null }> };

let api: Api;
const W: Record<string, string> = {};
const inv: Record<string, { no: number; id: string; jobs: string[] }> = {};
// Any bytes: the fake reader ignores the image. A different value per "photo".
const PHOTO_WORK = Buffer.from("fake-photo-work-sheet");
const PHOTO_BOOK = Buffer.from("fake-photo-alteration-notebook");

before(async () => {
  api = await startApi();
  const specs: Array<[string, string[]]> = [
    ["Mahbob", ["CUTTING"]],
    ["Jahid", ["SEWING"]],
    ["Shajahan", ["MACHINE_EMBROIDERY"]],
    ["Sobur", ["FINISHING"]],
    ["Aman", ["PUSSOS"]],
    ["Baniyas", ["ARI"]],
    ["Ahsan", []],
  ];
  for (const [name, s] of specs) {
    const r = await api.call<{ id: string }>("POST", "/workers", { name, role: "WORKER", specializations: JSON.stringify(s) });
    assert.equal(r.status, 201, JSON.stringify(r.error));
    W[name] = r.data.id;
  }
  const types = await api.call<{ types: Array<{ id: string; code: string }> }>("GET", "/abaya-catalog");
  const walter = types.data.types.find((t) => t.code === "WALTER");
  assert.ok(walter, "seed must have the WALTER type");

  const cust = await api.call<{ id: string }>("POST", "/customers", { name: "Sheet", mobile: "0559990002" });
  const due = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const make = async (label: string, n: number, extra: Record<string, unknown> = {}) => {
    const r = await api.call<{ invoice: { id: string; invoiceNo: number }; jobOrders: Array<{ id: string }> }>(
      "POST",
      "/invoices/tailoring-checkout",
      {
        customerId: cust.data.id,
        items: Array.from({ length: n }, () => ({ productStyle: "عباية سادة", dueDate: due, costFils: 0, totalFils: 20000, ...extra })),
      },
    );
    assert.equal(r.status, 201, JSON.stringify(r.error));
    inv[label] = { no: r.data.invoice.invoiceNo, id: r.data.invoice.id, jobs: r.data.jobOrders.map((j) => j.id) };
  };
  await make("A", 1);
  await make("B", 3);
  await make("C", 1, { abayaTypeId: walter.id, productStyle: "تعديل" });
  await make("D", 2, { abayaTypeId: walter.id, productStyle: "تعديل" });
  // A tailoring-only invoice (an abaya can come back to it for a free repair)…
  await make("E", 2);
  // …and a mixed one: one tailored abaya plus two alteration pieces.
  const mixed = await api.call<{ invoice: { id: string; invoiceNo: number }; jobOrders: Array<{ id: string }> }>(
    "POST",
    "/invoices/tailoring-checkout",
    {
      customerId: cust.data.id,
      items: [
        { productStyle: "عباية سادة", dueDate: due, costFils: 0, totalFils: 30000 },
        { productStyle: "تعديل", abayaTypeId: walter.id, dueDate: due, costFils: 0, totalFils: 2000 },
        { productStyle: "تعديل", abayaTypeId: walter.id, dueDate: due, costFils: 0, totalFils: 2000 },
      ],
    },
  );
  assert.equal(mixed.status, 201, JSON.stringify(mixed.error));
  inv.F = { no: mixed.data.invoice.invoiceNo, id: mixed.data.invoice.id, jobs: mixed.data.jobOrders.map((j) => j.id) };
});

after(async () => {
  await api?.stop();
  fs.rmSync(FAKE, { force: true });
});

function entry(nameAsWritten: string, workerName: string | null, amount: number | null, writtenUnder = "TAILORING") {
  return {
    nameAsWritten,
    workerName,
    amount,
    amountAlternatives: [],
    writtenUnder,
    sameLineAsInvoice: true,
    struckOut: false,
    confidence: "high",
  };
}
function line(invoiceNo: string, entries: unknown[], extra: Record<string, unknown> = {}) {
  return {
    invoiceNo,
    invoiceAlternatives: [],
    pieces: null,
    modelText: null,
    dateText: null,
    struckOut: false,
    entries,
    confidence: "high",
    note: null,
    ...extra,
  };
}

async function read(kind: "WORK" | "ALTERATION", photo: Buffer, fake: unknown): Promise<{ status: number; data: ReadResponse }> {
  fs.writeFileSync(FAKE, JSON.stringify(fake));
  const form = new FormData();
  form.append("kind", kind);
  form.append("image", new Blob([new Uint8Array(photo)], { type: "image/jpeg" }), "sheet.jpg");
  const r = await fetch(`${api.base}/api/workshop-sheets/read`, {
    method: "POST",
    headers: { authorization: `Bearer ${api.token}` },
    body: form,
  });
  const j = (await r.json()) as { data: ReadResponse; error?: unknown };
  assert.equal(r.status, 201, JSON.stringify(j.error));
  return { status: r.status, data: j.data };
}

async function job(id: string): Promise<Job> {
  const r = await api.call<Job>("GET", `/job-orders/${id}`);
  assert.equal(r.status, 200);
  return r.data;
}
async function earned(worker: string): Promise<number> {
  const r = await api.call<{ earnedFils: number }>("GET", `/workers/${W[worker]}/balance`);
  return r.data.earnedFils;
}

let workSheet: ReadResponse;

describe("workshop sheet (work)", () => {
  test("reading proposes the owner's rules: auto cutting, stage from the worker, split 3P, W = alteration", async () => {
    workSheet = (
      await read("WORK", PHOTO_WORK, {
        sheetDateText: "D: 20-11-26 - 21-11-26",
        rows: [
          line(String(inv.A!.no), [entry("Jahid", "Jahid", 30), entry("Aman", "Aman", 40, "RIGHT_EDGE")]),
          line(String(inv.B!.no), [entry("Jahid", "Jahid", 54), entry("Ari", "Baniyas", 60, "EMBROIDERY")], { pieces: 3 }),
          line(String(inv.C!.no), [entry("Jahid", "Jahid", 10), entry("Sobur", "Sobur", 10, "HANDWORK")], { modelText: "W" }),
          line("99999", [entry("Jahid", "Jahid", 18)]),
        ],
      })
    ).data;
    const [a, b, c, x] = workSheet.plan.rows;
    assert.equal(workSheet.sheet.sheetDate.slice(0, 10), "2026-11-21");

    const aSteps = a!.pieces[0]!.steps.map((s) => `${s.work}:${s.state}:${s.workerName ?? "-"}:${s.wageFils}`);
    assert.deepEqual(aSteps, [
      "CUTTING:NEW:Mahbob:500",
      "SEWING:NEW:Jahid:3000",
      "EMBROIDERY:SKIP:-:0",
      "FINISHING:SKIP:-:0",
      "PUSSOS:NEW:Aman:4000",
    ]);
    assert.equal(a!.pieces[0]!.becomesReady, true);

    assert.equal(b!.pieces.length, 3);
    for (const p of b!.pieces) {
      assert.equal(p.steps.find((s) => s.work === "SEWING")!.wageFils, 1800);
      assert.equal(p.steps.find((s) => s.work === "ARI")!.wageFils, 2000);
    }

    const cSteps = c!.pieces[0]!.steps.map((s) => `${s.work}:${s.state}`);
    assert.deepEqual(cSteps, ["CUTTING:SKIP", "SEWING:NEW", "EMBROIDERY:SKIP", "FINISHING:NEW"]);

    assert.equal(x!.status, "error");
    assert.ok(x!.reasons.some((r) => r.includes("99999")));

    const jahid = workSheet.plan.totals.find((t) => t.workerName === "Jahid")!;
    assert.equal(jahid.totalFils, 3000 + 5400 + 1000);
    assert.equal(jahid.pieces, 5);
    assert.equal(workSheet.plan.totals.find((t) => t.workerName === "Mahbob")!.totalFils, 500 * 4);
  });

  test("approval is refused while a line is red, and nothing is written", async () => {
    const before = await earned("Jahid");
    const r = await api.call("POST", `/workshop-sheets/${workSheet.sheet.id}/approve`, {
      sheetDate: workSheet.sheet.sheetDate,
      rows: workSheet.rows,
    });
    assert.equal(r.status, 400);
    assert.equal(r.error?.code, "SHEET_HAS_ERRORS");
    assert.equal(await earned("Jahid"), before);
  });

  test("approving writes stages, wages and extra work, and the pieces become ready", async () => {
    const rows = workSheet.rows.map((r, i) => (i === 3 ? { ...r, ignore: true } : r));
    const r = await api.call<{ linesApplied: number; totalFils: number; readyPieces: number }>(
      "POST",
      `/workshop-sheets/${workSheet.sheet.id}/approve`,
      { sheetDate: workSheet.sheet.sheetDate, rows },
    );
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.equal(r.data.readyPieces, 5);

    const a = await job(inv.A!.jobs[0]!);
    assert.equal(a.stage, "READY");
    assert.deepEqual(
      a.workStages.map((s) => `${s.stageKey}:${s.status}:${s.wageFils}`),
      ["CUTTING:DONE:500", "SEWING:DONE:3000"],
    );
    const c = await job(inv.C!.jobs[0]!);
    assert.equal(c.stage, "READY");
    assert.deepEqual(c.workStages.map((s) => s.stageKey), ["SEWING", "FINISHING"]);

    assert.equal(await earned("Jahid"), 3000 + 5400 + 1000);
    assert.equal(await earned("Aman"), 4000);
    assert.equal(await earned("Baniyas"), 6000);
    assert.equal(await earned("Mahbob"), 500 * 4);

    const invA = await api.call<{ readyAt: string | null }>("GET", `/invoices/${inv.A!.id}`);
    assert.ok(invA.data.readyAt, "a fully ready invoice is stamped readyAt");
  });

  test("the same sheet again is recognised and changes nothing", async () => {
    const again = (await read("WORK", PHOTO_WORK, JSON.parse(fs.readFileSync(FAKE, "utf8")))).data;
    assert.ok(again.samePhoto, "the same photo is recognised");
    const [a, b, c] = again.plan.rows;
    assert.deepEqual([a!.status, b!.status, c!.status], ["done", "done", "done"]);
    assert.equal(
      again.plan.totals.reduce((s, t) => s + t.newFils, 0),
      0,
      "nothing new to pay",
    );
    const del = await api.call("DELETE", `/workshop-sheets/${again.sheet.id}`);
    assert.equal(del.status, 200);
  });

  test("an approved sheet cannot be approved twice", async () => {
    const r = await api.call("POST", `/workshop-sheets/${workSheet.sheet.id}/approve`, {
      sheetDate: workSheet.sheet.sheetDate,
      rows: workSheet.rows,
    });
    assert.equal(r.status, 409);
  });
});

describe("alteration notebook", () => {
  test("every open stage goes to Ahsan at 0 and the pieces become ready", async () => {
    const book = (
      await read("ALTERATION", PHOTO_BOOK, {
        sheetDateText: null,
        rows: [line(String(inv.D!.no), [], { pieces: 2, dateText: "21-11" })],
      })
    ).data;
    assert.equal(book.plan.rows[0]!.status, "ok", JSON.stringify(book.plan.rows[0]!.reasons));
    const r = await api.call("POST", `/workshop-sheets/${book.sheet.id}/approve`, {
      sheetDate: book.sheet.sheetDate,
      rows: book.rows,
    });
    assert.equal(r.status, 200, JSON.stringify(r.error));
    for (const id of inv.D!.jobs) {
      const j = await job(id);
      assert.equal(j.stage, "READY");
      assert.ok(j.workStages.every((s) => s.status === "DONE" && s.workerId === W.Ahsan && s.wageFils === 0));
    }
    assert.equal(await earned("Ahsan"), 0);
  });
});

describe("free repair on a tailored abaya", () => {
  test("a notebook line on a tailoring-only invoice only writes a note; a mixed invoice closes only its alteration pieces", async () => {
    const book = (
      await read("ALTERATION", Buffer.from("fake-photo-repairs"), {
        sheetDateText: null,
        rows: [
          line(String(inv.E!.no), [], { pieces: 2, dateText: "30-9" }),
          line(String(inv.F!.no), [], { pieces: 2, dateText: "30-9" }),
        ],
      })
    ).data;
    const [e, f] = book.plan.rows as Array<Plan["rows"][number] & { freeRepair: { note: string } | null }>;
    assert.equal(e!.status, "warn");
    assert.equal(e!.pieces.length, 0, "no stage is touched on a free repair");
    assert.match(e!.freeRepair!.note, /إصلاح مجاني — Ahsan — 30-09-\d{4} — 2 قطعة/);
    assert.deepEqual(
      f!.pieces.map((p) => p.jobId).sort(),
      inv.F!.jobs.slice(1).sort(),
      "only the two alteration pieces are taken",
    );

    const r = await api.call<{ freeRepairNotes: number }>("POST", `/workshop-sheets/${book.sheet.id}/approve`, {
      sheetDate: book.sheet.sheetDate,
      rows: book.rows,
    });
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.equal(r.data.freeRepairNotes, 1);

    const invE = await api.call<{ notes: string | null }>("GET", `/invoices/${inv.E!.id}`);
    assert.match(invE.data.notes ?? "", /إصلاح مجاني/);
    for (const id of inv.E!.jobs) {
      const j = await job(id);
      assert.ok(j.workStages.every((s) => s.status !== "DONE"), "tailoring stages stay open");
    }
    const tailored = await job(inv.F!.jobs[0]!);
    assert.ok(tailored.workStages.every((s) => s.status !== "DONE"), "the tailored abaya on the mixed invoice is untouched");
    for (const id of inv.F!.jobs.slice(1)) assert.equal((await job(id)).stage, "READY");

    // The same notebook again: the note is not written twice.
    const again = (
      await read("ALTERATION", Buffer.from("fake-photo-repairs-2"), {
        sheetDateText: null,
        rows: [line(String(inv.E!.no), [], { pieces: 2, dateText: "30-9" })],
      })
    ).data;
    assert.equal(again.plan.rows[0]!.status, "done");
    await api.call("DELETE", `/workshop-sheets/${again.sheet.id}`);
  });

  test("a W line on a work sheet pointing at a tailoring-only invoice is red", async () => {
    const ws = (
      await read("WORK", Buffer.from("fake-photo-w-on-tailoring"), {
        sheetDateText: "D: 20-11-26 - 21-11-26",
        rows: [line(String(inv.E!.no), [entry("Jahid", "Jahid", 10)], { modelText: "W" })],
      })
    ).data;
    assert.equal(ws.plan.rows[0]!.status, "error");
    assert.ok(ws.plan.rows[0]!.reasons.some((x) => x.includes("قطعة تعديل")));
    await api.call("DELETE", `/workshop-sheets/${ws.sheet.id}`);
  });
});

describe("history and the photo", () => {
  test("approved sheets are listed, and the photo is never public", async () => {
    const list = await api.call<Array<{ id: string; status: string; kind: string }>>("GET", "/workshop-sheets");
    assert.equal(list.status, 200);
    assert.deepEqual(
      list.data.map((s) => `${s.kind}:${s.status}`).sort(),
      ["ALTERATION:APPROVED", "ALTERATION:APPROVED", "WORK:APPROVED"],
    );
    const img = await fetch(`${api.base}/api/workshop-sheets/${workSheet.sheet.id}/image`, {
      headers: { authorization: `Bearer ${api.token}` },
    });
    assert.equal(img.status, 200);
    assert.equal(Buffer.from(await img.arrayBuffer()).toString(), PHOTO_WORK.toString());
    const anon = await fetch(`${api.base}/api/workshop-sheets/${workSheet.sheet.id}/image`);
    assert.equal(anon.status, 401);
    const direct = await fetch(`${api.base}/uploads/private/workshop-sheets/x.jpg`);
    assert.equal(direct.status, 404);
  });
});
