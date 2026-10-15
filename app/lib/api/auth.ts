import "server-only";
import { prisma } from "@/app/lib/prisma";
import { effectiveBoardRole } from "@/app/lib/access";
import { recordAudit } from "@/app/lib/audit";
import type { BoardRole } from "@/app/lib/roles";
import { hashToken, ORG_KEY_PREFIX } from "./tokens";

// Authentication and authorization for the public API. Unlike the DAL (cookies and
// redirects), this works with `Authorization: Bearer <token>` and returns HTTP codes. The
// server is still the only authority: the board role is checked again on every request,
// with the same rules as the app (app/lib/access.ts). See docs/api/public-api.md.

// `workspaceId` is set for an ORGANIZATION key: it only reaches that organization's boards and
// never more than editing (apiBoardRole). `userId` is then the key's creator.
export type ApiAuth = { userId: string; scope: string; workspaceId: string | null };

// An organization key's use is written to its activity log, at most once an hour per key.
const KEY_USE_AUDIT_MS = 60 * 60 * 1000;

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
  if (token.startsWith(ORG_KEY_PREFIX)) return authenticateOrgKey(token);

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

  return { userId: record.userId, scope: record.scope, workspaceId: null };
}

/**
 * An organization key: valid while it has not expired, its organization is not suspended and
 * whoever created it is still a member (leaving deletes their keys anyway).
 */
async function authenticateOrgKey(token: string): Promise<ApiAuth | null> {
  const key = await prisma.workspaceApiKey.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      name: true,
      scope: true,
      expiresAt: true,
      lastUsedAt: true,
      createdById: true,
      workspaceId: true,
      workspace: { select: { suspendedAt: true } },
    },
  });
  if (!key || key.workspace.suspendedAt) return null;
  if (key.expiresAt && key.expiresAt.getTime() < Date.now()) return null;
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: key.workspaceId, userId: key.createdById } },
    select: { userId: true },
  });
  if (!member) return null;
  const now = new Date();
  await prisma.workspaceApiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: now } })
    .catch(() => undefined);
  if (!key.lastUsedAt || now.getTime() - key.lastUsedAt.getTime() > KEY_USE_AUDIT_MS) {
    await recordAudit({
      action: "workspace.apikey_used",
      userId: key.createdById,
      targetType: "workspace",
      targetId: key.workspaceId,
      detail: `${key.id} ${key.name}`,
    });
  }
  return { userId: key.createdById, scope: key.scope, workspaceId: key.workspaceId };
}

/** true if the token is read-only (cannot write). */
export function isReadOnly(auth: ApiAuth): boolean {
  return auth.scope === "read";
}

/**
 * The token's effective role on a board, or null without access. An organization key only
 * sees its organization's boards and is capped at EDITOR: it can work on boards but not
 * delete or rename them, nor manage their members.
 */
export async function apiBoardRole(auth: ApiAuth, boardId: string): Promise<BoardRole | null> {
  const role = await effectiveBoardRole(boardId, auth.userId);
  if (!role || !auth.workspaceId) return role;
  const board = await prisma.board.findUnique({ where: { id: boardId }, select: { workspaceId: true } });
  if (board?.workspaceId !== auth.workspaceId) return null;
  return role === "OWNER" ? "EDITOR" : role;
}
