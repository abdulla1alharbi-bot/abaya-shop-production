/** The pure rules behind «قراءة ورقة الورشة» (no database). */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  findWorkerByName,
  looseName,
  modelWord,
  notebookDate,
  sheetDateFromText,
  splitFils,
  workKindsFromSpecializations,
} from "../../src/modules/workshop-sheets/sheetResolve.js";

describe("worker names as saved in the shop", () => {
  // The production list as of 2026-11-22.
  const workers = [
    { id: "1", name: "mahboob", isActive: true },
    { id: "2", name: "ahsan", isActive: true },
    { id: "3", name: "jahid", isActive: true },
    { id: "4", name: "Sahajahan", isActive: true },
    { id: "5", name: "Ari baniyas", isActive: true },
    { id: "6", name: "Baniyas", isActive: true },
  ];

  test("the default cutter and alteration names find the saved cards", () => {
    assert.equal(findWorkerByName(workers, "Mahbob")?.id, "1");
    assert.equal(findWorkerByName(workers, "Ahsan")?.id, "2");
    assert.equal(findWorkerByName(workers, "Jahid")?.id, "3");
  });

  test("exact names win, and a different person is never matched", () => {
    assert.equal(findWorkerByName(workers, "Baniyas")?.id, "6");
    assert.equal(findWorkerByName(workers, "Ari baniyas")?.id, "5");
    assert.equal(findWorkerByName(workers, "Imran"), null);
    assert.equal(findWorkerByName(workers, "Aman"), null);
  });

  test("loose keys ignore case, spaces and doubled letters", () => {
    assert.equal(looseName("Mahboob"), looseName("mahbob"));
    assert.notEqual(looseName("Aman"), looseName("Imran"));
  });
});

describe("amounts and pieces", () => {
  test("a multi-piece total splits exactly", () => {
    assert.deepEqual(splitFils(5400, 3), [1800, 1800, 1800]);
    assert.deepEqual(splitFils(2500, 3), [834, 833, 833]);
    assert.equal(splitFils(2500, 3).reduce((a, b) => a + b, 0), 2500);
  });
});

describe("words on the sheet", () => {
  test("model column words", () => {
    assert.equal(modelWord("W"), "ALTERATION");
    assert.equal(modelWord("Shda"), "PLAIN");
    assert.equal(modelWord("Black Sela"), "SHAYLA");
    assert.equal(modelWord("Nikab"), "NIQAB");
    assert.equal(modelWord("731"), null);
  });

  test("the sheet date is the last date of the range", () => {
    const now = new Date(2026, 10, 22, 10);
    const d = sheetDateFromText("D: 24-10-26 - 25-10-26", now)!;
    assert.deepEqual([d.getFullYear(), d.getMonth() + 1, d.getDate()], [2026, 10, 25]);
  });

  test("a notebook day never lands in the future", () => {
    const now = new Date(2026, 0, 5, 10);
    const d = notebookDate("29-9", now)!;
    assert.deepEqual([d.getFullYear(), d.getMonth() + 1, d.getDate()], [2025, 9, 29]);
  });

  test("worker cards map to sheet work", () => {
    assert.deepEqual(workKindsFromSpecializations('["SEW_BASIC","SEWING"]'), ["SEWING"]);
    assert.deepEqual(workKindsFromSpecializations('["HAND_EMBROIDERY"]'), ["FINISHING"]);
    assert.deepEqual(workKindsFromSpecializations('["MACHINE_EMBROIDERY"]'), ["EMBROIDERY"]);
    assert.deepEqual(workKindsFromSpecializations('["PUSSOS"]'), ["PUSSOS"]);
  });
});
