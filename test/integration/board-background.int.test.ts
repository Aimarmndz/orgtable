import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

// Temporary upload directory (storage.ts reads it when imported).
const uploadDir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "orgtable-background-"));
  process.env.ORGTABLE_UPLOAD_DIR = dir;
  return dir;
});

import { prisma } from "@/app/lib/prisma";
import {
  removeBoardBackgroundImage,
  setBoardBackground,
  setBoardBackgroundImage,
} from "@/app/lib/actions/boards";
import { deleteBoardWithAttachments } from "@/app/lib/services/attachments";
import { GET as backgroundRoute } from "@/app/api/boards/[id]/background/route";
import { resetDb, disconnect, seedUser, seedBoard, addMember, loginAs } from "./helpers";

// Board backgrounds: free colours and uploaded images (docs/board-menu.md, "Background").

beforeEach(resetDb);
afterAll(async () => {
  await rm(uploadDir, { recursive: true, force: true });
  delete process.env.ORGTABLE_UPLOAD_DIR;
  await disconnect();
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

const imageForm = (boardId: string, bytes: Buffer, type = "image/png") => {
  const data = new FormData();
  data.set("boardId", boardId);
  data.set("image", new File([new Uint8Array(bytes)], "bg.png", { type }));
  return data;
};
const imageOf = async (id: string) =>
  (await prisma.board.findUniqueOrThrow({ where: { id }, select: { backgroundImageStoredName: true } }))
    .backgroundImageStoredName;
const fetchImage = (id: string) =>
  backgroundRoute(new Request(`http://localhost/api/boards/${id}/background`), { params: Promise.resolve({ id }) });

async function scenario() {
  const owner = await seedUser();
  const editor = await seedUser();
  const stranger = await seedUser();
  const board = await seedBoard(owner.id, "Backgrounds");
  await addMember(board.id, editor.id, "EDITOR");
  return { owner, editor, stranger, board };
}

describe("board backgrounds", () => {
  it("the owner picks any #rrggbb colour; nothing looser gets in", async () => {
    const { owner, board } = await scenario();
    await loginAs(owner.id);
    expect(await setBoardBackground({ boardId: board.id, background: "#3B6E8F" })).toEqual({ ok: true });
    expect((await prisma.board.findUniqueOrThrow({ where: { id: board.id } })).background).toBe("#3b6e8f");
    expect(await setBoardBackground({ boardId: board.id, background: "#3b6e8f;background:url(x)" })).toEqual({
      ok: false,
    });
  });

  it("takes an image from the owner only, by its bytes, and replaces the old file", async () => {
    const { owner, editor, board } = await scenario();
    await loginAs(editor.id);
    expect(await setBoardBackgroundImage(imageForm(board.id, PNG))).toEqual({ ok: false, error: "forbidden" });
    await loginAs(owner.id);
    expect(await setBoardBackgroundImage(imageForm(board.id, SVG, "image/svg+xml"))).toEqual({
      ok: false,
      error: "bad_image",
    });
    expect(await setBoardBackgroundImage(imageForm(board.id, Buffer.alloc(4 * 1024 * 1024)))).toEqual({
      ok: false,
      error: "too_big",
    });
    expect(await imageOf(board.id)).toBeNull();

    expect(await setBoardBackgroundImage(imageForm(board.id, PNG))).toEqual({ ok: true });
    const first = (await imageOf(board.id))!;
    await setBoardBackgroundImage(imageForm(board.id, PNG));
    expect(existsSync(path.join(uploadDir, first))).toBe(false);

    const second = (await imageOf(board.id))!;
    expect(await removeBoardBackgroundImage({ boardId: board.id })).toEqual({ ok: true });
    expect(await imageOf(board.id)).toBeNull();
    expect(existsSync(path.join(uploadDir, second))).toBe(false);
  });

  it("serves the image to whoever opens the board, as a non-sniffed image; 404 to the rest", async () => {
    const { owner, editor, stranger, board } = await scenario();
    await loginAs(owner.id);
    await setBoardBackgroundImage(imageForm(board.id, PNG));

    await loginAs(editor.id);
    const ok = await fetchImage(board.id);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");

    await loginAs(stranger.id);
    expect((await fetchImage(board.id)).status).toBe(404);
  });

  it("deleting the board deletes its image file", async () => {
    const { owner, board } = await scenario();
    await loginAs(owner.id);
    await setBoardBackgroundImage(imageForm(board.id, PNG));
    const file = (await imageOf(board.id))!;
    expect(await deleteBoardWithAttachments({ id: board.id })).toBe(1);
    expect(existsSync(path.join(uploadDir, file))).toBe(false);
  });
});
