import type { PrismaClient } from "@prisma/client";
import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "./logger.js";

/**
 * Outbound email configuration.
 *
 * Originally this was env-only, on the reasoning that an SMTP password in the
 * `Setting` table is one careless role grant from leaking. That held right up until
 * the owner had to edit the server's `.env` over SSH from a phone — it went wrong
 * twice and left the production env file unparseable. A secret nobody can install
 * safely protects nothing, so the settings screen now owns it, with three guards:
 * the write needs `settings.manage`, the value is NEVER returned by any endpoint
 * (see the redaction in `settings.router.ts`), and Gmail App Passwords are scoped
 * and revocable, so the blast radius of the stored value is one mailbox's sending.
 *
 * Env still works and is merged per field, so an operator who prefers `.env` keeps
 * it, and a half-and-half setup (host in env, password in the UI) is also valid.
 * A non-empty setting wins over the matching env var.
 */

export const SMTP_KEYS = {
  host: "smtp_host",
  port: "smtp_port",
  secure: "smtp_secure",
  user: "smtp_user",
  /** Write-only. Redacted from every read path — never send this to a client. */
  pass: "smtp_pass",
  from: "smtp_from",
} as const;

export type MailConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
};

export type MailMessage = {
  to: string[];
  subject: string;
  html: string;
  text: string;
};

function envTrim(key: string): string {
  return (process.env[key] ?? "").trim();
}

/** Per-field merge: a non-empty setting wins, otherwise the env var, otherwise "". */
function pick(settings: Map<string, string>, settingKey: string, envKey: string): string {
  const fromDb = settings.get(settingKey)?.trim();
  if (fromDb) return fromDb;
  return envTrim(envKey);
}

export async function resolveMailConfig(db: PrismaClient): Promise<MailConfig> {
  const rows = await db.setting.findMany({ where: { key: { in: Object.values(SMTP_KEYS) } } });
  const settings = new Map(rows.map((r) => [r.key, r.value]));

  const host = pick(settings, SMTP_KEYS.host, "SMTP_HOST");
  const user = pick(settings, SMTP_KEYS.user, "SMTP_USER");
  const rawSecure = pick(settings, SMTP_KEYS.secure, "SMTP_SECURE").toLowerCase();
  const rawPort = pick(settings, SMTP_KEYS.port, "SMTP_PORT");

  // 465 is implicit TLS, 587 is STARTTLS. Given only one of the two, infer the other
  // rather than failing — those are the only combinations Gmail and Hostinger accept.
  const secure = rawSecure ? rawSecure === "true" : rawPort === "465";
  const parsedPort = Number(rawPort);
  const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : secure ? 465 : 587;

  return {
    host,
    port,
    secure,
    user,
    pass: pick(settings, SMTP_KEYS.pass, "SMTP_PASS"),
    // Gmail rewrites From to the authenticated account anyway, so defaulting to the
    // login address is both correct and one less field for the owner to fill in.
    from: pick(settings, SMTP_KEYS.from, "SMTP_FROM") || user,
  };
}

/** True once there is enough configuration to actually talk to an SMTP host. */
export function configIsUsable(config: MailConfig): boolean {
  return config.host.length > 0 && config.from.length > 0;
}

export async function isMailConfigured(db: PrismaClient): Promise<boolean> {
  return configIsUsable(await resolveMailConfig(db));
}

/** What's configured, minus the password — safe to show in the UI. */
export async function mailConfigSummary(db: PrismaClient): Promise<{
  configured: boolean;
  host: string | null;
  port: number;
  secure: boolean;
  user: string | null;
  from: string | null;
  /** So the UI can render "saved" without ever receiving the value. */
  hasPassword: boolean;
  /** Where the host came from, so an env-based deployment isn't confusing. */
  source: "settings" | "env" | "none";
}> {
  const [config, rows] = await Promise.all([
    resolveMailConfig(db),
    db.setting.findMany({ where: { key: SMTP_KEYS.host } }),
  ]);
  const hostFromDb = (rows[0]?.value ?? "").trim().length > 0;
  return {
    configured: configIsUsable(config),
    host: config.host || null,
    port: config.port,
    secure: config.secure,
    user: config.user || null,
    from: config.from || null,
    hasPassword: config.pass.length > 0,
    source: hostFromDb ? "settings" : config.host ? "env" : "none",
  };
}

/**
 * Transporters are cached per distinct configuration, so editing the settings takes
 * effect on the next send without a restart, and the common case still reuses one
 * pooled connection instead of rebuilding it nightly.
 */
const transporters = new Map<string, Transporter>();

function transporterFor(config: MailConfig): Transporter {
  const key = JSON.stringify([config.host, config.port, config.secure, config.user, config.pass]);
  const existing = transporters.get(key);
  if (existing) return existing;

  const created = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    // An internal relay needs no credentials; only send auth when we actually have some.
    auth: config.user ? { user: config.user, pass: config.pass } : undefined,
  });
  // One entry per config; the old one is dropped when the owner edits a field.
  transporters.clear();
  transporters.set(key, created);
  return created;
}

/** Split a comma/semicolon/whitespace separated recipient list into clean addresses. */
export function parseRecipients(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && isEmail(s)),
    ),
  ];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

const NOT_CONFIGURED = "لم يتم إعداد خادم البريد بعد — أضف الخادم وعنوان المُرسِل في الإعدادات";

export async function sendMail(db: PrismaClient, message: MailMessage): Promise<void> {
  const config = await resolveMailConfig(db);
  if (!configIsUsable(config)) throw new Error(NOT_CONFIGURED);
  if (message.to.length === 0) throw new Error("No recipients");

  const info = (await transporterFor(config).sendMail({
    from: config.from,
    to: message.to.join(", "),
    subject: message.subject,
    html: message.html,
    text: message.text,
  })) as { messageId?: string };

  logger.info("Email sent", {
    to: message.to.length,
    subject: message.subject,
    messageId: info.messageId,
  });
}

/** Handshake with the SMTP host without sending anything — used by the settings screen. */
export async function verifyMailConnection(db: PrismaClient): Promise<void> {
  const config = await resolveMailConfig(db);
  if (!configIsUsable(config)) throw new Error(NOT_CONFIGURED);
  await transporterFor(config).verify();
}
