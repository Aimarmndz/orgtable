import { revalidatePath } from "next/cache";
import { prisma } from "@/app/lib/prisma";
import { getBoardsForUser } from "@/app/lib/queries";
import { recordAudit } from "@/app/lib/audit";
import { boardTitleSchema } from "@/app/lib/validators";
import { authenticateApiToken, isReadOnly } from "@/app/lib/api/auth";
import { apiError, apiOk, apiValidationError } from "@/app/lib/api/respond";
import { serializeBoardSummary } from "@/app/lib/api/serialize";

// Public API v1: board collection. See docs/api/public-api.md.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/boards: boards the token's user has access to. */
export async function GET(request: Request) {
  const auth = await authenticateApiToken(request);
  if (!auth) return apiError(401, "Missing or invalid API token.");

  const boards = await getBoardsForUser(auth.userId);
  return apiOk({ boards: boards.map(serializeBoardSummary) });
}

/** POST /api/v1/boards: creates a board (the user becomes its owner). */
export async function POST(request: Request) {
  const auth = await authenticateApiToken(request);
  if (!auth) return apiError(401, "Missing or invalid API token.");
  if (isReadOnly(auth)) return apiError(403, "Read-only token.");

  const body = await request.json().catch(() => null);
  const parsed = boardTitleSchema.safeParse((body as { title?: unknown })?.title);
  if (!parsed.success) {
    return apiValidationError(parsed.error.issues[0]);
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
