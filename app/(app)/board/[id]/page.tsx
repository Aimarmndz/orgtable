import { notFound } from "next/navigation";
import { requireUser } from "@/app/lib/dal";
import { getBoardWithLists } from "@/app/lib/queries";
import { BoardView } from "@/app/components/board/board-view";
import type { BoardDTO } from "@/app/lib/types";

export default async function BoardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // En Next.js 16 `params` es asíncrono.
  const { id } = await params;
  const user = await requireUser();
  const board = await getBoardWithLists(id, user.id);
  if (!board) notFound();

  // Proyectamos a un DTO mínimo y serializable para el componente cliente.
  const dto: BoardDTO = {
    id: board.id,
    title: board.title,
    lists: board.lists.map((list) => ({
      id: list.id,
      title: list.title,
      position: list.position,
      cards: list.cards.map((card) => ({
        id: card.id,
        title: card.title,
        position: card.position,
      })),
    })),
  };

  return <BoardView board={dto} />;
}
