import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  addMember,
} from "./helpers";

// La sesión llega por cookie y el stub de next/headers no tiene ninguna: se sustituye el
// DAL solo en este archivo para decidir qué usuario "está conectado". La consulta de
// acceso sí va contra la BD real.
const currentUser = vi.hoisted(() => ({ id: "" }));
vi.mock("@/app/lib/dal", () => ({
  requireUser: async () => ({ id: currentUser.id }),
}));

const { generateMetadata } = await import("@/app/(app)/board/[id]/page");

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

    currentUser.id = owner.id;
    expect((await metadataFor(board.id)).title).toBe("Plan secreto");

    currentUser.id = viewer.id;
    expect((await metadataFor(board.id)).title).toBe("Plan secreto");
  });

  it("quien no es miembro recibe el título genérico, no el nombre", async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const board = await seedBoard(owner.id, "Plan secreto");

    currentUser.id = stranger.id;
    expect((await metadataFor(board.id)).title).toBe("Tablero");
  });

  it("un tablero inexistente también da el título genérico", async () => {
    const user = await seedUser();
    currentUser.id = user.id;
    expect((await metadataFor("no-existe")).title).toBe("Tablero");
  });
});
