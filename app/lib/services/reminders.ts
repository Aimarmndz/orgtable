import "server-only";
import { prisma } from "@/app/lib/prisma";
import { notify } from "@/app/lib/notifications";

// Recordatorios de vencimiento (Hito 11). Genera notificaciones para las tarjetas con
// fecha de vencimiento que están vencidas o vencen en las próximas 24 h, a las personas
// que las tienen asignadas. Idempotente por día: no repite el aviso de la misma tarjeta a
// la misma persona dos veces el mismo día. Se invoca desde un endpoint cron protegido
// (app/api/cron/reminders) que dispara un programador externo. `now` se inyecta para poder
// testearlo. Ver docs/reminders.md y docs/decisions/0015-reminders-cron.md.

const DAY_MS = 24 * 60 * 60 * 1000;

function formatDue(d: Date): string {
  return new Intl.DateTimeFormat("es", { dateStyle: "medium" }).format(d);
}

export async function generateDueReminders(
  now: Date,
): Promise<{ created: number; scanned: number }> {
  const soon = new Date(now.getTime() + DAY_MS);
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );

  // Tarjetas con vencimiento hasta dentro de 24 h (incluye vencidas) y con asignados.
  const cards = await prisma.card.findMany({
    where: {
      dueDate: { not: null, lte: soon },
      assignees: { some: {} },
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
      list: { select: { boardId: true } },
      assignees: { select: { userId: true } },
    },
  });

  let created = 0;
  for (const card of cards) {
    if (!card.dueDate) continue;
    const overdue = card.dueDate < todayStart;
    for (const a of card.assignees) {
      // Dedup diario: ¿ya se avisó hoy de esta tarjeta a esta persona?
      const already = await prisma.notification.findFirst({
        where: {
          userId: a.userId,
          cardId: card.id,
          type: "due.reminder",
          createdAt: { gte: todayStart },
        },
        select: { id: true },
      });
      if (already) continue;

      await notify({
        userId: a.userId,
        type: "due.reminder",
        title: overdue
          ? `Tarea vencida: «${card.title}»`
          : `Vence pronto: «${card.title}»`,
        body: `Vencimiento: ${formatDue(card.dueDate)}.`,
        boardId: card.list.boardId,
        cardId: card.id,
      });
      created++;
    }
  }

  return { created, scanned: cards.length };
}
