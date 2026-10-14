"use server";

import { refresh } from "next/cache";
import { prisma } from "@/app/lib/prisma";
import { requireUser } from "@/app/lib/dal";

// Actions on one's own notifications. Authorisation is implicit: the WHERE always includes
// the signed-in user's `userId`, so nobody can mark someone else's as read. See
// docs/notifications.md.
//
// Both call refresh(): the counter lives in the shared layout and, without refreshing the
// router from the server, it is not repainted when navigating to a board after marking.

/** Marks one of one's own notifications as read. */
export async function markNotificationRead(id: string): Promise<void> {
  const user = await requireUser();
  await prisma.notification.updateMany({
    where: { id, userId: user.id },
    data: { read: true },
  });
  refresh();
}

/** Marks all of one's own notifications as read. */
export async function markAllNotificationsRead(): Promise<void> {
  const user = await requireUser();
  await prisma.notification.updateMany({
    where: { userId: user.id, read: false },
    data: { read: true },
  });
  refresh();
}
