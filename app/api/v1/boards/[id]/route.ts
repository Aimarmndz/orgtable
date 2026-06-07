import { revalidatePath } from "next/cache";
import { prisma } from "@/app/lib/prisma";
import { getBoardWithLists } from "@/app/lib/queries";
import { revalidateBoard } from "@/app/lib/realtime/notify";
import { canManageBoard } from "@/app/lib/roles";
import { recordAudit } from "@/app/lib/audit";
import { boardTitleSchema } from "@/app/lib/validators";
import { authenticateApiToken, apiBoardRole, isReadOnly } from "@/app/lib/api/auth";
import { apiError, apiOk } from "@/app/lib/api/respond";
import {
  serializeBoardFull,
  serializeBoardSummary,
} from "@/app/lib/api/serialize";

// API pública v1 — un tablero (Hito 9). Ver docs/api/public-api.md.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/boards/:id — el tablero con sus listas y tarjetas. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiToken(request);
  if (!auth) return apiError(401, "Token de API no válido o ausente.");
  const { id } = await params;

  // getBoardWithLists ya acota por acceso (dueño o miembro); null = sin acceso.
  const board = await getBoardWithLists(id, auth.userId);
  if (!board) return apiError(404, "Tablero no encontrado.");
  return apiOk(serializeBoardFull(board));
}

/** PATCH /api/v1/boards/:id — renombra el tablero (solo propietario). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiToken(request);
  if (!auth) return apiError(401, "Token de API no válido o ausente.");
  if (isReadOnly(auth)) return apiError(403, "Token de solo lectura.");
  const { id } = await params;

  const role = await apiBoardRole(auth.userId, id);
  if (!role) return apiError(404, "Tablero no encontrado.");
  if (!canManageBoard(role)) {
    return apiError(403, "Necesitas ser propietario del tablero.");
  }

  const body = await request.json().catch(() => null);
  const parsed = boardTitleSchema.safeParse((body as { title?: unknown })?.title);
  if (!parsed.success) {
    return apiError(422, parsed.error.issues[0]?.message ?? "Datos no válidos.");
  }

  const board = await prisma.board.update({
    where: { id },
    data: { title: parsed.data },
  });
  revalidateBoard(id);
  return apiOk(serializeBoardSummary(board));
}

/** DELETE /api/v1/boards/:id — borra el tablero (solo propietario). */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiToken(request);
  if (!auth) return apiError(401, "Token de API no válido o ausente.");
  if (isReadOnly(auth)) return apiError(403, "Token de solo lectura.");
  const { id } = await params;

  const role = await apiBoardRole(auth.userId, id);
  if (!role) return apiError(404, "Tablero no encontrado.");
  if (!canManageBoard(role)) {
    return apiError(403, "Necesitas ser propietario del tablero.");
  }

  await prisma.board.delete({ where: { id } });
  await recordAudit({
    action: "board.deleted",
    userId: auth.userId,
    targetType: "board",
    targetId: id,
    detail: "api",
  });
  revalidatePath("/boards");
  return apiOk({ deleted: true });
}
