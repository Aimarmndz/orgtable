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

// Helper of the guard against the moveCard IDOR: a card only "belongs" to its own board.
// This test checks ONLY the helper; that moveCard uses it is checked by running the action
// in cards-actions.int.test.ts.
describe("security: cardBelongsToBoard helper", () => {
  it("cardBelongsToBoard is only true for the card's actual board", async () => {
    const u1 = await seedUser();
    const u2 = await seedUser();
    const boardA = await seedBoard(u1.id, "A");
    const boardB = await seedBoard(u2.id, "B");
    const listA = await seedList(boardA.id);
    const cardA = await seedCard(listA.id);

    expect(await cardBelongsToBoard(cardA.id, boardA.id)).toBe(true);
    // The IDOR attempt: claiming board A's card from board B.
    expect(await cardBelongsToBoard(cardA.id, boardB.id)).toBe(false);
    // A card that does not exist.
    expect(await cardBelongsToBoard("cmmissing0000000000000000", boardA.id)).toBe(
      false,
    );
  });
});
