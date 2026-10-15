import "server-only";
import { prisma } from "@/app/lib/prisma";
import { workspaceAccessOf } from "@/app/lib/access";
import { generateOrgKey } from "@/app/lib/api/tokens";

// API keys of an organization (docs/api/public-api.md, "Organization keys"). Managed with the
// "apikeys.manage" permission. A key reaches only the organization's boards, at most as an
// editor, on behalf of whoever created it (app/lib/api/auth.ts).

export const MAX_KEYS = 25;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ApiKeyError = "forbidden" | "not_found" | "too_many";

async function mayManage(workspaceId: string, actorId: string): Promise<boolean> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { kind: true, suspendedAt: true },
  });
  if (!workspace || workspace.kind !== "ORGANIZATION" || workspace.suspendedAt) return false;
  return Boolean((await workspaceAccessOf(workspaceId, actorId))?.permissions.has("apikeys.manage"));
}

export async function createApiKey(input: {
  workspaceId: string;
  actorId: string;
  name: string;
  scope: "read" | "full";
  // 0 = never.
  expiryDays: number;
  now?: Date;
}): Promise<{ ok: true; id: string; token: string } | { ok: false; error: ApiKeyError }> {
  if (!(await mayManage(input.workspaceId, input.actorId))) return { ok: false, error: "forbidden" };
  if ((await prisma.workspaceApiKey.count({ where: { workspaceId: input.workspaceId } })) >= MAX_KEYS) {
    return { ok: false, error: "too_many" };
  }
  const now = input.now ?? new Date();
  const { token, hash, prefix } = generateOrgKey();
  const key = await prisma.workspaceApiKey.create({
    data: {
      workspaceId: input.workspaceId,
      name: input.name,
      scope: input.scope,
      tokenHash: hash,
      prefix,
      createdById: input.actorId,
      expiresAt: input.expiryDays > 0 ? new Date(now.getTime() + input.expiryDays * DAY_MS) : null,
    },
    select: { id: true },
  });
  return { ok: true, id: key.id, token };
}

export async function revokeApiKey(input: {
  workspaceId: string;
  actorId: string;
  keyId: string;
}): Promise<{ ok: true } | { ok: false; error: ApiKeyError }> {
  if (!(await mayManage(input.workspaceId, input.actorId))) return { ok: false, error: "forbidden" };
  const { count } = await prisma.workspaceApiKey.deleteMany({ where: { id: input.keyId, workspaceId: input.workspaceId } });
  return count === 0 ? { ok: false, error: "not_found" } : { ok: true };
}

export async function listApiKeys(workspaceId: string) {
  return prisma.workspaceApiKey.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      scope: true,
      expiresAt: true,
      lastUsedAt: true,
      createdAt: true,
      createdBy: { select: { name: true } },
    },
  });
}
