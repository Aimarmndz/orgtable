import "server-only";
import { prisma } from "@/app/lib/prisma";

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
