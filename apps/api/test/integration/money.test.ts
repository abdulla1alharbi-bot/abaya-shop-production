/**
 * Money paths end to end against a real database: invoice totals and VAT,
 * payments (partial, rounding, the rounding cap, repeats), payment deletion,
 * returns (credit and cash) and void — each checked against the invoice, its
 * payment rows and the customer's balance, which is where a mistake would show.
 *
 * Needs TEST_DATABASE_URL (see harness.ts). Run with
 * `pnpm --filter @abaya-shop/api test:integration`.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { MAX_PAYMENT_ROUNDING_FILS } from "@abaya-shop/shared";
import { startApi, type Api } from "./harness.js";

type Invoice = {
  id: string;
  invoiceNo: number;
  subtotalFils: number;
  vatFils: number;
  totalFils: number;
  paidFils: number;
  balanceFils: number;
  isVoid: boolean;
  items: Array<{ id: string; qty: number; totalFils: number }>;
  payments: Array<{ id: string; method: string; amountFils: number; reference: string | null }>;
};

let api: Api;
let productId: string;
let customerSeq = 0;

before(async () => {
  api = await startApi();
  const products = await api.call<{ items?: Array<{ id: string; sku: string; isService: boolean }> }>(
    "GET",
    "/products?limit=50",
  );
  const list = products.data.items ?? (products.data as unknown as Array<{ id: string; sku: string; isService: boolean }>);
  const p = list.find((x) => !x.isService && !x.sku.startsWith("SYS"));
  assert.ok(p, "seed must provide a sellable product");
  productId = p.id;
});

after(async () => {
  await api?.stop();
});

async function newCustomer(): Promise<string> {
  customerSeq += 1;
  const mobile = `05000${String(customerSeq).padStart(5, "0")}`;
  const r = await api.call<{ id: string }>("POST", "/customers", { name: `Test ${customerSeq}`, mobile });
  assert.equal(r.status, 201, JSON.stringify(r.error));
  return r.data.id;
}

async function newInvoice(
  customerId: string,
  line: { unitFils: number; qty?: number },
  payments: number[] = [],
): Promise<Invoice> {
  const r = await api.call<Invoice>("POST", "/invoices", {
    customerId,
    items: [{ productId, qty: line.qty ?? 1, unitFils: line.unitFils }],
    payments: payments.map((amountFils) => ({ method: "CASH", amountFils })),
  });
  assert.equal(r.status, 201, JSON.stringify(r.error));
  return invoice(r.data.id);
}

async function invoice(id: string): Promise<Invoice> {
  const r = await api.call<Invoice>("GET", `/invoices/${id}`);
  assert.equal(r.status, 200);
  return r.data;
}

async function customerBalance(id: string): Promise<number> {
  const r = await api.call<{ balanceFils: number }>("GET", `/customers/${id}`);
  assert.equal(r.status, 200);
  return r.data.balanceFils;
}

const pay = (invoiceId: string, amountFils: number, extra: Record<string, unknown> = {}) =>
  api.call<Invoice>("POST", `/invoices/${invoiceId}/payments`, {
    payments: [{ method: "CASH", amountFils }],
    ...extra,
  });

const rowsSum = (inv: Invoice) => inv.payments.reduce((a, p) => a + p.amountFils, 0);

describe("invoice totals", () => {
  test("subtotal, 5% VAT and total; the customer owes exactly the balance", async () => {
    const c = await newCustomer();
    const inv = await newInvoice(c, { unitFils: 16250 }, [5000]);
    assert.equal(inv.subtotalFils, 16250);
    assert.equal(inv.vatFils, 813); // 5% of 162.50, rounded to the fils
    assert.equal(inv.totalFils, 17063);
    assert.equal(inv.paidFils, 5000);
    assert.equal(inv.balanceFils, 12063);
    assert.equal(await customerBalance(c), 12063);
  });

  test("a payment above the total at checkout is refused", async () => {
    const c = await newCustomer();
    const r = await api.call("POST", "/invoices", {
      customerId: c,
      items: [{ productId, qty: 1, unitFils: 10000 }],
      payments: [{ method: "CASH", amountFils: 20000 }],
    });
    assert.equal(r.status, 400);
    assert.equal(await customerBalance(c), 0);
  });
});

describe("adding payments", () => {
  test("a partial payment settles part of the invoice and lowers the customer's balance", async () => {
    const c = await newCustomer();
    const inv = await newInvoice(c, { unitFils: 16250 }, [5000]);
    const r = await pay(inv.id, 3063);
    assert.equal(r.status, 200);
    const after = await invoice(inv.id);
    assert.equal(after.paidFils, 8063);
    assert.equal(after.balanceFils, 9000);
    assert.equal(after.paidFils + after.balanceFils, after.totalFils);
    assert.equal(await customerBalance(c), 9000);
  });

  test("cash rounding within the cap settles the invoice; the row keeps the cash handed over; no customer credit", async () => {
    const c = await newCustomer();
    const inv = await newInvoice(c, { unitFils: 16250 }); // 170.63 due
    const r = await pay(inv.id, 17100); // customer hands over 171
    assert.equal(r.status, 200);
    const after = await invoice(inv.id);
    assert.equal(after.paidFils, 17063);
    assert.equal(after.balanceFils, 0);
    assert.equal(rowsSum(after), 17100, "the drawer really received 171.00");
    assert.equal(await customerBalance(c), 0, "the 0.37 is rounding income, never credit");
  });

  test("exactly the cap over the balance is accepted, one fils more is refused", async () => {
    const c = await newCustomer();
    const a = await newInvoice(c, { unitFils: 10000 }); // 105.00
    assert.equal((await pay(a.id, a.totalFils + MAX_PAYMENT_ROUNDING_FILS)).status, 200);
    const b = await newInvoice(c, { unitFils: 10000 });
    const r = await pay(b.id, b.totalFils + MAX_PAYMENT_ROUNDING_FILS + 1);
    assert.equal(r.status, 400);
    assert.equal(r.error?.code, "PAYMENT_EXCEEDS_BALANCE");
  });

  test("an invoice number typed as the amount is refused and changes nothing", async () => {
    const c = await newCustomer();
    const inv = await newInvoice(c, { unitFils: 28600 }, [5000]); // the real 33488 case
    const r = await pay(inv.id, 3348800);
    assert.equal(r.status, 400);
    assert.equal(r.error?.code, "PAYMENT_EXCEEDS_BALANCE");
    const after = await invoice(inv.id);
    assert.equal(after.paidFils, 5000);
    assert.equal(after.payments.length, 1);
    assert.equal(await customerBalance(c), after.balanceFils);
  });

  test("a payment on a fully paid invoice is refused", async () => {
    const c = await newCustomer();
    const inv = await newInvoice(c, { unitFils: 10000 }, [10500]);
    const r = await pay(inv.id, 100);
    assert.equal(r.status, 400);
    assert.equal(r.error?.code, "INVOICE_FULLY_PAID");
  });

  test("the same payment twice within a minute needs the seller's confirmation", async () => {
    const c = await newCustomer();
    const inv = await newInvoice(c, { unitFils: 20000 }); // 210.00
    assert.equal((await pay(inv.id, 3000)).status, 200);
    const repeat = await pay(inv.id, 3000);
    assert.equal(repeat.status, 409);
    assert.equal(repeat.error?.code, "REPEAT_PAYMENT");
    assert.equal((await invoice(inv.id)).paidFils, 3000, "the refused repeat must not settle anything");
    assert.equal((await pay(inv.id, 3000, { confirmRepeat: true })).status, 200);
    const after = await invoice(inv.id);
    assert.equal(after.paidFils, 6000);
    assert.equal(await customerBalance(c), after.balanceFils);
  });
});

describe("deleting a payment", () => {
  test("restores exactly what the payment had settled", async () => {
    const c = await newCustomer();
    const inv = await newInvoice(c, { unitFils: 20000 }, [5000]); // 210.00, 50 paid
    await pay(inv.id, 7000);
    const before = await invoice(inv.id);
    const row = before.payments.find((p) => p.amountFils === 7000);
    assert.ok(row);
    const r = await api.call("DELETE", `/invoices/${inv.id}/payments/${row.id}`);
    assert.equal(r.status, 200, JSON.stringify(r.error));
    const after = await invoice(inv.id);
    assert.equal(after.paidFils, 5000);
    assert.equal(after.balanceFils, 16000);
    assert.equal(await customerBalance(c), 16000);
  });

  test("deleting a rounding payment reopens the debt without leaving credit behind", async () => {
    const c = await newCustomer();
    const inv = await newInvoice(c, { unitFils: 16250 }); // 170.63
    await pay(inv.id, 17100);
    const row = (await invoice(inv.id)).payments[0];
    assert.ok(row);
    await api.call("DELETE", `/invoices/${inv.id}/payments/${row.id}`);
    const after = await invoice(inv.id);
    assert.equal(after.paidFils, 0);
    assert.equal(after.balanceFils, 17063);
    assert.equal(await customerBalance(c), 17063);
  });
});

describe("returns", () => {
  // Two pieces at 100.00 + 5% VAT = 210.00, 150.00 paid, 60.00 still owed.
  // Returning one piece is worth 105.00: it first cancels the 60.00 debt, the
  // other 45.00 goes back to the customer — as credit or as cash.
  async function setup() {
    const c = await newCustomer();
    const inv = await newInvoice(c, { unitFils: 10000, qty: 2 }, [15000]);
    assert.equal(inv.totalFils, 21000);
    assert.equal(await customerBalance(c), 6000);
    const itemId = inv.items[0]?.id;
    assert.ok(itemId);
    return { c, inv, itemId };
  }

  test("CREDIT: unpaid balance is cancelled first, the rest becomes customer credit", async () => {
    const { c, inv, itemId } = await setup();
    const r = await api.call("POST", `/invoices/${inv.id}/returns`, {
      reason: "wrong size",
      refundMethod: "CREDIT",
      items: [{ invoiceItemId: itemId, qty: 1 }],
    });
    assert.equal(r.status, 201, JSON.stringify(r.error));
    const after = await invoice(inv.id);
    assert.equal(after.balanceFils, 0);
    assert.equal(after.paidFils, 15000, "a credit return moves no cash");
    assert.equal(rowsSum(after), 15000);
    assert.equal(await customerBalance(c), -4500);
  });

  test("CASH: the remainder leaves the drawer as a negative payment row", async () => {
    const { c, inv, itemId } = await setup();
    const r = await api.call("POST", `/invoices/${inv.id}/returns`, {
      reason: "wrong size",
      refundMethod: "CASH",
      items: [{ invoiceItemId: itemId, qty: 1 }],
    });
    assert.equal(r.status, 201, JSON.stringify(r.error));
    const after = await invoice(inv.id);
    assert.equal(after.balanceFils, 0);
    assert.equal(after.paidFils, 10500);
    const refund = after.payments.find((p) => p.amountFils < 0);
    assert.equal(refund?.amountFils, -4500);
    assert.ok(refund?.reference?.startsWith("RETURN:"));
    assert.equal(rowsSum(after), 10500, "collections show 150 in, 45 out");
    assert.equal(await customerBalance(c), 0);
  });

  test("more than was sold cannot be returned", async () => {
    const { inv, itemId } = await setup();
    const r = await api.call("POST", `/invoices/${inv.id}/returns`, {
      reason: "too many",
      refundMethod: "CREDIT",
      items: [{ invoiceItemId: itemId, qty: 3 }],
    });
    assert.equal(r.status, 400);
    assert.equal(r.error?.code, "RETURN_QTY_EXCEEDED");
  });
});

describe("void", () => {
  test("removes the unpaid debt and credits the customer what was paid", async () => {
    const c = await newCustomer();
    const inv = await newInvoice(c, { unitFils: 20000 }, [5000]); // 210.00, 50 paid
    assert.equal(await customerBalance(c), 16000);
    const r = await api.call("POST", `/invoices/${inv.id}/void`, {
      voidReason: "customer cancelled",
      voidCategory: "CUSTOMER_CHANGED_MIND",
    });
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.equal((await invoice(inv.id)).isVoid, true);
    assert.equal(await customerBalance(c), -5000);
  });

  test("after a credit return, voiding credits only what was not already given back", async () => {
    const c = await newCustomer();
    const inv = await newInvoice(c, { unitFils: 10000, qty: 2 }, [15000]);
    const itemId = inv.items[0]?.id;
    assert.ok(itemId);
    await api.call("POST", `/invoices/${inv.id}/returns`, {
      reason: "wrong size",
      refundMethod: "CREDIT",
      items: [{ invoiceItemId: itemId, qty: 1 }],
    });
    assert.equal(await customerBalance(c), -4500);
    await api.call("POST", `/invoices/${inv.id}/void`, {
      voidReason: "cancelled",
      voidCategory: "OTHER",
    });
    // Paid 150.00 in total: 45.00 came back with the return, the void adds the other 105.00.
    assert.equal(await customerBalance(c), -15000);
  });

  test("a second void is refused and does not credit twice", async () => {
    const c = await newCustomer();
    const inv = await newInvoice(c, { unitFils: 10000 }, [5000]);
    const body = { voidReason: "dup", voidCategory: "DATA_ENTRY_ERROR" };
    assert.equal((await api.call("POST", `/invoices/${inv.id}/void`, body)).status, 200);
    const balance = await customerBalance(c);
    const again = await api.call("POST", `/invoices/${inv.id}/void`, body);
    assert.ok(again.status >= 400, `second void returned ${again.status}`);
    assert.equal(await customerBalance(c), balance);
  });
});

describe("sales report", () => {
  test("money received splits into new orders, delivery and payments on older invoices", async () => {
    const c = await newCustomer();
    const oldPaid = await newInvoice(c, { unitFils: 10000 }, [1000]); // paid later, not delivered
    const oldDelivered = await newInvoice(c, { unitFils: 20000 }, [2000]); // paid and delivered later
    const untouched = await newInvoice(c, { unitFils: 30000 }); // nothing happens in the window
    await new Promise((r) => setTimeout(r, 1100));
    const from = new Date().toISOString();

    assert.equal((await pay(oldPaid.id, 3000)).status, 200);
    const del = await api.call("POST", `/invoices/${oldDelivered.id}/deliver`, {});
    assert.equal(del.status, 200, JSON.stringify(del.error));
    assert.equal((await pay(oldDelivered.id, 4000)).status, 200);
    const fresh = await newInvoice(c, { unitFils: 5000 }, [5000]);

    const to = new Date(Date.now() + 60_000).toISOString();
    const r = await api.call<{
      summary: { receivedFils: number; receivedNewFils: number; receivedDeliveryFils: number; receivedOldPaymentFils: number };
      rows: Array<{ invoiceId: string; kind: string; receivedFils: number }>;
    }>("GET", `/reports/invoices?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    assert.equal(r.status, 200, JSON.stringify(r.error));
    const s = r.data.summary;
    assert.equal(s.receivedNewFils, 5000);
    assert.equal(s.receivedDeliveryFils, 4000);
    assert.equal(s.receivedOldPaymentFils, 3000);
    assert.equal(s.receivedFils, 12000, "the three parts add up to all money received");
    const kindOf = (id: string) => r.data.rows.find((x) => x.invoiceId === id)?.kind;
    assert.equal(kindOf(fresh.id), "NEW");
    assert.equal(kindOf(oldDelivered.id), "DELIVERY");
    assert.equal(kindOf(oldPaid.id), "OLD_PAYMENT");
    assert.equal(kindOf(untouched.id), undefined, "an older invoice with nothing in the window is not listed");
  });
});
