import { revalidatePath } from "next/cache";
import { prisma } from "@/app/lib/prisma";
import { getBoardsForUser } from "@/app/lib/queries";
import { recordAudit } from "@/app/lib/audit";
import { emitBoardEvent } from "@/app/lib/webhooks/dispatch";
import { boardTitleSchema } from "@/app/lib/validators";
import { authenticateApiToken, isReadOnly } from "@/app/lib/api/auth";
import { apiError, apiOk, apiValidationError } from "@/app/lib/api/respond";
import { serializeBoardSummary } from "@/app/lib/api/serialize";
import { createBoardWithSlug } from "@/app/lib/services/workspaces";
import { workspaceAccessOf } from "@/app/lib/access";

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

/**
 * POST /api/v1/boards: creates a board (the user becomes its owner) in the workspace whose
 * slug is in `workspace`, if the user is a member of it, or in their personal workspace.
 */
export async function POST(request: Request) {
  const auth = await authenticateApiToken(request);
  if (!auth) return apiError(401, "Missing or invalid API token.");
  if (isReadOnly(auth)) return apiError(403, "Read-only token.");

  const body = await request.json().catch(() => null);
  const parsed = boardTitleSchema.safeParse((body as { title?: unknown })?.title);
  if (!parsed.success) {
    return apiValidationError(parsed.error.issues[0]);
  }

  const requested = (body as { workspace?: unknown })?.workspace;
  if (requested !== undefined && typeof requested !== "string") {
    return apiError(400, "`workspace` must be a workspace slug.");
  }
  // Same 404 for a workspace that does not exist and one the user is not in.
  const workspace = await prisma.workspace.findFirst({
    where: {
      ...(requested
        ? { slug: requested.toLowerCase(), members: { some: { userId: auth.userId } } }
        : { personalOwnerId: auth.userId }),
      suspendedAt: null,
    },
    select: { id: true, kind: true },
  });
  if (!workspace) return apiError(404, "Workspace not found.");
  // In an organization, creating boards is a permission (app/lib/permissions.ts).
  if (workspace.kind === "ORGANIZATION") {
    const access = await workspaceAccessOf(workspace.id, auth.userId);
    if (!access?.permissions.has("boards.create")) {
      return apiError(403, "Your role in this workspace cannot create boards.");
    }
  }

    const board = await createBoardWithSlug(workspace.id, parsed.data, (slug) =>
    prisma.board.create({
      data: {
        title: parsed.data,
        ownerId: auth.userId,
        workspaceId: workspace.id,
        slug,
        members: { create: { userId: auth.userId, role: "OWNER" } },
      },
      include: { workspace: { select: { slug: true } } },
    }),
  );
  await recordAudit({
    action: "board.created",
    userId: auth.userId,
    targetType: "board",
    targetId: board.id,
    detail: `api: ${board.title}`,
  });
  await emitBoardEvent({ event: "board.created", boardId: board.id, actorId: auth.userId, data: { board: { id: board.id, title: board.title } } });
  revalidatePath("/boards");
  return apiOk(serializeBoardSummary(board), 201);
}
