import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/app/lib/prisma";
import { verifyPassword } from "@/app/lib/auth";
import { decryptSecret, encryptSecret } from "@/app/lib/crypto/secrets";
import {
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  totpUri,
  verifyTotp,
} from "@/app/lib/totp";

// Two-step verification of an account (docs/authentication.md, "Two-step verification").
// Business rules without request context: the actions resolve who is acting and audit.
//
// Setup: a secret waits encrypted in totpPendingEnc until a first code proves the app has
// it; then it moves to totpSecretEnc and ten recovery codes are issued (only their SHA-256
// is kept). Every code is accepted once: totpLastStep refuses replays, and a recovery code
// is removed from the array by the same UPDATE that checks it.

const context = (userId: string) => `totp:${userId}`;

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}

export async function twoFactorStatus(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpEnabledAt: true, totpPendingEnc: true, recoveryCodeHashes: true },
  });
  return {
    enabledAt: user?.totpEnabledAt ?? null,
    pending: Boolean(user?.totpPendingEnc),
    recoveryLeft: user?.recoveryCodeHashes.length ?? 0,
  };
}

/** Starts (or restarts) the setup: a new pending secret. Not while it is already on. */
export async function startTwoFactorSetup(userId: string): Promise<{ ok: boolean }> {
  const secret = generateTotpSecret();
  const { count } = await prisma.user.updateMany({
    where: { id: userId, totpEnabledAt: null },
    data: { totpPendingEnc: encryptSecret(secret, context(userId)) },
  });
  return { ok: count === 1 };
}

/** What the setup page shows: the secret (to type it) and the otpauth address (the QR). */
export async function pendingTwoFactorSetup(
  userId: string,
  issuer: string,
): Promise<{ secret: string; uri: string } | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, totpPendingEnc: true, totpEnabledAt: true },
  });
  if (!user?.totpPendingEnc || user.totpEnabledAt) return null;
  const secret = decryptSecret(user.totpPendingEnc, context(userId));
  return { secret, uri: totpUri(secret, user.email, issuer) };
}

/** Confirms the setup with a code from the app. Returns the recovery codes, shown once. */
export async function confirmTwoFactorSetup(
  userId: string,
  code: string,
  now = Date.now(),
): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; error: "no_setup" | "bad_code" }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpPendingEnc: true, totpEnabledAt: true },
  });
  if (!user?.totpPendingEnc || user.totpEnabledAt) return { ok: false, error: "no_setup" };
  const secret = decryptSecret(user.totpPendingEnc, context(userId));
  const step = verifyTotp(secret, code, now);
  if (step === null) return { ok: false, error: "bad_code" };
  const recoveryCodes = generateRecoveryCodes();
  const { count } = await prisma.user.updateMany({
    // Same pending value: a second confirmation racing this one does nothing.
    where: { id: userId, totpEnabledAt: null, totpPendingEnc: user.totpPendingEnc },
    data: {
      totpSecretEnc: user.totpPendingEnc,
      totpPendingEnc: null,
      totpEnabledAt: new Date(now),
      totpLastStep: step,
      recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode),
    },
  });
  if (count === 0) return { ok: false, error: "no_setup" };
  return { ok: true, recoveryCodes };
}

/**
 * Checks a second-factor code at sign-in (or to confirm a sensitive change): an app code or a
 * recovery code. Each one works once. Returns which kind was used, or null.
 */
export async function verifySecondFactor(
  userId: string,
  code: string,
  now = Date.now(),
): Promise<"totp" | "recovery" | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpSecretEnc: true, totpEnabledAt: true, totpLastStep: true },
  });
  if (!user?.totpSecretEnc || !user.totpEnabledAt) return null;
  const clean = code.trim();
  if (/^\d[\d\s]{5,}$/.test(clean)) {
    // A secret that does not decrypt (another key, or copied from another row) is a failed
    // check, never a crash of the sign-in.
    let secret: string;
    try {
      secret = decryptSecret(user.totpSecretEnc, context(userId));
    } catch {
      return null;
    }
    const step = verifyTotp(secret, clean, now, user.totpLastStep);
    if (step === null) return null;
    // Only moves forward: two requests with the same code cannot both pass.
    const { count } = await prisma.user.updateMany({
      where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
      data: { totpLastStep: step },
    });
    return count === 1 ? "totp" : null;
  }
  const hash = hashRecoveryCode(clean);
  const used = await prisma.$executeRaw`
    UPDATE "User" SET "recoveryCodeHashes" = array_remove("recoveryCodeHashes", ${hash})
    WHERE "id" = ${userId} AND ${hash} = ANY("recoveryCodeHashes")`;
  return used === 1 ? "recovery" : null;
}

export type TwoFactorChangeError = "bad_password" | "bad_code" | "not_enabled";

/** Turns two-step verification off: the password AND a code (app or recovery) are needed. */
export async function disableTwoFactor(
  userId: string,
  password: string,
  code: string,
): Promise<{ ok: true } | { ok: false; error: TwoFactorChangeError }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, totpEnabledAt: true },
  });
  if (!user?.totpEnabledAt) return { ok: false, error: "not_enabled" };
  if (!(await verifyPassword(password, user.passwordHash))) return { ok: false, error: "bad_password" };
  if (!(await verifySecondFactor(userId, code))) return { ok: false, error: "bad_code" };
  await clearTwoFactor(userId);
  return { ok: true };
}

/** New recovery codes (the old ones stop working). Needs the password. */
export async function regenerateRecoveryCodes(
  userId: string,
  password: string,
): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; error: TwoFactorChangeError }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, totpEnabledAt: true },
  });
  if (!user?.totpEnabledAt) return { ok: false, error: "not_enabled" };
  if (!(await verifyPassword(password, user.passwordHash))) return { ok: false, error: "bad_password" };
  const recoveryCodes = generateRecoveryCodes();
  await prisma.user.update({
    where: { id: userId },
    data: { recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode) },
  });
  return { ok: true, recoveryCodes };
}

/**
 * Removes two-step verification from an account: when its owner turns it off, or when the
 * instance administrator (or the organization that created the account) resets it for
 * someone who lost their phone and their recovery codes.
 */
export async function clearTwoFactor(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      totpSecretEnc: null,
      totpPendingEnc: null,
      totpEnabledAt: null,
      totpLastStep: null,
      recoveryCodeHashes: [],
    },
  });
}
