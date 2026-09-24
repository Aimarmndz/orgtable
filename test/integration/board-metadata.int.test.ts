import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { generateMetadata } from "@/app/(app)/board/[id]/page";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  addMember,
  loginAs,
} from "./helpers";

function metadataFor(boardId: string) {
  return generateMetadata({ params: Promise.resolve({ id: boardId }) });
}

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await disconnect();
});

describe("título de la página del tablero (integración)", () => {
  it("el dueño y los miembros ven el nombre del tablero", async () => {
    const owner = await seedUser();
    const viewer = await seedUser();
    const board = await seedBoard(owner.id, "Plan secreto");
    await addMember(board.id, viewer.id, "VIEWER");

    await loginAs(owner.id);
    expect((await metadataFor(board.id)).title).toBe("Plan secreto");

    await loginAs(viewer.id);
    expect((await metadataFor(board.id)).title).toBe("Plan secreto");
  });

  it("quien no es miembro recibe el título genérico, no el nombre", async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const board = await seedBoard(owner.id, "Plan secreto");

    await loginAs(stranger.id);
    expect((await metadataFor(board.id)).title).toBe("Tablero");
  });

  it("un tablero inexistente también da el título genérico", async () => {
    const user = await seedUser();
    await loginAs(user.id);
    expect((await metadataFor("no-existe")).title).toBe("Tablero");
  });
});
