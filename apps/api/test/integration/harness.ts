/**
 * Boots the real API (same entry point as production) against a throwaway
 * database, so the money tests exercise the actual routes, middleware and
 * transactions instead of mocks.
 *
 * TEST_DATABASE_URL must point at a database whose NAME contains "test" or
 * "ci": the harness wipes it (`prisma db push --force-reset`) on every run, and
 * that guard is what keeps a mistyped URL from erasing the shop's data.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const prismaCli = path.join(apiDir, "node_modules", "prisma", "build", "index.js");
const OWNER_PASSWORD = "Test-Owner-123!";

export type Api = {
  base: string;
  call: <T = Record<string, unknown>>(
    method: string,
    route: string,
    body?: unknown,
  ) => Promise<{ status: number; data: T; error: { code?: string; message?: string } | undefined }>;
  stop: () => Promise<void>;
};

function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Point it at an empty Postgres database whose name contains 'test' or 'ci'.",
    );
  }
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!/test|ci/i.test(dbName)) {
    throw new Error(`Refusing to wipe database "${dbName}": its name must contain "test" or "ci".`);
  }
  return url;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, () => {
      const addr = srv.address();
      srv.close(() => (typeof addr === "object" && addr ? resolve(addr.port) : reject(new Error("no port"))));
    });
  });
}

export async function startApi(): Promise<Api> {
  const databaseUrl = testDatabaseUrl();
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    SEED_ADMIN_PASSWORD: OWNER_PASSWORD,
    NODE_ENV: "test",
    JWT_ACCESS_SECRET: "integration-test-access-secret-0123456789abcdef0123",
    JWT_REFRESH_SECRET: "integration-test-refresh-secret-0123456789abcdef012",
  };

  execFileSync(process.execPath, [prismaCli, "db", "push", "--force-reset", "--skip-generate", "--accept-data-loss"], {
    cwd: apiDir,
    env,
    stdio: "pipe",
  });
  execFileSync(process.execPath, ["--import", "tsx", "prisma/seed.ts"], { cwd: apiDir, env, stdio: "pipe" });

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child: ChildProcess = spawn(process.execPath, ["--import", "tsx", "src/app.ts"], {
    cwd: apiDir,
    env: { ...env, PORT: String(port), FRONTEND_URL: "http://localhost:5173" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (d) => (output += String(d)));
  child.stderr?.on("data", (d) => (output += String(d)));

  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`API exited during start-up:\n${output}`);
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) break;
    } catch {
      /* not listening yet */
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`API did not become healthy within 60s:\n${output}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "owner", password: OWNER_PASSWORD }),
  });
  const loginBody = (await login.json()) as { data?: { accessToken?: string } };
  const token = loginBody.data?.accessToken;
  if (!token) throw new Error(`Owner login failed (${login.status}): ${JSON.stringify(loginBody)}`);

  const call: Api["call"] = async (method, route, body) => {
    const r = await fetch(`${base}/api${route}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await r.json().catch(() => ({}))) as { data?: unknown; error?: { code?: string; message?: string } };
    return { status: r.status, data: json.data as never, error: json.error };
  };

  const stop = () =>
    new Promise<void>((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", () => resolve());
      child.kill();
    });

  return { base, call, stop };
}
