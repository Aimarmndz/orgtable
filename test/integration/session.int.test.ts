import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { SignJWT } from "jose";
import { prisma } from "@/app/lib/prisma";
import {
  createSession,
  decrypt,
  deleteSession,
  revokeAllUserSessions,
} from "@/app/lib/session";
import { verifySession, getCurrentUser } from "@/app/lib/dal";
import { cookies } from "next/headers";
import { __getCookieOptions, __setHeaders } from "../stubs/next-headers";
import { resetDb, disconnect, seedUser, loginAs } from "./helpers";

// Sessions backed by the Session table (ADR 0008): immediate revocation depends on the
// checks in verifySession (app/lib/dal.ts). If any of them is removed, these tests fail.
// They use the mutable next/headers stub and the test SESSION_SECRET.

beforeEach(async () => {
  await resetDb();
});
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await disconnect();
});

const key = () => new TextEncoder().encode(process.env.SESSION_SECRET);

async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set("session", token);
}

async function signToken(
  payload: Record<string, unknown>,
  opts: { secret?: Uint8Array; alg?: string } = {},
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: opts.alg ?? "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(opts.secret ?? key());
}

describe("verifySession (integration)", () => {
  it("with a freshly created session it returns the user and the sid", async () => {
    // Required case: decrypt hides failures (returns null), so without this test a broken
    // configuration would make every "returns null" below pass.
    const u = await seedUser();
    await loginAs(u.id);

    const session = await verifySession();
    const row = await prisma.session.findFirstOrThrow({ where: { userId: u.id } });
    expect(session).toEqual({ userId: u.id, sessionId: row.id });
  });

  it("React's cache() does not memoize outside RSC: switching user is visible at once", async () => {
    const a = await seedUser();
    const b = await seedUser();
    await loginAs(a.id);
    expect((await getCurrentUser())?.id).toBe(a.id);
    await loginAs(b.id);
    expect((await getCurrentUser())?.id).toBe(b.id);
  });

  it("returns null after revokeAllUserSessions", async () => {
    const u = await seedUser();
    await loginAs(u.id);
    await revokeAllUserSessions(u.id);
    expect(await verifySession()).toBeNull();
  });

  it("returns null with the session expired in the DB", async () => {
    const u = await seedUser();
    await loginAs(u.id);
    await prisma.session.updateMany({
      where: { userId: u.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await verifySession()).toBeNull();
  });

  it("a valid JWT with the sid of ANOTHER user's session returns null", async () => {
    const victim = await seedUser();
    const attacker = await seedUser();
    await loginAs(victim.id);
    const victimSession = await prisma.session.findFirstOrThrow({
      where: { userId: victim.id },
    });

    await setSessionCookie(await signToken({ userId: attacker.id, sid: victimSession.id }));
    expect(await verifySession()).toBeNull();
  });

  it("rejects cookies signed with another key, with another algorithm or without a sid", async () => {
    const u = await seedUser();
    await loginAs(u.id);
    const row = await prisma.session.findFirstOrThrow({ where: { userId: u.id } });

    const otherKey = new TextEncoder().encode("another-key-different-from-the-test-one");
    await setSessionCookie(await signToken({ userId: u.id, sid: row.id }, { secret: otherKey }));
    expect(await verifySession()).toBeNull();

    await setSessionCookie(await signToken({ userId: u.id, sid: row.id }, { alg: "HS512" }));
    expect(await verifySession()).toBeNull();

    await setSessionCookie(await signToken({ userId: u.id }));
    expect(await verifySession()).toBeNull();
  });

  it("deleteSession sets revokedAt and deletes the cookie", async () => {
    const u = await seedUser();
    await loginAs(u.id);
    await deleteSession();

    const row = await prisma.session.findFirstOrThrow({ where: { userId: u.id } });
    expect(row.revokedAt).not.toBeNull();
    expect((await cookies()).get("session")).toBeUndefined();
    expect(await verifySession()).toBeNull();
  });
});

describe("decrypt: missing SESSION_SECRET", () => {
  it("fails loudly instead of treating it as 'no session'", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    await expect(decrypt("x.y.z")).rejects.toThrow(/SESSION_SECRET/);
    // Without a cookie the key is not needed: /login and /setup keep working.
    await expect(decrypt(undefined)).resolves.toBeNull();
  });

  it("with a valid secret, a tampered token still returns null", async () => {
    expect(await decrypt("x.y.z")).toBeNull();
  });

  it("createSession does not leave an orphan row if the key is missing", async () => {
    const u = await seedUser();
    vi.stubEnv("SESSION_SECRET", "");
    await expect(createSession(u.id)).rejects.toThrow(/SESSION_SECRET/);
    expect(await prisma.session.count()).toBe(0);
  });
});

describe("session cookie: Secure depending on the request scheme", () => {
  it("over HTTP (first start on http://IP:3000) the cookie is not Secure", async () => {
    const u = await seedUser();
    __setHeaders({ "x-forwarded-proto": "http" });
    await createSession(u.id);
    expect(__getCookieOptions("session")).toMatchObject({ secure: false, httpOnly: true });
  });

  it("over HTTPS (TLS proxy) the cookie is Secure", async () => {
    const u = await seedUser();
    __setHeaders({ "x-forwarded-proto": "https" });
    await createSession(u.id);
    expect(__getCookieOptions("session")).toMatchObject({ secure: true, httpOnly: true });
  });
});
