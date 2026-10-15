import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { login, verifyLoginCode } from "@/app/lib/actions/auth";
import { verifySession } from "@/app/lib/dal";
import { decryptSecret } from "@/app/lib/crypto/secrets";
import { base32Decode, hotp, totpStep } from "@/app/lib/totp";
import {
  confirmTwoFactorSetup,
  disableTwoFactor,
  startTwoFactorSetup,
  twoFactorStatus,
  verifySecondFactor,
} from "@/app/lib/services/two-factor";
import { resetDb, disconnect, seedUser, formOf, redirectTarget } from "./helpers";
import { cookies } from "../stubs/next-headers";

// Two-step verification (docs/authentication.md): setup, the second step of the sign-in,
// replays, recovery codes, turning it off, and the secret at rest.

beforeEach(async () => {
  await resetDb();
  await prisma.instanceConfig.create({
    data: { id: "singleton", instanceName: "Test", setupCompletedAt: new Date() },
  });
});
afterAll(disconnect);

const PASSWORD = "contraseña-segura";

async function pendingSecret(userId: string): Promise<string> {
  const row = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { totpPendingEnc: true } });
  return decryptSecret(row.totpPendingEnc!, `totp:${userId}`);
}

function codeFor(secret: string, now = Date.now()): string {
  return hotp(base32Decode(secret), totpStep(now));
}

/** An account with two-step verification on; returns its secret and recovery codes. */
async function seedWithTwoFactor(email = "ana@test.local") {
  const user = await seedUser({ email, password: PASSWORD });
  await startTwoFactorSetup(user.id);
  const secret = await pendingSecret(user.id);
  // A code from the previous step, so the one of "now" is still unused for the tests.
  const confirmed = await confirmTwoFactorSetup(user.id, codeFor(secret, Date.now() - 30_000));
  if (!confirmed.ok) throw new Error(confirmed.error);
  return { user, secret, recoveryCodes: confirmed.recoveryCodes };
}

describe("setup", () => {
  it("only turns on with a valid code, and keeps the secret encrypted", async () => {
    const user = await seedUser({ password: PASSWORD });
    expect(await startTwoFactorSetup(user.id)).toEqual({ ok: true });
    const secret = await pendingSecret(user.id);
    expect(await confirmTwoFactorSetup(user.id, "000000")).toEqual({ ok: false, error: "bad_code" });
    const ok = await confirmTwoFactorSetup(user.id, codeFor(secret));
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.recoveryCodes).toHaveLength(10);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.totpSecretEnc).not.toContain(secret);
    expect(row.recoveryCodeHashes).toHaveLength(10);
    expect(row.recoveryCodeHashes.join()).not.toContain(ok.recoveryCodes[0].replace("-", ""));
    expect((await twoFactorStatus(user.id)).enabledAt).not.toBeNull();
    // Not twice.
    expect(await startTwoFactorSetup(user.id)).toEqual({ ok: false });
  });
});

describe("second factor", () => {
  it("accepts a code once, and each recovery code once", async () => {
    const { user, secret, recoveryCodes } = await seedWithTwoFactor();
    const code = codeFor(secret);
    expect(await verifySecondFactor(user.id, code)).toBe("totp");
    expect(await verifySecondFactor(user.id, code)).toBeNull();
    expect(await verifySecondFactor(user.id, recoveryCodes[0].toUpperCase())).toBe("recovery");
    expect(await verifySecondFactor(user.id, recoveryCodes[0])).toBeNull();
    expect((await twoFactorStatus(user.id)).recoveryLeft).toBe(9);
  });

  it("a secret copied from another account does not work there", async () => {
    const a = await seedWithTwoFactor("a@test.local");
    const b = await seedWithTwoFactor("b@test.local");
    const rowA = await prisma.user.findUniqueOrThrow({ where: { id: a.user.id }, select: { totpSecretEnc: true } });
    await prisma.user.update({ where: { id: b.user.id }, data: { totpSecretEnc: rowA.totpSecretEnc } });
    expect(await verifySecondFactor(b.user.id, codeFor(a.secret))).toBeNull();
  });
});

describe("sign-in with two-step verification", () => {
  it("asks for the code before opening a session", async () => {
    const { secret } = await seedWithTwoFactor();
    const to = await redirectTarget(() => login({}, formOf({ email: "ana@test.local", password: PASSWORD })));
    expect(to).toBe("/login/verify");
    expect(await verifySession()).toBeNull();
    expect((await cookies()).get("pending_2fa")).toBeTruthy();

    const wrong = await verifyLoginCode({}, formOf({ code: "000000" }));
    expect(wrong.error).toBeTruthy();
    expect(await verifySession()).toBeNull();

    const done = await redirectTarget(() => verifyLoginCode({}, formOf({ code: codeFor(secret) })));
    expect(done).toBe("/boards");
    expect(await verifySession()).not.toBeNull();
    expect((await cookies()).get("pending_2fa")).toBeUndefined();
    const audit = await prisma.auditLog.findFirst({ where: { action: "auth.login" } });
    expect(audit?.detail).toBe("2fa");
  });

  it("without the password step there is nothing to verify", async () => {
    const { secret } = await seedWithTwoFactor();
    const to = await redirectTarget(() => verifyLoginCode({}, formOf({ code: codeFor(secret) })));
    expect(to).toBe("/login");
    expect(await verifySession()).toBeNull();
  });

  it("sends back to the password after five wrong codes", async () => {
    const { secret } = await seedWithTwoFactor();
    await redirectTarget(() => login({}, formOf({ email: "ana@test.local", password: PASSWORD })));
    for (let i = 0; i < 5; i++) await verifyLoginCode({}, formOf({ code: "000000" }));
    const locked = await verifyLoginCode({}, formOf({ code: codeFor(secret) }));
    expect(locked.error).toBeTruthy();
    expect((await cookies()).get("pending_2fa")).toBeUndefined();
    expect(await verifySession()).toBeNull();
  });

  it("changing the password voids a pending second step", async () => {
    const { user, secret } = await seedWithTwoFactor();
    await redirectTarget(() => login({}, formOf({ email: "ana@test.local", password: PASSWORD })));
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: "changed" } });
    const to = await redirectTarget(() => verifyLoginCode({}, formOf({ code: codeFor(secret) })));
    expect(to).toBe("/login");
  });
});

describe("turning it off", () => {
  it("needs the password and a code", async () => {
    const { user, recoveryCodes } = await seedWithTwoFactor();
    expect(await disableTwoFactor(user.id, "wrong", recoveryCodes[0])).toEqual({ ok: false, error: "bad_password" });
    expect(await disableTwoFactor(user.id, PASSWORD, "000000")).toEqual({ ok: false, error: "bad_code" });
    expect(await disableTwoFactor(user.id, PASSWORD, recoveryCodes[1])).toEqual({ ok: true });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row).toMatchObject({ totpSecretEnc: null, totpEnabledAt: null, recoveryCodeHashes: [] });
  });
});
