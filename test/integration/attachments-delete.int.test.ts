import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { access, readdir, rm } from "node:fs/promises";
import path from "node:path";

// Temporary upload directory: storage.ts reads it when imported, so it is set before any
// import (vi.hoisted runs first).
const uploadDir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "orgtable-attachments-"));
  process.env.ORGTABLE_UPLOAD_DIR = dir;
  return dir;
});

import { prisma } from "@/app/lib/prisma";
import { saveAttachmentFile } from "@/app/lib/storage";
import { subscribeBoard } from "@/app/lib/realtime/bus";
import { deleteCard } from "@/app/lib/actions/cards";
import { deleteList } from "@/app/lib/actions/lists";
import { deleteBoard } from "@/app/lib/actions/boards";
import { uploadAttachment } from "@/app/lib/actions/attachments";
import { DELETE as deleteCardApi } from "@/app/api/v1/cards/[id]/route";
import { DELETE as deleteBoardApi } from "@/app/api/v1/boards/[id]/route";
import {
  resetDb,
  disconnect,
  seedUser,
  seedApiToken,
  seedBoard,
  seedList,
  seedCard,
  addMember,
  apiRequest,
  ctx,
  loginAs,
} from "./helpers";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await rm(uploadDir, { recursive: true, force: true });
  delete process.env.ORGTABLE_UPLOAD_DIR;
  await disconnect();
});

/** Saves a real file in the temporary directory, plus its Attachment row. */
async function seedAttachment(cardId: string): Promise<string> {
  const { storedName, size } = await saveAttachmentFile(
    new File(["content"], "note.txt", { type: "text/plain" }),
  );
  await prisma.attachment.create({
    data: { cardId, filename: "note.txt", storedName, mimeType: "text/plain", size },
  });
  return path.join(uploadDir, storedName);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

/** Signed-in owner, board, list, card and an attachment on disk. */
async function seedBoardWithAttachment() {
  const owner = await seedUser();
  const board = await seedBoard(owner.id);
  const list = await seedList(board.id);
  const card = await seedCard(list.id);
  const filePath = await seedAttachment(card.id);
  await loginAs(owner.id);
  return { owner, board, list, card, filePath };
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

// Regression: the Cascade deleted the Attachment rows, but the files stayed on the volume
// forever.
describe("deleting a card, list or board deletes its attachment files", () => {
  it("deleteCard (Server Action)", async () => {
    const { card, filePath } = await seedBoardWithAttachment();
    expect(await fileExists(filePath)).toBe(true);

    await deleteCard(form({ cardId: card.id }));
    expect(await prisma.card.count()).toBe(0);
    expect(await fileExists(filePath)).toBe(false);
  });

  it("deleteList (Server Action)", async () => {
    const { list, filePath } = await seedBoardWithAttachment();

    await deleteList(form({ listId: list.id }));
    expect(await prisma.list.count()).toBe(0);
    expect(await fileExists(filePath)).toBe(false);
  });

  it("deleteBoard (Server Action) deletes the files and announces it on the live bus", async () => {
    const { board, filePath } = await seedBoardWithAttachment();
    const events: string[] = [];
    const unsubscribe = subscribeBoard(board.id, (e) => events.push(e.boardId));

    // deleteBoard ends with redirect("/boards"), which throws NEXT_REDIRECT.
    await expect(deleteBoard(form({ boardId: board.id }))).rejects.toThrow("NEXT_REDIRECT");
    unsubscribe();

    expect(await prisma.board.count()).toBe(0);
    expect(await fileExists(filePath)).toBe(false);
    expect(events).toEqual([board.id]);
  });

  it("deleteBoard by someone who is not the owner deletes nothing", async () => {
    const { board, filePath } = await seedBoardWithAttachment();
    const editor = await seedUser();
    await addMember(board.id, editor.id, "EDITOR");
    await loginAs(editor.id);

    await expect(deleteBoard(form({ boardId: board.id }))).rejects.toThrow("NEXT_REDIRECT");
    expect(await prisma.board.count()).toBe(1);
    expect(await fileExists(filePath)).toBe(true);
  });

  it("DELETE /api/v1/cards/:id", async () => {
    const { owner, card, filePath } = await seedBoardWithAttachment();
    const token = await seedApiToken(owner.id);

    const res = await deleteCardApi(
      apiRequest("DELETE", `/api/v1/cards/${card.id}`, { token }),
      ctx({ id: card.id }),
    );
    expect(res.status).toBe(200);
    expect(await fileExists(filePath)).toBe(false);
  });

  it("DELETE /api/v1/boards/:id deletes the files and announces it on the live bus", async () => {
    const { owner, board, filePath } = await seedBoardWithAttachment();
    const token = await seedApiToken(owner.id);
    const events: string[] = [];
    const unsubscribe = subscribeBoard(board.id, (e) => events.push(e.boardId));

    const res = await deleteBoardApi(
      apiRequest("DELETE", `/api/v1/boards/${board.id}`, { token }),
      ctx({ id: board.id }),
    );
    unsubscribe();
    expect(res.status).toBe(200);
    expect(await fileExists(filePath)).toBe(false);
    expect(events).toEqual([board.id]);
  });

  it("a VIEWER gets 403 and the file is still there", async () => {
    const { board, card, filePath } = await seedBoardWithAttachment();
    const viewer = await seedUser();
    await addMember(board.id, viewer.id, "VIEWER");
    const token = await seedApiToken(viewer.id);

    const res = await deleteCardApi(
      apiRequest("DELETE", `/api/v1/cards/${card.id}`, { token }),
      ctx({ id: card.id }),
    );
    expect(res.status).toBe(403);
    expect(await prisma.card.count()).toBe(1);
    expect(await fileExists(filePath)).toBe(true);
  });
});

/**
 * Opens a transaction that inserts an attachment (with its file on disk) and leaves it
 * uncommitted, like an upload halfway through. Returns the file path and `commit()`, which
 * commits it and waits for it to finish.
 */
async function pendingUpload(cardId: string) {
  const { storedName, size } = await saveAttachmentFile(
    new File(["late"], "late.txt", { type: "text/plain" }),
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let inserted!: () => void;
  const insertedP = new Promise<void>((resolve) => (inserted = resolve));
  const tx = prisma.$transaction(
    async (t) => {
      await t.attachment.create({
        data: { cardId, filename: "late.txt", storedName, mimeType: "text/plain", size },
      });
      inserted();
      await gate;
    },
    { timeout: 20_000 },
  );
  await insertedP;
  return {
    filePath: path.join(uploadDir, storedName),
    commit: async () => {
      release();
      await tx;
    },
  };
}

/** Waits until some session of this DB is blocked waiting for a lock. */
async function waitForLockWait(): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const [row] = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (row.n > BigInt(0)) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("no session ever waited for a lock");
}

// Regression: the deletion read the attachments without locking the card. An upload
// committed between that read and the delete was removed by the cascade, but its file was
// not in the list that had been read and was orphaned.
describe("concurrent deletion with an upload in progress", () => {
  it("deleteCardWithAttachments waits for the upload and deletes its file too", async () => {
    const { card, filePath } = await seedBoardWithAttachment();
    const upload = await pendingUpload(card.id);

    const deleting = deleteCard(form({ cardId: card.id }));
    await waitForLockWait();
    await upload.commit();
    await deleting;

    expect(await prisma.attachment.count()).toBe(0);
    expect(await fileExists(filePath)).toBe(false);
    expect(await fileExists(upload.filePath)).toBe(false);
  });

  it("deleteListWithAttachments waits for the upload and deletes its file too", async () => {
    const { list, card } = await seedBoardWithAttachment();
    const upload = await pendingUpload(card.id);

    const deleting = deleteList(form({ listId: list.id }));
    await waitForLockWait();
    await upload.commit();
    await deleting;

    expect(await prisma.attachment.count()).toBe(0);
    expect(await fileExists(upload.filePath)).toBe(false);
  });

  it("deleteBoardWithAttachments waits for the upload and deletes its file too", async () => {
    const { owner, board, card } = await seedBoardWithAttachment();
    const upload = await pendingUpload(card.id);
    const token = await seedApiToken(owner.id);

    const deleting = deleteBoardApi(
      apiRequest("DELETE", `/api/v1/boards/${board.id}`, { token }),
      ctx({ id: board.id }),
    );
    await waitForLockWait();
    await upload.commit();
    expect((await deleting).status).toBe(200);

    expect(await prisma.attachment.count()).toBe(0);
    expect(await fileExists(upload.filePath)).toBe(false);
  });
});

describe("uploadAttachment", () => {
  it("does not orphan the file if the DB insert fails", async () => {
    const { card } = await seedBoardWithAttachment();
    const before = await readdir(uploadDir);
    const spy = vi
      .spyOn(prisma.attachment, "create")
      .mockRejectedValueOnce(new Error("simulated DB failure"));

    const fd = new FormData();
    fd.set("cardId", card.id);
    fd.set("file", new File(["x"], "other.txt", { type: "text/plain" }));
    await expect(uploadAttachment({}, fd)).rejects.toThrow("simulated DB failure");
    spy.mockRestore();

    expect((await readdir(uploadDir)).sort()).toEqual(before.sort());
  });
});
