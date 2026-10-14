"use server";

import { redirect } from "next/navigation";
import { isLocale } from "@/app/i18n/config";
import { setLocaleCookie } from "@/app/i18n/cookie";
import { prisma } from "@/app/lib/prisma";
import { verifyPasswordOrDummy } from "@/app/lib/auth";
import { createSession, deleteSession } from "@/app/lib/session";
import { verifySession } from "@/app/lib/dal";
import { loginSchema } from "@/app/lib/validators";
import { rateLimit, resetRateLimit } from "@/app/lib/rate-limit";
import { recordAudit, clientIp } from "@/app/lib/audit";
import { getI18n } from "@/app/i18n/server";
import { plural } from "@/app/i18n/format";

// `values` returns what was typed (never the password) to repaint the form: React 19
// resets uncontrolled forms after the action and, without this, an error cleared the email.
export type AuthState = { error?: string; values?: { email: string } };

// Up to 10 login attempts per IP every 10 minutes (anti brute force). Only applied when
// there is a trustworthy IP (TRUSTED_PROXY_HOPS > 0, see app/lib/client-ip.ts); without one,
// everybody is not lumped into a shared bucket, which would lock the login for everyone.
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;

// Per-account limit, independent of the IP: slows down attacks spread over many IPs. It
// counts failed attempts (also for emails that do not exist, so as not to reveal which do)
// and is reset after a successful login. Accepted risk: whoever knows an email can lock
// that account for up to 15 minutes. See docs/decisions/0009.
const EMAIL_LIMIT = 20;
const EMAIL_WINDOW_MS = 15 * 60 * 1000;

async function tooManyAttempts(
  retryAfterSec: number,
  values: AuthState["values"],
): Promise<AuthState> {
  const { m, intl } = await getI18n();
  return {
    error: plural(intl, m.errors.auth.tooManyAttempts, retryAfterSec, {
      seconds: retryAfterSec,
    }),
    values,
  };
}

export async function login(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const ip = await clientIp();
  const rawEmail = formData.get("email");
  const values = { email: typeof rawEmail === "string" ? rawEmail.slice(0, 254) : "" };

  if (ip) {
    const limit = rateLimit(`login:${ip}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
    if (!limit.ok) {
      // One row per blocked window, not one per attempt: a sustained attack must not fill
      // AuditLog precisely while the limit is holding it back.
      if (limit.firstBlock) {
        await recordAudit({ action: "auth.login_rate_limited", ip, detail: "IP limit" });
      }
      return tooManyAttempts(limit.retryAfterSec, values);
    }
  }

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: (await getI18n()).m.errors.auth.checkCredentials, values };
  }
  const email = parsed.data.email.toLowerCase();

  // Counted BEFORE verifying (no races between simultaneous requests) and cleared if the
  // login succeeds, so in practice only failures add up.
  const emailKey = `login-email:${email}`;
  const emailLimit = rateLimit(emailKey, EMAIL_LIMIT, EMAIL_WINDOW_MS);
  if (!emailLimit.ok) {
    if (emailLimit.firstBlock) {
      await recordAudit({
        action: "auth.login_rate_limited",
        ip,
        detail: "account limit",
      });
    }
    return tooManyAttempts(emailLimit.retryAfterSec, values);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  // If the user does not exist, a dummy hash of the same cost is verified, so as not to leak
  // through timing whether an email is registered.
  const valid = await verifyPasswordOrDummy(
    parsed.data.password,
    user?.passwordHash ?? null,
  );

  if (!user || !valid) {
    // Without the typed email: it could belong to someone else (or be a password pasted
    // into the wrong field) and would end up visible in /admin/audit. If the account exists,
    // its userId is enough.
    await recordAudit({
      action: "auth.login_failed",
      userId: user?.id ?? null,
      ip,
    });
    return { error: (await getI18n()).m.errors.auth.invalidCredentials, values };
  }

  resetRateLimit(emailKey);
  await createSession(user.id);
  // The account's language wins over the browser's on any device it signs in from.
  if (isLocale(user.locale)) {
    await setLocaleCookie(user.locale);
  }
  await recordAudit({ action: "auth.login", userId: user.id, ip });
  redirect("/boards");
}

export async function logout(): Promise<void> {
  const session = await verifySession();
  await deleteSession();
  if (session) {
    await recordAudit({ action: "auth.logout", userId: session.userId });
  }
  redirect("/login");
}
