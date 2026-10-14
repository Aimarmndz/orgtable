import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import {
  GET as getBoard,
  PATCH as patchBoard,
  DELETE as deleteBoard,
} from "@/app/api/v1/boards/[id]/route";
import {
  resetDb,
  disconnect,
  seedUser,
  seedApiToken,
  seedBoard,
  addMember,
  apiRequest,
  ctx,
} from "./helpers";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await disconnect();
});

/** Board with an owner, an EDITOR, a VIEWER and a stranger, each with their own token. */
async function seedRoles() {
  const owner = await seedUser();
  const editor = await seedUser();
  const viewer = await seedUser();
  const stranger = await seedUser();
  const board = await seedBoard(owner.id, "Original");
  await addMember(board.id, editor.id, "EDITOR");
  await addMember(board.id, viewer.id, "VIEWER");
  return {
    board,
    owner: { ...owner, token: await seedApiToken(owner.id) },
    editor: { ...editor, token: await seedApiToken(editor.id) },
    viewer: { ...viewer, token: await seedApiToken(viewer.id) },
    stranger: { ...stranger, token: await seedApiToken(stranger.id) },
  };
}

function patch(boardId: string, token: string, body: unknown) {
  return patchBoard(
    apiRequest("PATCH", `/api/v1/boards/${boardId}`, { token, body }),
    ctx({ id: boardId }),
  );
}

function del(boardId: string, token: string) {
  return deleteBoard(
    apiRequest("DELETE", `/api/v1/boards/${boardId}`, { token }),
    ctx({ id: boardId }),
  );
}

async function boardTitle(id: string) {
  return (await prisma.board.findUnique({ where: { id }, select: { title: true } }))?.title;
}

describe("API v1 — GET /boards/:id", () => {
  it("200 for a member and 404 for a stranger", async () => {
    const { board, viewer, stranger } = await seedRoles();
    const ok = await getBoard(
      apiRequest("GET", `/api/v1/boards/${board.id}`, { token: viewer.token }),
      ctx({ id: board.id }),
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).title).toBe("Original");

    const hidden = await getBoard(
      apiRequest("GET", `/api/v1/boards/${board.id}`, { token: stranger.token }),
      ctx({ id: board.id }),
    );
    expect(hidden.status).toBe(404);
  });
});

describe("API v1 — PATCH /boards/:id", () => {
  it("200 for the owner", async () => {
    const { board, owner } = await seedRoles();
    const res = await patch(board.id, owner.token, { title: "Renamed" });
    expect(res.status).toBe(200);
    expect(await boardTitle(board.id)).toBe("Renamed");
  });

  it("403 for the EDITOR and 404 for a stranger, without changes", async () => {
    const { board, editor, stranger } = await seedRoles();
    expect((await patch(board.id, editor.token, { title: "X" })).status).toBe(403);
    expect((await patch(board.id, stranger.token, { title: "X" })).status).toBe(404);
    expect(await boardTitle(board.id)).toBe("Original");
  });

  it("422 with an empty or missing title", async () => {
    const { board, owner } = await seedRoles();
    expect((await patch(board.id, owner.token, { title: "   " })).status).toBe(422);
    expect((await patch(board.id, owner.token, {})).status).toBe(422);
    expect(await boardTitle(board.id)).toBe("Original");
  });
});

describe("API v1 — DELETE /boards/:id", () => {
  it("403 for the EDITOR and 404 for a stranger, without deleting", async () => {
    const { board, editor, stranger } = await seedRoles();
    expect((await del(board.id, editor.token)).status).toBe(403);
    expect((await del(board.id, stranger.token)).status).toBe(404);
    expect(await prisma.board.count()).toBe(1);
  });

  it("200 for the owner and recorded in the audit log as board.deleted", async () => {
    const { board, owner } = await seedRoles();
    const res = await del(board.id, owner.token);
    expect(res.status).toBe(200);
    expect(await prisma.board.count()).toBe(0);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "board.deleted", targetId: board.id },
    });
    expect(audit?.userId).toBe(owner.id);
  });
});
