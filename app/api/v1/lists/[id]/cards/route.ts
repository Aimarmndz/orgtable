import { prisma } from "@/app/lib/prisma";
import { revalidateBoard } from "@/app/lib/realtime/notify";
import { canEditBoard } from "@/app/lib/roles";
import { apiCardCreateSchema } from "@/app/lib/validators";
import { positionAtEnd } from "@/app/lib/ordering";
import { authenticateApiToken, apiBoardRole, isReadOnly } from "@/app/lib/api/auth";
import { apiError, apiOk } from "@/app/lib/api/respond";
import { serializeCard } from "@/app/lib/api/serialize";

// API pública v1 — tarjetas de una lista (Hito 9). Ver docs/api/public-api.md.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Relaciones que componen una tarjeta completa en la respuesta.
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

/** GET /api/v1/lists/:id/cards — las tarjetas de la lista, en orden. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiToken(request);
  if (!auth) return apiError(401, "Token de API no válido o ausente.");
  const { id: listId } = await params;

  const list = await prisma.list.findUnique({
    where: { id: listId },
    select: { boardId: true },
  });
  if (!list) return apiError(404, "Lista no encontrada.");
  const role = await apiBoardRole(auth.userId, list.boardId);
  if (!role) return apiError(404, "Lista no encontrada.");

  const cards = await prisma.card.findMany({
    where: { listId },
    orderBy: { position: "asc" },
    include: cardInclude,
  });
  return apiOk({ cards: cards.map(serializeCard) });
}

/** POST /api/v1/lists/:id/cards — crea una tarjeta al final (requiere editor). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiToken(request);
  if (!auth) return apiError(401, "Token de API no válido o ausente.");
  if (isReadOnly(auth)) return apiError(403, "Token de solo lectura.");
  const { id: listId } = await params;

  const list = await prisma.list.findUnique({
    where: { id: listId },
    select: { boardId: true },
  });
  if (!list) return apiError(404, "Lista no encontrada.");
  const role = await apiBoardRole(auth.userId, list.boardId);
  if (!role) return apiError(404, "Lista no encontrada.");
  if (!canEditBoard(role)) {
    return apiError(403, "Necesitas permiso de edición en el tablero.");
  }

  const body = await request.json().catch(() => null);
  const parsed = apiCardCreateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(422, parsed.error.issues[0]?.message ?? "Datos no válidos.");
  }

  const due = parsed.data.dueDate ? new Date(parsed.data.dueDate) : null;
  const last = await prisma.card.findFirst({
    where: { listId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const created = await prisma.card.create({
    data: {
      listId,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      dueDate: due && !Number.isNaN(due.getTime()) ? due : null,
      position: positionAtEnd(last?.position ?? null),
    },
    include: cardInclude,
  });
  revalidateBoard(list.boardId);
  return apiOk(serializeCard(created), 201);
}
