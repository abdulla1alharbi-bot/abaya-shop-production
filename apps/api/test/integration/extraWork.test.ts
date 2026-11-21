/**
 * «شغل إضافي» (ARI / PUSSOS) end to end: a wage line on a piece that is not a
 * pipeline stage. Checks that it is paid like a stage wage (worker balance,
 * dashboard, nightly report, financial report), that it never touches the
 * piece's stage, that only extra-work lines can be edited through it, and that
 * a plain workshop worker cannot set wages with it.
 *
 * Needs TEST_DATABASE_URL (see harness.ts).
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startApi, type Api } from "./harness.js";

type ExtraLine = { id: string; workType: string; totalFils: number; date: string; worker: { id: string; name: string } };
type Job = {
  id: string;
  stage: string;
  workStages: Array<{ stageKey: string; status: string; productionEntryId: string | null }>;
};

let api: Api;
let jobId: string;
let workerId: string;

before(async () => {
  api = await startApi();
  const c = await api.call<{ id: string }>("POST", "/customers", { name: "Extra work", mobile: "0559990001" });
  assert.equal(c.status, 201, JSON.stringify(c.error));
  const j = await api.call<{ id: string }>("POST", "/job-orders", {
    customerId: c.data.id,
    productStyle: "Test abaya",
    dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    costFils: 0,
    totalFils: 0,
    paidFils: 0,
  });
  assert.equal(j.status, 201, JSON.stringify(j.error));
  jobId = j.data.id;
  const w = await api.call<{ id: string }>("POST", "/workers", {
    name: "Aman",
    role: "WORKER",
    specializations: JSON.stringify(["PUSSOS"]),
  });
  assert.equal(w.status, 201, JSON.stringify(w.error));
  workerId = w.data.id;
});

after(async () => {
  await api?.stop();
});

async function job(): Promise<Job> {
  const r = await api.call<Job>("GET", `/job-orders/${jobId}`);
  assert.equal(r.status, 200);
  return r.data;
}

async function lines(): Promise<ExtraLine[]> {
  const r = await api.call<ExtraLine[]>("GET", `/job-orders/${jobId}/extra-work`);
  assert.equal(r.status, 200);
  return r.data;
}

async function balanceEarned(): Promise<number> {
  const r = await api.call<{ earnedFils: number }>("GET", `/workers/${workerId}/balance`);
  assert.equal(r.status, 200);
  return r.data.earnedFils;
}

async function dashboardWagesToday(): Promise<{ totalFils: number; items: Array<{ stageKey: string; amountFils: number }> }> {
  const r = await api.call<{ wages: { totalFils: number; items: Array<{ stageKey: string; amountFils: number }> } }>(
    "GET",
    "/dashboard/today",
  );
  assert.equal(r.status, 200, JSON.stringify(r.error));
  return r.data.wages;
}

describe("workshop board totals", () => {
  test("board-summary counts every open piece, and the list finds a piece by its number", async () => {
    const sum = await api.call<{ byStage: Record<string, number>; inWork: number; ready: number; overdue: number }>(
      "GET",
      "/job-orders/board-summary",
    );
    assert.equal(sum.status, 200, JSON.stringify(sum.error));
    const total = Object.values(sum.data.byStage).reduce((a, b) => a + b, 0);
    assert.equal(sum.data.inWork + sum.data.ready, total);
    assert.equal(typeof sum.data.overdue, "number");

    const j = await job();
    const list = await api.call<{ items: Array<{ id: string }> }>(
      "GET",
      `/job-orders?open=true&limit=500&q=${(j as unknown as { jobNo: number }).jobNo}`,
    );
    assert.equal(list.status, 200);
    assert.ok(list.data.items.some((x) => x.id === jobId), "search by job number finds the piece");
  });
});

describe("extra work (ARI / PUSSOS)", () => {
  test("adding a line pays the worker and leaves the piece's stage alone", async () => {
    const before = await job();
    const earnedBefore = await balanceEarned();

    const r = await api.call<ExtraLine>("POST", `/job-orders/${jobId}/extra-work`, {
      workType: "PUSSOS",
      workerId,
      amountFils: 3000,
    });
    assert.equal(r.status, 201, JSON.stringify(r.error));
    assert.equal(r.data.workType, "PUSSOS");
    assert.equal(r.data.totalFils, 3000);
    assert.equal(r.data.worker.name, "Aman");

    const after = await job();
    assert.equal(after.stage, before.stage, "extra work must not move the piece");
    assert.deepEqual(
      after.workStages.map((s) => s.status),
      before.workStages.map((s) => s.status),
    );
    assert.equal(await balanceEarned(), earnedBefore + 3000);
    assert.deepEqual(
      (await lines()).map((l) => [l.workType, l.totalFils]),
      [["PUSSOS", 3000]],
    );
  });

  test("today's wages on the dashboard, the nightly report and the financial report include it", async () => {
    const wages = await dashboardWagesToday();
    assert.ok(wages.items.some((i) => i.stageKey === "PUSSOS" && i.amountFils === 3000));
    assert.equal(
      wages.totalFils,
      wages.items.reduce((s, i) => s + i.amountFils, 0),
    );

    const daily = await api.call<{ workshop: { wagesFils: number; byStage: Array<{ stageKey: string; wagesFils: number }> } }>(
      "GET",
      "/reports/daily-report",
    );
    assert.equal(daily.status, 200, JSON.stringify(daily.error));
    assert.equal(daily.data.workshop.byStage.find((s) => s.stageKey === "PUSSOS")?.wagesFils, 3000);

    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const fin = await api.call<{ summary: { totalWagesFils: number }; entries: Array<{ type: string; amountFils: number; description: string }> }>(
      "GET",
      `/reports/financial-activity?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&detailedWages=true`,
    );
    assert.equal(fin.status, 200, JSON.stringify(fin.error));
    assert.equal(fin.data.summary.totalWagesFils, wages.totalFils);
    assert.ok(fin.data.entries.some((e) => e.type === "wage" && e.amountFils === 3000 && e.description.includes("PUSSOS")));

    const ww = await api.call<{ rows: Array<{ workerId: string | null; totalWageFils: number }> }>(
      "GET",
      `/reports/workshop-wages?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    assert.equal(ww.status, 200, JSON.stringify(ww.error));
    assert.equal(ww.data.rows.find((r) => r.workerId === workerId)?.totalWageFils, 3000);
  });

  test("correcting the wage changes the worker's balance by the difference", async () => {
    const [line] = await lines();
    const earnedBefore = await balanceEarned();
    const r = await api.call<ExtraLine>("PATCH", `/job-orders/${jobId}/extra-work/${line!.id}`, {
      workType: "ARI",
      amountFils: 6000,
    });
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.equal(r.data.workType, "ARI");
    assert.equal(await balanceEarned(), earnedBefore + 3000);
  });

  test("rejects a stage name, a future date and a missing worker", async () => {
    const bad = (body: Record<string, unknown>) => api.call("POST", `/job-orders/${jobId}/extra-work`, body);
    assert.equal((await bad({ workType: "SEWING", workerId, amountFils: 100 })).status, 400);
    assert.equal(
      (await bad({ workType: "ARI", workerId, amountFils: 100, date: new Date(Date.now() + 3 * 86_400_000).toISOString() }))
        .status,
      400,
    );
    assert.equal((await bad({ workType: "ARI", workerId: "nope", amountFils: 100 })).status, 404);
  });

  test("a stage's own wage line cannot be edited or deleted through extra work", async () => {
    // A walk-in job starts as NEW with no workshop stages; activate them first.
    const init = await api.call("POST", `/job-orders/${jobId}/init-pipeline`, {});
    assert.equal(init.status, 200, JSON.stringify(init.error));
    const j = await job();
    const current = j.workStages.find((s) => s.stageKey === j.stage);
    assert.ok(current, `job should be on a pipeline stage, is ${j.stage}`);
    const done = await api.call<Job>("POST", `/job-orders/${jobId}/work-stages/${current.stageKey}/complete-one-click`, {
      workerId,
    });
    assert.equal(done.status, 200, JSON.stringify(done.error));
    const stageEntryId = done.data.workStages.find((s) => s.stageKey === current.stageKey)?.productionEntryId;
    assert.ok(stageEntryId);

    assert.equal((await api.call("DELETE", `/job-orders/${jobId}/extra-work/${stageEntryId}`)).status, 404);
    assert.equal(
      (await api.call("PATCH", `/job-orders/${jobId}/extra-work/${stageEntryId}`, { amountFils: 1 })).status,
      404,
    );
    assert.equal((await lines()).length, 1, "the stage wage must not appear as extra work");
  });

  test("deleting a line takes its wage back off", async () => {
    const [line] = await lines();
    const earnedBefore = await balanceEarned();
    const r = await api.call("DELETE", `/job-orders/${jobId}/extra-work/${line!.id}`);
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.equal(await balanceEarned(), earnedBefore - 6000);
    assert.equal((await lines()).length, 0);
    assert.ok(!(await dashboardWagesToday()).items.some((i) => i.stageKey === "ARI"));
  });

  test("a workshop WORKER login can see extra work but cannot set wages with it", async () => {
    const created = await api.call("POST", "/users", {
      username: "worker_xw",
      name: "Workshop worker",
      password: "Worker-Pass-123",
      role: "WORKER",
    });
    assert.equal(created.status, 201, JSON.stringify(created.error));
    const login = await fetch(`${api.base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "worker_xw", password: "Worker-Pass-123" }),
    });
    const token = ((await login.json()) as { data?: { accessToken?: string } }).data?.accessToken;
    assert.ok(token, `worker login failed (${login.status})`);
    const as = (method: string, route: string, body?: unknown) =>
      fetch(`${api.base}/api${route}`, {
        method,
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    assert.equal((await as("GET", `/job-orders/${jobId}/extra-work`)).status, 200);
    assert.equal(
      (await as("POST", `/job-orders/${jobId}/extra-work`, { workType: "ARI", workerId, amountFils: 100 })).status,
      403,
    );
  });
});
