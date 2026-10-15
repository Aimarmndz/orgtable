"use server";

import { redirect } from "next/navigation";
import { isLocale } from "@/app/i18n/config";
import { setLocaleCookie } from "@/app/i18n/cookie";
import { prisma } from "@/app/lib/prisma";
import { verifyPasswordOrDummy } from "@/app/lib/auth";
import {
  clearPendingTwoFactor,
  createPendingTwoFactor,
  createSession,
  deleteSession,
  readPendingTwoFactor,
} from "@/app/lib/session";
import { verifySecondFactor } from "@/app/lib/services/two-factor";
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
  // Two-step verification: no session yet, only the right to type a code at /login/verify
  // (app/lib/session.ts, createPendingTwoFactor).
  if (user.totpEnabledAt) {
    await createPendingTwoFactor(user.id, user.passwordHash);
    redirect("/login/verify");
  }
  return finishLogin(user, ip, null);
}

/** Opens the session once every step passed, and remembers the account's language. */
async function finishLogin(
  user: { id: string; locale: string | null },
  ip: string | null,
  detail: string | null,
): Promise<never> {
  await createSession(user.id);
  // The account's language wins over the browser's on any device it signs in from.
  if (isLocale(user.locale)) {
    await setLocaleCookie(user.locale);
  }
  await recordAudit({ action: "auth.login", userId: user.id, ip, detail: detail ?? undefined });
  redirect("/boards");
}

export type VerifyState = { error?: string };

// Codes per account and window at the second step. Six digits are a million options: five
// tries per ten minutes keep guessing hopeless, and running out sends the person back to
// the password.
const CODE_LIMIT = 5;
const CODE_WINDOW_MS = 10 * 60 * 1000;

/** Second step of the sign-in: a code from the authenticator app, or a recovery code. */
export async function verifyLoginCode(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const { m } = await getI18n();
  const ip = await clientIp();
  const userId = await readPendingTwoFactor();
  if (!userId) {
    await clearPendingTwoFactor();
    redirect("/login");
  }
  const limit = rateLimit(`2fa:${userId}`, CODE_LIMIT, CODE_WINDOW_MS);
  if (!limit.ok) {
    if (limit.firstBlock) await recordAudit({ action: "auth.two_factor_rate_limited", userId, ip });
    await clearPendingTwoFactor();
    return { error: m.errors.auth.twoFactorLocked };
  }
  const raw = formData.get("code");
  const code = typeof raw === "string" ? raw.slice(0, 40) : "";
  const kind = await verifySecondFactor(userId, code);
  if (!kind) {
    await recordAudit({ action: "auth.two_factor_failed", userId, ip });
    return { error: m.errors.auth.twoFactorInvalid };
  }
  resetRateLimit(`2fa:${userId}`);
  await clearPendingTwoFactor();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, locale: true } });
  if (kind === "recovery") await recordAudit({ action: "auth.recovery_code_used", userId, ip });
  return finishLogin(user, ip, kind === "recovery" ? "2fa: recovery code" : "2fa");
}

export async function logout(): Promise<void> {
  const session = await verifySession();
  await deleteSession();
  if (session) {
    await recordAudit({ action: "auth.logout", userId: session.userId });
  }
  redirect("/login");
}
