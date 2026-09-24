import { prisma } from "@/app/lib/prisma";
import { revalidateBoard } from "@/app/lib/realtime/notify";
import { canEditBoard } from "@/app/lib/roles";
import { listTitleSchema } from "@/app/lib/validators";
import { createListAtEnd } from "@/app/lib/services/lists";
import { authenticateApiToken, apiBoardRole, isReadOnly } from "@/app/lib/api/auth";
import { apiError, apiOk } from "@/app/lib/api/respond";
import { serializeListSummary } from "@/app/lib/api/serialize";

// API pública v1 — listas de un tablero (Hito 9). Ver docs/api/public-api.md.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/boards/:id/lists — las listas del tablero, en orden. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiToken(request);
  if (!auth) return apiError(401, "Token de API no válido o ausente.");
  const { id: boardId } = await params;

  const role = await apiBoardRole(auth.userId, boardId);
  if (!role) return apiError(404, "Tablero no encontrado.");

  const lists = await prisma.list.findMany({
    where: { boardId },
    orderBy: { position: "asc" },
    select: { id: true, title: true, position: true },
  });
  return apiOk({ lists: lists.map(serializeListSummary) });
}

/** POST /api/v1/boards/:id/lists — crea una lista al final (requiere editor). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiToken(request);
  if (!auth) return apiError(401, "Token de API no válido o ausente.");
  if (isReadOnly(auth)) return apiError(403, "Token de solo lectura.");
  const { id: boardId } = await params;

  const role = await apiBoardRole(auth.userId, boardId);
  if (!role) return apiError(404, "Tablero no encontrado.");
  if (!canEditBoard(role)) {
    return apiError(403, "Necesitas permiso de edición en el tablero.");
  }

  const body = await request.json().catch(() => null);
  const parsed = listTitleSchema.safeParse((body as { title?: unknown })?.title);
  if (!parsed.success) {
    return apiError(422, parsed.error.issues[0]?.message ?? "Datos no válidos.");
  }

  const list = await createListAtEnd({ boardId, title: parsed.data });
  revalidateBoard(boardId);
  return apiOk(serializeListSummary(list), 201);
}
