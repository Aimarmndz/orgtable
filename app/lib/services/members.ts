import "server-only";
import { prisma } from "@/app/lib/prisma";

// Expulsar a un miembro de un tablero. Aislado de la Server Action para poder testearlo sin
// sesión. NO autoriza al actor ni protege al propietario: eso lo hace removeBoardMember.
//
// Además de la fila BoardMember se borran sus asignaciones en las tarjetas del tablero: si
// quedaran, el expulsado seguiría recibiendo por la campana el título de las tarjetas y el
// texto de los comentarios (comment.added, due.reminder) de un tablero al que ya no tiene
// acceso. Van en una transacción para no dejar nunca una de las dos mitades.
//
// Devuelve cuántas membresías se borraron (0 si el usuario no era miembro), para que la
// acción no audite ni notifique una expulsión que no ha ocurrido.
export async function removeMemberFromBoard(
  boardId: string,
  userId: string,
): Promise<number> {
  const [removed] = await prisma.$transaction([
    prisma.boardMember.deleteMany({ where: { boardId, userId } }),
    prisma.cardAssignee.deleteMany({
      where: { userId, card: { list: { boardId } } },
    }),
  ]);
  return removed.count;
}
