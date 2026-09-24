import "server-only";
import { prisma } from "@/app/lib/prisma";

/**
 * ¿La etiqueta pertenece a este tablero? toggleCardLabel autoriza por el tablero de la
 * TARJETA; sin esta comprobación, un editor de A podría vincular una etiqueta de B (con
 * solo conocer su id) y exponer su nombre y color a los miembros de A y en el export.
 * Aislado aquí para poder testearlo. Un id inexistente también da false.
 */
export async function labelBelongsToBoard(
  labelId: string,
  boardId: string,
): Promise<boolean> {
  const label = await prisma.label.findFirst({
    where: { id: labelId, boardId },
    select: { id: true },
  });
  return label !== null;
}
