/**
 * Pure money helpers — no database. Run with `pnpm --filter @abaya-shop/api test`.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MAX_PAYMENT_ROUNDING_FILS } from "@abaya-shop/shared";
import { allocateByLineShares, fixRoundingSum } from "../../src/utils/invoiceAllocation.js";
import { effectivePaidFils } from "../../src/utils/invoiceLock.js";
import { planPaymentCorrections } from "../../src/utils/phantomPayments.js";

const at = (s: number) => new Date(Date.UTC(2026, 6, 1, 0, 0, s));

describe("planPaymentCorrections (phantom payment repair)", () => {
  test("an invoice number typed as the amount is trimmed to what it settled", () => {
    // Real case, invoice 33488: 50 paid, then 33,488 keyed on a 300.30 bill.
    const out = planPaymentCorrections(30030, 30030, [
      { id: "b", amountFils: 3348800, createdAt: at(9) },
      { id: "a", amountFils: 5000, createdAt: at(1) },
    ]);
    assert.deepEqual(out, [{ paymentId: "b", fromFils: 3348800, toFils: 25030 }]);
  });

  test("a repeated save keeps only the part that settled the remainder", () => {
    // Real case, invoice 33200: 200, 1500, 1500 on 1701 — the second 1500 settled 1 AED.
    const out = planPaymentCorrections(170100, 170100, [
      { id: "a", amountFils: 20000, createdAt: at(1) },
      { id: "b", amountFils: 150000, createdAt: at(2) },
      { id: "c", amountFils: 150000, createdAt: at(3) },
    ]);
    assert.deepEqual(out, [{ paymentId: "c", fromFils: 150000, toFils: 100 }]);
  });

  test("genuine cash rounding up to the cap is kept", () => {
    assert.deepEqual(planPaymentCorrections(16250, 16250, [{ id: "a", amountFils: 16300, createdAt: at(1) }]), []);
    assert.deepEqual(
      planPaymentCorrections(10000, 10000, [{ id: "a", amountFils: 10000 + MAX_PAYMENT_ROUNDING_FILS, createdAt: at(1) }]),
      [],
    );
    assert.equal(
      planPaymentCorrections(10000, 10000, [{ id: "a", amountFils: 10001 + MAX_PAYMENT_ROUNDING_FILS, createdAt: at(1) }])
        ?.length,
      1,
    );
  });

  test("a payment on an already settled invoice is removed entirely", () => {
    const out = planPaymentCorrections(10000, 10000, [
      { id: "a", amountFils: 10000, createdAt: at(1) },
      { id: "b", amountFils: 10000, createdAt: at(2) },
    ]);
    assert.deepEqual(out, [{ paymentId: "b", fromFils: 10000, toFils: 0 }]);
  });

  test("rows are replayed in time order, not in the order given", () => {
    const out = planPaymentCorrections(10000, 10000, [
      { id: "late", amountFils: 9000, createdAt: at(5) },
      { id: "early", amountFils: 10000, createdAt: at(1) },
    ]);
    assert.deepEqual(out, [{ paymentId: "late", fromFils: 9000, toFils: 0 }]);
  });

  test("anything the replay cannot explain is left for a human (null)", () => {
    assert.equal(planPaymentCorrections(10000, 5000, [{ id: "a", amountFils: 20000, createdAt: at(1) }]), null);
    assert.equal(
      planPaymentCorrections(10000, 10000, [
        { id: "a", amountFils: 20000, createdAt: at(1) },
        { id: "refund", amountFils: -100, createdAt: at(2) },
      ]),
      null,
    );
  });
});

describe("allocateByLineShares (invoice money spread over job lines)", () => {
  test("lines that make up the whole invoice add up exactly to total and paid", () => {
    const { shareTotal, sharePaid } = allocateByLineShares([3333, 3333, 3334], 10000, 10500, 7001);
    assert.equal(shareTotal.reduce((a, b) => a + b, 0), 10500);
    assert.equal(sharePaid.reduce((a, b) => a + b, 0), 7001);
  });

  test("on a mixed invoice the tailoring line carries only its own share", () => {
    // 100 retail + 100 tailoring at 5% VAT: the job is worth 105, not the whole 210
    // (the bug fixed in d52d3d5 put the retail amount on the last job).
    const { shareTotal, sharePaid } = allocateByLineShares([10000], 20000, 21000, 21000);
    assert.deepEqual(shareTotal, [10500]);
    assert.deepEqual(sharePaid, [10500]);
  });

  test("no lines or no subtotal allocates nothing", () => {
    assert.deepEqual(allocateByLineShares([], 10000, 10500, 0), { shareTotal: [], sharePaid: [] });
    assert.deepEqual(allocateByLineShares([100], 0, 0, 0), { shareTotal: [], sharePaid: [] });
  });

  test("fixRoundingSum puts the rounding difference on the last part", () => {
    const parts = [33, 33, 33];
    fixRoundingSum(parts, 100);
    assert.deepEqual(parts, [33, 33, 34]);
  });
});

describe("effectivePaidFils (what was paid and not given back)", () => {
  test("without returns it is total minus balance", () => {
    assert.equal(effectivePaidFils({ totalFils: 21000, balanceFils: 6000 }, 0), 15000);
  });

  test("a credit return lowers it by the returned amount", () => {
    // 21000 invoice, 15000 paid, 10500 returned to credit: 6000 cancelled debt, 4500 credited.
    assert.equal(effectivePaidFils({ totalFils: 21000, balanceFils: 0 }, 10500), 10500);
  });

  test("never negative", () => {
    assert.equal(effectivePaidFils({ totalFils: 1000, balanceFils: 900 }, 500), 0);
  });
});
