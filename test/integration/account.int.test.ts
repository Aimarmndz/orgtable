import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { access, rm } from "node:fs/promises";
import path from "node:path";

// Temporary upload directory: storage.ts reads it when imported (see
// attachments-delete.int.test.ts).
const uploadDir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "orgtable-account-"));
  process.env.ORGTABLE_UPLOAD_DIR = dir;
  return dir;
});

import { prisma } from "@/app/lib/prisma";
import { saveAttachmentFile } from "@/app/lib/storage";
import { verifyPassword } from "@/app/lib/auth";
import { verifySession } from "@/app/lib/dal";
import {
  changePassword,
  deleteAccount,
  revokeOtherSessions,
  revokeSession,
  updateProfile,
} from "@/app/lib/actions/account";
import { exportUserData } from "@/app/lib/services/account";
import { GET as exportRoute } from "@/app/api/account/export/route";
import { fmt } from "@/app/i18n/format";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  seedList,
  seedCard,
  seedApiToken,
  addMember,
  loginAs,
  en,
} from "./helpers";

const PASSWORD = "contraseña-segura";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await rm(uploadDir, { recursive: true, force: true });
  delete process.env.ORGTABLE_UPLOAD_DIR;
  await disconnect();
});

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function redirectOf(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (e) {
    const digest = (e as { digest?: string }).digest;
    if (digest?.startsWith("NEXT_REDIRECT")) return digest.split(";")[2];
    throw e;
  }
  throw new Error("The action did not redirect");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Opens another session of the same user (another browser) without touching the current cookie. */
async function openOtherSession(userId: string): Promise<string> {
  const s = await prisma.session.create({
    data: { userId, expiresAt: new Date(Date.now() + 86_400_000), userAgent: "other" },
  });
  return s.id;
}

describe("profile (updateProfile)", () => {
  it("changes the name without asking for the password", async () => {
    const user = await seedUser({ email: "me@test.local" });
    await loginAs(user.id);
    const state = await updateProfile(
      {},
      form({ name: "New Name", email: "me@test.local", currentPassword: "" }),
    );
    expect(state.message).toBe(en.errors.account.profileSaved);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).name).toBe(
      "New Name",
    );
  });

  it("changing the email requires the current password", async () => {
    const user = await seedUser({ email: "me@test.local" });
    await loginAs(user.id);
    const state = await updateProfile(
      {},
      form({ name: "Me", email: "other@test.local", currentPassword: "wrong" }),
    );
    expect(state.field).toBe("currentPassword");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(
      "me@test.local",
    );

    const ok = await updateProfile(
      {},
      form({ name: "Me", email: "Other@Test.local", currentPassword: PASSWORD }),
    );
    expect(ok.message).toBe(en.errors.account.profileSaved);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(
      "other@test.local",
    );
  });

  it("does not allow taking another account's email", async () => {
    await seedUser({ email: "taken@test.local" });
    const user = await seedUser({ email: "me@test.local" });
    await loginAs(user.id);
    const state = await updateProfile(
      {},
      form({ name: "Me", email: "taken@test.local", currentPassword: PASSWORD }),
    );
    expect(state.field).toBe("email");
  });
});

describe("password and sessions", () => {
  it("changes the password, signs out the other sessions and keeps the current one", async () => {
    const user = await seedUser();
    await loginAs(user.id);
    const current = (await verifySession())!.sessionId;
    const other = await openOtherSession(user.id);

    const state = await changePassword(
      {},
      form({
        currentPassword: PASSWORD,
        newPassword: "another-long-password",
        confirmPassword: "another-long-password",
      }),
    );
    expect(state.message).toBe(
      fmt(en.errors.account.passwordChangedSessionsClosed.one, { count: 1 }),
    );

    const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword("another-long-password", u.passwordHash)).toBe(true);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: other } })).revokedAt).not.toBeNull();
    expect((await prisma.session.findUniqueOrThrow({ where: { id: current } })).revokedAt).toBeNull();
  });

  it("rejects a wrong current password and a confirmation that does not match", async () => {
    const user = await seedUser();
    await loginAs(user.id);
    const wrong = await changePassword(
      {},
      form({ currentPassword: "wrong", newPassword: "new-long-one", confirmPassword: "new-long-one" }),
    );
    expect(wrong.field).toBe("currentPassword");
    const mismatch = await changePassword(
      {},
      form({ currentPassword: PASSWORD, newPassword: "new-long-one", confirmPassword: "something-else" }),
    );
    expect(mismatch.field).toBe("confirmPassword");
  });

  it("revokes one of your own sessions but not someone else's", async () => {
    const user = await seedUser();
    const stranger = await seedUser();
    const mine = await openOtherSession(user.id);
    const theirs = await openOtherSession(stranger.id);
    await loginAs(user.id);

    expect(await redirectOf(revokeSession(form({ sessionId: theirs })))).toBe(
      "/settings/security",
    );
    expect((await prisma.session.findUniqueOrThrow({ where: { id: theirs } })).revokedAt).toBeNull();

    await redirectOf(revokeSession(form({ sessionId: mine })));
    expect((await prisma.session.findUniqueOrThrow({ where: { id: mine } })).revokedAt).not.toBeNull();
  });

  it("“sign out the others” leaves only the current one open", async () => {
    const user = await seedUser();
    await loginAs(user.id);
    await openOtherSession(user.id);
    await openOtherSession(user.id);
    await redirectOf(revokeOtherSessions());
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(1);
    expect(await verifySession()).not.toBeNull();
  });
});

describe("export my data", () => {
  it("includes your own data and what you wrote on other people's boards, without hashes", async () => {
    const owner = await seedUser({ email: "owner@test.local" });
    const me = await seedUser({ email: "me@test.local", name: "Me" });
    const myBoard = await seedBoard(me.id, "My board");
    const myList = await seedList(myBoard.id);
    await seedCard(myList.id, "My card");
    const theirBoard = await seedBoard(owner.id, "Their board");
    await addMember(theirBoard.id, me.id, "EDITOR");
    const theirCard = await seedCard((await seedList(theirBoard.id)).id, "Their card");
    await prisma.comment.create({
      data: { cardId: theirCard.id, authorId: me.id, text: "My comment" },
    });
    await seedApiToken(me.id, { name: "script" });

    const data = await exportUserData(me.id);
    expect(data?.account).toMatchObject({ email: "me@test.local", name: "Me" });
    expect(data?.ownedBoards.map((b) => b.title)).toEqual(["My board"]);
    expect(data?.ownedBoards[0].lists[0].cards[0].title).toBe("My card");
    expect(data?.memberships.map((m) => m.boardTitle).sort()).toEqual([
      "My board",
      "Their board",
    ]);
    expect(data?.comments).toEqual([
      expect.objectContaining({ text: "My comment", cardTitle: "Their card" }),
    ]);
    expect(data?.apiTokens).toEqual([expect.objectContaining({ name: "script" })]);

    const json = JSON.stringify(data);
    expect(json).not.toContain("passwordHash");
    expect(json).not.toContain("tokenHash");
    // Nothing from the other board that she did not write herself.
    expect(json).not.toContain("owner@test.local");
  });

  it("the route requires a session, downloads the JSON and audits it", async () => {
    const user = await seedUser();
    expect((await exportRoute()).status).toBe(401);

    await loginAs(user.id);
    const res = await exportRoute();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="orgtable-my-data-/);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect((await res.json()).account.id).toBe(user.id);
    expect(await prisma.auditLog.count({ where: { action: "account.exported" } })).toBe(1);
  });
});

describe("delete my account (deleteAccount)", () => {
  it("deletes the account, its own boards with their files, and its comments; other boards stay", async () => {
    const other = await seedUser();
    const me = await seedUser({ email: "me@test.local" });
    const myBoard = await seedBoard(me.id);
    const myCard = await seedCard((await seedList(myBoard.id)).id);
    const { storedName, size } = await saveAttachmentFile(
      new File(["content"], "note.txt", { type: "text/plain" }),
    );
    await prisma.attachment.create({
      data: { cardId: myCard.id, filename: "note.txt", storedName, mimeType: "text/plain", size },
    });
    const filePath = path.join(uploadDir, storedName);

    const theirBoard = await seedBoard(other.id);
    await addMember(theirBoard.id, me.id);
    const theirCard = await seedCard((await seedList(theirBoard.id)).id);
    await prisma.comment.create({ data: { cardId: theirCard.id, authorId: me.id, text: "hello" } });
    // Audit row about this account with its email in `detail` (like user.created).
    await prisma.auditLog.create({
      data: { action: "user.created", targetType: "user", targetId: me.id, detail: "yo@test.local (MEMBER)" },
    });

    await loginAs(me.id);
    expect(await redirectOf(deleteAccount({}, form({ password: PASSWORD })))).toBe(
      "/login?account=deleted",
    );

    expect(await prisma.user.findUnique({ where: { id: me.id } })).toBeNull();
    expect(await prisma.board.findUnique({ where: { id: myBoard.id } })).toBeNull();
    expect(await fileExists(filePath)).toBe(false);
    expect(await prisma.board.findUnique({ where: { id: theirBoard.id } })).not.toBeNull();
    expect(await prisma.comment.count()).toBe(0);
    expect(await prisma.session.count({ where: { userId: me.id } })).toBe(0);
    const auditDetails = (await prisma.auditLog.findMany()).map((a) => a.detail ?? "");
    expect(auditDetails.join(" ")).not.toContain("me@test.local");
    expect(await prisma.auditLog.count({ where: { action: "account.deleted", userId: null } })).toBe(1);
  });

  it("deletes nothing with a wrong password", async () => {
    const me = await seedUser();
    await seedBoard(me.id);
    await loginAs(me.id);
    const state = await deleteAccount({}, form({ password: "wrong" }));
    expect(state.field).toBe("password");
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.board.count()).toBe(1);
  });

  it("the only ADMIN account cannot be deleted; with another admin, it can", async () => {
    const admin = await seedUser({ role: "ADMIN" });
    await loginAs(admin.id);
    const state = await deleteAccount({}, form({ password: PASSWORD }));
    expect(state.error).toBe(en.errors.account.lastAdmin);
    expect(await prisma.user.count()).toBe(1);

    await seedUser({ role: "ADMIN" });
    expect(await redirectOf(deleteAccount({}, form({ password: PASSWORD })))).toBe(
      "/login?account=deleted",
    );
    expect(await prisma.user.count({ where: { role: "ADMIN" } })).toBe(1);
  });

  it("two admins deleting themselves at once do not leave the instance without an admin", async () => {
    const a = await seedUser({ role: "ADMIN" });
    const b = await seedUser({ role: "ADMIN" });
    const { deleteOwnAccount } = await import("@/app/lib/services/account");
    const results = await Promise.all([
      deleteOwnAccount(a.id, PASSWORD),
      deleteOwnAccount(b.id, PASSWORD),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === "last_admin")).toHaveLength(1);
    expect(await prisma.user.count({ where: { role: "ADMIN" } })).toBe(1);
  });

  it("after deleting it, the cookie is removed and the session no longer exists", async () => {
    const me = await seedUser();
    await loginAs(me.id);
    await redirectOf(deleteAccount({}, form({ password: PASSWORD })));
    expect(await verifySession()).toBeNull();
    expect(await prisma.session.count()).toBe(0);
  });
});
