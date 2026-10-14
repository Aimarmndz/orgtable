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
import { getI18n } from "@/app/i18n/server";
import { fmt } from "@/app/i18n/format";

// Card attachments. Uploading/deleting requires the EDITOR role; downloads are served by the
// route handler app/api/attachments/[id] with its own authorisation. See
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
  const { m } = await getI18n();
  const cardId = String(formData.get("cardId"));
  const boardId = await boardIdForCard(cardId);
  if (!boardId) return { error: m.errors.attachments.cardNotFound };
  const { role } = await requireBoardAccess(boardId);
  if (!canEditBoard(role)) return { error: m.errors.attachments.noPermission };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: m.errors.attachments.noFile };
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return {
      error: fmt(m.errors.attachments.tooLarge, {
        megabytes: MAX_ATTACHMENT_BYTES / (1024 * 1024),
      }),
    };
  }

  const { storedName, size } = await saveAttachmentFile(file);
  try {
    await prisma.attachment.create({
      data: {
        cardId,
        filename: file.name.slice(0, 255) || "file",
        storedName,
        mimeType: (file.type || "application/octet-stream").slice(0, 128),
        size,
      },
    });
  } catch (err) {
    // Without a row there is no way to reach the file (e.g. the card was deleted during the
    // upload): it is deleted so as not to leave an orphan on disk, and the original error is
    // rethrown.
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
