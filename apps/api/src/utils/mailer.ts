import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "./logger.js";

/**
 * Outbound email, configured entirely from the environment.
 *
 * Credentials deliberately live in env and NOT in the `Setting` table: the settings
 * screen is readable by anyone with `settings.view`, and an SMTP password there would
 * be one careless role grant away from leaking. What the owner edits in the app is
 * only WHO gets the report and WHEN — never how to authenticate as the shop.
 */

export type MailMessage = {
  to: string[];
  subject: string;
  html: string;
  text: string;
};

function envTrim(key: string): string {
  return (process.env[key] ?? "").trim();
}

/** True once the server has enough env to actually talk to an SMTP host. */
export function isMailConfigured(): boolean {
  return envTrim("SMTP_HOST").length > 0 && mailFrom().length > 0;
}

/** The From address: `SMTP_FROM` if set, otherwise the login user. */
export function mailFrom(): string {
  return envTrim("SMTP_FROM") || envTrim("SMTP_USER");
}

/** What's configured, minus anything secret — safe to show in the UI. */
export function mailConfigSummary(): {
  configured: boolean;
  host: string | null;
  port: number;
  secure: boolean;
  from: string | null;
} {
  const host = envTrim("SMTP_HOST");
  return {
    configured: isMailConfigured(),
    host: host || null,
    port: smtpPort(),
    secure: smtpSecure(),
    from: mailFrom() || null,
  };
}

function smtpPort(): number {
  const raw = Number(envTrim("SMTP_PORT"));
  if (Number.isFinite(raw) && raw > 0) return raw;
  // 465 is implicit TLS, 587 is STARTTLS — pick the one that matches SMTP_SECURE
  // so a host-only config still works without a port.
  return smtpSecureRaw() === "true" ? 465 : 587;
}

function smtpSecureRaw(): string {
  const explicit = envTrim("SMTP_SECURE").toLowerCase();
  if (explicit) return explicit;
  return envTrim("SMTP_PORT") === "465" ? "true" : "false";
}

function smtpSecure(): boolean {
  return smtpSecureRaw() === "true";
}

let cached: Transporter | null = null;

function transporter(): Transporter {
  if (cached) return cached;
  const user = envTrim("SMTP_USER");
  const pass = envTrim("SMTP_PASS");
  cached = nodemailer.createTransport({
    host: envTrim("SMTP_HOST"),
    port: smtpPort(),
    secure: smtpSecure(),
    // An open relay on the LAN needs no credentials; only pass auth when given.
    auth: user ? { user, pass } : undefined,
  });
  return cached;
}

/** Split a comma/semicolon/newline separated recipient list into clean addresses. */
export function parseRecipients(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return [...new Set(
    raw
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && isEmail(s)),
  )];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

export async function sendMail(message: MailMessage): Promise<void> {
  if (!isMailConfigured()) throw new Error("SMTP is not configured (set SMTP_HOST and SMTP_FROM)");
  if (message.to.length === 0) throw new Error("No recipients");

  const info = (await transporter().sendMail({
    from: mailFrom(),
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
export async function verifyMailConnection(): Promise<void> {
  if (!isMailConfigured()) throw new Error("SMTP is not configured (set SMTP_HOST and SMTP_FROM)");
  await transporter().verify();
}
