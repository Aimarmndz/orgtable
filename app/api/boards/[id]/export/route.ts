import { requireUser } from "@/app/lib/dal";
import { getBoardWithLists } from "@/app/lib/queries";

// Exporta un tablero completo a JSON (Hito 5): listas, tarjetas, etiquetas, fechas y
// checklists. Las etiquetas se referencian por nombre dentro de cada tarjeta para poder
// re-vincularlas al importar. Los binarios de los adjuntos NO se incluyen (solo viven en
// disco); ver docs/operations.md. Cualquier miembro del tablero puede exportar.

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
      .slice(0, 40) || "tablero";

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="orgtable-${slug}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
