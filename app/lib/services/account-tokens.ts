import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/app/lib/prisma";
import { hashPassword } from "@/app/lib/auth";
import { mailConfig } from "@/app/lib/mail/config";
import { sendMail } from "@/app/lib/mail/send";
import {
  inviteEmail,
  passwordChangedEmail,
  passwordResetEmail,
} from "@/app/lib/mail/templates";
import { i18nFor } from "@/app/i18n/server";

// Single-use links sent by email (AccountToken): "forgot your password" and the invitation
// an organization sends to an employee it created. Only the SHA-256 of the token is stored.
// Consuming a link sets the password, revokes every session and API token of the account
// and deletes its other links. See docs/email.md.

export const RESET_MINUTES = 60;
export const INVITE_DAYS = 7;

type Purpose = "PASSWORD_RESET" | "INVITE";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A new link for an account; earlier unused links of the same purpose stop working. */
async function issueToken(
  userId: string,
  purpose: Purpose,
  ttlMs: number,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await prisma.$transaction([
    prisma.accountToken.deleteMany({ where: { userId, purpose } }),
    prisma.accountToken.create({
      data: {
        userId,
        purpose,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + ttlMs),
      },
    }),
  ]);
  return token;
}

function linkFor(publicUrl: string, token: string): string {
  return `${publicUrl}/reset-password?token=${encodeURIComponent(token)}`;
}

/**
 * "Forgot your password": emails a reset link if an account has that address. Says
 * nothing either way (the caller answers the same in both cases), so it cannot be used to
 * find out who has an account.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const config = mailConfig();
  if (!config.enabled) return;
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, name: true, email: true, locale: true },
  });
  if (!user) return;
  const token = await issueToken(
    user.id,
    "PASSWORD_RESET",
    RESET_MINUTES * 60 * 1000,
  );
  const { m, locale } = i18nFor(user.locale);
  const mail = passwordResetEmail({
    m,
    lang: locale,
    baseUrl: config.publicUrl,
    name: user.name,
    url: linkFor(config.publicUrl, token),
    minutes: RESET_MINUTES,
  });
  await sendMail({ to: user.email, ...mail });
}

/** Emails an employee the link to choose their password. False if it could not be sent. */
export async function sendInvite(input: {
  userId: string;
  organization: { name: string; slug: string };
  inviterName: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
}): Promise<boolean> {
  const config = mailConfig();
  if (!config.enabled) return false;
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, name: true, email: true, locale: true },
  });
  if (!user) return false;
  const token = await issueToken(
    user.id,
    "INVITE",
    INVITE_DAYS * 24 * 60 * 60 * 1000,
  );
  const { m, locale } = i18nFor(user.locale);
  const mail = inviteEmail({
    m,
    lang: locale,
    baseUrl: config.publicUrl,
    name: user.name,
    email: user.email,
    url: linkFor(config.publicUrl, token),
    days: INVITE_DAYS,
    organization: input.organization.name,
    organizationSlug: input.organization.slug,
    inviter: input.inviterName,
    role: m.workspaces.roles[input.role].toLowerCase(),
  });
  return sendMail({ to: user.email, ...mail });
}

/** Whose link it is, if it is still valid (for the page that asks for the password). */
export async function peekAccountToken(
  token: string,
): Promise<{ name: string; email: string; purpose: Purpose } | null> {
  if (!token) return null;
  const row = await prisma.accountToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      purpose: true,
      expiresAt: true,
      user: { select: { name: true, email: true } },
    },
  });
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  return { name: row.user.name, email: row.user.email, purpose: row.purpose };
}

export type ConsumeResult =
  | { ok: true; userId: string; purpose: Purpose }
  | { ok: false; error: "invalid" };

/**
 * Uses a link: sets the password and closes every way in that existed before (sessions,
 * API tokens, other links). The link is deleted in the same statement that checks it, so
 * two simultaneous submissions cannot both use it.
 */
export async function consumeAccountToken(
  token: string,
  password: string,
): Promise<ConsumeResult> {
  if (!token) return { ok: false, error: "invalid" };
  const passwordHash = await hashPassword(password);
  const tokenHash = hashToken(token);
  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ userId: string; purpose: Purpose }[]>`
      DELETE FROM "AccountToken"
      WHERE "tokenHash" = ${tokenHash} AND "expiresAt" > now()
      RETURNING "userId", "purpose"::text AS "purpose"`;
    const row = rows[0];
    if (!row) return null;
    await tx.user.update({ where: { id: row.userId }, data: { passwordHash } });
    await tx.session.updateMany({
      where: { userId: row.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.apiToken.deleteMany({ where: { userId: row.userId } });
    await tx.accountToken.deleteMany({ where: { userId: row.userId } });
    return row;
  });
  if (!result) return { ok: false, error: "invalid" };

  // A reset (not the first password of an invitation) is announced to the address, so the
  // owner notices if it was not them.
  const config = mailConfig();
  if (result.purpose === "PASSWORD_RESET" && config.enabled) {
    const user = await prisma.user.findUnique({
      where: { id: result.userId },
      select: { name: true, email: true, locale: true },
    });
    if (user) {
      const { m, locale } = i18nFor(user.locale);
      await sendMail({
        to: user.email,
        ...passwordChangedEmail({
          m,
          lang: locale,
          baseUrl: config.publicUrl,
          name: user.name,
          resetUrl: `${config.publicUrl}/forgot-password`,
        }),
      });
    }
  }
  return { ok: true, userId: result.userId, purpose: result.purpose };
}

/** Deletes links that expired (run by the maintenance job). */
export async function purgeExpiredAccountTokens(): Promise<number> {
  const { count } = await prisma.accountToken.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}
