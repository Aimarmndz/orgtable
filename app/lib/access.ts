import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import {
  boardRoleFromMembership,
  maxBoardRole,
  type BoardRole,
  type WorkspaceRole,
} from "@/app/lib/roles";
import { permissionsOf, type Permission } from "@/app/lib/permissions";

// THE place that decides who can open a board. Every page, Server Action, route handler
// and API endpoint goes through one of these two functions, so the rules exist once:
//
// 1. An explicit board membership (BoardMember) gives its role.
// 2. A membership of the board's workspace gives a role too (roles.boardRoleFromWorkspace):
//    owners and admins manage every board of the organization, members edit the boards
//    shared with the workspace, and a custom role with "boards.view_all" also sees the
//    private ones (app/lib/permissions.ts).
// 3. A suspended workspace (/admin/workspaces) gives nobody anything.
//
// The effective role is the higher of 1 and 2. See docs/authorization.md.

const MANAGERS: WorkspaceRole[] = ["OWNER", "ADMIN"];

/** Prisma filter for "boards this user can open". Use it in every board query. */
export function accessibleBoardsWhere(userId: string): Prisma.BoardWhereInput {
  return {
    workspace: { suspendedAt: null },
    OR: [
      { members: { some: { userId } } },
      { workspace: { members: { some: { userId, role: { in: MANAGERS } } } } },
      { visibility: "WORKSPACE", workspace: { members: { some: { userId } } } },
      {
        workspace: {
          members: { some: { userId, customRole: { permissions: { has: "boards.view_all" } } } },
        },
      },
    ],
  };
}

/** The user's effective role on a board, or null without access (or if it does not exist). */
export async function effectiveBoardRole(
  boardId: string,
  userId: string,
): Promise<BoardRole | null> {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: {
      visibility: true,
      members: { where: { userId }, select: { role: true } },
      workspace: {
        select: {
          suspendedAt: true,
          members: {
            where: { userId },
            select: { role: true, customRole: { select: { permissions: true } } },
          },
        },
      },
    },
  });
  if (!board || board.workspace.suspendedAt) return null;
  const explicit = board.members[0]?.role ?? null;
  const membership = board.workspace.members[0];
  const fromWorkspace = membership ? boardRoleFromMembership(membership, board.visibility) : null;
  return maxBoardRole(explicit, fromWorkspace);
}

/** The user's role in a workspace, or null if they are not a member. */
export async function workspaceRoleOf(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | null> {
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  });
  return member?.role ?? null;
}

export type WorkspaceAccess = {
  role: WorkspaceRole;
  customRoleId: string | null;
  permissions: ReadonlySet<Permission>;
};

type Db = Pick<typeof prisma, "workspaceMember">;

/**
 * The user's role AND permissions in a workspace, or null if they are not a member. Services
 * call it with the transaction they run in, so the answer and the change agree.
 */
export async function workspaceAccessOf(
  workspaceId: string,
  userId: string,
  db: Db = prisma,
): Promise<WorkspaceAccess | null> {
  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true, customRoleId: true, customRole: { select: { permissions: true } } },
  });
  if (!member) return null;
  return {
    role: member.role,
    customRoleId: member.customRoleId,
    permissions: permissionsOf(member.role, member.customRole?.permissions),
  };
}
