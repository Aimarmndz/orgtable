import "server-only";
import { prisma } from "@/app/lib/prisma";
import { effectiveBoardRole } from "@/app/lib/access";
import { notify } from "@/app/lib/notifications";
import { i18nFor } from "@/app/i18n/server";
import { fmt } from "@/app/i18n/format";

// Due-date reminders. Creates notifications for cards whose due date falls within the next
// 24 h or passed recently, for the people assigned to them who are still board members. It
// is called from a protected cron endpoint (app/api/cron/reminders) triggered by an
// external scheduler. `now` is injected so it can be tested. See docs/reminders.md and
// docs/decisions/0015-reminders-cron.md.
//
// Notification policy:
//  - "Due soon": at most one per day per card and person.
//  - "Overdue": a single one in total, and only if it fell due within the last
//    OVERDUE_WINDOW_DAYS days. Without that cap, a forgotten card would notify every day
//    forever and each run would grow without bound.
//
// Days are counted in UTC: dueDate is a calendar date ("YYYY-MM-DD", stored as midnight
// UTC), so using the server's time zone would shift the day.
//
// Each notification is written in the recipient's language (User.locale).

const DAY_MS = 24 * 60 * 60 * 1000;
const OVERDUE_WINDOW_DAYS = 7;

// Calendar date: formatted in UTC so that it shows the same day that was picked. One
// formatter per language, reused across the run.
const dueFormatters = new Map<string, Intl.DateTimeFormat>();

function formatDueDate(intl: string, date: Date): string {
  let formatter = dueFormatters.get(intl);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(intl, { dateStyle: "medium", timeZone: "UTC" });
    dueFormatters.set(intl, formatter);
  }
  return formatter.format(date);
}

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

  // Cards with assignees due within the next 24 h or that fell due within the window.
  const cards = await prisma.card.findMany({
    where: {
      dueDate: { gte: overdueFloor, lte: soon },
      assignees: { some: {} },
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
      list: { select: { boardId: true } },
      assignees: { select: { userId: true, user: { select: { locale: true } } } },
    },
  });

  let created = 0;
  for (const card of cards) {
    if (!card.dueDate) continue;
    const overdue = card.dueDate < todayStart;
    // It becomes "overdue" when the day after the due date starts. Any notification after
    // that instant is already the overdue one.
    const dedupSince = overdue
      ? new Date(utcDayStart(card.dueDate).getTime() + DAY_MS)
      : todayStart;
    // Only whoever can still open the board (app/lib/access.ts: members of it or of its
    // organization, never a suspended one): an orphan assignment must not keep sending the
    // card's title.
    for (const a of card.assignees) {
      if (!(await effectiveBoardRole(card.list.boardId, a.userId))) continue;
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

      const { m, intl } = i18nFor(a.user.locale);
      const t = m.notifications.dueReminder;
      const ok = await notify({
        userId: a.userId,
        type: "due.reminder",
        title: fmt(overdue ? t.overdueTitle : t.soonTitle, { card: card.title }),
        body: fmt(t.body, { date: formatDueDate(intl, card.dueDate) }),
        boardId: card.list.boardId,
        cardId: card.id,
      });
      if (ok) created++;
    }
  }

  return { created, scanned: cards.length };
}
