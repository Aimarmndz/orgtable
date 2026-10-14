import { requireUser } from "@/app/lib/dal";
import { getBoardWithLists } from "@/app/lib/queries";

// Exports a full board as JSON: lists, cards, labels, dates and checklists. Labels are
// referenced by name inside each card so they can be relinked on import. Attachment
// files are NOT included (they only live on disk); see docs/operations.md. Any board
// member can export.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type BoardExport = {
  orgtable: { type: "board"; version: 1; exportedAt: string };
  board: {
    title: string;
    background: string | null;
    labels: { name: string; color: string }[];
    lists: {
      title: string;
      cards: {
        title: string;
        description: string | null;
        dueDate: string | null;
        labels: string[];
        checklists: {
          title: string;
          items: { text: string; done: boolean }[];
        }[];
      }[];
    }[];
  };
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await requireUser();
  const board = await getBoardWithLists(id, user.id);
  if (!board) return new Response("Not found", { status: 404 });

  const data: BoardExport = {
    orgtable: {
      type: "board",
      version: 1,
      exportedAt: new Date().toISOString(),
    },
    board: {
      title: board.title,
      background: board.background,
      labels: board.labels.map((l) => ({ name: l.name, color: l.color })),
      lists: board.lists.map((list) => ({
        title: list.title,
        cards: list.cards.map((card) => ({
          title: card.title,
          description: card.description,
          dueDate: card.dueDate ? card.dueDate.toISOString() : null,
          labels: card.labels.map((cl) => cl.label.name),
          checklists: card.checklists.map((ch) => ({
            title: ch.title,
            items: ch.items.map((it) => ({ text: it.text, done: it.done })),
          })),
        })),
      })),
    },
  };

  const slug =
    board.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "board";

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="orgtable-${slug}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
