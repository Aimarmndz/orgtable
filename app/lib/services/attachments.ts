import "server-only";
import { prisma } from "@/app/lib/prisma";
import { deleteAttachmentFile } from "@/app/lib/storage";

// Borrado de tarjetas, listas y tableros JUNTO con los binarios de sus adjuntos. El
// onDelete: Cascade del esquema borra las filas Attachment, pero no toca el disco: sin
// esto, los ficheros que el usuario cree borrados se quedaban en /data/uploads para
// siempre. Patrón común, dentro de una transacción: bloquear con `FOR UPDATE` las filas
// padre, leer los storedName y borrar en BD; SOLO después del commit, borrar los ficheros.
// Si la transacción falla no se toca el disco; si falla un unlink, la fila ya no existe y
// deleteAttachmentFile lo registra sin lanzar. Ver docs/attachments.md.
//
// Por qué el bloqueo: en READ COMMITTED, una subida (uploadAttachment) que insertara su
// fila entre el findMany y el delete no estaría en la lista leída, pero el delete
// esperaría a su commit y la borraría en cascada: fichero huérfano y subida «correcta».
// Insertar un Attachment toma FOR KEY SHARE sobre su Card (y crear una Card o una List
// lo toma sobre su padre), que choca con FOR UPDATE. Así, con los padres bloqueados, una
// subida en curso termina antes de que leamos (y su fichero entra en la lista), y una
// posterior espera, falla por la FK tras el borrado y uploadAttachment borra su fichero.

async function removeFiles(storedNames: string[]): Promise<void> {
  await Promise.allSettled(storedNames.map((name) => deleteAttachmentFile(name)));
}

/** Borra una tarjeta y los ficheros de sus adjuntos. */
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

/** Borra una lista (sus tarjetas caen en cascada) y los ficheros de sus adjuntos. */
export async function deleteListWithAttachments(listId: string): Promise<void> {
  const storedNames = await prisma.$transaction(async (tx) => {
    // Primero la lista (frena altas de tarjetas) y luego sus tarjetas (frena subidas).
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
 * Borra un tablero y los ficheros de sus adjuntos. `ownerId` restringe el borrado al
 * dueño (lo usa la Server Action, que no comprueba el rol antes); la API ya autorizó y
 * pasa solo el id. Devuelve cuántos tableros se borraron (0 o 1).
 */
export async function deleteBoardWithAttachments(where: {
  id: string;
  ownerId?: string;
}): Promise<number> {
  const { count, storedNames } = await prisma.$transaction(async (tx) => {
    // De arriba abajo: tablero (frena altas de listas), listas (frena altas de tarjetas)
    // y tarjetas (frena subidas). Se bloquea aunque luego no sea el dueño: solo dura la
    // transacción y deleteMany no borrará nada.
    await tx.$queryRaw`SELECT 1 FROM "Board" WHERE id = ${where.id} FOR UPDATE`;
    await tx.$queryRaw`SELECT 1 FROM "List" WHERE "boardId" = ${where.id} FOR UPDATE`;
    await tx.$queryRaw`
      SELECT 1 FROM "Card" c JOIN "List" l ON l.id = c."listId"
      WHERE l."boardId" = ${where.id} FOR UPDATE OF c`;
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
