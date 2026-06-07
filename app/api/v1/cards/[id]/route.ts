import { prisma } from "@/app/lib/prisma";
import { revalidateBoard } from "@/app/lib/realtime/notify";
import { canEditBoard } from "@/app/lib/roles";
import { apiCardUpdateSchema } from "@/app/lib/validators";
import { authenticateApiToken, apiBoardRole } from "@/app/lib/api/auth";
import { apiError, apiOk } from "@/app/lib/api/respond";
import { serializeCard } from "@/app/lib/api/serialize";

// API pública v1 — una tarjeta (Hito 9). Ver docs/api/public-api.md.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const cardInclude = {
  labels: { include: { label: true } },
  checklists: {
    orderBy: { position: "asc" as const },
    include: { items: { orderBy: { position: "asc" as const } } },
  },
  attachments: { orderBy: { createdAt: "asc" as const } },
};

// Carga la tarjeta con sus relaciones y el boardId de su lista (para autorizar).
async function loadCard(id: string) {
  return prisma.card.findUnique({
    where: { id },
    include: { ...cardInclude, list: { select: { boardId: true } } },
  });
}

/** GET /api/v1/cards/:id — el detalle de una tarjeta. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiToken(request);
  if (!auth) return apiError(401, "Token de API no válido o ausente.");
  const { id } = await params;

  const card = await loadCard(id);
  if (!card) return apiError(404, "Tarjeta no encontrada.");
  const role = await apiBoardRole(auth.userId, card.list.boardId);
  if (!role) return apiError(404, "Tarjeta no encontrada.");

  return apiOk(serializeCard(card));
}

/** PATCH /api/v1/cards/:id — actualiza título, descripción o vencimiento (editor). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiToken(request);
  if (!auth) return apiError(401, "Token de API no válido o ausente.");
  const { id } = await params;

  const existing = await prisma.card.findUnique({
    where: { id },
    select: { list: { select: { boardId: true } } },
  });
  if (!existing) return apiError(404, "Tarjeta no encontrada.");
  const role = await apiBoardRole(auth.userId, existing.list.boardId);
  if (!role) return apiError(404, "Tarjeta no encontrada.");
  if (!canEditBoard(role)) {
    return apiError(403, "Necesitas permiso de edición en el tablero.");
  }

  const body = await request.json().catch(() => null);
  const parsed = apiCardUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(422, parsed.error.issues[0]?.message ?? "Datos no válidos.");
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
    const due = parsed.data.dueDate ? new Date(parsed.data.dueDate) : null;
    data.dueDate = due && !Number.isNaN(due.getTime()) ? due : null;
  }

  await prisma.card.update({ where: { id }, data });
  const card = await loadCard(id);
  revalidateBoard(existing.list.boardId);
  return apiOk(card ? serializeCard(card) : { id });
}

/** DELETE /api/v1/cards/:id — borra una tarjeta (editor). */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiToken(request);
  if (!auth) return apiError(401, "Token de API no válido o ausente.");
  const { id } = await params;

  const existing = await prisma.card.findUnique({
    where: { id },
    select: { list: { select: { boardId: true } } },
  });
  if (!existing) return apiError(404, "Tarjeta no encontrada.");
  const role = await apiBoardRole(auth.userId, existing.list.boardId);
  if (!role) return apiError(404, "Tarjeta no encontrada.");
  if (!canEditBoard(role)) {
    return apiError(403, "Necesitas permiso de edición en el tablero.");
  }

  await prisma.card.delete({ where: { id } });
  revalidateBoard(existing.list.boardId);
  return apiOk({ deleted: true });
}
