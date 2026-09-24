import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { SignJWT } from "jose";
import { prisma } from "@/app/lib/prisma";
import { deleteSession, revokeAllUserSessions } from "@/app/lib/session";
import { verifySession, getCurrentUser } from "@/app/lib/dal";
import { cookies } from "next/headers";
import { resetDb, disconnect, seedUser, loginAs } from "./helpers";

// Sesiones respaldadas por la tabla Session (ADR 0008): la revocación inmediata depende de
// las comprobaciones de verifySession (app/lib/dal.ts). Si alguna se quita, estos tests
// fallan. Usan el stub mutable de next/headers y el SESSION_SECRET de test.

beforeEach(async () => {
  await resetDb();
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

describe("verifySession (integración)", () => {
  it("con una sesión recién creada devuelve el usuario y el sid", async () => {
    // Caso obligatorio: decrypt oculta los fallos (devuelve null), así que sin este test
    // una mala configuración haría pasar todos los "devuelve null" de abajo.
    const u = await seedUser();
    await loginAs(u.id);

    const session = await verifySession();
    const row = await prisma.session.findFirstOrThrow({ where: { userId: u.id } });
    expect(session).toEqual({ userId: u.id, sessionId: row.id });
  });

  it("cache() de React no memoiza fuera de RSC: cambiar de usuario se ve al instante", async () => {
    const a = await seedUser();
    const b = await seedUser();
    await loginAs(a.id);
    expect((await getCurrentUser())?.id).toBe(a.id);
    await loginAs(b.id);
    expect((await getCurrentUser())?.id).toBe(b.id);
  });

  it("tras revokeAllUserSessions devuelve null", async () => {
    const u = await seedUser();
    await loginAs(u.id);
    await revokeAllUserSessions(u.id);
    expect(await verifySession()).toBeNull();
  });

  it("con la sesión caducada en la BD devuelve null", async () => {
    const u = await seedUser();
    await loginAs(u.id);
    await prisma.session.updateMany({
      where: { userId: u.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await verifySession()).toBeNull();
  });

  it("un JWT válido con el sid de la sesión de OTRO usuario devuelve null", async () => {
    const victim = await seedUser();
    const attacker = await seedUser();
    await loginAs(victim.id);
    const victimSession = await prisma.session.findFirstOrThrow({
      where: { userId: victim.id },
    });

    await setSessionCookie(await signToken({ userId: attacker.id, sid: victimSession.id }));
    expect(await verifySession()).toBeNull();
  });

  it("rechaza cookies firmadas con otra clave, con otro algoritmo o sin sid", async () => {
    const u = await seedUser();
    await loginAs(u.id);
    const row = await prisma.session.findFirstOrThrow({ where: { userId: u.id } });

    const otherKey = new TextEncoder().encode("otra-clave-distinta-de-la-de-test-000");
    await setSessionCookie(await signToken({ userId: u.id, sid: row.id }, { secret: otherKey }));
    expect(await verifySession()).toBeNull();

    await setSessionCookie(await signToken({ userId: u.id, sid: row.id }, { alg: "HS512" }));
    expect(await verifySession()).toBeNull();

    await setSessionCookie(await signToken({ userId: u.id }));
    expect(await verifySession()).toBeNull();
  });

  it("deleteSession marca revokedAt y borra la cookie", async () => {
    const u = await seedUser();
    await loginAs(u.id);
    await deleteSession();

    const row = await prisma.session.findFirstOrThrow({ where: { userId: u.id } });
    expect(row.revokedAt).not.toBeNull();
    expect((await cookies()).get("session")).toBeUndefined();
    expect(await verifySession()).toBeNull();
  });
});
