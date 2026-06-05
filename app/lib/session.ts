import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { prisma } from "@/app/lib/prisma";

// Sesiones respaldadas por servidor (Hito 4). La cookie sigue siendo un JWT firmado
// con SESSION_SECRET (httpOnly), pero ahora el token lleva el id de una fila de la
// tabla `Session` (sid). El Data Access Layer (app/lib/dal.ts) valida el JWT y además
// comprueba que esa sesión existe, no está revocada y no ha expirado. Esto permite
// REVOCACIÓN INMEDIATA (logout, restablecer contraseña, cerrar en todos los
// dispositivos). Ver docs/authentication.md y docs/decisions/0008-session-store.md.

const SECRET = process.env.SESSION_SECRET;
const encodedKey = new TextEncoder().encode(SECRET);
const COOKIE_NAME = "session";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

export type SessionPayload = { userId: string; sid: string };

async function encrypt(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(encodedKey);
}

export async function decrypt(
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, encodedKey, {
      algorithms: ["HS256"],
    });
    if (typeof payload.userId !== "string" || typeof payload.sid !== "string") {
      return null;
    }
    return { userId: payload.userId, sid: payload.sid };
  } catch {
    // Token inválido, expirado o manipulado.
    return null;
  }
}

/** Crea una fila de sesión y guarda el JWT (con su sid) en la cookie httpOnly. */
export async function createSession(userId: string): Promise<void> {
  const expiresAt = new Date(Date.now() + MAX_AGE_MS);
  const userAgent =
    (await headers()).get("user-agent")?.slice(0, 255) ?? null;

  const session = await prisma.session.create({
    data: { userId, expiresAt, userAgent },
  });

  const token = await encrypt({ userId, sid: session.id });
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
}

/** Cierra la sesión actual: revoca su fila y borra la cookie. */
export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = await decrypt(token);
  if (payload?.sid) {
    await prisma.session.updateMany({
      where: { id: payload.sid, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  cookieStore.delete(COOKIE_NAME);
}

/**
 * Revoca TODAS las sesiones activas de un usuario (cerrar en todos los dispositivos).
 * Lo usa el admin al restablecer una contraseña o forzar el cierre de sesión. El
 * efecto es inmediato: la siguiente petición de ese usuario fallará en el DAL.
 */
export async function revokeAllUserSessions(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
