import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { generateMetadata } from "@/app/(app)/board/[id]/page";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  addMember,
  loginAs,
  en,
  es,
} from "./helpers";
import { cookies } from "next/headers";

function metadataFor(boardId: string) {
  return generateMetadata({ params: Promise.resolve({ id: boardId }) });
}

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await disconnect();
});

describe("board page title (integration)", () => {
  it("the owner and the members see the board's name", async () => {
    const owner = await seedUser();
    const viewer = await seedUser();
    const board = await seedBoard(owner.id, "Secret plan");
    await addMember(board.id, viewer.id, "VIEWER");

    await loginAs(owner.id);
    expect((await metadataFor(board.id)).title).toBe("Secret plan");

    await loginAs(viewer.id);
    expect((await metadataFor(board.id)).title).toBe("Secret plan");
  });

  it("a non-member gets the generic title, not the name", async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const board = await seedBoard(owner.id, "Secret plan");

    await loginAs(stranger.id);
    expect((await metadataFor(board.id)).title).toBe(en.boards.board.metaTitle);
  });

  it("a board that does not exist also gets the generic title", async () => {
    const user = await seedUser();
    await loginAs(user.id);
    expect((await metadataFor("does-not-exist")).title).toBe(en.boards.board.metaTitle);
  });

  it("the generic title follows the language of the request", async () => {
    const user = await seedUser();
    await loginAs(user.id);
    (await cookies()).set("locale", "es");
    expect((await metadataFor("does-not-exist")).title).toBe(es.boards.board.metaTitle);
  });
});
