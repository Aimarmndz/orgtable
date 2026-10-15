import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { requireOrgSettings } from "@/app/lib/org-settings";
import {
  resetDb,
  disconnect,
  seedUser,
  seedOrganization,
  addWorkspaceMember,
  loginAs,
} from "./helpers";

// Tenant isolation of an organization's settings (docs/authorization.md, "Tenant
// isolation"). requireOrgSettings is the single door of /<slug>/settings/…: it must answer
// the SAME 404 for an organization that does not exist, one the person is not in and a
// personal workspace, and hand back only the organization the slug names.

beforeEach(resetDb);
afterAll(disconnect);

// notFound() throws Next's 404 signal; its digest says which one.
async function expectNotFound(p: Promise<unknown>) {
  await expect(p).rejects.toMatchObject({ digest: expect.stringContaining("404") });
}

describe("requireOrgSettings", () => {
  it("gives a member their organization and role", async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const org = await seedOrganization(owner.id, "acme");
    await addWorkspaceMember(org.id, member.id, "MEMBER");
    await loginAs(member.id);
    const ctx = await requireOrgSettings("acme");
    expect(ctx.workspace.id).toBe(org.id);
    expect(ctx.role).toBe("MEMBER");
    expect(ctx.user.id).toBe(member.id);
  });

  it("answers 404 to someone from another organization", async () => {
    const a = await seedUser();
    const b = await seedUser();
    await seedOrganization(a.id, "acme");
    await seedOrganization(b.id, "globex");
    await loginAs(b.id);
    await expectNotFound(requireOrgSettings("acme"));
  });

  it("answers the same 404 for an organization that does not exist", async () => {
    const a = await seedUser();
    await loginAs(a.id);
    await expectNotFound(requireOrgSettings("nope"));
  });

  it("answers 404 for a personal workspace, even its owner's", async () => {
    const a = await seedUser();
    // Every account gets its personal workspace when it is created.
    const personal = await prisma.workspace.findUniqueOrThrow({ where: { personalOwnerId: a.id } });
    await loginAs(a.id);
    await expectNotFound(requireOrgSettings(personal.slug));
  });

  it("does not open an organization through access to one of its boards", async () => {
    // A guest invited to a single board sees the workspace page, but never its settings.
    const owner = await seedUser();
    const guest = await seedUser();
    const org = await seedOrganization(owner.id, "acme");
    const board = await prisma.board.create({
      data: { title: "B", slug: "b", ownerId: owner.id, workspaceId: org.id },
    });
    await prisma.boardMember.create({ data: { boardId: board.id, userId: guest.id, role: "EDITOR" } });
    await loginAs(guest.id);
    await expectNotFound(requireOrgSettings("acme"));
  });
});
