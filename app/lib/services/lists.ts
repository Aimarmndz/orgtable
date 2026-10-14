import "server-only";
import { prisma } from "@/app/lib/prisma";
import { positionAtEnd } from "@/app/lib/ordering";

/**
 * Creates a list at the end of the board. Locks the board row (`FOR UPDATE`) so two
 * concurrent creates do not read the same last position and store the same key.
 * Same reasoning as createCardAtEnd (app/lib/services/cards.ts).
 */
export async function createListAtEnd(data: {
  boardId: string;
  title: string;
}): Promise<{ id: string; title: string; position: string }> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Board" WHERE id = ${data.boardId} FOR UPDATE`;
    const last = await tx.list.findFirst({
      where: { boardId: data.boardId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    return tx.list.create({
      data: {
        boardId: data.boardId,
        title: data.title,
        position: positionAtEnd(last?.position ?? null),
      },
      select: { id: true, title: true, position: true },
    });
  });
}
