import "server-only";
import { prisma } from "@/app/lib/prisma";
import { deleteAttachmentFile } from "@/app/lib/storage";

// Deletes cards, lists and boards TOGETHER with their attachment binaries. The schema's
// onDelete: Cascade removes the Attachment rows but does not touch the disk: without this,
// files the user believes deleted stayed in /data/uploads forever. Shared pattern, inside
// a transaction: lock the parent rows with `FOR UPDATE`, read the storedNames and delete
// in the DB; ONLY after the commit, delete the files. If the transaction fails the disk
// is untouched; if an unlink fails, the row is already gone and deleteAttachmentFile logs
// it without throwing. See docs/attachments.md.
//
// Why the lock: under READ COMMITTED, an upload (uploadAttachment) inserting its row
// between the findMany and the delete would not be in the list read, but the delete would
// wait for its commit and cascade-delete it: orphaned file and a "successful" upload.
// Inserting an Attachment takes FOR KEY SHARE on its Card (and creating a Card or a List
// takes it on its parent), which conflicts with FOR UPDATE. So, with the parents locked,
// an in-flight upload finishes before we read (and its file makes the list), and a later
// one waits, fails on the FK after the delete, and uploadAttachment removes its file.

async function removeFiles(storedNames: string[]): Promise<void> {
  await Promise.allSettled(storedNames.map((name) => deleteAttachmentFile(name)));
}

/** Deletes a card and its attachment files. */
export async function deleteCardWithAttachments(cardId: string): Promise<void> {
  const storedNames = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Card" WHERE id = ${cardId} FOR UPDATE`;
    const rows = await tx.attachment.findMany({
      where: { cardId },
      select: { storedName: true },
    });
    await tx.card.delete({ where: { id: cardId } });
    return rows.map((r) => r.storedName);
  });
  await removeFiles(storedNames);
}

/** Deletes a list (its cards cascade) and their attachment files. */
export async function deleteListWithAttachments(listId: string): Promise<void> {
  const storedNames = await prisma.$transaction(async (tx) => {
    // First the list (blocks new cards), then its cards (blocks uploads).
    await tx.$queryRaw`SELECT 1 FROM "List" WHERE id = ${listId} FOR UPDATE`;
    await tx.$queryRaw`SELECT 1 FROM "Card" WHERE "listId" = ${listId} FOR UPDATE`;
    const rows = await tx.attachment.findMany({
      where: { card: { listId } },
      select: { storedName: true },
    });
    await tx.list.delete({ where: { id: listId } });
    return rows.map((r) => r.storedName);
  });
  await removeFiles(storedNames);
}

/**
 * Deletes a board and its attachment files. `ownerId` restricts the deletion to the owner
 * (used by the Server Action, which does not check the role beforehand); the API has
 * already authorized and passes only the id. Returns how many boards were deleted (0 or 1).
 */
export async function deleteBoardWithAttachments(where: {
  id: string;
  ownerId?: string;
}): Promise<number> {
  const { count, storedNames } = await prisma.$transaction(async (tx) => {
    // Top down: board (blocks new lists), lists (blocks new cards) and cards (blocks
    // uploads). Locks even if the caller turns out not to be the owner: it only lasts for
    // the transaction and deleteMany will delete nothing.
    await tx.$queryRaw`SELECT 1 FROM "Board" WHERE id = ${where.id} FOR UPDATE`;
    await tx.$queryRaw`SELECT 1 FROM "List" WHERE "boardId" = ${where.id} FOR UPDATE`;
    await tx.$queryRaw`
      SELECT 1 FROM "Card" c JOIN "List" l ON l.id = c."listId"
      WHERE l."boardId" = ${where.id} FOR UPDATE OF c`;
    const rows = await tx.attachment.findMany({
      where: { card: { list: { board: where } } },
      select: { storedName: true },
    });
    // The background image is a file too, outside the cascade.
    const image = await tx.board.findFirst({ where, select: { backgroundImageStoredName: true } });
    const deleted = await tx.board.deleteMany({ where });
    return {
      count: deleted.count,
      // If nothing was deleted (not the owner), no file is touched.
      storedNames:
        deleted.count > 0
          ? [...rows.map((r) => r.storedName), ...(image?.backgroundImageStoredName ? [image.backgroundImageStoredName] : [])]
          : [],
    };
  });
  await removeFiles(storedNames);
  return count;
}
