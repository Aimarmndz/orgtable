"use server";

import { prisma } from "@/app/lib/prisma";
import { requireUser } from "@/app/lib/dal";

// Acciones sobre las notificaciones propias (Hito 8). La autorización es implícita: el
// WHERE siempre incluye `userId` del usuario en sesión, así que nadie puede marcar como
// leídas las de otra persona. Ver docs/notifications.md.

/** Marca una notificación propia como leída. */
export async function markNotificationRead(id: string): Promise<void> {
  const user = await requireUser();
  await prisma.notification.updateMany({
    where: { id, userId: user.id },
    data: { read: true },
  });
}

/** Marca todas las notificaciones propias como leídas. */
export async function markAllNotificationsRead(): Promise<void> {
  const user = await requireUser();
  await prisma.notification.updateMany({
    where: { userId: user.id, read: false },
    data: { read: true },
  });
}
