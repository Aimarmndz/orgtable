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
// 3. A team of the board's organization gives the role it holds on that board to its
//    members (TeamBoard, docs/teams.md).
// 4. A suspended workspace (/admin/workspaces) gives nobody anything, and an organization
//    that requires two-step verification gives nothing to someone without it.
//
// The effective role is the highest of 1, 2 and 3. See docs/authorization.md.

const MANAGERS: WorkspaceRole[] = ["OWNER", "ADMIN"];

/** Prisma filter for "boards this user can open". Use it in every board query. */
export function accessibleBoardsWhere(userId: string): Prisma.BoardWhereInput {
  return {
    workspace: { suspendedAt: null },
    // Mandatory two-step verification: the board's organization does not require it, or
    // this user has it on. (The user is reached through any membership row of theirs.)
    AND: [
      {
        OR: [
          { workspace: { requireTwoFactor: false } },
          { workspace: { members: { some: { userId, user: { totpEnabledAt: { not: null } } } } } },
          { members: { some: { userId, user: { totpEnabledAt: { not: null } } } } },
        ],
      },
    ],
    OR: [
      { members: { some: { userId } } },
      { workspace: { members: { some: { userId, role: { in: MANAGERS } } } } },
      { visibility: "WORKSPACE", workspace: { members: { some: { userId } } } },
      {
        workspace: {
          members: { some: { userId, customRole: { permissions: { has: "boards.view_all" } } } },
        },
      },
      { teams: { some: { team: { members: { some: { userId } } } } } },
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
      teams: { where: { team: { members: { some: { userId } } } }, select: { role: true } },
      workspace: {
        select: {
          suspendedAt: true,
          requireTwoFactor: true,
          members: {
            where: { userId },
            select: { role: true, customRole: { select: { permissions: true } } },
          },
        },
      },
    },
  });
  if (!board || board.workspace.suspendedAt) return null;
  if (board.workspace.requireTwoFactor && !(await hasTwoFactor(userId))) return null;
  const explicit = board.members[0]?.role ?? null;
  const membership = board.workspace.members[0];
  const fromWorkspace = membership ? boardRoleFromMembership(membership, board.visibility) : null;
  return [explicit, fromWorkspace, ...board.teams.map((t) => t.role)].reduce<BoardRole | null>(
    maxBoardRole,
    null,
  );
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

/**
 * Whether the user holds `permission` in the organization of a board: a custom role may
 * change visibility or delete boards without managing them (permissions.ts). False for
 * personal boards (their owner manages them anyway). Callers check access to the board too.
 */
export async function holdsPermissionOnBoard(
  boardId: string,
  userId: string,
  permission: Permission,
): Promise<boolean> {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { workspaceId: true, workspace: { select: { kind: true } } },
  });
  if (!board || board.workspace.kind !== "ORGANIZATION") return false;
  const access = await workspaceAccessOf(board.workspaceId, userId);
  return Boolean(access?.permissions.has(permission));
}

async function hasTwoFactor(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { totpEnabledAt: true } });
  return Boolean(user?.totpEnabledAt);
}
