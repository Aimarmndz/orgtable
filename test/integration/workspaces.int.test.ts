import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { effectiveBoardRole } from "@/app/lib/access";
import {
  findBoardByPath,
  getBoardSummariesForUser,
  getWorkspaceForUser,
  searchForUser,
} from "@/app/lib/queries";
import {
  changeMemberRole,
  createEmployee,
  createOrganization,
  deleteOrganization,
  removeMember,
  resetEmployeePassword,
  updateWorkspace,
} from "@/app/lib/services/workspaces";
import {
  createBoard,
  deleteBoard,
  renameBoard,
} from "@/app/lib/actions/boards";
import { deleteOwnAccount } from "@/app/lib/services/account";
import { verifyPassword } from "@/app/lib/auth";
import {
  GET as listBoardsApi,
  POST as createBoardApi,
} from "@/app/api/v1/boards/route";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  seedOrganization,
  addWorkspaceMember,
  addMember,
  seedList,
  seedCard,
  seedApiToken,
  apiRequest,
  loginAs,
} from "./helpers";

// Multi-tenant security of workspaces (docs/workspaces.md, docs/authorization.md): who can
// open which board, what each workspace role may do, and that no role can be escalated or
// reach into another organization. Every rule is exercised against the real database.

// A public instance (open sign-up): organizations and employees can be created. The
// private case is tested at the end.
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
afterAll(async () => {
  await disconnect();
});

const PASSWORD = "contraseña-segura";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** Runs a Server Action that ends in a redirect and returns the target (or null). */
async function redirectOf(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (e) {
    const digest = (e as { digest?: string }).digest;
    if (!digest?.startsWith("NEXT_REDIRECT")) throw e;
    return digest.split(";")[2] ?? null;
  }
}

/** An organization with an owner, an admin, a member and an outsider, plus two boards. */
async function seedCompany() {
  const owner = await seedUser({ name: "Owner" });
  const admin = await seedUser({ name: "Admin" });
  const member = await seedUser({ name: "Member" });
  const outsider = await seedUser({ name: "Outsider" });
  const org = await seedOrganization(owner.id, "acme");
  await addWorkspaceMember(org.id, admin.id, "ADMIN");
  await addWorkspaceMember(org.id, member.id, "MEMBER");
  const shared = await seedBoard(owner.id, "Roadmap", { workspaceId: org.id });
  const secret = await seedBoard(owner.id, "Salaries", {
    workspaceId: org.id,
    visibility: "PRIVATE",
  });
  return { owner, admin, member, outsider, org, shared, secret };
}

describe("board access through workspaces", () => {
  it("members edit shared boards and see nothing of private ones", async () => {
    const { member, shared, secret } = await seedCompany();
    expect(await effectiveBoardRole(shared.id, member.id)).toBe("EDITOR");
    expect(await effectiveBoardRole(secret.id, member.id)).toBeNull();
    const titles = (await getBoardSummariesForUser(member.id)).map(
      (b) => b.title,
    );
    expect(titles).toEqual(["Roadmap"]);
  });

  it("owners and admins manage every board of the organization, private ones too", async () => {
    const { owner, admin, shared, secret } = await seedCompany();
    for (const user of [owner, admin]) {
      expect(await effectiveBoardRole(shared.id, user.id)).toBe("OWNER");
      expect(await effectiveBoardRole(secret.id, user.id)).toBe("OWNER");
    }
  });

  it("someone outside the organization reaches none of its boards", async () => {
    const { outsider, org, shared, secret } = await seedCompany();
    expect(await effectiveBoardRole(shared.id, outsider.id)).toBeNull();
    expect(await effectiveBoardRole(secret.id, outsider.id)).toBeNull();
    expect(await getBoardSummariesForUser(outsider.id)).toEqual([]);
    expect(await getWorkspaceForUser(org.slug, outsider.id)).toBeNull();
    expect((await searchForUser(outsider.id, "Roadmap")).boards).toEqual([]);
  });

  it("a guest added to one board sees that board and no other", async () => {
    const { outsider, shared, secret, org } = await seedCompany();
    await addMember(shared.id, outsider.id, "VIEWER");
    expect(await effectiveBoardRole(shared.id, outsider.id)).toBe("VIEWER");
    expect(await effectiveBoardRole(secret.id, outsider.id)).toBeNull();
    const ws = await getWorkspaceForUser(org.slug, outsider.id);
    expect(ws?.role).toBeNull();
  });

  it("a personal workspace's boards are private to their owner", async () => {
    const alice = await seedUser();
    const bob = await seedUser();
    const board = await seedBoard(alice.id, "Diary");
    expect(await effectiveBoardRole(board.id, alice.id)).toBe("OWNER");
    expect(await effectiveBoardRole(board.id, bob.id)).toBeNull();
  });

  it("a suspended workspace gives nobody access, not even its owner", async () => {
    const { owner, member, org, shared } = await seedCompany();
    await prisma.workspace.update({
      where: { id: org.id },
      data: { suspendedAt: new Date() },
    });
    expect(await effectiveBoardRole(shared.id, owner.id)).toBeNull();
    expect(await effectiveBoardRole(shared.id, member.id)).toBeNull();
    expect(await getBoardSummariesForUser(owner.id)).toEqual([]);
  });

  it("the instance administrator has no access to boards by being one", async () => {
    const { shared } = await seedCompany();
    const root = await seedUser({ role: "ADMIN" });
    expect(await effectiveBoardRole(shared.id, root.id)).toBeNull();
  });

  it("removing someone from the organization takes away its boards, explicit ones too", async () => {
    const { owner, member, org, shared, secret } = await seedCompany();
    await addMember(secret.id, member.id, "EDITOR");
    expect(
      (
        await removeMember({
          workspaceId: org.id,
          actorId: owner.id,
          userId: member.id,
        })
      ).ok,
    ).toBe(true);
    expect(await effectiveBoardRole(shared.id, member.id)).toBeNull();
    expect(await effectiveBoardRole(secret.id, member.id)).toBeNull();
  });
});

describe("workspace roles cannot be escalated", () => {
  it("an admin can only grant MEMBER, never ADMIN or OWNER", async () => {
    const { admin, member, org } = await seedCompany();
    for (const role of ["ADMIN", "OWNER"] as const) {
      expect(
        await changeMemberRole({
          workspaceId: org.id,
          actorId: admin.id,
          userId: member.id,
          role,
        }),
      ).toEqual({ ok: false, error: "forbidden" });
    }
    expect(
      await createEmployee({
        workspaceId: org.id,
        actorId: admin.id,
        name: "New",
        email: "new@test.local",
        password: PASSWORD,
        role: "ADMIN",
      }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      await prisma.user.count({ where: { email: "new@test.local" } }),
    ).toBe(0);
  });

  it("nobody changes their own role", async () => {
    const { owner, admin, org } = await seedCompany();
    expect(
      await changeMemberRole({
        workspaceId: org.id,
        actorId: admin.id,
        userId: admin.id,
        role: "OWNER",
      }),
    ).toEqual({ ok: false, error: "self" });
    expect(
      await changeMemberRole({
        workspaceId: org.id,
        actorId: owner.id,
        userId: owner.id,
        role: "MEMBER",
      }),
    ).toEqual({ ok: false, error: "self" });
  });

  it("an admin cannot touch owners or other admins", async () => {
    const { owner, admin, org } = await seedCompany();
    const admin2 = await seedUser();
    await addWorkspaceMember(org.id, admin2.id, "ADMIN");
    expect(
      await changeMemberRole({
        workspaceId: org.id,
        actorId: admin.id,
        userId: owner.id,
        role: "MEMBER",
      }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      await changeMemberRole({
        workspaceId: org.id,
        actorId: admin.id,
        userId: admin2.id,
        role: "MEMBER",
      }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      await removeMember({
        workspaceId: org.id,
        actorId: admin.id,
        userId: owner.id,
      }),
    ).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(
      await removeMember({
        workspaceId: org.id,
        actorId: admin.id,
        userId: admin2.id,
      }),
    ).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("a member manages nobody and creates no accounts", async () => {
    const { owner, admin, member, org } = await seedCompany();
    expect(
      await changeMemberRole({
        workspaceId: org.id,
        actorId: member.id,
        userId: admin.id,
        role: "MEMBER",
      }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      await removeMember({
        workspaceId: org.id,
        actorId: member.id,
        userId: owner.id,
      }),
    ).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(
      await createEmployee({
        workspaceId: org.id,
        actorId: member.id,
        name: "X",
        email: "x@test.local",
        password: PASSWORD,
        role: "MEMBER",
      }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      await updateWorkspace({
        workspaceId: org.id,
        actorId: member.id,
        name: "Hacked",
        slug: "acme",
      }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      await deleteOrganization({ workspaceId: org.id, actorId: member.id }),
    ).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("an organization always keeps an owner", async () => {
    const { owner, org } = await seedCompany();
    expect(
      await removeMember({
        workspaceId: org.id,
        actorId: owner.id,
        userId: owner.id,
      }),
    ).toEqual({
      ok: false,
      error: "last_owner",
    });
    // With a second owner, the first can step down.
    const other = await seedUser();
    await addWorkspaceMember(org.id, other.id, "MEMBER");
    expect(
      (
        await changeMemberRole({
          workspaceId: org.id,
          actorId: owner.id,
          userId: other.id,
          role: "OWNER",
        })
      ).ok,
    ).toBe(true);
    expect(
      await changeMemberRole({
        workspaceId: org.id,
        actorId: other.id,
        userId: owner.id,
        role: "ADMIN",
      }),
    ).toEqual({ ok: true, changed: true });
    // Now `other` is the only owner and cannot leave.
    expect(
      await removeMember({
        workspaceId: org.id,
        actorId: other.id,
        userId: other.id,
      }),
    ).toEqual({
      ok: false,
      error: "last_owner",
    });
  });

  it("anyone can leave an organization they do not solely own", async () => {
    const { member, admin, org } = await seedCompany();
    expect(
      (
        await removeMember({
          workspaceId: org.id,
          actorId: member.id,
          userId: member.id,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await removeMember({
          workspaceId: org.id,
          actorId: admin.id,
          userId: admin.id,
        })
      ).ok,
    ).toBe(true);
  });
});

describe("organizations are isolated from each other", () => {
  it("an owner of one organization cannot act in another", async () => {
    const a = await seedCompany();
    const otherOwner = await seedUser();
    const other = await seedOrganization(otherOwner.id, "globex");
    const victim = await seedUser();
    await addWorkspaceMember(other.id, victim.id, "MEMBER");

    expect(
      await createEmployee({
        workspaceId: other.id,
        actorId: a.owner.id,
        name: "Spy",
        email: "spy@test.local",
        password: PASSWORD,
        role: "MEMBER",
      }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      await changeMemberRole({
        workspaceId: other.id,
        actorId: a.owner.id,
        userId: victim.id,
        role: "OWNER",
      }),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      await removeMember({
        workspaceId: other.id,
        actorId: a.owner.id,
        userId: victim.id,
      }),
    ).toEqual({
      ok: false,
      error: "forbidden",
    });
    // Its own organization's id with someone else's member does not work either.
    expect(
      await changeMemberRole({
        workspaceId: a.org.id,
        actorId: a.owner.id,
        userId: victim.id,
        role: "MEMBER",
      }),
    ).toEqual({ ok: false, error: "not_member" });
  });

  it("passwords can only be reset for accounts THIS organization created", async () => {
    const { owner, admin, org } = await seedCompany();
    // `admin` signed up on their own: not managed by the organization.
    expect(
      await resetEmployeePassword({
        workspaceId: org.id,
        actorId: owner.id,
        userId: admin.id,
        password: "x".repeat(10),
      }),
    ).toEqual({ ok: false, error: "not_member" });

    const created = await createEmployee({
      workspaceId: org.id,
      actorId: owner.id,
      name: "Employee",
      email: "employee@test.local",
      password: PASSWORD,
      role: "MEMBER",
    });
    if (!created.ok) throw new Error(created.error);

    // Another organization's owner cannot, even naming the right user.
    const otherOwner = await seedUser();
    const other = await seedOrganization(otherOwner.id, "globex");
    expect(
      await resetEmployeePassword({
        workspaceId: other.id,
        actorId: otherOwner.id,
        userId: created.userId,
        password: "y".repeat(10),
      }),
    ).toEqual({ ok: false, error: "not_member" });

    await loginAs(created.userId);
    expect(
      await prisma.session.count({
        where: { userId: created.userId, revokedAt: null },
      }),
    ).toBe(1);
    expect(
      await resetEmployeePassword({
        workspaceId: org.id,
        actorId: owner.id,
        userId: created.userId,
        password: "new-password-1",
      }),
    ).toEqual({ ok: true });
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: created.userId },
    });
    expect(await verifyPassword("new-password-1", user.passwordHash)).toBe(
      true,
    );
    // Every session of the employee was revoked.
    expect(
      await prisma.session.count({
        where: { userId: created.userId, revokedAt: null },
      }),
    ).toBe(0);
  });

  it("an admin cannot reset the password of an admin the organization created", async () => {
    const { owner, admin, org } = await seedCompany();
    const created = await createEmployee({
      workspaceId: org.id,
      actorId: owner.id,
      name: "Second admin",
      email: "admin2@test.local",
      password: PASSWORD,
      role: "ADMIN",
    });
    if (!created.ok) throw new Error(created.error);
    expect(
      await resetEmployeePassword({
        workspaceId: org.id,
        actorId: admin.id,
        userId: created.userId,
        password: "z".repeat(10),
      }),
    ).toEqual({ ok: false, error: "forbidden" });
  });

  it("boards cannot be created in someone else's workspace", async () => {
    const { org } = await seedCompany();
    const intruder = await seedUser();
    await loginAs(intruder.id);
    await createBoard(form({ title: "Planted", workspaceId: org.id }));
    expect(await prisma.board.count({ where: { title: "Planted" } })).toBe(0);
  });
});

describe("employees", () => {
  it("get their own account, a personal workspace and the role given", async () => {
    const { owner, org, shared } = await seedCompany();
    const created = await createEmployee({
      workspaceId: org.id,
      actorId: owner.id,
      name: "Employee",
      email: "Employee@Test.local",
      password: PASSWORD,
      role: "MEMBER",
    });
    if (!created.ok) throw new Error(created.error);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: created.userId },
      include: { personalWorkspace: true },
    });
    expect(user.email).toBe("employee@test.local");
    expect(user.role).toBe("MEMBER");
    expect(user.managedById).toBe(org.id);
    expect(user.personalWorkspace?.slug).toBe("employee");
    expect(user.personalWorkspace?.slug).not.toContain("test-local");
    expect(await effectiveBoardRole(shared.id, created.userId)).toBe("EDITOR");
  });

  it("an email that already has an account is refused", async () => {
    const { owner, org } = await seedCompany();
    const existing = await seedUser({ email: "taken@test.local" });
    expect(
      await createEmployee({
        workspaceId: org.id,
        actorId: owner.id,
        name: "Dup",
        email: "TAKEN@test.local",
        password: PASSWORD,
        role: "MEMBER",
      }),
    ).toEqual({ ok: false, error: "email_taken" });
    // The existing account is not pulled into the organization.
    expect(
      await prisma.workspaceMember.count({
        where: { userId: existing.id, workspaceId: org.id },
      }),
    ).toBe(0);
  });
});

describe("organization addresses", () => {
  it("refuses reserved, malformed and taken addresses", async () => {
    const user = await seedUser();
    for (const [slug, error] of [
      ["admin", "slug_reserved"],
      ["boards", "slug_reserved"],
      ["Ab", "slug_format"],
      ["-acme", "slug_format"],
      ["ac--", "slug_format"],
      ["acme corp", "slug_format"],
    ] as const) {
      expect(
        await createOrganization({ ownerId: user.id, name: "X", slug }),
        slug,
      ).toEqual({
        ok: false,
        error,
      });
    }
    expect(
      (
        await createOrganization({
          ownerId: user.id,
          name: "Acme",
          slug: "acme",
        })
      ).ok,
    ).toBe(true);
    expect(
      await createOrganization({
        ownerId: user.id,
        name: "Acme 2",
        slug: "ACME",
      }),
    ).toEqual({
      ok: false,
      error: "slug_taken",
    });
    // A user's handle and an organization share one namespace.
    const handle = (
      await prisma.workspace.findUniqueOrThrow({
        where: { personalOwnerId: user.id },
      })
    ).slug;
    expect(
      await createOrganization({
        ownerId: user.id,
        name: "Mine",
        slug: handle,
      }),
    ).toEqual({
      ok: false,
      error: "slug_taken",
    });
  });
});

describe("board URLs", () => {
  it("resolve by slug and by id, and follow a rename", async () => {
    const { owner, org, shared } = await seedCompany();
    expect((await findBoardByPath("acme", "roadmap"))?.id).toBe(shared.id);
    expect(await findBoardByPath("acme", shared.id)).toMatchObject({
      id: shared.id,
      slug: "roadmap",
      workspace: { slug: "acme" },
    });
    await loginAs(owner.id);
    await renameBoard(form({ boardId: shared.id, title: "Roadmap 2027" }));
    expect(await findBoardByPath("acme", "roadmap-2027")).toMatchObject({
      id: shared.id,
    });
    expect(await findBoardByPath("acme", "roadmap")).toBeNull();
    // Two boards with the same title get different slugs; "settings" is reserved.
    const again = await seedBoard(owner.id, "Roadmap 2027", {
      workspaceId: org.id,
    });
    expect(again.slug).toBe("roadmap-2027-2");
    expect(
      (await seedBoard(owner.id, "Settings", { workspaceId: org.id })).slug,
    ).toBe("settings-2");
  });

  it("creating a board redirects to /<workspace>/<board>", async () => {
    const { member, org } = await seedCompany();
    await loginAs(member.id);
    expect(
      await redirectOf(() =>
        createBoard(form({ title: "Q3 Plan", workspaceId: org.id })),
      ),
    ).toBe("/acme/q3-plan");
  });
});

describe("managing organization boards", () => {
  it("an organization admin can delete a board someone else created; a member cannot", async () => {
    const { admin, member, shared, secret } = await seedCompany();
    await loginAs(member.id);
    await redirectOf(() => deleteBoard(form({ boardId: shared.id })));
    expect(await prisma.board.count({ where: { id: shared.id } })).toBe(1);
    await loginAs(admin.id);
    await redirectOf(() => deleteBoard(form({ boardId: secret.id })));
    expect(await prisma.board.count({ where: { id: secret.id } })).toBe(0);
  });
});

describe("deleting an account with organizations", () => {
  it("is blocked while it is the only owner of an organization with other members", async () => {
    const { owner } = await seedCompany();
    expect(await deleteOwnAccount(owner.id, PASSWORD)).toEqual({
      ok: false,
      error: "sole_owner",
      organizations: ["Org acme"],
    });
  });

  it("hands the boards it created to an owner and keeps the organization", async () => {
    const { owner, member, org } = await seedCompany();
    const board = await seedBoard(member.id, "Member's board", {
      workspaceId: org.id,
    });
    const list = await seedList(board.id);
    await seedCard(list.id);
    expect((await deleteOwnAccount(member.id, PASSWORD)).ok).toBe(true);
    const kept = await prisma.board.findUniqueOrThrow({
      where: { id: board.id },
    });
    expect(kept.ownerId).toBe(owner.id);
  });

  it("deletes the organizations where it was alone", async () => {
    const solo = await seedUser();
    const org = await seedOrganization(solo.id, "solo-co");
    await seedBoard(solo.id, "Alone", { workspaceId: org.id });
    expect((await deleteOwnAccount(solo.id, PASSWORD)).ok).toBe(true);
    expect(await prisma.workspace.count({ where: { id: org.id } })).toBe(0);
    expect(await prisma.board.count()).toBe(0);
  });
});

describe("public API with workspaces", () => {
  it("creates boards only in workspaces the user belongs to", async () => {
    const { member, org } = await seedCompany();
    const token = await seedApiToken(member.id);

    const inOrg = await createBoardApi(
      apiRequest("POST", "/api/v1/boards", {
        token,
        body: { title: "From API", workspace: "acme" },
      }),
    );
    expect(inOrg.status).toBe(201);
    expect(await inOrg.json()).toMatchObject({
      workspace: "acme",
      slug: "from-api",
    });

    const otherOwner = await seedUser();
    await seedOrganization(otherOwner.id, "globex");
    const outside = await createBoardApi(
      apiRequest("POST", "/api/v1/boards", {
        token,
        body: { title: "Planted", workspace: "globex" },
      }),
    );
    expect(outside.status).toBe(404);
    expect(await prisma.board.count({ where: { title: "Planted" } })).toBe(0);

    const list = await listBoardsApi(
      apiRequest("GET", "/api/v1/boards", { token }),
    );
    const titles = (
      (await list.json()) as { boards: { title: string }[] }
    ).boards.map((b) => b.title);
    expect(titles.sort()).toEqual(["From API", "Roadmap"]);
    expect(org.slug).toBe("acme");
  });
});

describe("a private instance (sign-up closed)", () => {
  it("only the instance administrator creates organizations and employee accounts", async () => {
    const { owner, org } = await seedCompany();
    await prisma.instanceConfig.update({
      where: { id: "singleton" },
      data: { registrationOpen: false },
    });
    expect(await createOrganization({ ownerId: owner.id, name: "New", slug: "new-co" })).toEqual({
      ok: false,
      error: "closed",
    });
    expect(
      await createEmployee({
        workspaceId: org.id,
        actorId: owner.id,
        name: "E",
        email: "e@test.local",
        password: PASSWORD,
        role: "MEMBER",
      }),
    ).toEqual({ ok: false, error: "closed" });
    const root = await seedUser({ role: "ADMIN" });
    expect((await createOrganization({ ownerId: root.id, name: "Root", slug: "root-co" })).ok).toBe(true);
  });
});

describe("a suspended organization is frozen", () => {
  it("nobody can change its members, passwords, name or delete it", async () => {
    const { owner, member, org } = await seedCompany();
    const created = await createEmployee({
      workspaceId: org.id,
      actorId: owner.id,
      name: "Employee",
      email: "employee@test.local",
      password: PASSWORD,
      role: "MEMBER",
    });
    if (!created.ok) throw new Error(created.error);
    await prisma.workspace.update({ where: { id: org.id }, data: { suspendedAt: new Date() } });
    const forbidden = { ok: false, error: "forbidden" };
    expect(
      await changeMemberRole({ workspaceId: org.id, actorId: owner.id, userId: member.id, role: "ADMIN" }),
    ).toEqual(forbidden);
    expect(await removeMember({ workspaceId: org.id, actorId: owner.id, userId: member.id })).toEqual(
      forbidden,
    );
    expect(
      await resetEmployeePassword({
        workspaceId: org.id,
        actorId: owner.id,
        userId: created.userId,
        password: "takeover-123",
      }),
    ).toEqual(forbidden);
    expect(
      await updateWorkspace({ workspaceId: org.id, actorId: owner.id, name: "X", slug: "acme" }),
    ).toEqual(forbidden);
    expect(await deleteOrganization({ workspaceId: org.id, actorId: owner.id })).toEqual(forbidden);
  });
});

describe("guests and employee accounts", () => {
  it("an account an organization created cannot be invited to boards outside it", async () => {
    const { owner, org } = await seedCompany();
    const created = await createEmployee({
      workspaceId: org.id,
      actorId: owner.id,
      name: "Planted",
      email: "ceo@victim.test",
      password: PASSWORD,
      role: "MEMBER",
    });
    if (!created.ok) throw new Error(created.error);
    const victim = await seedUser();
    const board = await seedBoard(victim.id, "Private plans");
    await loginAs(victim.id);
    const { addBoardMember } = await import("@/app/lib/actions/members");
    const result = await addBoardMember(
      {},
      form({ boardId: board.id, email: "ceo@victim.test", role: "EDITOR" }),
    );
    expect(result.error).toBeTruthy();
    expect(await effectiveBoardRole(board.id, created.userId)).toBeNull();
  });

  it("a guest does not see the email addresses of the organization", async () => {
    const { outsider, owner, shared } = await seedCompany();
    await addMember(shared.id, outsider.id, "VIEWER");
    const { getBoardPeople } = await import("@/app/lib/queries");
    const forGuest = await getBoardPeople(shared.id, outsider.id);
    expect(forGuest.filter((p) => p.viaWorkspace).every((p) => p.email === "")).toBe(true);
    const forOwner = await getBoardPeople(shared.id, owner.id);
    expect(forOwner.filter((p) => p.viaWorkspace).every((p) => p.email.includes("@"))).toBe(true);
  });
});

describe("the instance administrator cannot orphan an organization", () => {
  it("deleting its only owner is refused", async () => {
    const { owner } = await seedCompany();
    const { deleteUserAccount } = await import("@/app/lib/services/users");
    expect(await deleteUserAccount(owner.id)).toEqual({ ok: false, error: "sole_owner" });
  });
});
