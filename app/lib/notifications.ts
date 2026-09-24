import "server-only";
import { prisma } from "@/app/lib/prisma";
import { publishUserEvent } from "@/app/lib/realtime/bus";

// Notificaciones in-app (Hito 8). `notify` escribe una fila y publica un evento en el
// bus para que la pestaña del destinatario actualice su campana al instante. Igual que
// la auditoría, es best-effort: nunca debe romper la acción que la origina. El texto se
// precalcula en español (la app es monolingüe). Ver docs/notifications.md y el modelo
// Notification en prisma/schema.prisma.

export type NotificationType =
  | "member.added"
  | "member.removed"
  | "member.role_changed"
  | "card.assigned"
  | "comment.added"
  | "due.reminder";

/**
 * Crea la notificación y avisa en vivo. Devuelve true si la fila quedó guardada (aunque
 * falle el aviso en vivo: la campana la verá al recargar) y false si no se pudo crear,
 * para que quien cuente avisos (el cron de recordatorios) no informe de uno inexistente.
 */
export async function notify(params: {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  boardId?: string;
  cardId?: string;
}): Promise<boolean> {
  try {
    await prisma.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title.slice(0, 300),
        body: params.body?.slice(0, 500) ?? null,
        boardId: params.boardId ?? null,
        cardId: params.cardId ?? null,
      },
    });
  } catch (error) {
    // Best-effort: una notificación que falla no debe tumbar la mutación principal. Se
    // registra sin título ni cuerpo, que llevan contenido del usuario.
    console.error("[notify] fallo al crear la notificación", {
      type: params.type,
      userId: params.userId,
      boardId: params.boardId,
      cardId: params.cardId,
      code: errorCode(error),
    });
    return false;
  }
  try {
    await publishUserEvent(params.userId);
  } catch (error) {
    console.error("[notify] fallo al publicar el aviso en vivo", {
      type: params.type,
      userId: params.userId,
      code: errorCode(error),
    });
  }
  return true;
}

// Código de error de Prisma (P2003…) o nombre del error, sin el mensaje completo, que
// puede incluir valores de la consulta.
function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
    if (error instanceof Error) return error.name;
  }
  return "desconocido";
}
