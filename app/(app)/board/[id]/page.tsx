import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/app/lib/dal";
import {
  getBoardWithLists,
  getBoardMembers,
  getBoardTitleForUser,
} from "@/app/lib/queries";
import { firstParam } from "@/app/lib/search-params";
import { BoardView } from "@/app/components/board/board-view";
import { BoardRealtime } from "@/app/components/board/board-realtime";
import type { BoardMemberDTO } from "@/app/components/board/members-panel";
import type { BoardDTO } from "@/app/lib/types";
import type { BoardRole } from "@/app/lib/roles";

// El nombre sale de la misma guarda de acceso que la página: sin acceso, título
// genérico (la página redirige o da 404, pero el <title> se resuelve aparte).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const user = await requireUser();
  const title = await getBoardTitleForUser(id, user.id);
  return { title: title ?? "Tablero" };
}

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ card?: string | string[] }>;
}) {
  // En Next.js 16 `params` y `searchParams` son asíncronos.
  const { id } = await params;
  // Deep-link para abrir una tarjeta directamente (p. ej. desde /search). Si el id no
  // existe en el tablero, BoardView simplemente no abre nada. Ver docs/search.md.
  const initialCardId = firstParam((await searchParams).card);
  const user = await requireUser();
  const board = await getBoardWithLists(id, user.id);
  if (!board) notFound();

  // Miembros del tablero y rol del visor (para autorizar la UI). El propietario es
  // siempre miembro OWNER; si por algún motivo no apareciera, caemos a VIEWER.
  const memberData = await getBoardMembers(id);
  const members: BoardMemberDTO[] = (memberData?.members ?? []).map((m) => ({
    id: m.user.id,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    isOwner: m.user.id === memberData?.ownerId,
  }));
  const viewerRole: BoardRole =
    members.find((m) => m.id === user.id)?.role ?? "VIEWER";

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
        attachments: card.attachments.map((a) => ({
          id: a.id,
          filename: a.filename,
          mimeType: a.mimeType,
          size: a.size,
        })),
        assignees: card.assignees.map((a) => ({
          id: a.user.id,
          name: a.user.name,
        })),
        comments: card.comments.map((c) => ({
          id: c.id,
          text: c.text,
          authorId: c.author.id,
          authorName: c.author.name,
          createdAt: c.createdAt.toISOString(),
        })),
      })),
    })),
  };

  return (
    <>
      <BoardRealtime boardId={id} />
      <BoardView
        board={dto}
        viewerRole={viewerRole}
        members={members}
        currentUserId={user.id}
        initialCardId={initialCardId ?? null}
      />
    </>
  );
}
