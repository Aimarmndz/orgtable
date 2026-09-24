import "server-only";
import { prisma } from "@/app/lib/prisma";
import { deleteAttachmentFile } from "@/app/lib/storage";

// Borrado de tarjetas, listas y tableros JUNTO con los binarios de sus adjuntos. El
// onDelete: Cascade del esquema borra las filas Attachment, pero no toca el disco: sin
// esto, los ficheros que el usuario cree borrados se quedaban en /data/uploads para
// siempre. Patrón común: leer los storedName y borrar en BD dentro de una transacción
// (lo leído es exactamente lo que se borra) y, SOLO después del commit, borrar los
// ficheros. Si la transacción falla no se toca el disco; si falla un unlink, la fila ya no
// existe y deleteAttachmentFile lo registra sin lanzar. Ver docs/attachments.md.

async function removeFiles(storedNames: string[]): Promise<void> {
  await Promise.allSettled(storedNames.map((name) => deleteAttachmentFile(name)));
}

/** Borra una tarjeta y los ficheros de sus adjuntos. */
export async function deleteCardWithAttachments(cardId: string): Promise<void> {
  const storedNames = await prisma.$transaction(async (tx) => {
    const rows = await tx.attachment.findMany({
      where: { cardId },
      select: { storedName: true },
    });
    await tx.card.delete({ where: { id: cardId } });
    return rows.map((r) => r.storedName);
  });
  await removeFiles(storedNames);
}

/** Borra una lista (sus tarjetas caen en cascada) y los ficheros de sus adjuntos. */
export async function deleteListWithAttachments(listId: string): Promise<void> {
  const storedNames = await prisma.$transaction(async (tx) => {
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
 * Borra un tablero y los ficheros de sus adjuntos. `ownerId` restringe el borrado al
 * dueño (lo usa la Server Action, que no comprueba el rol antes); la API ya autorizó y
 * pasa solo el id. Devuelve cuántos tableros se borraron (0 o 1).
 */
export async function deleteBoardWithAttachments(where: {
  id: string;
  ownerId?: string;
}): Promise<number> {
  const { count, storedNames } = await prisma.$transaction(async (tx) => {
    const rows = await tx.attachment.findMany({
      where: { card: { list: { board: where } } },
      select: { storedName: true },
    });
    const deleted = await tx.board.deleteMany({ where });
    return {
      count: deleted.count,
      // Si no se borró nada (no es el dueño), no se toca ningún fichero.
      storedNames: deleted.count > 0 ? rows.map((r) => r.storedName) : [],
    };
  });
  await removeFiles(storedNames);
  return count;
}
