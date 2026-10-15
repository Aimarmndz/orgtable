import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { accessibleBoardsWhere, effectiveBoardRole, workspaceAccessOf } from "@/app/lib/access";
import {
  createCustomRole,
  deleteCustomRole,
  duplicateCustomRole,
  updateCustomRole,
} from "@/app/lib/services/roles";
import { changeMemberRole, createEmployee, removeMember, purgeWorkspace } from "@/app/lib/services/workspaces";
import { createBoard, deleteBoard, setBoardVisibility } from "@/app/lib/actions/boards";
import { createRoleAction } from "@/app/lib/actions/roles";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  seedOrganization,
  addWorkspaceMember,
  loginAs,
  formOf,
  redirectTarget,
} from "./helpers";

// Custom roles of an organization (docs/roles.md): who creates them, what they grant, that
// nothing in them escalates, and that they never cross into another organization.

beforeEach(async () => {
  await resetDb();
  await prisma.instanceConfig.create({
    data: {
      id: "singleton",
      instanceName: "Test",
      setupCompletedAt: new Date(),
      registrationOpen: true,
      operatorName: "Operator",
      operatorEmail: "privacy@test.local",
    },
  });
});
afterAll(disconnect);

const ROLE = { name: "Accounting", color: "amber", description: null };

async function seedCompany() {
  const owner = await seedUser({ name: "Owner" });
  const admin = await seedUser({ name: "Admin" });
  const member = await seedUser({ name: "Member" });
  const other = await seedUser({ name: "Other" });
  const org = await seedOrganization(owner.id, "acme");
  await addWorkspaceMember(org.id, admin.id, "ADMIN");
  await addWorkspaceMember(org.id, member.id, "MEMBER");
  await addWorkspaceMember(org.id, other.id, "MEMBER");
  return { owner, admin, member, other, org };
}

async function giveRole(workspaceId: string, userId: string, permissions: string[]) {
  const owner = await prisma.workspaceMember.findFirstOrThrow({ where: { workspaceId, role: "OWNER" } });
  const created = await createCustomRole({
    workspaceId,
    actorId: owner.userId,
    role: { ...ROLE, name: `R ${Math.random()}`, permissions },
  });
  if (!created.ok) throw new Error(created.error);
  const changed = await changeMemberRole({ workspaceId, actorId: owner.userId, userId, role: "MEMBER", customRoleId: created.id });
  if (!changed.ok) throw new Error(changed.error);
  return created.id;
}

describe("creating and editing custom roles", () => {
  it("is for owners and admins only", async () => {
    const { owner, admin, member, org } = await seedCompany();
    for (const actor of [owner, admin]) {
      const r = await createCustomRole({ workspaceId: org.id, actorId: actor.id, role: { ...ROLE, name: actor.id, permissions: [] } });
      expect(r.ok).toBe(true);
    }
    const denied = await createCustomRole({ workspaceId: org.id, actorId: member.id, role: { ...ROLE, permissions: [] } });
    expect(denied).toEqual({ ok: false, error: "forbidden" });
  });

  it("also refuses a member whose custom role holds every permission it can", async () => {
    const { member, org } = await seedCompany();
    await giveRole(org.id, member.id, ["people.invite", "people.teams", "people.remove", "audit.view"]);
    const denied = await createCustomRole({ workspaceId: org.id, actorId: member.id, role: { ...ROLE, permissions: [] } });
    expect(denied).toEqual({ ok: false, error: "forbidden" });
  });

  it("drops base-only and unknown permissions", async () => {
    const { owner, org } = await seedCompany();
    const r = await createCustomRole({
      workspaceId: org.id,
      actorId: owner.id,
      role: { ...ROLE, permissions: ["people.roles", "root", "audit.view"] },
    });
    if (!r.ok) throw new Error(r.error);
    const row = await prisma.workspaceCustomRole.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.permissions).toEqual(["audit.view"]);
  });

  it("refuses two roles with the same name and duplicates with a free one", async () => {
    const { owner, org } = await seedCompany();
    const first = await createCustomRole({ workspaceId: org.id, actorId: owner.id, role: { ...ROLE, permissions: [] } });
    if (!first.ok) throw new Error(first.error);
    expect(await createCustomRole({ workspaceId: org.id, actorId: owner.id, role: { ...ROLE, permissions: [] } })).toEqual({
      ok: false,
      error: "name_taken",
    });
    const copy = await duplicateCustomRole({ workspaceId: org.id, actorId: owner.id, roleId: first.id });
    if (!copy.ok) throw new Error(copy.error);
    const row = await prisma.workspaceCustomRole.findUniqueOrThrow({ where: { id: copy.id } });
    expect(row.name).toBe("Accounting (2)");
  });

  it("the action validates and redirects to the new role", async () => {
    const { owner, org } = await seedCompany();
    await loginAs(owner.id);
    const empty = await createRoleAction({}, formOf({ workspaceId: org.id, name: " ", color: "blue", description: "" }));
    expect(empty.error).toBeTruthy();
    const to = await redirectTarget(() =>
      createRoleAction({}, formOf({ workspaceId: org.id, name: "Sales", color: "teal", description: "", permissions: ["boards.create"] })),
    );
    const row = await prisma.workspaceCustomRole.findFirstOrThrow({ where: { workspaceId: org.id, name: "Sales" } });
    expect(to).toBe(`/acme/settings/roles/${row.id}`);
    expect(row.permissions).toEqual(["boards.create"]);
  });
});

describe("what a custom role grants", () => {
  it("replaces the member defaults: an empty role cannot create boards", async () => {
    const { member, org } = await seedCompany();
    await giveRole(org.id, member.id, []);
    await loginAs(member.id);
    await createBoard(formOf({ title: "Nope", workspaceId: org.id })).catch(() => {});
    expect(await prisma.board.count({ where: { workspaceId: org.id } })).toBe(0);
    // A plain member still can.
    const plain = await prisma.workspaceMember.findFirstOrThrow({ where: { workspaceId: org.id, role: "MEMBER", customRoleId: null } });
    await loginAs(plain.userId);
    await redirectTarget(() => createBoard(formOf({ title: "Yes", workspaceId: org.id })));
    expect(await prisma.board.count({ where: { workspaceId: org.id } })).toBe(1);
  });

  it("boards.view_all opens private boards read-only, and lists them", async () => {
    const { owner, member, org } = await seedCompany();
    const secret = await seedBoard(owner.id, "Salaries", { workspaceId: org.id, visibility: "PRIVATE" });
    expect(await effectiveBoardRole(secret.id, member.id)).toBeNull();
    await giveRole(org.id, member.id, ["boards.view_all"]);
    expect(await effectiveBoardRole(secret.id, member.id)).toBe("VIEWER");
    const listed = await prisma.board.findMany({ where: accessibleBoardsWhere(member.id), select: { id: true } });
    expect(listed.map((b) => b.id)).toContain(secret.id);
  });

  it("boards.visibility and boards.delete act on boards the person can open", async () => {
    const { owner, member, org } = await seedCompany();
    const board = await seedBoard(owner.id, "Roadmap", { workspaceId: org.id });
    await loginAs(member.id);
    await setBoardVisibility(formOf({ boardId: board.id, visibility: "PRIVATE" }));
    expect((await prisma.board.findUniqueOrThrow({ where: { id: board.id } })).visibility).toBe("WORKSPACE");

    await giveRole(org.id, member.id, ["boards.visibility", "boards.delete"]);
    await loginAs(member.id);
    await setBoardVisibility(formOf({ boardId: board.id, visibility: "PRIVATE" }));
    expect((await prisma.board.findUniqueOrThrow({ where: { id: board.id } })).visibility).toBe("PRIVATE");
    // Now private and the role has no view_all: the board is out of reach, so no delete.
    await redirectTarget(() => deleteBoard(formOf({ boardId: board.id })));
    expect(await prisma.board.count({ where: { id: board.id } })).toBe(1);

    const open = await seedBoard(owner.id, "Open", { workspaceId: org.id });
    await redirectTarget(() => deleteBoard(formOf({ boardId: open.id })));
    expect(await prisma.board.count({ where: { id: open.id } })).toBe(0);
  });

  it("people.invite creates plain members only, and cannot pass a custom role", async () => {
    const { member, org } = await seedCompany();
    const roleId = await giveRole(org.id, member.id, ["people.invite"]);
    const base = { workspaceId: org.id, actorId: member.id, name: "New", password: "contraseña-segura" };
    expect(await createEmployee({ ...base, email: "a@test.local", role: "ADMIN" })).toEqual({ ok: false, error: "forbidden" });
    expect(await createEmployee({ ...base, email: "b@test.local", role: "MEMBER", customRoleId: roleId })).toEqual({
      ok: false,
      error: "forbidden",
    });
    const ok = await createEmployee({ ...base, email: "c@test.local", role: "MEMBER" });
    expect(ok.ok).toBe(true);
  });

  it("people.remove removes plain members, never admins or owners", async () => {
    const { owner, admin, member, other, org } = await seedCompany();
    await giveRole(org.id, member.id, ["people.remove"]);
    expect(await removeMember({ workspaceId: org.id, actorId: member.id, userId: admin.id })).toEqual({ ok: false, error: "forbidden" });
    expect(await removeMember({ workspaceId: org.id, actorId: member.id, userId: owner.id })).toEqual({ ok: false, error: "forbidden" });
    expect(await removeMember({ workspaceId: org.id, actorId: member.id, userId: other.id })).toEqual({ ok: true });
  });

  it("never lets a custom role change roles", async () => {
    const { member, other, org } = await seedCompany();
    await giveRole(org.id, member.id, ["people.invite", "people.remove", "people.teams"]);
    expect(await changeMemberRole({ workspaceId: org.id, actorId: member.id, userId: other.id, role: "ADMIN" })).toEqual({
      ok: false,
      error: "forbidden",
    });
  });
});

describe("assigning and deleting", () => {
  it("promoting someone to admin drops their custom role", async () => {
    const { owner, member, org } = await seedCompany();
    await giveRole(org.id, member.id, ["audit.view"]);
    await changeMemberRole({ workspaceId: org.id, actorId: owner.id, userId: member.id, role: "ADMIN" });
    const row = await prisma.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: org.id, userId: member.id } } });
    expect(row).toMatchObject({ role: "ADMIN", customRoleId: null });
  });

  it("deleting a role turns its holders into plain members", async () => {
    const { owner, member, org } = await seedCompany();
    const roleId = await giveRole(org.id, member.id, ["audit.view"]);
    expect(await deleteCustomRole({ workspaceId: org.id, actorId: owner.id, roleId })).toEqual({ ok: true, members: 1 });
    const access = await workspaceAccessOf(org.id, member.id);
    expect(access?.customRoleId).toBeNull();
    expect([...(access?.permissions ?? [])]).toEqual(["boards.create"]);
  });

  it("an organization with custom roles in use can be deleted", async () => {
    const { member, org } = await seedCompany();
    await giveRole(org.id, member.id, ["audit.view"]);
    await purgeWorkspace(org.id);
    expect(await prisma.workspaceCustomRole.count()).toBe(0);
  });
});

describe("tenant isolation of roles", () => {
  it("never assigns, edits or deletes a role of another organization", async () => {
    const { owner, member, org } = await seedCompany();
    const stranger = await seedUser();
    const globex = await seedOrganization(stranger.id, "globex");
    const foreign = await createCustomRole({ workspaceId: globex.id, actorId: stranger.id, role: { ...ROLE, permissions: ["audit.view"] } });
    if (!foreign.ok) throw new Error(foreign.error);

    expect(
      await changeMemberRole({ workspaceId: org.id, actorId: owner.id, userId: member.id, role: "MEMBER", customRoleId: foreign.id }),
    ).toEqual({ ok: false, error: "role_not_found" });
    expect(await updateCustomRole({ workspaceId: org.id, actorId: owner.id, roleId: foreign.id, role: { ...ROLE, permissions: [] } })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await deleteCustomRole({ workspaceId: org.id, actorId: owner.id, roleId: foreign.id })).toEqual({ ok: false, error: "not_found" });
    expect(await prisma.workspaceCustomRole.count({ where: { id: foreign.id } })).toBe(1);
  });

  it("the database itself refuses a foreign role or a custom role on an admin", async () => {
    const { admin, member, org } = await seedCompany();
    const stranger = await seedUser();
    const globex = await seedOrganization(stranger.id, "globex");
    const foreign = await createCustomRole({ workspaceId: globex.id, actorId: stranger.id, role: { ...ROLE, permissions: [] } });
    if (!foreign.ok) throw new Error(foreign.error);
    await expect(
      prisma.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId: org.id, userId: member.id } },
        data: { customRoleId: foreign.id },
      }),
    ).rejects.toThrow();
    const own = await giveRole(org.id, member.id, []);
    await expect(
      prisma.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId: org.id, userId: admin.id } },
        data: { customRoleId: own },
      }),
    ).rejects.toThrow();
  });
});
