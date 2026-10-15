"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/app/lib/dal";
import { recordAudit, type AuditAction } from "@/app/lib/audit";
import { prisma } from "@/app/lib/prisma";
import { boardRoleSchema, teamSchema } from "@/app/lib/validators";
import {
  addTeamMember,
  createTeam,
  deleteTeam,
  removeTeamBoard,
  removeTeamMember,
  setTeamBoard,
  updateTeam,
  type TeamError,
} from "@/app/lib/services/teams";
import { getI18n, issueMessage } from "@/app/i18n/server";
import type { Messages } from "@/app/i18n/config";

// Server Actions of an organization's teams (docs/teams.md). They resolve who is acting,
// audit and revalidate; app/lib/services/teams.ts enforces every rule.

export type TeamFormState = { error?: string; message?: string };

function text(formData: FormData, key: string, max = 200): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.slice(0, max) : "";
}

function teamErrorMessage(m: Messages, error: TeamError): string {
  switch (error) {
    case "name_taken":
      return m.errors.workspaces.teamNameTaken;
    case "too_many":
      return m.errors.workspaces.tooManyTeams;
    case "not_member":
      return m.errors.workspaces.notMember;
    case "role_too_high":
      return m.errors.workspaces.teamRoleTooHigh;
    case "not_found":
      return m.errors.workspaces.teamNotFound;
    default:
      return m.errors.workspaces.forbidden;
  }
}

async function teamsPath(workspaceId: string): Promise<string | null> {
  const w = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { slug: true } });
  return w ? `/${w.slug}/settings/teams` : null;
}

/** Revalidates the organization (its boards' access may have changed too). */
async function refresh(workspaceId: string) {
  const path = await teamsPath(workspaceId);
  if (path) revalidatePath(`/${path.split("/")[1]}`, "layout");
  revalidatePath("/boards");
}

async function audit(userId: string, action: AuditAction, workspaceId: string, detail: string) {
  await recordAudit({ action, userId, targetType: "workspace", targetId: workspaceId, detail });
}

function parseTeam(formData: FormData) {
  return teamSchema.safeParse({
    name: text(formData, "name", 120),
    color: text(formData, "color", 20),
    description: text(formData, "description", 400),
  });
}

export async function createTeamAction(_prev: TeamFormState, formData: FormData): Promise<TeamFormState> {
  const user = await requireUser();
  const { m } = await getI18n();
  const workspaceId = text(formData, "workspaceId");
  const parsed = parseTeam(formData);
  if (!parsed.success) return { error: issueMessage(m, parsed.error.issues[0]) };
  const result = await createTeam({ workspaceId, actorId: user.id, team: parsed.data });
  if (!result.ok) return { error: teamErrorMessage(m, result.error) };
  await audit(user.id, "workspace.team_created", workspaceId, `${result.id} ${parsed.data.name}`);
  await refresh(workspaceId);
  const path = await teamsPath(workspaceId);
  if (path) redirect(`${path}/${result.id}`);
  return {};
}

export async function updateTeamAction(_prev: TeamFormState, formData: FormData): Promise<TeamFormState> {
  const user = await requireUser();
  const { m } = await getI18n();
  const workspaceId = text(formData, "workspaceId");
  const teamId = text(formData, "teamId");
  const parsed = parseTeam(formData);
  if (!parsed.success) return { error: issueMessage(m, parsed.error.issues[0]) };
  const result = await updateTeam({ workspaceId, actorId: user.id, teamId, team: parsed.data });
  if (!result.ok) return { error: teamErrorMessage(m, result.error) };
  await audit(user.id, "workspace.team_updated", workspaceId, `${teamId} ${parsed.data.name}`);
  await refresh(workspaceId);
  return { message: m.workspaces.teams.saved };
}

export async function deleteTeamAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const workspaceId = text(formData, "workspaceId");
  const teamId = text(formData, "teamId");
  const result = await deleteTeam({ workspaceId, actorId: user.id, teamId });
  if (!result.ok) return;
  await audit(user.id, "workspace.team_deleted", workspaceId, teamId);
  await refresh(workspaceId);
  const path = await teamsPath(workspaceId);
  if (path) redirect(path);
}

export async function addTeamMemberAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const workspaceId = text(formData, "workspaceId");
  const teamId = text(formData, "teamId");
  const userId = text(formData, "userId");
  const result = await addTeamMember({ workspaceId, actorId: user.id, teamId, userId });
  if (!result.ok) return;
  await audit(user.id, "workspace.team_member_added", workspaceId, `${teamId} + ${userId}`);
  await refresh(workspaceId);
}

export async function removeTeamMemberAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const workspaceId = text(formData, "workspaceId");
  const teamId = text(formData, "teamId");
  const userId = text(formData, "userId");
  const result = await removeTeamMember({ workspaceId, actorId: user.id, teamId, userId });
  if (!result.ok) return;
  await audit(user.id, "workspace.team_member_removed", workspaceId, `${teamId} - ${userId}`);
  await refresh(workspaceId);
}

export async function setTeamBoardAction(_prev: TeamFormState, formData: FormData): Promise<TeamFormState> {
  const user = await requireUser();
  const { m } = await getI18n();
  const workspaceId = text(formData, "workspaceId");
  const teamId = text(formData, "teamId");
  const boardId = text(formData, "boardId");
  const role = boardRoleSchema.safeParse(formData.get("role"));
  if (!role.success) return { error: issueMessage(m, role.error.issues[0]) };
  const result = await setTeamBoard({ workspaceId, actorId: user.id, teamId, boardId, role: role.data });
  if (!result.ok) return { error: teamErrorMessage(m, result.error) };
  await audit(user.id, "workspace.team_board_set", workspaceId, `${teamId} ${boardId} ${role.data}`);
  await refresh(workspaceId);
  return {};
}

export async function removeTeamBoardAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const workspaceId = text(formData, "workspaceId");
  const teamId = text(formData, "teamId");
  const boardId = text(formData, "boardId");
  const result = await removeTeamBoard({ workspaceId, actorId: user.id, teamId, boardId });
  if (!result.ok) return;
  await audit(user.id, "workspace.team_board_removed", workspaceId, `${teamId} ${boardId}`);
  await refresh(workspaceId);
}
