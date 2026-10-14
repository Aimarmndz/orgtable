import "server-only";
import { prisma } from "@/app/lib/prisma";
import { effectiveBoardRole } from "@/app/lib/access";
import type { BoardRole } from "@/app/lib/roles";
import { hashToken } from "./tokens";

// Authentication and authorization for the public API. Unlike the DAL (cookies and
// redirects), this works with `Authorization: Bearer <token>` and returns HTTP codes. The
// server is still the only authority: the board role is checked again on every request,
// with the same rules as the app (app/lib/access.ts). See docs/api/public-api.md.

export type ApiAuth = { userId: string; scope: string };

/**
 * Resolves the user from the Authorization header. Returns `{ userId, scope }`, or null
 * when there is no valid token or it has EXPIRED. Also stamps `lastUsedAt` (best-effort).
 */
export async function authenticateApiToken(
  request: Request,
): Promise<ApiAuth | null> {
  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  const record = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, scope: true, expiresAt: true },
  });
  if (!record) return null;
  // Expired token: no longer valid (not deleted; the user sees it as expired in /settings).
  if (record.expiresAt && record.expiresAt.getTime() < Date.now()) return null;

  // Last-use stamp; it must never fail the request, but a failure is logged: lastUsedAt is
  // what users check to spot tokens used without their consent, and silently freezing it
  // would mislead them. Neither the token nor its hash is ever logged.
  await prisma.apiToken
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch((err: unknown) =>
      console.error("[api-auth] could not update lastUsedAt", {
        tokenId: record.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    );

  return { userId: record.userId, scope: record.scope };
}

/** true if the token is read-only (cannot write). */
export function isReadOnly(auth: ApiAuth): boolean {
  return auth.scope === "read";
}

/** The user's effective role on a board, or null without access. */
export async function apiBoardRole(
  userId: string,
  boardId: string,
): Promise<BoardRole | null> {
  return effectiveBoardRole(boardId, userId);
}
