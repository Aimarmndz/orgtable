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

const COOKIE_NAME = "session";
// Exportado para la política de privacidad, que dice cuánto dura una sesión.
export const SESSION_MAX_AGE_DAYS = 7;
const MAX_AGE_MS = SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

// La clave se deriva en el momento de usarse (no al importar el módulo, para no romper el
// build) y se EXIGE: sin SESSION_SECRET, `TextEncoder().encode(undefined)` daría una clave
// vacía/predecible con la que se podrían FORJAR sesiones. Fallar ruidosamente es lo seguro.
function getKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "SESSION_SECRET no está configurado o es demasiado corto (mínimo 16 caracteres). " +
        "Genera uno con: openssl rand -hex 32",
    );
  }
  return new TextEncoder().encode(secret);
}

export type SessionPayload = { userId: string; sid: string };

async function encrypt(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getKey());
}

export async function decrypt(
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token) return null;
  // getKey() va FUERA del try: un SESSION_SECRET ausente es un fallo de configuración y
  // debe romper la petición con su mensaje, no convertirse en "sin sesión" (lo que
  // mandaría a /login sin dejar rastro). Sin cookie ni se llega aquí, así que /login y
  // /setup siguen funcionando para visitantes anónimos.
  const key = getKey();
  try {
    const { payload } = await jwtVerify(token, key, {
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

/**
 * true si la petición llegó por HTTPS. Next rellena X-Forwarded-Proto con el esquema real
 * del socket cuando no viene de un proxy (`??=` en base-server), y un proxy TLS la fija a
 * "https". Se mira el primer valor por si hay varios proxies encadenados.
 */
function isHttpsRequest(h: Headers): boolean {
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  return proto === "https";
}

/** Crea una fila de sesión y guarda el JWT (con su sid) en la cookie httpOnly. */
export async function createSession(userId: string): Promise<void> {
  // Se valida la clave ANTES de crear la fila: sin SESSION_SECRET no queda una sesión
  // huérfana en la BD.
  getKey();
  const expiresAt = new Date(Date.now() + MAX_AGE_MS);
  const requestHeaders = await headers();
  const userAgent = requestHeaders.get("user-agent")?.slice(0, 255) ?? null;

  const session = await prisma.session.create({
    data: { userId, expiresAt, userAgent },
  });

  const token = await encrypt({ userId, sid: session.id });
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    // Secure según el esquema REAL de la petición, no NODE_ENV: con NODE_ENV el primer
    // arranque documentado (http://IP:3000) quedaba inutilizable, porque el navegador
    // descarta una cookie Secure recibida por HTTP. Detrás de un proxy TLS la cookie sí
    // lleva Secure. Falsear X-Forwarded-Proto solo perjudica al propio cliente.
    secure: isHttpsRequest(requestHeaders),
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
