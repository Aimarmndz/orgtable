// Email configuration, from the environment (see .env.example and docs/email.md). Email is
// optional: without it the instance works as before, it just cannot send password-reset
// links or invitations (the "Forgot your password?" link is not shown and organizations
// set an initial password by hand).
//
// - ORGTABLE_SMTP_URL: smtp://user:password@host:587 (STARTTLS) or smtps://…:465 (TLS).
//   memory:// keeps the messages in memory instead of sending them (tests and local
//   development only; refused in production).
// - ORGTABLE_MAIL_FROM: the sender, e.g. "orgtable <no-reply@example.org>".
// - ORGTABLE_PUBLIC_URL: the instance's public address (https://orgtable.example.org), used
//   to build the links in the messages. Never taken from the request's Host header, which
//   the client controls.
//
// Read on every call (not at build time) so the Docker image honours them; a value that is
// set but wrong fails with its reason instead of silently disabling email.

export type MailConfig =
  | { enabled: false }
  | { enabled: true; transportUrl: string; from: string; publicUrl: string };

export function mailConfig(env: NodeJS.ProcessEnv = process.env): MailConfig {
  const transportUrl = env.ORGTABLE_SMTP_URL?.trim() ?? "";
  if (!transportUrl) return { enabled: false };

  let transport: URL;
  try {
    transport = new URL(transportUrl);
  } catch {
    throw new Error(
      "ORGTABLE_SMTP_URL is not a valid URL (smtp://user:password@host:587)",
    );
  }
  if (!["smtp:", "smtps:", "memory:"].includes(transport.protocol)) {
    throw new Error(
      "ORGTABLE_SMTP_URL must start with smtp://, smtps:// or memory://",
    );
  }
  if (transport.protocol === "memory:" && env.NODE_ENV === "production") {
    throw new Error(
      "ORGTABLE_SMTP_URL=memory:// only works outside production",
    );
  }

  const from = env.ORGTABLE_MAIL_FROM?.trim() ?? "";
  if (!from || !from.includes("@")) {
    throw new Error(
      "ORGTABLE_MAIL_FROM must be set to the sender's address when email is on",
    );
  }

  const rawPublic = env.ORGTABLE_PUBLIC_URL?.trim() ?? "";
  let publicUrl: URL;
  try {
    publicUrl = new URL(rawPublic);
  } catch {
    throw new Error(
      "ORGTABLE_PUBLIC_URL must be the instance's address (https://…) when email is on",
    );
  }
  if (publicUrl.protocol !== "https:" && publicUrl.protocol !== "http:") {
    throw new Error("ORGTABLE_PUBLIC_URL must start with https:// or http://");
  }
  return {
    enabled: true,
    transportUrl,
    from,
    publicUrl: publicUrl.origin,
  };
}

/** Whether this instance can send email (the forms that depend on it read this). */
export function isMailEnabled(): boolean {
  return mailConfig().enabled;
}
