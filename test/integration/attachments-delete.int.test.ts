import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { access, readdir, rm } from "node:fs/promises";
import path from "node:path";

// Directorio de subida temporal: storage.ts lo fija al importarse, así que se define antes
// de cualquier import (vi.hoisted se ejecuta primero).
const uploadDir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "orgtable-attachments-"));
  process.env.ORGTABLE_UPLOAD_DIR = dir;
  return dir;
});

const cookieJar = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "session" && cookieJar.token
        ? { name, value: cookieJar.token }
        : undefined,
    set: () => {},
    delete: () => {},
  }),
  headers: async () => new Headers(),
}));

import { prisma } from "@/app/lib/prisma";
import { saveAttachmentFile } from "@/app/lib/storage";
import { subscribeBoard } from "@/app/lib/realtime/bus";
import { deleteCard } from "@/app/lib/actions/cards";
import { deleteList } from "@/app/lib/actions/lists";
import { deleteBoard } from "@/app/lib/actions/boards";
import { uploadAttachment } from "@/app/lib/actions/attachments";
import { DELETE as deleteCardApi } from "@/app/api/v1/cards/[id]/route";
import { DELETE as deleteBoardApi } from "@/app/api/v1/boards/[id]/route";
import { sessionTokenFor, TEST_SESSION_SECRET } from "./action-session";
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
} from "./helpers";

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  cookieJar.token = undefined;
  await resetDb();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(uploadDir, { recursive: true, force: true });
  delete process.env.ORGTABLE_UPLOAD_DIR;
  await disconnect();
});

/** Guarda un fichero real en el directorio temporal y su fila Attachment. */
async function seedAttachment(cardId: string): Promise<string> {
  const { storedName, size } = await saveAttachmentFile(
    new File(["contenido"], "nota.txt", { type: "text/plain" }),
  );
  await prisma.attachment.create({
    data: { cardId, filename: "nota.txt", storedName, mimeType: "text/plain", size },
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

/** Propietario con sesión, tablero, lista, tarjeta y un adjunto en disco. */
async function seedBoardWithAttachment() {
  const owner = await seedUser();
  const board = await seedBoard(owner.id);
  const list = await seedList(board.id);
  const card = await seedCard(list.id);
  const filePath = await seedAttachment(card.id);
  cookieJar.token = await sessionTokenFor(owner.id);
  return { owner, board, list, card, filePath };
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

// Regresión: el Cascade borraba las filas Attachment, pero los ficheros se quedaban en el
// volumen para siempre.
describe("borrar tarjeta, lista o tablero borra los ficheros de sus adjuntos", () => {
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

  it("deleteBoard (Server Action) borra ficheros y avisa por el bus en vivo", async () => {
    const { board, filePath } = await seedBoardWithAttachment();
    const events: string[] = [];
    const unsubscribe = subscribeBoard(board.id, (e) => events.push(e.boardId));

    // deleteBoard termina con redirect("/boards"), que lanza NEXT_REDIRECT.
    await expect(deleteBoard(form({ boardId: board.id }))).rejects.toThrow("NEXT_REDIRECT");
    unsubscribe();

    expect(await prisma.board.count()).toBe(0);
    expect(await fileExists(filePath)).toBe(false);
    expect(events).toEqual([board.id]);
  });

  it("deleteBoard de alguien que no es el dueño no borra nada", async () => {
    const { board, filePath } = await seedBoardWithAttachment();
    const editor = await seedUser();
    await addMember(board.id, editor.id, "EDITOR");
    cookieJar.token = await sessionTokenFor(editor.id);

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

  it("DELETE /api/v1/boards/:id borra ficheros y avisa por el bus en vivo", async () => {
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

  it("un VIEWER recibe 403 y el fichero sigue ahí", async () => {
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

describe("uploadAttachment", () => {
  it("si falla el alta en BD no deja el fichero huérfano", async () => {
    const { card } = await seedBoardWithAttachment();
    const before = await readdir(uploadDir);
    const spy = vi
      .spyOn(prisma.attachment, "create")
      .mockRejectedValueOnce(new Error("fallo simulado de la BD"));

    const fd = new FormData();
    fd.set("cardId", card.id);
    fd.set("file", new File(["x"], "otro.txt", { type: "text/plain" }));
    await expect(uploadAttachment({}, fd)).rejects.toThrow("fallo simulado de la BD");
    spy.mockRestore();

    expect((await readdir(uploadDir)).sort()).toEqual(before.sort());
  });
});
