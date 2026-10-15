import { revalidatePath } from "next/cache";
import { prisma } from "@/app/lib/prisma";
import { getBoardWithLists } from "@/app/lib/queries";
import { revalidateBoard } from "@/app/lib/realtime/notify";
import { canManageBoard } from "@/app/lib/roles";
import { holdsPermissionOnBoard } from "@/app/lib/access";
import { recordAudit } from "@/app/lib/audit";
import { boardTitleSchema } from "@/app/lib/validators";
import { deleteBoardWithAttachments } from "@/app/lib/services/attachments";
import { freeBoardSlug } from "@/app/lib/services/workspaces";
import { authenticateApiToken, apiBoardRole, isReadOnly } from "@/app/lib/api/auth";
import { apiError, apiOk, apiValidationError } from "@/app/lib/api/respond";
import {
  serializeBoardFull,
  serializeBoardSummary,
} from "@/app/lib/api/serialize";

// Public API v1: a single board. See docs/api/public-api.md.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/boards/:id: the board with its lists and cards. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiToken(request);
  if (!auth) return apiError(401, "Missing or invalid API token.");
  const { id } = await params;

  // getBoardWithLists already scopes by access (owner or member); null = no access.
  const board = await getBoardWithLists(id, auth.userId);
  if (!board) return apiError(404, "Board not found.");
  return apiOk(serializeBoardFull(board));
}

/** PATCH /api/v1/boards/:id: renames the board (owner only). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiToken(request);
  if (!auth) return apiError(401, "Missing or invalid API token.");
  if (isReadOnly(auth)) return apiError(403, "Read-only token.");
  const { id } = await params;

  const role = await apiBoardRole(auth.userId, id);
  if (!role) return apiError(404, "Board not found.");
  if (!canManageBoard(role)) {
    return apiError(403, "You need to be the board owner.");
  }

  const body = await request.json().catch(() => null);
  const parsed = boardTitleSchema.safeParse((body as { title?: unknown })?.title);
  if (!parsed.success) {
    return apiValidationError(parsed.error.issues[0]);
  }

  const current = await prisma.board.findUniqueOrThrow({
    where: { id },
    select: { workspaceId: true },
  });
  const board = await prisma.board.update({
    where: { id },
    data: {
      title: parsed.data,
      slug: await freeBoardSlug(prisma, current.workspaceId, parsed.data, id),
    },
    include: { workspace: { select: { slug: true } } },
  });
  revalidateBoard(id);
  return apiOk(serializeBoardSummary(board));
}

/** DELETE /api/v1/boards/:id: deletes the board (owner only). */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiToken(request);
  if (!auth) return apiError(401, "Missing or invalid API token.");
  if (isReadOnly(auth)) return apiError(403, "Read-only token.");
  const { id } = await params;

  const role = await apiBoardRole(auth.userId, id);
  if (!role) return apiError(404, "Board not found.");
  if (!canManageBoard(role) && !(await holdsPermissionOnBoard(id, auth.userId, "boards.delete"))) {
    return apiError(403, "You need to be the board owner.");
  }

  const before = await prisma.board.findUnique({ where: { id }, select: { workspaceId: true, title: true } });
  await deleteBoardWithAttachments({ id });
  await recordAudit({
    action: "board.deleted",
    userId: auth.userId,
    targetType: "board",
    targetId: id,
    workspaceId: before?.workspaceId ?? null,
    detail: `api: ${before?.title ?? ""}`,
  });
  revalidatePath("/boards");
  // Tells the board's open tabs (SSE), like the Server Action does.
  revalidateBoard(id);
  return apiOk({ deleted: true });
}
