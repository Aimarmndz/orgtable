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

  // Proyectamos a un DTO mínimo y serializable (las fechas a ISO string).
  const dto: BoardDTO = {
    id: board.id,
    title: board.title,
    background: board.background,
    labels: board.labels.map((l) => ({
      id: l.id,
      name: l.name,
      color: l.color,
    })),
    lists: board.lists.map((list) => ({
      id: list.id,
      title: list.title,
      position: list.position,
      cards: list.cards.map((card) => ({
        id: card.id,
        title: card.title,
        position: card.position,
        description: card.description,
        dueDate: card.dueDate ? card.dueDate.toISOString() : null,
        labels: card.labels.map((cl) => ({
          id: cl.label.id,
          name: cl.label.name,
          color: cl.label.color,
        })),
        checklists: card.checklists.map((ch) => ({
          id: ch.id,
          title: ch.title,
          items: ch.items.map((it) => ({
            id: it.id,
            text: it.text,
            done: it.done,
          })),
        })),
      })),
    })),
  };

  return <BoardView board={dto} />;
}
