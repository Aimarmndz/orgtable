"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/app/lib/prisma";
import { revalidateBoard } from "@/app/lib/realtime/notify";
import { requireUser, requireBoardAccess } from "@/app/lib/dal";
import { effectiveBoardRole, holdsPermissionOnBoard, workspaceAccessOf } from "@/app/lib/access";
import { canManageBoard } from "@/app/lib/roles";
import { boardPath } from "@/app/lib/slugs";
import { createBoardWithSlug, freeBoardSlug } from "@/app/lib/services/workspaces";
import { recordAudit } from "@/app/lib/audit";
import { emitBoardEvent } from "@/app/lib/webhooks/dispatch";
import {
  boardTitleSchema,
  boardImportSchema,
  boardVisibilitySchema,
} from "@/app/lib/validators";
import { positionAtEnd } from "@/app/lib/ordering";
import { deleteBoardWithAttachments } from "@/app/lib/services/attachments";
import { getI18n } from "@/app/i18n/server";
import { fmt } from "@/app/i18n/format";

const IMPORT_MAX_MB = 5;

/**
 * The workspace a new board goes to: the one in the form if the user may create boards in
 * it (their own personal one, or an organization where they hold "boards.create"; a
 * suspended workspace takes none), else their personal one. Null if the requested one is
 * not allowed.
 */
async function targetWorkspace(userId: string, requested: FormDataEntryValue | null) {
  const where =
    typeof requested === "string" && requested !== ""
      ? { id: requested, members: { some: { userId } } }
      : { personalOwnerId: userId };
  const workspace = await prisma.workspace.findFirst({
    where: { ...where, suspendedAt: null },
    select: { id: true, slug: true, kind: true },
  });
  if (!workspace) return null;
  if (workspace.kind === "ORGANIZATION") {
    const access = await workspaceAccessOf(workspace.id, userId);
    if (!access?.permissions.has("boards.create")) return null;
  }
  return { id: workspace.id, slug: workspace.slug };
}


export async function createBoard(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = boardTitleSchema.safeParse(formData.get("title"));
  if (!parsed.success) return;
  const workspace = await targetWorkspace(user.id, formData.get("workspaceId"));
  if (!workspace) return;

  // The creator is the owner and, at the same time, an OWNER member of the board.
    const board = await createBoardWithSlug(workspace.id, parsed.data, (slug) =>
    prisma.board.create({
      data: {
        title: parsed.data,
        ownerId: user.id,
        workspaceId: workspace.id,
        slug,
        members: { create: { userId: user.id, role: "OWNER" } },
      },
    }),
  );
  await recordAudit({
    action: "board.created",
    userId: user.id,
    targetType: "board",
    targetId: board.id,
    detail: board.title,
  });
  await emitBoardEvent({ event: "board.created", boardId: board.id, actorId: user.id, data: { board: { id: board.id, title: board.title } } });
  revalidatePath("/boards");
  redirect(boardPath(workspace.slug, board.slug));
}

export async function renameBoard(formData: FormData): Promise<void> {
  const boardId = String(formData.get("boardId"));
  const { role } = await requireBoardAccess(boardId);
  if (!canManageBoard(role)) return;
  const parsed = boardTitleSchema.safeParse(formData.get("title"));
  if (!parsed.success) return;

  // The slug follows the title; the board's id keeps working in URLs and redirects to it.
  const current = await prisma.board.findUnique({
    where: { id: boardId },
    select: { workspaceId: true },
  });
  if (!current) return;
  await prisma.board.update({
    where: { id: boardId },
    data: {
      title: parsed.data,
      slug: await freeBoardSlug(prisma, current.workspaceId, parsed.data, boardId),
    },
  });
  revalidateBoard(boardId);
}

/** Who besides its members sees an organization board: the whole workspace, or nobody. */
export async function setBoardVisibility(formData: FormData): Promise<void> {
  const boardId = String(formData.get("boardId"));
  const { user, role } = await requireBoardAccess(boardId);
  if (!canManageBoard(role) && !(await holdsPermissionOnBoard(boardId, user.id, "boards.visibility"))) return;
  const parsed = boardVisibilitySchema.safeParse(formData.get("visibility"));
  if (!parsed.success) return;
  const { count } = await prisma.board.updateMany({
    where: { id: boardId, visibility: { not: parsed.data } },
    data: { visibility: parsed.data },
  });
  if (count === 0) return;
  await recordAudit({
    action: "board.visibility_changed",
    userId: user.id,
    targetType: "board",
    targetId: boardId,
    detail: parsed.data,
  });
  revalidateBoard(boardId);
}

export type ImportState = { error?: string };

/**
 * Imports a board from the JSON produced by GET /api/boards/[id]/export. Creates a NEW board
 * owned by the importer, regenerating ids and positions. Attachments are not included
 * (their binaries do not travel in the export). See docs/operations.md.
 */
export async function importBoard(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const user = await requireUser();
  const { m } = await getI18n();
  const workspace = await targetWorkspace(user.id, formData.get("workspaceId"));
  if (!workspace) return { error: m.errors.workspaces.forbidden };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: m.errors.boards.importNoFile };
  }
  if (file.size > IMPORT_MAX_MB * 1024 * 1024) {
    return { error: fmt(m.errors.boards.importTooLarge, { megabytes: IMPORT_MAX_MB }) };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    return { error: m.errors.boards.importInvalidJson };
  }
  const parsed = boardImportSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: m.errors.boards.importInvalidFormat };
  }

  const b = parsed.data.board;
  // Colours already sanitised by boardImportSchema: outside the palette → null / "blue".
  const background = b.background ?? null;

  let newBoardId = "";
  let newBoardSlug = "";
  await prisma.$transaction(
    async (tx) => {
      const board = await tx.board.create({
        data: {
          title: b.title,
          background,
          ownerId: user.id,
          workspaceId: workspace.id,
          slug: await freeBoardSlug(tx, workspace.id, b.title),
          members: { create: { userId: user.id, role: "OWNER" } },
        },
      });
      newBoardId = board.id;
      newBoardSlug = board.slug;

      // Labels: one per name (duplicates are ignored); colour sanitised by the schema.
      const labelIdByName = new Map<string, string>();
      for (const lab of b.labels ?? []) {
        if (labelIdByName.has(lab.name)) continue;
        const created = await tx.label.create({
          data: { boardId: board.id, name: lab.name, color: lab.color },
        });
        labelIdByName.set(lab.name, created.id);
      }

      let listPos: string | null = null;
      for (const list of b.lists ?? []) {
        listPos = positionAtEnd(listPos);
        const createdList = await tx.list.create({
          data: { boardId: board.id, title: list.title, position: listPos },
        });

        let cardPos: string | null = null;
        for (const card of list.cards ?? []) {
          cardPos = positionAtEnd(cardPos);
          const due = card.dueDate ? new Date(card.dueDate) : null;
          const createdCard = await tx.card.create({
            data: {
              listId: createdList.id,
              title: card.title,
              description: card.description ?? null,
              position: cardPos,
              dueDate: due && !Number.isNaN(due.getTime()) ? due : null,
            },
          });

          // Re-link labels by name (without duplicates).
          const seenLabels = new Set<string>();
          for (const name of card.labels ?? []) {
            const labelId = labelIdByName.get(name);
            if (!labelId || seenLabels.has(labelId)) continue;
            seenLabels.add(labelId);
            await tx.cardLabel.create({
              data: { cardId: createdCard.id, labelId },
            });
          }

          let clPos: string | null = null;
          for (const cl of card.checklists ?? []) {
            clPos = positionAtEnd(clPos);
            const createdCl = await tx.checklist.create({
              data: {
                cardId: createdCard.id,
                title: cl.title || "Checklist",
                position: clPos,
              },
            });
            let itPos: string | null = null;
            for (const it of cl.items ?? []) {
              itPos = positionAtEnd(itPos);
              await tx.checklistItem.create({
                data: {
                  checklistId: createdCl.id,
                  text: it.text,
                  done: it.done,
                  position: itPos,
                },
              });
            }
          }
        }
      }
    },
    { timeout: 30000 },
  );

  await recordAudit({
    action: "board.created",
    userId: user.id,
    targetType: "board",
    targetId: newBoardId,
    detail: `import: ${b.title}`,
  });
  revalidatePath("/boards");
  redirect(boardPath(workspace.slug, newBoardSlug));
}

export async function deleteBoard(formData: FormData): Promise<void> {
  const user = await requireUser();
  const boardId = String(formData.get("boardId"));
  // Whoever manages the board (its owner, or the owners and admins of its organization:
  // app/lib/access.ts), or someone who can open it and holds "boards.delete" in its
  // organization. Without that nothing happens. The service also deletes the attachment
  // files.
  const role = await effectiveBoardRole(boardId, user.id);
  const allowed =
    role !== null && (canManageBoard(role) || (await holdsPermissionOnBoard(boardId, user.id, "boards.delete")));
  // Read before deleting: the audit event keeps the board's workspace and title.
  const before = allowed
    ? await prisma.board.findUnique({
        where: { id: boardId },
        select: {
          id: true,
          workspaceId: true,
          title: true,
          slug: true,
          visibility: true,
          workspace: { select: { id: true, slug: true, name: true } },
        },
      })
    : null;
  const count = allowed ? await deleteBoardWithAttachments({ id: boardId }) : 0;
  if (count > 0) {
    await recordAudit({
      action: "board.deleted",
      userId: user.id,
      targetType: "board",
      targetId: boardId,
      workspaceId: before?.workspaceId ?? null,
      detail: before?.title,
    });
    if (before) {
      await emitBoardEvent({
        event: "board.deleted",
        boardId,
        actorId: user.id,
        board: before,
        data: { board: { id: before.id, title: before.title } },
      });
    }
    // Tell the board's open tabs (SSE) so that they stop showing it.
    revalidateBoard(boardId);
  }
  revalidatePath("/boards");
  redirect("/boards");
}
