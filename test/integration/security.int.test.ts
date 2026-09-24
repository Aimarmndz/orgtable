import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { cardBelongsToBoard } from "@/app/lib/services/cards";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  seedList,
  seedCard,
} from "./helpers";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await disconnect();
});

// Helper del guard contra el IDOR de moveCard: una tarjeta solo "pertenece" a su propio
// tablero. Este test prueba SOLO el helper; que moveCard lo use se comprueba ejecutando la
// acción en cards-actions.int.test.ts.
describe("seguridad: helper cardBelongsToBoard", () => {
  it("cardBelongsToBoard es true solo para el tablero real de la tarjeta", async () => {
    const u1 = await seedUser();
    const u2 = await seedUser();
    const boardA = await seedBoard(u1.id, "A");
    const boardB = await seedBoard(u2.id, "B");
    const listA = await seedList(boardA.id);
    const cardA = await seedCard(listA.id);

    expect(await cardBelongsToBoard(cardA.id, boardA.id)).toBe(true);
    // El intento de IDOR: reclamar la tarjeta de A desde el tablero B.
    expect(await cardBelongsToBoard(cardA.id, boardB.id)).toBe(false);
    // Tarjeta inexistente.
    expect(await cardBelongsToBoard("cminexistente000000000000", boardA.id)).toBe(
      false,
    );
  });
});
