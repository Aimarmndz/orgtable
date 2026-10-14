import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { prisma } from "@/app/lib/prisma";

// Server-backed sessions. The cookie is a JWT signed with SESSION_SECRET (httpOnly) that
// carries the id of a row in the `Session` table (sid). The Data Access Layer
// (app/lib/dal.ts) validates the JWT and also checks that the session exists, is not
// revoked and has not expired. That allows IMMEDIATE REVOCATION (sign-out, password
// reset, sign out everywhere). See docs/authentication.md and
// docs/decisions/0008-session-store.md.

const COOKIE_NAME = "session";
// Exported for the privacy policy, which states how long a session lasts.
export const SESSION_MAX_AGE_DAYS = 7;
const MAX_AGE_MS = SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

// The key is derived when used (not on module import, so the build does not break) and
// is REQUIRED: without SESSION_SECRET, `TextEncoder().encode(undefined)` would give an
// empty/predictable key with which sessions could be FORGED. Failing loudly is the safe
// choice.
function getKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "SESSION_SECRET is not set or is too short (at least 16 characters). " +
        "Generate one with: openssl rand -hex 32",
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
  // getKey() goes OUTSIDE the try: a missing SESSION_SECRET is a configuration error and
  // must fail the request with its message, not turn into "no session" (which would send
  // to /login without a trace). Without a cookie this point is never reached, so /login
  // and /setup still work for anonymous visitors.
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
    // Invalid, expired or tampered token.
    return null;
  }
}

/**
 * true if the request arrived over HTTPS. Next fills X-Forwarded-Proto with the socket's
 * real scheme when no proxy set it (`??=` in base-server), and a TLS proxy sets it to
 * "https". The first value is used in case several proxies are chained.
 */
function isHttpsRequest(h: Headers): boolean {
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  return proto === "https";
}

/** Creates a session row and stores the JWT (with its sid) in the httpOnly cookie. */
export async function createSession(userId: string): Promise<void> {
  // The key is checked BEFORE creating the row: without SESSION_SECRET no orphan session
  // is left in the database.
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
    // Secure follows the request's REAL scheme, not NODE_ENV: with NODE_ENV the documented
    // first start (http://IP:3000) was unusable, because browsers drop a Secure cookie
    // received over HTTP. Behind a TLS proxy the cookie is Secure. Faking
    // X-Forwarded-Proto only harms the client itself.
    secure: isHttpsRequest(requestHeaders),
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
}

/** Ends the current session: revokes its row and deletes the cookie. */
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
 * Revokes ALL active sessions of a user (sign out on every device). Used by the admin
 * when resetting a password or forcing a sign-out. Takes effect at once: that user's next
 * request fails in the DAL.
 */
export async function revokeAllUserSessions(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
