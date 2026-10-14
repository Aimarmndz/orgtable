import { prisma } from "@/app/lib/prisma";
import { revalidateBoard } from "@/app/lib/realtime/notify";
import { canEditBoard } from "@/app/lib/roles";
import { apiCardCreateSchema } from "@/app/lib/validators";
import { createCardAtEnd } from "@/app/lib/services/cards";
import { authenticateApiToken, apiBoardRole, isReadOnly } from "@/app/lib/api/auth";
import { apiError, apiOk, apiValidationError } from "@/app/lib/api/respond";
import { serializeCard } from "@/app/lib/api/serialize";

// Public API v1: cards of a list. See docs/api/public-api.md.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Relations that make up a full card in the response.
const cardInclude = {
  labels: { include: { label: true } },
  checklists: {
    orderBy: { position: "asc" as const },
    include: { items: { orderBy: { position: "asc" as const } } },
  },
  attachments: { orderBy: { createdAt: "asc" as const } },
  assignees: { include: { user: { select: { id: true, name: true } } } },
  comments: {
    orderBy: { createdAt: "asc" as const },
    include: { author: { select: { id: true, name: true } } },
  },
};

/** GET /api/v1/lists/:id/cards: the list's cards, in order. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiToken(request);
  if (!auth) return apiError(401, "Missing or invalid API token.");
  const { id: listId } = await params;

  const list = await prisma.list.findUnique({
    where: { id: listId },
    select: { boardId: true },
  });
  if (!list) return apiError(404, "List not found.");
  const role = await apiBoardRole(auth.userId, list.boardId);
  if (!role) return apiError(404, "List not found.");

  const cards = await prisma.card.findMany({
    where: { listId },
    orderBy: { position: "asc" },
    include: cardInclude,
  });
  return apiOk({ cards: cards.map(serializeCard) });
}

/** POST /api/v1/lists/:id/cards: creates a card at the end (requires editor). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiToken(request);
  if (!auth) return apiError(401, "Missing or invalid API token.");
  if (isReadOnly(auth)) return apiError(403, "Read-only token.");
  const { id: listId } = await params;

  const list = await prisma.list.findUnique({
    where: { id: listId },
    select: { boardId: true },
  });
  if (!list) return apiError(404, "List not found.");
  const role = await apiBoardRole(auth.userId, list.boardId);
  if (!role) return apiError(404, "List not found.");
  if (!canEditBoard(role)) {
    return apiError(403, "You need edit permission on this board.");
  }

  const body = await request.json().catch(() => null);
  const parsed = apiCardCreateSchema.safeParse(body);
  if (!parsed.success) {
    return apiValidationError(parsed.error.issues[0]);
  }

  // apiDueDateSchema already guarantees a valid ISO date (or null/absent).
  const { id } = await createCardAtEnd({
    listId,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
  });
  const created = await prisma.card.findUniqueOrThrow({
    where: { id },
    include: cardInclude,
  });
  revalidateBoard(list.boardId);
  return apiOk(serializeCard(created), 201);
}
