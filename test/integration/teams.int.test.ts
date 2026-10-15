import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { accessibleBoardsWhere, effectiveBoardRole } from "@/app/lib/access";
import { getBoardPeople } from "@/app/lib/queries";
import {
  addTeamMember,
  createTeam,
  deleteTeam,
  removeTeamBoard,
  setTeamBoard,
  updateTeam,
} from "@/app/lib/services/teams";
import { createCustomRole } from "@/app/lib/services/roles";
import { changeMemberRole, removeMember } from "@/app/lib/services/workspaces";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  seedOrganization,
  addWorkspaceMember,
  addMember,
} from "./helpers";

// Teams of an organization (docs/teams.md): the access they give, the rule that a team never
// gives more than whoever configures it has, and isolation between organizations.

beforeEach(resetDb);
afterAll(disconnect);

const TEAM = { name: "Design", description: null, color: "teal" };

async function seedCompany() {
  const owner = await seedUser({ name: "Owner" });
  const member = await seedUser({ name: "Member" });
  const lead = await seedUser({ name: "Lead" });
  const org = await seedOrganization(owner.id, "acme");
  await addWorkspaceMember(org.id, member.id, "MEMBER");
  await addWorkspaceMember(org.id, lead.id, "MEMBER");
  const secret = await seedBoard(owner.id, "Salaries", { workspaceId: org.id, visibility: "PRIVATE" });
  const team = await createTeam({ workspaceId: org.id, actorId: owner.id, team: TEAM });
  if (!team.ok) throw new Error(team.error);
  return { owner, member, lead, org, secret, teamId: team.id };
}

/** Gives `userId` a custom role with "people.teams" (a team lead who is not an admin). */
async function makeTeamLead(workspaceId: string, ownerId: string, userId: string) {
  const role = await createCustomRole({
    workspaceId,
    actorId: ownerId,
    role: { name: "Team lead", color: "blue", description: null, permissions: ["people.teams", "boards.create"] },
  });
  if (!role.ok) throw new Error(role.error);
  await changeMemberRole({ workspaceId, actorId: ownerId, userId, role: "MEMBER", customRoleId: role.id });
}

describe("what a team gives", () => {
  it("opens a private board to its members with the team's role", async () => {
    const { owner, member, org, secret, teamId } = await seedCompany();
    expect(await effectiveBoardRole(secret.id, member.id)).toBeNull();
    await addTeamMember({ workspaceId: org.id, actorId: owner.id, teamId, userId: member.id });
    expect(await setTeamBoard({ workspaceId: org.id, actorId: owner.id, teamId, boardId: secret.id, role: "EDITOR" })).toEqual({ ok: true });
    expect(await effectiveBoardRole(secret.id, member.id)).toBe("EDITOR");
    const ids = (await prisma.board.findMany({ where: accessibleBoardsWhere(member.id), select: { id: true } })).map((b) => b.id);
    expect(ids).toContain(secret.id);
    const people = await getBoardPeople(secret.id, owner.id);
    expect(people.find((p) => p.id === member.id)?.role).toBe("EDITOR");
  });

  it("keeps the highest of every path to a board", async () => {
    const { owner, member, org, secret, teamId } = await seedCompany();
    await addMember(secret.id, member.id, "VIEWER");
    await addTeamMember({ workspaceId: org.id, actorId: owner.id, teamId, userId: member.id });
    await setTeamBoard({ workspaceId: org.id, actorId: owner.id, teamId, boardId: secret.id, role: "OWNER" });
    expect(await effectiveBoardRole(secret.id, member.id)).toBe("OWNER");
    await removeTeamBoard({ workspaceId: org.id, actorId: owner.id, teamId, boardId: secret.id });
    expect(await effectiveBoardRole(secret.id, member.id)).toBe("VIEWER");
  });

  it("ends with the team, and with leaving the organization", async () => {
    const { owner, member, org, secret, teamId } = await seedCompany();
    await addTeamMember({ workspaceId: org.id, actorId: owner.id, teamId, userId: member.id });
    await setTeamBoard({ workspaceId: org.id, actorId: owner.id, teamId, boardId: secret.id, role: "EDITOR" });
    await removeMember({ workspaceId: org.id, actorId: owner.id, userId: member.id });
    expect(await prisma.teamMember.count({ where: { userId: member.id } })).toBe(0);
    expect(await effectiveBoardRole(secret.id, member.id)).toBeNull();

    const other = await seedUser();
    await addWorkspaceMember(org.id, other.id, "MEMBER");
    await addTeamMember({ workspaceId: org.id, actorId: owner.id, teamId, userId: other.id });
    expect(await effectiveBoardRole(secret.id, other.id)).toBe("EDITOR");
    await deleteTeam({ workspaceId: org.id, actorId: owner.id, teamId });
    expect(await effectiveBoardRole(secret.id, other.id)).toBeNull();
  });
});

describe("who manages teams", () => {
  it("needs people.teams: a plain member cannot", async () => {
    const { member, org, teamId } = await seedCompany();
    expect(await createTeam({ workspaceId: org.id, actorId: member.id, team: { ...TEAM, name: "X" } })).toEqual({ ok: false, error: "forbidden" });
    expect(await updateTeam({ workspaceId: org.id, actorId: member.id, teamId, team: TEAM })).toEqual({ ok: false, error: "forbidden" });
    expect(await addTeamMember({ workspaceId: org.id, actorId: member.id, teamId, userId: member.id })).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("a team never gives more than the person configuring it has", async () => {
    const { owner, lead, member, org, secret, teamId } = await seedCompany();
    await makeTeamLead(org.id, owner.id, lead.id);
    // The lead cannot open the private board: it is "not found" for them.
    expect(await setTeamBoard({ workspaceId: org.id, actorId: lead.id, teamId, boardId: secret.id, role: "VIEWER" })).toEqual({
      ok: false,
      error: "not_found",
    });
    // On a shared board the lead is an editor: editor yes, manager no.
    const shared = await seedBoard(owner.id, "Roadmap", { workspaceId: org.id });
    expect(await setTeamBoard({ workspaceId: org.id, actorId: lead.id, teamId, boardId: shared.id, role: "OWNER" })).toEqual({
      ok: false,
      error: "role_too_high",
    });
    expect(await setTeamBoard({ workspaceId: org.id, actorId: lead.id, teamId, boardId: shared.id, role: "EDITOR" })).toEqual({ ok: true });
    // And the lead can put people in the team.
    expect(await addTeamMember({ workspaceId: org.id, actorId: lead.id, teamId, userId: member.id })).toEqual({ ok: true });
  });
});

describe("tenant isolation of teams", () => {
  it("never mixes people, boards or teams of another organization", async () => {
    const { owner, org, teamId } = await seedCompany();
    const stranger = await seedUser();
    const globex = await seedOrganization(stranger.id, "globex");
    const foreignBoard = await seedBoard(stranger.id, "Theirs", { workspaceId: globex.id });
    const foreignTeam = await createTeam({ workspaceId: globex.id, actorId: stranger.id, team: TEAM });
    if (!foreignTeam.ok) throw new Error(foreignTeam.error);

    expect(await addTeamMember({ workspaceId: org.id, actorId: owner.id, teamId, userId: stranger.id })).toEqual({
      ok: false,
      error: "not_member",
    });
    expect(await setTeamBoard({ workspaceId: org.id, actorId: owner.id, teamId, boardId: foreignBoard.id, role: "VIEWER" })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await addTeamMember({ workspaceId: org.id, actorId: owner.id, teamId: foreignTeam.id, userId: owner.id })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await deleteTeam({ workspaceId: org.id, actorId: owner.id, teamId: foreignTeam.id })).toEqual({ ok: false, error: "not_found" });
    expect(await prisma.team.count({ where: { id: foreignTeam.id } })).toBe(1);
  });

  it("the database refuses a cross-organization row written by hand", async () => {
    const { owner, org, teamId } = await seedCompany();
    const stranger = await seedUser();
    const globex = await seedOrganization(stranger.id, "globex");
    const foreignBoard = await seedBoard(stranger.id, "Theirs", { workspaceId: globex.id });
    await expect(
      prisma.teamBoard.create({ data: { teamId, workspaceId: org.id, boardId: foreignBoard.id, role: "OWNER" } }),
    ).rejects.toThrow();
    await expect(prisma.teamMember.create({ data: { teamId, workspaceId: org.id, userId: stranger.id } })).rejects.toThrow();
    await expect(prisma.teamMember.create({ data: { teamId, workspaceId: globex.id, userId: stranger.id } })).rejects.toThrow();
    expect(owner.id).toBeTruthy();
  });
});
