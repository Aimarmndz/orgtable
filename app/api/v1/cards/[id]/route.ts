import { prisma } from "@/app/lib/prisma";
import { cardSnapshot, emitCard } from "@/app/lib/webhooks/emit";
import { revalidateBoard } from "@/app/lib/realtime/notify";
import { canEditBoard } from "@/app/lib/roles";
import { apiCardUpdateSchema } from "@/app/lib/validators";
import { authenticateApiToken, apiBoardRole, isReadOnly } from "@/app/lib/api/auth";
import { apiError, apiOk, apiValidationError } from "@/app/lib/api/respond";
import { serializeCard } from "@/app/lib/api/serialize";
import { deleteCardWithAttachments } from "@/app/lib/services/attachments";

// Public API v1: a single card. See docs/api/public-api.md.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

// Loads the card with its relations and its list's boardId (for authorization).
async function loadCard(id: string) {
  return prisma.card.findUnique({
    where: { id },
    include: { ...cardInclude, list: { select: { boardId: true } } },
  });
}

/** GET /api/v1/cards/:id: a card's details. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiToken(request);
  if (!auth) return apiError(401, "Missing or invalid API token.");
  const { id } = await params;

  const card = await loadCard(id);
  if (!card) return apiError(404, "Card not found.");
  const role = await apiBoardRole(auth.userId, card.list.boardId);
  if (!role) return apiError(404, "Card not found.");

  return apiOk(serializeCard(card));
}

/** PATCH /api/v1/cards/:id: updates title, description or due date (editor). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiToken(request);
  if (!auth) return apiError(401, "Missing or invalid API token.");
  if (isReadOnly(auth)) return apiError(403, "Read-only token.");
  const { id } = await params;

  const existing = await prisma.card.findUnique({
    where: { id },
    select: { list: { select: { boardId: true } } },
  });
  if (!existing) return apiError(404, "Card not found.");
  const role = await apiBoardRole(auth.userId, existing.list.boardId);
  if (!role) return apiError(404, "Card not found.");
  if (!canEditBoard(role)) {
    return apiError(403, "You need edit permission on this board.");
  }

  const body = await request.json().catch(() => null);
  const parsed = apiCardUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return apiValidationError(parsed.error.issues[0]);
  }

  const data: {
    title?: string;
    description?: string | null;
    dueDate?: Date | null;
  } = {};
  if (parsed.data.title !== undefined) data.title = parsed.data.title;
  if (parsed.data.description !== undefined) {
    data.description = parsed.data.description || null;
  }
  if (parsed.data.dueDate !== undefined) {
    // apiDueDateSchema already guarantees a valid ISO date (or null): no silent fallback to null.
    data.dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : null;
  }

  await prisma.card.update({ where: { id }, data });
  const card = await loadCard(id);
  revalidateBoard(existing.list.boardId);
  await emitCard("card.updated", await cardSnapshot(id), auth.userId, { changes: Object.keys(data) });
  return apiOk(card ? serializeCard(card) : { id });
}

/** DELETE /api/v1/cards/:id: deletes a card (editor). */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiToken(request);
  if (!auth) return apiError(401, "Missing or invalid API token.");
  if (isReadOnly(auth)) return apiError(403, "Read-only token.");
  const { id } = await params;

  const existing = await prisma.card.findUnique({
    where: { id },
    select: { list: { select: { boardId: true } } },
  });
  if (!existing) return apiError(404, "Card not found.");
  const role = await apiBoardRole(auth.userId, existing.list.boardId);
  if (!role) return apiError(404, "Card not found.");
  if (!canEditBoard(role)) {
    return apiError(403, "You need edit permission on this board.");
  }

  const before = await cardSnapshot(id);
  await deleteCardWithAttachments(id);
  revalidateBoard(existing.list.boardId);
  await emitCard("card.deleted", before, auth.userId);
  return apiOk({ deleted: true });
}
