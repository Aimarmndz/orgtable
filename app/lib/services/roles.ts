import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { workspaceAccessOf } from "@/app/lib/access";
import { canManageWorkspace } from "@/app/lib/roles";
import { sanitizeCustomPermissions, type Permission } from "@/app/lib/permissions";
import { isUniqueViolation } from "@/app/lib/services/users";
import { BOARD_COLOR_KEYS, type BoardColor } from "@/app/lib/colors";

// Custom roles of an organization (docs/roles.md). Business rules only, without request
// context: the actions (app/lib/actions/roles.ts) resolve who is acting and audit.
//
// - Only owners and admins create, edit or delete roles ("people.roles" is base-only), and
//   nobody puts in a role a permission they do not hold themselves.
// - Every lookup is by { workspaceId, id }: a role id of another organization is "not
//   found", never edited.
// - A suspended organization is frozen.

export const MAX_CUSTOM_ROLES = 50;

export type RoleError = "forbidden" | "not_found" | "name_taken" | "too_many";

export type RoleInput = {
  name: string;
  color: string;
  description: string | null;
  permissions: readonly string[];
};

type Tx = Prisma.TransactionClient;

async function mayManageRoles(
  workspaceId: string,
  actorId: string,
  db: Tx | typeof prisma = prisma,
) {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { kind: true, suspendedAt: true },
  });
  if (!workspace || workspace.kind !== "ORGANIZATION" || workspace.suspendedAt) return null;
  const actor = await workspaceAccessOf(workspaceId, actorId, db);
  if (!actor || !canManageWorkspace(actor.role)) return null;
  return actor;
}

function cleanColor(color: string): BoardColor {
  return (BOARD_COLOR_KEYS as string[]).includes(color) ? (color as BoardColor) : "blue";
}

/** The permissions to store: known, allowed in a custom role and held by the actor. */
function storable(input: readonly string[], actor: ReadonlySet<Permission>): Permission[] {
  return sanitizeCustomPermissions(input).filter((p) => actor.has(p));
}

/** An organization's custom roles with how many members hold each. */
export async function listCustomRoles(workspaceId: string) {
  return prisma.workspaceCustomRole.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      color: true,
      description: true,
      permissions: true,
      _count: { select: { members: true } },
    },
  });
}

export async function createCustomRole(input: {
  workspaceId: string;
  actorId: string;
  role: RoleInput;
}): Promise<{ ok: true; id: string } | { ok: false; error: RoleError }> {
  const actor = await mayManageRoles(input.workspaceId, input.actorId);
  if (!actor) return { ok: false, error: "forbidden" };
  const count = await prisma.workspaceCustomRole.count({ where: { workspaceId: input.workspaceId } });
  if (count >= MAX_CUSTOM_ROLES) return { ok: false, error: "too_many" };
  try {
    const role = await prisma.workspaceCustomRole.create({
      data: {
        workspaceId: input.workspaceId,
        name: input.role.name,
        color: cleanColor(input.role.color),
        description: input.role.description,
        permissions: storable(input.role.permissions, actor.permissions),
      },
      select: { id: true },
    });
    return { ok: true, id: role.id };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "name_taken" };
    throw e;
  }
}

export async function updateCustomRole(input: {
  workspaceId: string;
  actorId: string;
  roleId: string;
  role: RoleInput;
}): Promise<{ ok: true } | { ok: false; error: RoleError }> {
  const actor = await mayManageRoles(input.workspaceId, input.actorId);
  if (!actor) return { ok: false, error: "forbidden" };
  try {
    const { count } = await prisma.workspaceCustomRole.updateMany({
      where: { id: input.roleId, workspaceId: input.workspaceId },
      data: {
        name: input.role.name,
        color: cleanColor(input.role.color),
        description: input.role.description,
        permissions: storable(input.role.permissions, actor.permissions),
      },
    });
    return count === 0 ? { ok: false, error: "not_found" } : { ok: true };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "name_taken" };
    throw e;
  }
}

/** A copy of a role, named "<name> (2)", "(3)"… until the name is free. */
export async function duplicateCustomRole(input: {
  workspaceId: string;
  actorId: string;
  roleId: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: RoleError }> {
  const source = await prisma.workspaceCustomRole.findUnique({
    where: { workspaceId_id: { workspaceId: input.workspaceId, id: input.roleId } },
    select: { name: true, color: true, description: true, permissions: true },
  });
  if (!source) return { ok: false, error: "not_found" };
  for (let n = 2; n < 100; n++) {
    const result = await createCustomRole({
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      role: { ...source, name: `${source.name.slice(0, 50)} (${n})` },
    });
    if (result.ok || result.error !== "name_taken") return result;
  }
  return { ok: false, error: "name_taken" };
}

/**
 * Deletes a role. Its members stay in the organization as plain members (in the same
 * transaction, so nobody is left pointing at a role that no longer exists).
 */
export async function deleteCustomRole(input: {
  workspaceId: string;
  actorId: string;
  roleId: string;
}): Promise<{ ok: true; members: number } | { ok: false; error: RoleError }> {
  return prisma.$transaction(async (tx) => {
    const actor = await mayManageRoles(input.workspaceId, input.actorId, tx);
    if (!actor) return { ok: false, error: "forbidden" } as const;
    const { count: members } = await tx.workspaceMember.updateMany({
      where: { workspaceId: input.workspaceId, customRoleId: input.roleId },
      data: { customRoleId: null },
    });
    const { count } = await tx.workspaceCustomRole.deleteMany({
      where: { id: input.roleId, workspaceId: input.workspaceId },
    });
    if (count === 0) return { ok: false, error: "not_found" } as const;
    return { ok: true, members } as const;
  });
}
