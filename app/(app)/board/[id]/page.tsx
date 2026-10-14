import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/app/lib/dal";
import {
  getBoardWithLists,
  getBoardMembers,
  getBoardTitleForUser,
} from "@/app/lib/queries";
import { BoardView } from "@/app/components/board/board-view";
import { BoardRealtime } from "@/app/components/board/board-realtime";
import type { BoardMemberDTO } from "@/app/components/board/members-panel";
import type { BoardDTO } from "@/app/lib/types";
import type { BoardRole } from "@/app/lib/roles";
import { getI18n } from "@/app/i18n/server";

// The name comes from the same access guard as the page: without access, a generic
// title (the page redirects or 404s, but the <title> is resolved separately).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const user = await requireUser();
  const title = await getBoardTitleForUser(id, user.id);
  if (title) return { title };
  const { m } = await getI18n();
  return { title: m.boards.board.metaTitle };
}

export default async function BoardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // In Next.js 16 `params` is async. BoardView reads the ?card=… deep link from the URL
  // (useSearchParams). See docs/search.md.
  const { id } = await params;
  const user = await requireUser();
  const board = await getBoardWithLists(id, user.id);
  if (!board) notFound();

  // Board members and the viewer's role (to authorize the UI). The owner is always an
  // OWNER member; if for some reason they were missing, fall back to VIEWER.
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

  // Project to a minimal, serializable DTO (dates as ISO strings).
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
      />
    </>
  );
}
