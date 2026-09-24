"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/app/lib/prisma";
import { revalidateBoard } from "@/app/lib/realtime/notify";
import { requireUser, requireBoardAccess } from "@/app/lib/dal";
import { canManageBoard } from "@/app/lib/roles";
import { recordAudit } from "@/app/lib/audit";
import { boardTitleSchema, boardImportSchema } from "@/app/lib/validators";
import { positionAtEnd } from "@/app/lib/ordering";

export async function createBoard(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = boardTitleSchema.safeParse(formData.get("title"));
  if (!parsed.success) return;

  // El creador queda como dueño y, a la vez, como miembro OWNER del tablero (la
  // autorización siempre se comprueba contra board_members).
  const board = await prisma.board.create({
    data: {
      title: parsed.data,
      ownerId: user.id,
      members: { create: { userId: user.id, role: "OWNER" } },
    },
  });
  await recordAudit({
    action: "board.created",
    userId: user.id,
    targetType: "board",
    targetId: board.id,
    detail: board.title,
  });
  revalidatePath("/boards");
  redirect(`/board/${board.id}`);
}

export async function renameBoard(formData: FormData): Promise<void> {
  const boardId = String(formData.get("boardId"));
  const { role } = await requireBoardAccess(boardId);
  if (!canManageBoard(role)) return;
  const parsed = boardTitleSchema.safeParse(formData.get("title"));
  if (!parsed.success) return;

  await prisma.board.update({
    where: { id: boardId },
    data: { title: parsed.data },
  });
  revalidateBoard(boardId);
}

export type ImportState = { error?: string };

/**
 * Importa un tablero desde el JSON que produce GET /api/boards/[id]/export. Crea un
 * tablero NUEVO del que el importador es propietario, regenerando ids y posiciones. No
 * incluye adjuntos (sus binarios no viajan en el export). Ver docs/operations.md.
 */
export async function importBoard(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const user = await requireUser();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Selecciona un archivo JSON." };
  }
  if (file.size > 5 * 1024 * 1024) {
    return { error: "El archivo es demasiado grande (máx. 5 MB)." };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    return { error: "El archivo no es JSON válido." };
  }
  const parsed = boardImportSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: "El archivo no tiene el formato de un tablero de orgtable." };
  }

  const b = parsed.data.board;
  // Colores ya saneados por boardImportSchema: fuera de la paleta → null / "blue".
  const background = b.background ?? null;

  let newBoardId = "";
  await prisma.$transaction(
    async (tx) => {
      const board = await tx.board.create({
        data: {
          title: b.title,
          background,
          ownerId: user.id,
          members: { create: { userId: user.id, role: "OWNER" } },
        },
      });
      newBoardId = board.id;

      // Etiquetas: una por nombre (se ignoran duplicados); color saneado en el esquema.
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

          // Re-vincula etiquetas por nombre (sin duplicar).
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
  redirect(`/board/${newBoardId}`);
}

export async function deleteBoard(formData: FormData): Promise<void> {
  const user = await requireUser();
  const boardId = String(formData.get("boardId"));
  // Solo el dueño puede borrar el tablero (deleteMany no falla si no coincide).
  const { count } = await prisma.board.deleteMany({
    where: { id: boardId, ownerId: user.id },
  });
  if (count > 0) {
    await recordAudit({
      action: "board.deleted",
      userId: user.id,
      targetType: "board",
      targetId: boardId,
    });
  }
  revalidatePath("/boards");
  redirect("/boards");
}
