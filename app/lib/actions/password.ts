"use server";

import { redirect } from "next/navigation";
import { getI18n, issueMessage } from "@/app/i18n/server";
import { plural } from "@/app/i18n/format";
import { forgotPasswordSchema, newPasswordSchema } from "@/app/lib/validators";
import { rateLimit } from "@/app/lib/rate-limit";
import { recordAudit, clientIp } from "@/app/lib/audit";
import { isMailEnabled } from "@/app/lib/mail/config";
import {
  consumeAccountToken,
  requestPasswordReset,
} from "@/app/lib/services/account-tokens";

// "Forgot your password?" and the page that sets a new one from an emailed link (also the
// first password of an invited employee). See docs/email.md.

export type PasswordFormState = {
  error?: string;
  sent?: boolean;
  email?: string;
};

// Per address and per IP, an hour. Few, because each one sends an email to someone.
const EMAIL_LIMIT = 3;
const IP_LIMIT = 10;
const GLOBAL_LIMIT = 2000;
// Setting a password from a link runs bcrypt: limited per IP so nobody can burn CPU.
const RESET_IP_LIMIT = 20;
const WINDOW_MS = 60 * 60 * 1000;

function text(formData: FormData, key: string, max: number): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.slice(0, max) : "";
}

/**
 * Emails a reset link. The answer is the same whether the address has an account or not,
 * so the form cannot be used to find out who is registered.
 */
export async function forgotPassword(
  _prev: PasswordFormState,
  formData: FormData,
): Promise<PasswordFormState> {
  const { m, intl } = await getI18n();
  const email = text(formData, "email", 254);
  if (!isMailEnabled()) return { error: m.auth.forgot.unavailable, email };
  const parsed = forgotPasswordSchema.safeParse({ email });
  if (!parsed.success)
    return { error: issueMessage(m, parsed.error.issues[0]), email };

  const ip = await clientIp();
  const limits = [
    rateLimit(
      `forgot:email:${parsed.data.email.toLowerCase()}`,
      EMAIL_LIMIT,
      WINDOW_MS,
    ),
    ...(ip ? [rateLimit(`forgot:ip:${ip}`, IP_LIMIT, WINDOW_MS)] : []),
    rateLimit("forgot:global", GLOBAL_LIMIT, WINDOW_MS),
  ];
  const blocked = limits.find((l) => !l.ok);
  if (blocked) {
    const minutes = Math.ceil(blocked.retryAfterSec / 60);
    return {
      error: plural(intl, m.errors.register.rateLimited, minutes, { minutes }),
      email,
    };
  }

  // Not awaited: the answer takes the same time whether the address has an account or not
  // (an existing one also waits for the database and the SMTP server).
  void requestPasswordReset(parsed.data.email).catch((err: unknown) =>
    console.error("[password] reset request failed", err instanceof Error ? err.message : err),
  );
  await recordAudit({ action: "auth.password_reset_requested", ip });
  return { sent: true, email: parsed.data.email };
}

/** Sets the password from a link, then sends the person to sign in with it. */
export async function resetPasswordWithToken(
  _prev: PasswordFormState,
  formData: FormData,
): Promise<PasswordFormState> {
  const { m, intl } = await getI18n();
  const ip = await clientIp();
  const limits = [
    ...(ip ? [rateLimit(`reset:ip:${ip}`, RESET_IP_LIMIT, WINDOW_MS)] : []),
    rateLimit("reset:global", GLOBAL_LIMIT, WINDOW_MS),
  ];
  const blocked = limits.find((l) => !l.ok);
  if (blocked) {
    const minutes = Math.ceil(blocked.retryAfterSec / 60);
    return { error: plural(intl, m.errors.register.rateLimited, minutes, { minutes }) };
  }
  const parsed = newPasswordSchema.safeParse({
    token: text(formData, "token", 200),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success)
    return { error: issueMessage(m, parsed.error.issues[0]) };

  const result = await consumeAccountToken(
    parsed.data.token,
    parsed.data.password,
  );
  if (!result.ok) return { error: m.auth.reset.invalid };
  await recordAudit({
    action: "auth.password_reset",
    userId: result.userId,
    detail: result.purpose,
  });
  redirect(`/login?password=${result.purpose === "INVITE" ? "set" : "reset"}`);
}
