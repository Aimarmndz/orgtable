import { revalidatePath } from "next/cache";
import { prisma } from "@/app/lib/prisma";
import { getBoardsForUser } from "@/app/lib/queries";
import { recordAudit } from "@/app/lib/audit";
import { boardTitleSchema } from "@/app/lib/validators";
import { authenticateApiToken } from "@/app/lib/api/auth";
import { apiError, apiOk } from "@/app/lib/api/respond";
import { serializeBoardSummary } from "@/app/lib/api/serialize";

// API pública v1 — colección de tableros (Hito 9). Ver docs/api/public-api.md.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/boards — tableros a los que el usuario del token tiene acceso. */
export async function GET(request: Request) {
  const auth = await authenticateApiToken(request);
  if (!auth) return apiError(401, "Token de API no válido o ausente.");

  const boards = await getBoardsForUser(auth.userId);
  return apiOk({ boards: boards.map(serializeBoardSummary) });
}

/** POST /api/v1/boards — crea un tablero (el usuario queda como propietario). */
export async function POST(request: Request) {
  const auth = await authenticateApiToken(request);
  if (!auth) return apiError(401, "Token de API no válido o ausente.");

  const body = await request.json().catch(() => null);
  const parsed = boardTitleSchema.safeParse((body as { title?: unknown })?.title);
  if (!parsed.success) {
    return apiError(422, parsed.error.issues[0]?.message ?? "Datos no válidos.");
  }

  const board = await prisma.board.create({
    data: {
      title: parsed.data,
      ownerId: auth.userId,
      members: { create: { userId: auth.userId, role: "OWNER" } },
    },
  });
  await recordAudit({
    action: "board.created",
    userId: auth.userId,
    targetType: "board",
    targetId: board.id,
    detail: `api: ${board.title}`,
  });
  revalidatePath("/boards");
  return apiOk(serializeBoardSummary(board), 201);
}
