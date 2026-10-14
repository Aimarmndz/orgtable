import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/app/lib/prisma";
import { addComment, deleteComment } from "@/app/lib/actions/comments";
import {
  createChecklist,
  deleteChecklist,
  addChecklistItem,
  toggleChecklistItem,
  deleteChecklistItem,
} from "@/app/lib/actions/checklists";
import { uploadAttachment } from "@/app/lib/actions/attachments";
import { importBoard } from "@/app/lib/actions/boards";
import { MAX_ATTACHMENT_BYTES } from "@/app/lib/storage";
import { GET as exportBoard } from "@/app/api/boards/[id]/export/route";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  seedList,
  seedCard,
  addMember,
  loginAs,
  ctx,
} from "./helpers";

// Authorization of the Server Actions for comments, checklists, attachments and
// import/export, run with a real session (loginAs). The effect on the DB is always
// checked, not just the returned value. Attachment download (404/403) is covered by its
// own route handler test.

// storage.ts reads ORGTABLE_UPLOAD_DIR when imported: it is pointed at a temporary
// directory before any import so nothing is written to the repo's ./uploads.
const uploadDir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "orgtable-uploads-test-"));
  process.env.ORGTABLE_UPLOAD_DIR = dir;
  return dir;
});

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  delete process.env.ORGTABLE_UPLOAD_DIR;
  await rm(uploadDir, { recursive: true, force: true });
  await disconnect();
});

function fd(fields: Record<string, string | Blob>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

async function boardWithRoles() {
  const owner = await seedUser();
  const editor = await seedUser();
  const viewer = await seedUser();
  const board = await seedBoard(owner.id);
  await addMember(board.id, editor.id, "EDITOR");
  await addMember(board.id, viewer.id, "VIEWER");
  const list = await seedList(board.id);
  const card = await seedCard(list.id);
  return { owner, editor, viewer, board, list, card };
}

describe("comments", () => {
  it("a VIEWER cannot comment", async () => {
    const { viewer, card } = await boardWithRoles();
    await loginAs(viewer.id);
    await addComment(fd({ cardId: card.id, text: "hello" }));
    expect(await prisma.comment.count()).toBe(0);
  });

  it("an EDITOR who is not the author cannot delete; the OWNER can", async () => {
    const { owner, editor, viewer, card } = await boardWithRoles();
    const comment = await prisma.comment.create({
      data: { cardId: card.id, authorId: viewer.id, text: "someone else's" },
    });

    await loginAs(editor.id);
    await deleteComment(fd({ commentId: comment.id }));
    expect(await prisma.comment.count()).toBe(1);

    await loginAs(owner.id);
    await deleteComment(fd({ commentId: comment.id }));
    expect(await prisma.comment.count()).toBe(0);
  });

  it("notifies comment.added to the assignees, not to the author", async () => {
    const { owner, editor, card } = await boardWithRoles();
    await prisma.cardAssignee.createMany({
      data: [
        { cardId: card.id, userId: owner.id },
        { cardId: card.id, userId: editor.id },
      ],
    });

    await loginAs(editor.id);
    await addComment(fd({ cardId: card.id, text: "done" }));

    expect(await prisma.comment.count({ where: { authorId: editor.id } })).toBe(1);
    const notified = await prisma.notification.findMany({
      where: { type: "comment.added" },
      select: { userId: true },
    });
    expect(notified.map((n) => n.userId)).toEqual([owner.id]);
  });
});

describe("checklists", () => {
  it("a VIEWER changes nothing with any of the five actions", async () => {
    const { viewer, card } = await boardWithRoles();
    const checklist = await prisma.checklist.create({
      data: { cardId: card.id, title: "Tasks", position: "a0" },
    });
    const item = await prisma.checklistItem.create({
      data: { checklistId: checklist.id, text: "one", position: "a0" },
    });

    await loginAs(viewer.id);
    await createChecklist(fd({ cardId: card.id, title: "New" }));
    await addChecklistItem(fd({ checklistId: checklist.id, text: "two" }));
    expect(await toggleChecklistItem({ itemId: item.id, done: true })).toEqual({ ok: false });
    await deleteChecklistItem(fd({ itemId: item.id }));
    await deleteChecklist(fd({ checklistId: checklist.id }));

    expect(await prisma.checklist.count()).toBe(1);
    const items = await prisma.checklistItem.findMany();
    expect(items).toHaveLength(1);
    expect(items[0]?.done).toBe(false);
  });

  it("an EDITOR can use them", async () => {
    const { editor, card } = await boardWithRoles();
    await loginAs(editor.id);
    await createChecklist(fd({ cardId: card.id, title: "New" }));
    const checklist = await prisma.checklist.findFirstOrThrow({ where: { cardId: card.id } });
    await addChecklistItem(fd({ checklistId: checklist.id, text: "one" }));
    const item = await prisma.checklistItem.findFirstOrThrow();
    expect(await toggleChecklistItem({ itemId: item.id, done: true })).toEqual({ ok: true });
    expect((await prisma.checklistItem.findUniqueOrThrow({ where: { id: item.id } })).done).toBe(
      true,
    );
  });
});

describe("attachments", () => {
  it("a VIEWER cannot upload", async () => {
    const { viewer, card } = await boardWithRoles();
    await loginAs(viewer.id);
    const state = await uploadAttachment(
      {},
      fd({ cardId: card.id, file: new File(["data"], "note.txt", { type: "text/plain" }) }),
    );
    expect(state.error).toBeTruthy();
    expect(await prisma.attachment.count()).toBe(0);
  });

  it("rejects an empty file and one over the maximum", async () => {
    const { editor, card } = await boardWithRoles();
    await loginAs(editor.id);

    const empty = await uploadAttachment({}, fd({ cardId: card.id, file: new File([], "empty.txt") }));
    expect(empty.error).toBeTruthy();

    const big = new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], "large.bin");
    const tooBig = await uploadAttachment({}, fd({ cardId: card.id, file: big }));
    expect(tooBig.error).toBeTruthy();

    expect(await prisma.attachment.count()).toBe(0);
  });

  it("an EDITOR uploads a file and it lands in the attachments directory", async () => {
    const { editor, card } = await boardWithRoles();
    await loginAs(editor.id);
    const state = await uploadAttachment(
      {},
      fd({ cardId: card.id, file: new File(["data"], "note.txt", { type: "text/plain" }) }),
    );
    expect(state.error).toBeUndefined();
    const attachment = await prisma.attachment.findFirstOrThrow({ where: { cardId: card.id } });
    expect(attachment.size).toBe(4);
    expect(existsSync(path.join(uploadDir, attachment.storedName))).toBe(true);
  });
});

describe("board export/import", () => {
  it("a non-member gets 404 when exporting", async () => {
    const { board } = await boardWithRoles();
    const stranger = await seedUser();
    await loginAs(stranger.id);
    const res = await exportBoard(new Request("http://test/export"), ctx({ id: board.id }));
    expect(res.status).toBe(404);
  });

  it("round trip: what a member exports is imported as a new board of their own", async () => {
    const { viewer, board, card } = await boardWithRoles();
    await prisma.card.update({ where: { id: card.id }, data: { description: "details" } });
    await loginAs(viewer.id);

    const res = await exportBoard(new Request("http://test/export"), ctx({ id: board.id }));
    expect(res.status).toBe(200);
    const json = await res.text();

    await expect(
      importBoard({}, fd({ file: new File([json], "board.json", { type: "application/json" }) })),
    ).rejects.toMatchObject({ digest: expect.stringContaining(";/board/") });

    const imported = await prisma.board.findFirstOrThrow({
      where: { ownerId: viewer.id },
      include: { members: true, lists: { include: { cards: true } } },
    });
    expect(imported.id).not.toBe(board.id);
    expect(imported.members).toEqual([
      expect.objectContaining({ userId: viewer.id, role: "OWNER" }),
    ]);
    expect(imported.lists).toHaveLength(1);
    expect(imported.lists[0]?.cards.map((c) => c.description)).toEqual(["details"]);
  });
});
