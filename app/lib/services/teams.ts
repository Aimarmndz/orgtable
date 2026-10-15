import "server-only";
import { prisma } from "@/app/lib/prisma";
import { effectiveBoardRole, workspaceAccessOf } from "@/app/lib/access";
import { atLeastBoardRole, type BoardRole } from "@/app/lib/roles";
import { isUniqueViolation } from "@/app/lib/services/users";
import { BOARD_COLOR_KEYS, type BoardColor } from "@/app/lib/colors";

// Teams of an organization (docs/teams.md). Business rules only, without request context:
// app/lib/actions/teams.ts resolves who is acting and audits.
//
// - Managing teams needs "people.teams" (owners and admins hold it; a custom role may).
// - A team never gives more than the person configuring it has: they can only add a board
//   they can open, with a role no higher than their own effective role on it.
// - Every lookup is by { workspaceId, id }; the foreign keys carry workspaceId too, so a
//   person or board of another organization cannot get in even through a buggy query.
// - A suspended organization is frozen.

export const MAX_TEAMS = 100;

export type TeamError = "forbidden" | "not_found" | "name_taken" | "too_many" | "not_member" | "role_too_high";

export type TeamInput = { name: string; description: string | null; color: string };

async function mayManageTeams(workspaceId: string, actorId: string): Promise<boolean> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { kind: true, suspendedAt: true },
  });
  if (!workspace || workspace.kind !== "ORGANIZATION" || workspace.suspendedAt) return false;
  const actor = await workspaceAccessOf(workspaceId, actorId);
  return Boolean(actor?.permissions.has("people.teams"));
}

function cleanColor(color: string): BoardColor {
  return (BOARD_COLOR_KEYS as string[]).includes(color) ? (color as BoardColor) : "teal";
}

async function teamExists(workspaceId: string, teamId: string): Promise<boolean> {
  return Boolean(
    await prisma.team.findUnique({ where: { workspaceId_id: { workspaceId, id: teamId } }, select: { id: true } }),
  );
}

/** The teams of an organization with their people and boards (for the settings pages). */
export async function listTeams(workspaceId: string) {
  return prisma.team.findMany({
    where: { workspaceId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      color: true,
      members: {
        orderBy: { addedAt: "asc" },
        select: { member: { select: { user: { select: { id: true, name: true } } } } },
      },
      _count: { select: { members: true, boards: true } },
    },
  });
}

export async function createTeam(input: {
  workspaceId: string;
  actorId: string;
  team: TeamInput;
}): Promise<{ ok: true; id: string } | { ok: false; error: TeamError }> {
  if (!(await mayManageTeams(input.workspaceId, input.actorId))) return { ok: false, error: "forbidden" };
  if ((await prisma.team.count({ where: { workspaceId: input.workspaceId } })) >= MAX_TEAMS) {
    return { ok: false, error: "too_many" };
  }
  try {
    const team = await prisma.team.create({
      data: {
        workspaceId: input.workspaceId,
        name: input.team.name,
        description: input.team.description,
        color: cleanColor(input.team.color),
      },
      select: { id: true },
    });
    return { ok: true, id: team.id };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "name_taken" };
    throw e;
  }
}

export async function updateTeam(input: {
  workspaceId: string;
  actorId: string;
  teamId: string;
  team: TeamInput;
}): Promise<{ ok: true } | { ok: false; error: TeamError }> {
  if (!(await mayManageTeams(input.workspaceId, input.actorId))) return { ok: false, error: "forbidden" };
  try {
    const { count } = await prisma.team.updateMany({
      where: { id: input.teamId, workspaceId: input.workspaceId },
      data: { name: input.team.name, description: input.team.description, color: cleanColor(input.team.color) },
    });
    return count === 0 ? { ok: false, error: "not_found" } : { ok: true };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "name_taken" };
    throw e;
  }
}

export async function deleteTeam(input: {
  workspaceId: string;
  actorId: string;
  teamId: string;
}): Promise<{ ok: true } | { ok: false; error: TeamError }> {
  if (!(await mayManageTeams(input.workspaceId, input.actorId))) return { ok: false, error: "forbidden" };
  const { count } = await prisma.team.deleteMany({ where: { id: input.teamId, workspaceId: input.workspaceId } });
  return count === 0 ? { ok: false, error: "not_found" } : { ok: true };
}

/** Adds a member of the organization to a team (someone from outside is "not_member"). */
export async function addTeamMember(input: {
  workspaceId: string;
  actorId: string;
  teamId: string;
  userId: string;
}): Promise<{ ok: true } | { ok: false; error: TeamError }> {
  if (!(await mayManageTeams(input.workspaceId, input.actorId))) return { ok: false, error: "forbidden" };
  if (!(await teamExists(input.workspaceId, input.teamId))) return { ok: false, error: "not_found" };
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.userId } },
    select: { userId: true },
  });
  if (!member) return { ok: false, error: "not_member" };
  await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId: input.teamId, userId: input.userId } },
    create: { teamId: input.teamId, workspaceId: input.workspaceId, userId: input.userId },
    update: {},
  });
  return { ok: true };
}

export async function removeTeamMember(input: {
  workspaceId: string;
  actorId: string;
  teamId: string;
  userId: string;
}): Promise<{ ok: true } | { ok: false; error: TeamError }> {
  if (!(await mayManageTeams(input.workspaceId, input.actorId))) return { ok: false, error: "forbidden" };
  const { count } = await prisma.teamMember.deleteMany({
    where: { teamId: input.teamId, userId: input.userId, workspaceId: input.workspaceId },
  });
  return count === 0 ? { ok: false, error: "not_found" } : { ok: true };
}

/**
 * Gives a team a role on a board of the organization, or changes it. The actor must be able
 * to open the board and the role cannot be above their own on it: a team never gives more
 * than the person configuring it has.
 */
export async function setTeamBoard(input: {
  workspaceId: string;
  actorId: string;
  teamId: string;
  boardId: string;
  role: BoardRole;
}): Promise<{ ok: true } | { ok: false; error: TeamError }> {
  if (!(await mayManageTeams(input.workspaceId, input.actorId))) return { ok: false, error: "forbidden" };
  if (!(await teamExists(input.workspaceId, input.teamId))) return { ok: false, error: "not_found" };
  const board = await prisma.board.findUnique({
    where: { workspaceId_id: { workspaceId: input.workspaceId, id: input.boardId } },
    select: { id: true },
  });
  if (!board) return { ok: false, error: "not_found" };
  const own = await effectiveBoardRole(input.boardId, input.actorId);
  if (!own) return { ok: false, error: "not_found" };
  if (!atLeastBoardRole(own, input.role)) return { ok: false, error: "role_too_high" };
  await prisma.teamBoard.upsert({
    where: { teamId_boardId: { teamId: input.teamId, boardId: input.boardId } },
    create: { teamId: input.teamId, boardId: input.boardId, workspaceId: input.workspaceId, role: input.role },
    update: { role: input.role },
  });
  return { ok: true };
}

/** Takes a board away from a team (the actor must be able to open it). */
export async function removeTeamBoard(input: {
  workspaceId: string;
  actorId: string;
  teamId: string;
  boardId: string;
}): Promise<{ ok: true } | { ok: false; error: TeamError }> {
  if (!(await mayManageTeams(input.workspaceId, input.actorId))) return { ok: false, error: "forbidden" };
  if (!(await effectiveBoardRole(input.boardId, input.actorId))) return { ok: false, error: "not_found" };
  const { count } = await prisma.teamBoard.deleteMany({
    where: { teamId: input.teamId, boardId: input.boardId, workspaceId: input.workspaceId },
  });
  return count === 0 ? { ok: false, error: "not_found" } : { ok: true };
}
