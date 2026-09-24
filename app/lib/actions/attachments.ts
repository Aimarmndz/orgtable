"use server";

import { prisma } from "@/app/lib/prisma";
import { requireBoardAccess } from "@/app/lib/dal";
import { canEditBoard } from "@/app/lib/roles";
import { revalidateBoard } from "@/app/lib/realtime/notify";
import {
  saveAttachmentFile,
  deleteAttachmentFile,
  MAX_ATTACHMENT_BYTES,
} from "@/app/lib/storage";

// Adjuntos de tarjeta (Hito 5). Subir/borrar requiere rol EDITOR; la descarga la sirve
// el route handler app/api/attachments/[id] con su propia autorización. Ver
// docs/attachments.md.

export type AttachmentState = { error?: string };

async function boardIdForCard(cardId: string): Promise<string | null> {
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { list: { select: { boardId: true } } },
  });
  return card?.list.boardId ?? null;
}

export async function uploadAttachment(
  _prev: AttachmentState,
  formData: FormData,
): Promise<AttachmentState> {
  const cardId = String(formData.get("cardId"));
  const boardId = await boardIdForCard(cardId);
  if (!boardId) return { error: "Tarjeta no encontrada." };
  const { role } = await requireBoardAccess(boardId);
  if (!canEditBoard(role)) return { error: "No tienes permiso para adjuntar." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Selecciona un archivo." };
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return { error: "El archivo supera el límite de 10 MB." };
  }

  const { storedName, size } = await saveAttachmentFile(file);
  try {
    await prisma.attachment.create({
      data: {
        cardId,
        filename: file.name.slice(0, 255) || "archivo",
        storedName,
        mimeType: (file.type || "application/octet-stream").slice(0, 128),
        size,
      },
    });
  } catch (err) {
    // Sin fila no hay forma de llegar al fichero (p. ej. la tarjeta se borró mientras se
    // subía): se borra para no dejar un huérfano en disco y se relanza el error original.
    await deleteAttachmentFile(storedName);
    throw err;
  }
  revalidateBoard(boardId);
  return {};
}

export async function deleteAttachment(formData: FormData): Promise<void> {
  const attachmentId = String(formData.get("attachmentId"));
  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    select: {
      storedName: true,
      card: { select: { list: { select: { boardId: true } } } },
    },
  });
  if (!attachment) return;
  const boardId = attachment.card.list.boardId;
  const { role } = await requireBoardAccess(boardId);
  if (!canEditBoard(role)) return;

  await prisma.attachment.delete({ where: { id: attachmentId } });
  await deleteAttachmentFile(attachment.storedName);
  revalidateBoard(boardId);
}
