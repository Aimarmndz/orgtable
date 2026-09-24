import "server-only";
import { prisma } from "@/app/lib/prisma";
import { positionAtEnd } from "@/app/lib/ordering";

// Contexto de una tarjeta (su tablero) para autorizar y notificar. Aislado aquí para
// reutilizarlo desde las Server Actions de comentarios y asignaciones (Hito 10) y para
// poder testearlo. Devuelve null si la tarjeta no existe.
export type CardContext = {
  cardId: string;
  cardTitle: string;
  boardId: string;
  boardTitle: string;
};

/**
 * ¿La tarjeta pertenece a este tablero? Lo usa moveCard para impedir mover a tu tablero una
 * tarjeta de OTRO al que no tienes acceso (IDOR). Aislado aquí para poder testearlo.
 */
export async function cardBelongsToBoard(
  cardId: string,
  boardId: string,
): Promise<boolean> {
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { list: { select: { boardId: true } } },
  });
  return !!card && card.list.boardId === boardId;
}

export async function cardContext(
  cardId: string,
): Promise<CardContext | null> {
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: {
      id: true,
      title: true,
      list: { select: { boardId: true, board: { select: { title: true } } } },
    },
  });
  if (!card) return null;
  return {
    cardId: card.id,
    cardTitle: card.title,
    boardId: card.list.boardId,
    boardTitle: card.list.board.title,
  };
}

/**
 * Crea una tarjeta al final de la lista. Leer la última posición y crear son dos pasos:
 * sin bloqueo, dos altas simultáneas (dos usuarios o Promise.all contra la API) leían la
 * misma última clave y guardaban la MISMA posición, y luego generateKeyBetween(a, a)
 * rompía el arrastre en esa lista. El `FOR UPDATE` sobre la fila de la lista serializa
 * las altas de esa lista (las de otras listas no esperan). No se usa un índice único
 * (listId, position) porque los movimientos concurrentes también colisionan y fallarían.
 */
export async function createCardAtEnd(data: {
  listId: string;
  title: string;
  description?: string | null;
  dueDate?: Date | null;
}): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "List" WHERE id = ${data.listId} FOR UPDATE`;
    const last = await tx.card.findFirst({
      where: { listId: data.listId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    return tx.card.create({
      data: {
        listId: data.listId,
        title: data.title,
        description: data.description ?? null,
        dueDate: data.dueDate ?? null,
        position: positionAtEnd(last?.position ?? null),
      },
      select: { id: true },
    });
  });
}
