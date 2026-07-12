import "dotenv/config";
import { createServer } from "node:http";
import path from "node:path";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { prisma } from "./config/db.js";
import { initSocket } from "./config/socket.js";
import { errorMiddleware } from "./middleware/error.middleware.js";
import { auditRouter } from "./modules/audit/audit.router.js";
import { authRouter } from "./modules/auth/auth.router.js";
import { branchesRouter } from "./modules/branches/branches.router.js";
import { customersRouter } from "./modules/customers/customers.router.js";
import { dashboardRouter } from "./modules/dashboard/dashboard.router.js";
import { expensesRouter } from "./modules/expenses/expenses.router.js";
import { fabricRollsRouter } from "./modules/fabric-rolls/fabric-rolls.router.js";
import { incomeRouter } from "./modules/income/income.router.js";
import { invoicesRouter } from "./modules/invoices/invoices.router.js";
import { abayaCatalogRouter } from "./modules/abaya-catalog/abaya-catalog.router.js";
import { abayaModelsAdminRouter } from "./modules/abaya-models/abaya-models.router.js";
import { jobOrdersRouter } from "./modules/job-orders/job-orders.router.js";
import { jobProcessRouter } from "./modules/job-process/job-process.router.js";
import { payrollRouter } from "./modules/payroll/payroll.router.js";
import { productsRouter } from "./modules/products/products.router.js";
import { productionRouter } from "./modules/production/production.router.js";
import { reportsRouter } from "./modules/reports/reports.router.js";
import { settingsRouter } from "./modules/settings/settings.router.js";
import { usersRouter } from "./modules/users/users.router.js";
import { workersRouter } from "./modules/workers/workers.router.js";
import { uploadRouter } from "./modules/upload/upload.router.js";
import { shiftsRouter } from "./modules/shifts/shifts.router.js";
import { notificationsRouter } from "./modules/notifications/notifications.router.js";
import { ensureSystemDefaults } from "./bootstrap/ensureSystemDefaults.js";
import { logger } from "./utils/logger.js";

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";

app.use(
  helmet({
    // API serves JSON + /uploads images consumed by the separate web origin.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  }),
);
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

// Brute-force protection on credential endpoints; generous global ceiling for the rest.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts, try again later", code: "RATE_LIMITED" },
});
const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests", code: "RATE_LIMITED" },
});
app.use("/api/auth/login", loginLimiter);
app.use("/api", apiLimiter);

app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ ok: true, db: true });
  } catch {
    res.status(503).json({ ok: false, db: false });
  }
});

app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

app.use("/api/auth", authRouter);
app.use("/api/branches", branchesRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/customers", customersRouter);
app.use("/api/workers", workersRouter);
app.use("/api/products", productsRouter);
app.use("/api/production", productionRouter);
app.use("/api/fabric-rolls", fabricRollsRouter);
app.use("/api/job-orders", jobOrdersRouter);
app.use("/api/job-process", jobProcessRouter);
app.use("/api/invoices", invoicesRouter);
app.use("/api/abaya-catalog", abayaCatalogRouter);
app.use("/api/abaya-models", abayaModelsAdminRouter);
app.use("/api/upload", uploadRouter);
app.use("/api/expenses", expensesRouter);
app.use("/api/income", incomeRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/users", usersRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/payroll", payrollRouter);
app.use("/api/audit", auditRouter);
app.use("/api/shifts", shiftsRouter);
app.use("/api/notifications", notificationsRouter);

app.use(errorMiddleware);

const httpServer = createServer(app);
initSocket(httpServer, FRONTEND_URL);

httpServer.listen(PORT, () => {
  const dbKind = process.env.DATABASE_URL?.startsWith("file:") ? "SQLite" : "configured";
  logger.info(`Abaya Shop API ready`, {
    url: `http://localhost:${PORT}`,
    health: `http://localhost:${PORT}/health`,
    api: `http://localhost:${PORT}/api`,
    database: dbKind,
    frontend: FRONTEND_URL,
    env: process.env.NODE_ENV ?? "development",
  });

  if (process.env.NODE_ENV === "production" && process.env.SECURE_COOKIES !== "true") {
    logger.warn(
      "SECURE_COOKIES is not 'true': refresh-token cookies are sent without the Secure flag. " +
        "Fine for plain-HTTP deployments, but set SECURE_COOKIES=true once the site is behind HTTPS.",
    );
  }

  // Self-heal: guarantee the records the app hard-requires exist, regardless of
  // whether the (demo) seed ran. Non-fatal — the server is already listening.
  void ensureSystemDefaults().catch((err: unknown) => {
    logger.error("ensureSystemDefaults failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  });
});
