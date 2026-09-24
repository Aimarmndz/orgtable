import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { assignMemberToCard } from "@/app/lib/services/assignees";
import { getBoardWithLists } from "@/app/lib/queries";
import { requireBoardAccess } from "@/app/lib/dal";
import { addComment } from "@/app/lib/actions/comments";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  seedList,
  seedCard,
  addMember,
} from "./helpers";

// addComment autoriza con requireBoardAccess (sesión por cookie), que no existe fuera de
// Next: se sustituye SOLO en este archivo. El resto de la acción es real.
vi.mock("@/app/lib/dal", () => ({ requireBoardAccess: vi.fn() }));

beforeEach(async () => {
  await resetDb();
  vi.mocked(requireBoardAccess).mockReset();
});
afterAll(async () => {
  await disconnect();
});

describe("colaboración en la tarjeta (integración)", () => {
  it("asigna a un miembro del tablero, es idempotente, y rechaza a un no-miembro", async () => {
    const owner = await seedUser();
    const editor = await seedUser();
    const stranger = await seedUser();
    const board = await seedBoard(owner.id);
    await addMember(board.id, editor.id, "EDITOR");
    const list = await seedList(board.id);
    const card = await seedCard(list.id);

    // Miembro: se asigna.
    const r1 = await assignMemberToCard(board.id, card.id, editor.id);
    expect(r1.assigned).toBe(true);
    expect(
      await prisma.cardAssignee.count({ where: { cardId: card.id } }),
    ).toBe(1);

    // Idempotente: segunda vez no duplica.
    const r2 = await assignMemberToCard(board.id, card.id, editor.id);
    expect(r2).toEqual({ assigned: false, reason: "already" });
    expect(
      await prisma.cardAssignee.count({ where: { cardId: card.id } }),
    ).toBe(1);

    // No-miembro: se rechaza y no crea fila.
    const r3 = await assignMemberToCard(board.id, card.id, stranger.id);
    expect(r3).toEqual({ assigned: false, reason: "not_member" });
    expect(
      await prisma.cardAssignee.count({ where: { cardId: card.id } }),
    ).toBe(1);
  });

  it("getBoardWithLists devuelve los asignados y los comentarios con su autor", async () => {
    const owner = await seedUser({ name: "Owner Persona" });
    const board = await seedBoard(owner.id);
    const list = await seedList(board.id);
    const card = await seedCard(list.id);

    await assignMemberToCard(board.id, card.id, owner.id);
    await prisma.comment.create({
      data: { cardId: card.id, authorId: owner.id, text: "Primer comentario" },
    });

    const full = await getBoardWithLists(board.id, owner.id);
    const got = full?.lists[0]?.cards[0];
    expect(got?.assignees.map((a) => a.user.name)).toEqual(["Owner Persona"]);
    expect(got?.comments).toHaveLength(1);
    expect(got?.comments[0]?.text).toBe("Primer comentario");
    expect(got?.comments[0]?.author.name).toBe("Owner Persona");
  });

  it("addComment no avisa a un asignado que ya no es miembro del tablero", async () => {
    const owner = await seedUser();
    const editor = await seedUser();
    const expelled = await seedUser();
    const board = await seedBoard(owner.id);
    await addMember(board.id, editor.id, "EDITOR");
    const card = await seedCard((await seedList(board.id)).id);
    // Asignación huérfana: como las que dejaba la expulsión antes de borrarlas.
    await prisma.cardAssignee.createMany({
      data: [
        { cardId: card.id, userId: editor.id },
        { cardId: card.id, userId: expelled.id },
      ],
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    vi.mocked(requireBoardAccess).mockResolvedValue({ user, role: "OWNER" });

    const fd = new FormData();
    fd.set("cardId", card.id);
    fd.set("text", "Hola");
    await addComment(fd);

    const notes = await prisma.notification.findMany({
      where: { type: "comment.added" },
      select: { userId: true },
    });
    expect(notes).toEqual([{ userId: editor.id }]);
  });
});
