import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { deleteUserAccount } from "@/app/lib/services/users";
import {
  createUser,
  updateUserRole,
  resetUserPassword,
  revokeUserSessions,
  deleteUser,
} from "@/app/lib/actions/admin";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  seedList,
  seedCard,
  loginAs,
  en,
} from "./helpers";

// The actions answer with redirect(): it is replaced by one that throws an error with the
// URL, just as the real one interrupts the action, so the target can be read. The
// authorization (requireAdmin) is the real one, with the session of a seeded admin.
class RedirectError extends Error {}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
}));

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** Runs the action and returns the URL it redirects to. */
async function redirectOf(run: Promise<void>): Promise<string> {
  try {
    await run;
  } catch (err) {
    if (err instanceof RedirectError) return err.message;
    throw err;
  }
  throw new Error("The action did not redirect");
}

beforeEach(async () => {
  await resetDb();
  await loginAs((await seedUser({ role: "ADMIN" })).id);
});
afterAll(async () => {
  await disconnect();
});

describe("admin actions on a user that does not exist (integration)", () => {
  const ghost = "user-that-does-not-exist";

  it("changing the role reports it and does not audit", async () => {
    const url = await redirectOf(
      updateUserRole(form({ userId: ghost, role: "ADMIN" })),
    );
    expect(url).toBe("/admin/users?error=not-found");
    expect(await prisma.auditLog.count({ where: { targetId: ghost } })).toBe(0);
  });

  it("resetting the password reports it and does not audit", async () => {
    const url = await redirectOf(
      resetUserPassword(form({ userId: ghost, password: "new-password" })),
    );
    expect(url).toBe("/admin/users?error=not-found");
    expect(await prisma.auditLog.count({ where: { targetId: ghost } })).toBe(0);
  });

  it("revoking sessions reports it and does not audit", async () => {
    const url = await redirectOf(revokeUserSessions(form({ userId: ghost })));
    expect(url).toBe("/admin/users?error=not-found");
    expect(await prisma.auditLog.count({ where: { targetId: ghost } })).toBe(0);
  });

  it("deleting reports it and does not audit", async () => {
    const url = await redirectOf(deleteUser(form({ userId: ghost })));
    expect(url).toBe("/admin/users?error=not-found");
    expect(await prisma.auditLog.count({ where: { targetId: ghost } })).toBe(0);
  });

  it("answers “invalid” without a userId in the form", async () => {
    const url = await redirectOf(revokeUserSessions(form({})));
    expect(url).toBe("/admin/users?error=invalid");
  });

  it("resetting the password without a userId answers “invalid”, not the password warning", async () => {
    const url = await redirectOf(
      resetUserPassword(form({ password: "new-password" })),
    );
    expect(url).toBe("/admin/users?error=invalid");
  });
});

describe("createUser keeps what was typed after an error (integration)", () => {
  it("with a duplicate email returns the values, flags the field and never the password", async () => {
    await seedUser({ email: "dup@test.local" });
    const state = await createUser(
      {},
      form({
        name: "Ada",
        email: "dup@test.local",
        password: "secret-password",
        role: "ADMIN",
      }),
    );
    expect(state.error).toBe(en.errors.admin.emailTaken);
    expect(state.field).toBe("email");
    expect(state.values).toEqual({
      name: "Ada",
      email: "dup@test.local",
      role: "ADMIN",
    });
    expect(JSON.stringify(state)).not.toContain("secret-password");
  });

  it("with invalid data it also returns the values (without the password)", async () => {
    const state = await createUser(
      {},
      form({ name: "Ada", email: "not-an-email", password: "short", role: "MEMBER" }),
    );
    expect(state.error).toBeDefined();
    expect(state.values?.email).toBe("not-an-email");
    expect(JSON.stringify(state)).not.toContain("short");
  });
});

describe("admin actions on a real user (integration)", () => {
  it("revoking the sessions of a user without sessions is valid and audited", async () => {
    const user = await seedUser();
    const url = await redirectOf(revokeUserSessions(form({ userId: user.id })));
    expect(url).toBe("/admin/users?ok=revoked");
    expect(
      await prisma.auditLog.count({
        where: { targetId: user.id, action: "user.sessions_revoked" },
      }),
    ).toBe(1);
  });

  it("changing the role saves and audits it", async () => {
    const user = await seedUser();
    const url = await redirectOf(
      updateUserRole(form({ userId: user.id, role: "ADMIN" })),
    );
    expect(url).toBe("/admin/users?ok=role");
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.role).toBe("ADMIN");
    expect(await prisma.auditLog.count({ where: { targetId: user.id } })).toBe(1);
  });

  it("deletes a user without boards of their own and audits it", async () => {
    const user = await seedUser();
    const url = await redirectOf(deleteUser(form({ userId: user.id })));
    expect(url).toBe("/admin/users?ok=delete");
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { targetId: user.id, action: "user.deleted" },
      }),
    ).toBe(1);
  });

  it("does not delete a board owner: their attachments stay in the DB (nothing is orphaned)", async () => {
    const owner = await seedUser();
    const board = await seedBoard(owner.id);
    const list = await seedList(board.id);
    const card = await seedCard(list.id);
    await prisma.attachment.create({
      data: {
        cardId: card.id,
        filename: "report.pdf",
        storedName: "00000000-0000-0000-0000-000000000000.pdf",
        mimeType: "application/pdf",
        size: 10,
      },
    });

    const url = await redirectOf(deleteUser(form({ userId: owner.id })));
    expect(url).toBe("/admin/users?error=owns-boards");
    expect(await prisma.user.count({ where: { id: owner.id } })).toBe(1);
    expect(await prisma.attachment.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { targetId: owner.id } })).toBe(0);
  });
});

// The action does not check the boards on its own: the only safeguard is the
// `boards: { none: {} }` condition of the service's DELETE. The service is called
// directly to pin that contract. The race itself (a board created between an earlier
// check and the DELETE) is not reproduced: there is no deterministic way to interleave
// two transactions here.
describe("deleteUserAccount (service, integration)", () => {
  it("rejects a board owner without cascading any deletion", async () => {
    const owner = await seedUser();
    const board = await seedBoard(owner.id);
    const list = await seedList(board.id);
    const card = await seedCard(list.id);
    await prisma.attachment.create({
      data: {
        cardId: card.id,
        filename: "report.pdf",
        storedName: "00000000-0000-0000-0000-000000000001.pdf",
        mimeType: "application/pdf",
        size: 10,
      },
    });

    expect(await deleteUserAccount(owner.id)).toEqual({
      ok: false,
      error: "owns_boards",
    });
    expect(await prisma.user.count({ where: { id: owner.id } })).toBe(1);
    expect(await prisma.board.count({ where: { id: board.id } })).toBe(1);
    expect(await prisma.attachment.count()).toBe(1);
  });

  it("tells apart a user that does not exist and deletes one without boards", async () => {
    expect(await deleteUserAccount("user-that-does-not-exist")).toEqual({
      ok: false,
      error: "not_found",
    });
    const user = await seedUser();
    expect(await deleteUserAccount(user.id)).toEqual({ ok: true });
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(0);
  });
});
