import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { accessibleBoardsWhere, effectiveBoardRole } from "@/app/lib/access";
import { getWorkspaceForUser } from "@/app/lib/queries";
import { createEmployee } from "@/app/lib/services/workspaces";
import {
  resetManagedTwoFactor,
  revokeManagedSessions,
  updateOrgSecurity,
} from "@/app/lib/services/org-security";
import { addBoardMember } from "@/app/lib/actions/members";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  seedOrganization,
  addWorkspaceMember,
  addMember,
  loginAs,
  formOf,
} from "./helpers";

// Security policy of an organization (docs/workspaces.md, "Security").

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

async function enable2fa(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { totpEnabledAt: new Date(), totpSecretEnc: "x" } });
}

async function seedCompany() {
  const owner = await seedUser({ name: "Owner" });
  const member = await seedUser({ name: "Member" });
  const guest = await seedUser({ name: "Guest" });
  const org = await seedOrganization(owner.id, "acme");
  await addWorkspaceMember(org.id, member.id, "MEMBER");
  const board = await seedBoard(owner.id, "Roadmap", { workspaceId: org.id });
  await addMember(board.id, guest.id, "VIEWER");
  return { owner, member, guest, org, board };
}

describe("mandatory two-step verification", () => {
  it("can only be turned on by someone who has it", async () => {
    const { owner, org } = await seedCompany();
    expect(await updateOrgSecurity({ workspaceId: org.id, actorId: owner.id, requireTwoFactor: true, domains: [] })).toEqual({
      ok: false,
      error: "actor_needs_2fa",
    });
    await enable2fa(owner.id);
    const ok = await updateOrgSecurity({ workspaceId: org.id, actorId: owner.id, requireTwoFactor: true, domains: [] });
    expect(ok.ok).toBe(true);
  });

  it("closes the boards to members and guests without it, and opens them when they turn it on", async () => {
    const { owner, member, guest, org, board } = await seedCompany();
    await enable2fa(owner.id);
    await updateOrgSecurity({ workspaceId: org.id, actorId: owner.id, requireTwoFactor: true, domains: [] });
    for (const u of [member, guest]) {
      expect(await effectiveBoardRole(board.id, u.id)).toBeNull();
      expect(await prisma.board.count({ where: accessibleBoardsWhere(u.id) })).toBe(0);
    }
    expect(await effectiveBoardRole(board.id, owner.id)).toBe("OWNER");
    expect((await getWorkspaceForUser("acme", member.id))?.twoFactorBlocked).toBe(true);
    await enable2fa(member.id);
    await enable2fa(guest.id);
    expect(await effectiveBoardRole(board.id, member.id)).toBe("EDITOR");
    expect(await effectiveBoardRole(board.id, guest.id)).toBe("VIEWER");
    expect(await prisma.board.count({ where: accessibleBoardsWhere(guest.id) })).toBe(1);
  });

  it("does not touch boards of other workspaces", async () => {
    const { owner, member, org } = await seedCompany();
    await enable2fa(owner.id);
    await updateOrgSecurity({ workspaceId: org.id, actorId: owner.id, requireTwoFactor: true, domains: [] });
    const own = await seedBoard(member.id, "Mine");
    expect(await effectiveBoardRole(own.id, member.id)).toBe("OWNER");
  });

  it("is for owners and admins only", async () => {
    const { member, org } = await seedCompany();
    await enable2fa(member.id);
    expect(await updateOrgSecurity({ workspaceId: org.id, actorId: member.id, requireTwoFactor: true, domains: [] })).toEqual({
      ok: false,
      error: "forbidden",
    });
  });
});

describe("allowed email domains", () => {
  it("validates and normalises the list", async () => {
    const { owner, org } = await seedCompany();
    expect(await updateOrgSecurity({ workspaceId: org.id, actorId: owner.id, requireTwoFactor: false, domains: ["not a domain"] })).toEqual({
      ok: false,
      error: "bad_domain",
    });
    await updateOrgSecurity({ workspaceId: org.id, actorId: owner.id, requireTwoFactor: false, domains: ["@ACME.com", "acme.com", ""] });
    const w = await prisma.workspace.findUniqueOrThrow({ where: { id: org.id } });
    expect(w.allowedEmailDomains).toEqual(["acme.com"]);
  });

  it("limits new employees and board guests", async () => {
    const { owner, org, board } = await seedCompany();
    await updateOrgSecurity({ workspaceId: org.id, actorId: owner.id, requireTwoFactor: false, domains: ["acme.com"] });
    const base = { workspaceId: org.id, actorId: owner.id, name: "N", password: "contraseña-segura", role: "MEMBER" as const };
    expect(await createEmployee({ ...base, email: "x@gmail.com" })).toEqual({ ok: false, error: "domain_not_allowed" });
    expect((await createEmployee({ ...base, email: "x@acme.com" })).ok).toBe(true);
    const outsider = await seedUser({ email: "someone@gmail.com" });
    await loginAs(owner.id);
    const r = await addBoardMember({}, formOf({ boardId: board.id, email: outsider.email, role: "VIEWER" }));
    expect(r.error).toBeTruthy();
    expect(await prisma.boardMember.count({ where: { boardId: board.id, userId: outsider.id } })).toBe(0);
  });
});

describe("accounts the organization created", () => {
  it("their sessions and two-step can be reset; anyone else's cannot", async () => {
    const { owner, member, org } = await seedCompany();
    const created = await createEmployee({
      workspaceId: org.id,
      actorId: owner.id,
      name: "Emp",
      email: "emp@test.local",
      password: "contraseña-segura",
      role: "MEMBER",
    });
    if (!created.ok) throw new Error(created.error);
    await prisma.session.create({ data: { userId: created.userId, expiresAt: new Date(Date.now() + 86_400_000) } });
    await prisma.session.create({ data: { userId: member.id, expiresAt: new Date(Date.now() + 86_400_000) } });
    await enable2fa(created.userId);
    await enable2fa(member.id);

    expect(await revokeManagedSessions({ workspaceId: org.id, actorId: owner.id, userId: member.id })).toEqual({ ok: false, error: "forbidden" });
    expect(await resetManagedTwoFactor({ workspaceId: org.id, actorId: owner.id, userId: member.id })).toEqual({ ok: false, error: "forbidden" });

    expect(await revokeManagedSessions({ workspaceId: org.id, actorId: owner.id, userId: created.userId })).toEqual({ ok: true, count: 1 });
    expect(await resetManagedTwoFactor({ workspaceId: org.id, actorId: owner.id, userId: created.userId })).toEqual({ ok: true });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: created.userId } })).totpEnabledAt).toBeNull();
    // A member cannot act at all.
    expect(await revokeManagedSessions({ workspaceId: org.id, actorId: member.id, userId: created.userId })).toEqual({ ok: false, error: "forbidden" });
  });

  it("never reaches an account another organization created", async () => {
    const { owner, org } = await seedCompany();
    const stranger = await seedUser();
    const globex = await seedOrganization(stranger.id, "globex");
    const theirs = await createEmployee({
      workspaceId: globex.id,
      actorId: stranger.id,
      name: "Theirs",
      email: "theirs@test.local",
      password: "contraseña-segura",
      role: "MEMBER",
    });
    if (!theirs.ok) throw new Error(theirs.error);
    await addWorkspaceMember(org.id, theirs.userId, "MEMBER");
    expect(await revokeManagedSessions({ workspaceId: org.id, actorId: owner.id, userId: theirs.userId })).toEqual({ ok: false, error: "forbidden" });
  });
});
