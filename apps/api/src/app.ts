import "dotenv/config";
import { createServer } from "node:http";
import path from "node:path";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
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
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  }),
);
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
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

  // Self-heal: guarantee the records the app hard-requires exist, regardless of
  // whether the (demo) seed ran. Non-fatal — the server is already listening.
  void ensureSystemDefaults().catch((err: unknown) => {
    logger.error("ensureSystemDefaults failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  });
});
