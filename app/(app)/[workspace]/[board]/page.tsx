import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/app/lib/dal";
import {
  findBoardByPath,
  getBoardPeople,
  getBoardWithLists,
  getBoardTitleForUser,
} from "@/app/lib/queries";
import { effectiveBoardRole, workspaceAccessOf } from "@/app/lib/access";
import { boardPath } from "@/app/lib/slugs";
import { BoardView } from "@/app/components/board/board-view";
import { BoardRealtime } from "@/app/components/board/board-realtime";
import type { BoardMemberDTO } from "@/app/components/board/members-panel";
import type { BoardDTO } from "@/app/lib/types";
import { canManageBoard, type BoardRole } from "@/app/lib/roles";
import { getI18n } from "@/app/i18n/server";

// The name comes from the same access guard as the page: without access, a generic
// title (the page redirects or 404s, but the <title> is resolved separately).
type Params = Promise<{ workspace: string; board: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspace, board: ref } = await params;
  const user = await requireUser();
  const found = await findBoardByPath(workspace, ref);
  const title = found ? await getBoardTitleForUser(found.id, user.id) : null;
  if (title) return { title };
  const { m } = await getI18n();
  return { title: m.boards.board.metaTitle };
}

// /<workspace>/<board>, where <board> is the board's slug or its id. An id, a board that
// moved or was renamed, or the old /board/<id> address redirect to the canonical path (the
// query string, e.g. the ?card=… deep link, is kept). Without access: 404, the same as a
// board that does not exist, so URLs do not reveal which boards exist.
export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // In Next.js 16 `params` is async. BoardView reads the ?card=… deep link from the URL
  // (useSearchParams). See docs/search.md.
  const { workspace, board: ref } = await params;
  const user = await requireUser();
  const found = await findBoardByPath(workspace, ref);
  if (!found) notFound();
  const id = found.id;
  const board = await getBoardWithLists(id, user.id);
  if (!board) notFound();
  if (found.workspace.slug !== workspace || found.slug !== ref) {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(await searchParams)) {
      if (typeof v === "string") query.set(k, v);
    }
    const qs = query.toString();
    redirect(`${boardPath(found.workspace.slug, found.slug)}${qs ? `?${qs}` : ""}`);
  }

  // Everyone who can open the board and the viewer's effective role (to authorize the UI;
  // every action checks it again on the server).
  const members: BoardMemberDTO[] = await getBoardPeople(id, user.id);
  const viewerRole: BoardRole = (await effectiveBoardRole(id, user.id)) ?? "VIEWER";
  const orgAccess =
    board.workspace.kind === "ORGANIZATION" ? await workspaceAccessOf(board.workspaceId, user.id) : null;
  const canChangeVisibility =
    canManageBoard(viewerRole) || Boolean(orgAccess?.permissions.has("boards.visibility"));

  // Project to a minimal, serializable DTO (dates as ISO strings).
  const dto: BoardDTO = {
    id: board.id,
    title: board.title,
    background: board.background,
    backgroundImageStoredName: board.backgroundImageStoredName,
    workspace: board.workspace,
    visibility: board.visibility,
    canChangeVisibility,
    inOrganization: orgAccess !== null,
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
          avatarStoredName: a.user.avatarStoredName,
        })),
        comments: card.comments.map((c) => ({
          id: c.id,
          text: c.text,
          authorId: c.author.id,
          authorName: c.author.name,
          authorAvatar: c.author.avatarStoredName,
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
