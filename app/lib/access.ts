import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import {
  boardRoleFromWorkspace,
  maxBoardRole,
  type BoardRole,
  type WorkspaceRole,
} from "@/app/lib/roles";

// THE place that decides who can open a board. Every page, Server Action, route handler
// and API endpoint goes through one of these two functions, so the rules exist once:
//
// 1. An explicit board membership (BoardMember) gives its role.
// 2. A membership of the board's workspace gives a role too (roles.boardRoleFromWorkspace):
//    owners and admins manage every board of the organization, members edit the boards
//    shared with the workspace.
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
          members: { where: { userId }, select: { role: true } },
        },
      },
    },
  });
  if (!board || board.workspace.suspendedAt) return null;
  const explicit = board.members[0]?.role ?? null;
  const fromWorkspace = board.workspace.members[0]
    ? boardRoleFromWorkspace(board.workspace.members[0].role, board.visibility)
    : null;
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
