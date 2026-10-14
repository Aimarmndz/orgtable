import { prisma } from "@/app/lib/prisma";
import { revalidateBoard } from "@/app/lib/realtime/notify";
import { canEditBoard } from "@/app/lib/roles";
import { listTitleSchema } from "@/app/lib/validators";
import { createListAtEnd } from "@/app/lib/services/lists";
import { authenticateApiToken, apiBoardRole, isReadOnly } from "@/app/lib/api/auth";
import { apiError, apiOk, apiValidationError } from "@/app/lib/api/respond";
import { serializeListSummary } from "@/app/lib/api/serialize";

// Public API v1: lists of a board. See docs/api/public-api.md.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/boards/:id/lists: the board's lists, in order. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiToken(request);
  if (!auth) return apiError(401, "Missing or invalid API token.");
  const { id: boardId } = await params;

  const role = await apiBoardRole(auth.userId, boardId);
  if (!role) return apiError(404, "Board not found.");

  const lists = await prisma.list.findMany({
    where: { boardId },
    orderBy: { position: "asc" },
    select: { id: true, title: true, position: true },
  });
  return apiOk({ lists: lists.map(serializeListSummary) });
}

/** POST /api/v1/boards/:id/lists: creates a list at the end (requires editor). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiToken(request);
  if (!auth) return apiError(401, "Missing or invalid API token.");
  if (isReadOnly(auth)) return apiError(403, "Read-only token.");
  const { id: boardId } = await params;

  const role = await apiBoardRole(auth.userId, boardId);
  if (!role) return apiError(404, "Board not found.");
  if (!canEditBoard(role)) {
    return apiError(403, "You need edit permission on this board.");
  }

  const body = await request.json().catch(() => null);
  const parsed = listTitleSchema.safeParse((body as { title?: unknown })?.title);
  if (!parsed.success) {
    return apiValidationError(parsed.error.issues[0]);
  }

  const list = await createListAtEnd({ boardId, title: parsed.data });
  revalidateBoard(boardId);
  return apiOk(serializeListSummary(list), 201);
}
