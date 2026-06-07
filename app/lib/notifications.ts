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
  | "comment.added";

export async function notify(params: {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  boardId?: string;
}): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title.slice(0, 300),
        body: params.body?.slice(0, 500) ?? null,
        boardId: params.boardId ?? null,
      },
    });
    await publishUserEvent(params.userId);
  } catch {
    // Best-effort: una notificación que falla no debe tumbar la mutación principal.
  }
}
