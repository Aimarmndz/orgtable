import "server-only";
import { prisma } from "@/app/lib/prisma";
import { notify } from "@/app/lib/notifications";

// Recordatorios de vencimiento (Hito 11). Genera notificaciones para las tarjetas con
// fecha de vencimiento que vencen en las próximas 24 h o vencieron hace poco, a las
// personas que las tienen asignadas y siguen siendo miembros del tablero. Se invoca desde
// un endpoint cron protegido (app/api/cron/reminders) que dispara un programador externo.
// `now` se inyecta para poder testearlo. Ver docs/reminders.md y
// docs/decisions/0015-reminders-cron.md.
//
// Política de avisos:
//  - «Vence pronto»: como mucho uno al día por tarjeta y persona.
//  - «Tarea vencida»: uno solo en total, y solo si venció en los últimos
//    OVERDUE_WINDOW_DAYS días. Sin ese tope, una tarjeta olvidada avisaría a diario para
//    siempre y la pasada crecería sin límite.
//
// Los días se cuentan en UTC: dueDate es una fecha de calendario («YYYY-MM-DD», que se
// guarda como medianoche UTC), así que usar la zona del servidor desplazaría el día.

const DAY_MS = 24 * 60 * 60 * 1000;
const OVERDUE_WINDOW_DAYS = 7;

// Fecha de calendario: se formatea en UTC para que salga el mismo día que se eligió.
const dueFormatter = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "medium",
  timeZone: "UTC",
});

function utcDayStart(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

export async function generateDueReminders(
  now: Date,
): Promise<{ created: number; scanned: number }> {
  const soon = new Date(now.getTime() + DAY_MS);
  const todayStart = utcDayStart(now);
  const overdueFloor = new Date(
    todayStart.getTime() - OVERDUE_WINDOW_DAYS * DAY_MS,
  );

  // Tarjetas con asignados que vencen hasta dentro de 24 h o vencieron dentro de la ventana.
  const cards = await prisma.card.findMany({
    where: {
      dueDate: { gte: overdueFloor, lte: soon },
      assignees: { some: {} },
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
      list: {
        select: {
          boardId: true,
          board: { select: { members: { select: { userId: true } } } },
        },
      },
      assignees: { select: { userId: true } },
    },
  });

  let created = 0;
  for (const card of cards) {
    if (!card.dueDate) continue;
    const overdue = card.dueDate < todayStart;
    // Pasa a «vencida» al empezar el día siguiente al del vencimiento. Cualquier aviso
    // posterior a ese instante ya es el aviso de vencida.
    const dedupSince = overdue
      ? new Date(utcDayStart(card.dueDate).getTime() + DAY_MS)
      : todayStart;
    // Solo miembros actuales: una asignación huérfana (de alguien expulsado) no debe
    // seguir enviando el título de la tarjeta.
    const memberIds = new Set(card.list.board.members.map((m) => m.userId));
    for (const a of card.assignees) {
      if (!memberIds.has(a.userId)) continue;
      const already = await prisma.notification.findFirst({
        where: {
          userId: a.userId,
          cardId: card.id,
          type: "due.reminder",
          createdAt: { gte: dedupSince },
        },
        select: { id: true },
      });
      if (already) continue;

      const ok = await notify({
        userId: a.userId,
        type: "due.reminder",
        title: overdue
          ? `Tarea vencida: «${card.title}»`
          : `Vence pronto: «${card.title}»`,
        body: `Vencimiento: ${dueFormatter.format(card.dueDate)}.`,
        boardId: card.list.boardId,
        cardId: card.id,
      });
      if (ok) created++;
    }
  }

  return { created, scanned: cards.length };
}
