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

// Regresión del IDOR de moveCard (auditoría de seguridad): una tarjeta solo "pertenece" a
// su propio tablero, así que moveCard no puede arrastrar a tu tablero una tarjeta de otro.
describe("seguridad: pertenencia tarjeta↔tablero (guard de moveCard)", () => {
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
