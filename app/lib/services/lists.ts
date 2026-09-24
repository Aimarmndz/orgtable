import "server-only";
import { prisma } from "@/app/lib/prisma";
import { positionAtEnd } from "@/app/lib/ordering";

/**
 * Crea una lista al final del tablero. Bloquea la fila del tablero (`FOR UPDATE`) para
 * que dos altas simultáneas no lean la misma última posición y guarden la misma clave.
 * Mismo razonamiento que createCardAtEnd (app/lib/services/cards.ts).
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
