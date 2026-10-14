import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { mailConfig } from "./config";

// Sends an email through the configured SMTP server (app/lib/mail/config.ts). With
// memory:// the message is kept in `memoryOutbox` instead (tests, local development).

export type OutgoingMail = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

/** Messages "sent" with ORGTABLE_SMTP_URL=memory:// (newest last). */
export const memoryOutbox: OutgoingMail[] = [];

let cached: { url: string; transporter: Transporter } | null = null;

function transporterFor(url: string): Transporter {
  if (cached?.url !== url)
    cached = { url, transporter: nodemailer.createTransport(url) };
  return cached.transporter;
}

/**
 * Sends one message. Returns false (and logs why, never the content) if email is off or
 * the server refuses it: callers decide whether that matters to the person.
 */
export async function sendMail(mail: OutgoingMail): Promise<boolean> {
  const config = mailConfig();
  if (!config.enabled) return false;
  if (config.transportUrl.startsWith("memory:")) {
    memoryOutbox.push(mail);
    return true;
  }
  try {
    await transporterFor(config.transportUrl).sendMail({
      from: config.from,
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
    return true;
  } catch (err) {
    console.error("[mail] could not send", {
      subject: mail.subject,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
