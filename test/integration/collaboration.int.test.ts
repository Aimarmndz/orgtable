import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { assignMemberToCard } from "@/app/lib/services/assignees";
import { getBoardWithLists } from "@/app/lib/queries";
import { addComment } from "@/app/lib/actions/comments";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  seedList,
  seedCard,
  addMember,
  loginAs,
} from "./helpers";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await disconnect();
});

describe("card collaboration (integration)", () => {
  it("assigns a board member, is idempotent, and rejects a non-member", async () => {
    const owner = await seedUser();
    const editor = await seedUser();
    const stranger = await seedUser();
    const board = await seedBoard(owner.id);
    await addMember(board.id, editor.id, "EDITOR");
    const list = await seedList(board.id);
    const card = await seedCard(list.id);

    // Member: gets assigned.
    const r1 = await assignMemberToCard(board.id, card.id, editor.id);
    expect(r1.assigned).toBe(true);
    expect(
      await prisma.cardAssignee.count({ where: { cardId: card.id } }),
    ).toBe(1);

    // Idempotent: a second time does not duplicate.
    const r2 = await assignMemberToCard(board.id, card.id, editor.id);
    expect(r2).toEqual({ assigned: false, reason: "already" });
    expect(
      await prisma.cardAssignee.count({ where: { cardId: card.id } }),
    ).toBe(1);

    // Non-member: rejected, and no row is created.
    const r3 = await assignMemberToCard(board.id, card.id, stranger.id);
    expect(r3).toEqual({ assigned: false, reason: "not_member" });
    expect(
      await prisma.cardAssignee.count({ where: { cardId: card.id } }),
    ).toBe(1);
  });

  it("getBoardWithLists returns the assignees and the comments with their author", async () => {
    const owner = await seedUser({ name: "Owner Person" });
    const board = await seedBoard(owner.id);
    const list = await seedList(board.id);
    const card = await seedCard(list.id);

    await assignMemberToCard(board.id, card.id, owner.id);
    await prisma.comment.create({
      data: { cardId: card.id, authorId: owner.id, text: "First comment" },
    });

    const full = await getBoardWithLists(board.id, owner.id);
    const got = full?.lists[0]?.cards[0];
    expect(got?.assignees.map((a) => a.user.name)).toEqual(["Owner Person"]);
    expect(got?.comments).toHaveLength(1);
    expect(got?.comments[0]?.text).toBe("First comment");
    expect(got?.comments[0]?.author.name).toBe("Owner Person");
  });

  it("addComment does not notify an assignee who is no longer a board member", async () => {
    const owner = await seedUser();
    const editor = await seedUser();
    const expelled = await seedUser();
    const board = await seedBoard(owner.id);
    await addMember(board.id, editor.id, "EDITOR");
    const card = await seedCard((await seedList(board.id)).id);
    // Orphan assignment: like the ones removal from the board used to leave behind.
    await prisma.cardAssignee.createMany({
      data: [
        { cardId: card.id, userId: editor.id },
        { cardId: card.id, userId: expelled.id },
      ],
    });
    await loginAs(owner.id);

    const fd = new FormData();
    fd.set("cardId", card.id);
    fd.set("text", "Hello");
    await addComment(fd);

    const notes = await prisma.notification.findMany({
      where: { type: "comment.added" },
      select: { userId: true },
    });
    expect(notes).toEqual([{ userId: editor.id }]);
  });
});
