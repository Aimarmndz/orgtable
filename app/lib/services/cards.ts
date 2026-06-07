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
