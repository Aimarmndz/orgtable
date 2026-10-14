"use server";

import { redirect } from "next/navigation";
import { createUserAccount } from "@/app/lib/services/users";
import { isRegistrationOpen } from "@/app/lib/services/instance";
import { createSession } from "@/app/lib/session";
import { getI18n, issueMessage } from "@/app/i18n/server";
import { plural } from "@/app/i18n/format";
import { registerSchema } from "@/app/lib/validators";
import { rateLimit } from "@/app/lib/rate-limit";
import { recordAudit, clientIp } from "@/app/lib/audit";

// Open registration (/register). It only works if the admin opened it in /admin/instance
// and the instance has an operator and a contact (without them the privacy policy would be
// incomplete). New accounts are always MEMBER. See docs/privacy.md and
// docs/authentication.md.

export type RegisterState = {
  error?: string;
  field?: "name" | "email" | "password" | "acceptTerms";
  // What was typed, to repaint the form after an error. Never the password.
  values?: { name: string; email: string };
};

// Per IP: 5 sign-ups per hour. Only with a trustworthy IP (TRUSTED_PROXY_HOPS > 0); without
// one, everybody is not lumped into a shared bucket.
const IP_LIMIT = 5;
const IP_WINDOW_MS = 60 * 60 * 1000;
// Instance-wide cap: slows down a wave of bots even without a trustworthy IP or when they
// come from many IPs. Accepted risk: during an attack, real people cannot sign up either
// until the hour passes (visible in /admin/audit as auth.register_rate_limited).
const GLOBAL_LIMIT = 30;
const GLOBAL_WINDOW_MS = 60 * 60 * 1000;

function text(formData: FormData, key: string, max: number): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.slice(0, max) : "";
}

export async function register(
  _prev: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const values = { name: text(formData, "name", 60), email: text(formData, "email", 254) };
  const { locale, intl, m } = await getI18n();

  if (!(await isRegistrationOpen())) {
    return { error: m.errors.register.closed, values };
  }

  // Honeypot field: invisible to people (and out of the tab order), bots that fill in
  // everything write in it. The answer is a generic error, without hints.
  if (text(formData, "website", 200) !== "") {
    return { error: m.errors.register.failed, values };
  }

  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    acceptTerms: formData.get("acceptTerms") ?? undefined,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path[0];
    return {
      error: issueMessage(m, issue),
      field:
        field === "name" || field === "email" || field === "password" || field === "acceptTerms"
          ? field
          : undefined,
      values,
    };
  }

  // Counted after validating: a typo does not use up anyone's quota. What counts is each
  // sign-up (or attempt with an already registered email) with valid data.
  const ip = await clientIp();
  const limits = [
    ...(ip ? [rateLimit(`register:${ip}`, IP_LIMIT, IP_WINDOW_MS)] : []),
    rateLimit("register:global", GLOBAL_LIMIT, GLOBAL_WINDOW_MS),
  ];
  const blocked = limits.find((l) => !l.ok);
  if (blocked) {
    if (blocked.firstBlock) {
      await recordAudit({ action: "auth.register_rate_limited", ip });
    }
    const minutes = Math.ceil(blocked.retryAfterSec / 60);
    return {
      error: plural(intl, m.errors.register.rateLimited, minutes, { minutes }),
      values,
    };
  }

  const result = await createUserAccount({
    name: parsed.data.name,
    email: parsed.data.email,
    password: parsed.data.password,
    role: "MEMBER",
    termsAcceptedAt: new Date(),
    locale,
  });
  if (!result.ok) {
    // Reveals that the email already has an account. Without email verification there is
    // no way to avoid it without breaking sign-up; the sign-up limit slows down mass
    // enumeration.
    return {
      error: m.errors.register.emailTaken,
      field: "email",
      values,
    };
  }

  await createSession(result.user.id);
  await recordAudit({ action: "auth.registered", userId: result.user.id, ip });
  redirect("/boards");
}
