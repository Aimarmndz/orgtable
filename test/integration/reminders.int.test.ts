import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { generateDueReminders } from "@/app/lib/services/reminders";
import { fmt } from "@/app/i18n/format";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  seedList,
  en,
  es,
} from "./helpers";

const originalTz = process.env.TZ;

beforeEach(async () => {
  await resetDb();
});
afterEach(() => {
  // Some tests change the process time zone; Node applies it as soon as TZ is assigned.
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});
afterAll(async () => {
  await disconnect();
});

const DAY_MS = 24 * 60 * 60 * 1000;

// The dedup compares the notification's REAL createdAt (set by the DB on insert) with the
// day of `now`. That is why each test uses a single real `now` (or one from the same UTC
// day) and derives the dates from it: if it were computed when importing the module, a test
// crossing UTC midnight would mix two days. Fake timers are not used because they do not
// affect that createdAt.
function isoDay(now: Date, offset: number): string {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

async function seedCardDue(
  listId: string,
  title: string,
  dueDate: string | null,
  assigneeId?: string,
) {
  const card = await prisma.card.create({
    data: {
      listId,
      title,
      position: "a0",
      dueDate: dueDate ? new Date(dueDate) : null,
    },
    select: { id: true },
  });
  if (assigneeId) {
    await prisma.cardAssignee.create({
      data: { cardId: card.id, userId: assigneeId },
    });
  }
  return card;
}

async function seedOwnerList() {
  const owner = await seedUser();
  const board = await seedBoard(owner.id);
  const list = await seedList(board.id);
  return { owner, board, list };
}

describe("due-date reminders (integration)", () => {
  it("notifies about assigned cards that are due soon or overdue, and nothing else", async () => {
    const now = new Date();
    const { owner, list } = await seedOwnerList();

    const soon = await seedCardDue(list.id, "Due today", isoDay(now, 0), owner.id);
    const overdue = await seedCardDue(
      list.id,
      "Overdue",
      isoDay(now, -2),
      owner.id,
    );
    await seedCardDue(list.id, "Future", isoDay(now, 10), owner.id); // outside the window
    await seedCardDue(list.id, "Unassigned", isoDay(now, 0)); // no assignee
    await seedCardDue(list.id, "No date", null, owner.id); // no due date

    const result = await generateDueReminders(now);
    expect(result.created).toBe(2);

    const notes = await prisma.notification.findMany({
      where: { userId: owner.id, type: "due.reminder" },
    });
    expect(notes).toHaveLength(2);
    expect(notes.map((n) => n.cardId).sort()).toEqual(
      [soon.id, overdue.id].sort(),
    );
    expect(notes.map((n) => n.title).sort()).toEqual(
      [
        fmt(en.notifications.dueReminder.overdueTitle, { card: "Overdue" }),
        fmt(en.notifications.dueReminder.soonTitle, { card: "Due today" }),
      ].sort(),
    );
  });

  it("is idempotent within the same day (does not duplicate the reminder)", async () => {
    const now = new Date();
    const { owner, list } = await seedOwnerList();
    await seedCardDue(list.id, "Due today", isoDay(now, 0), owner.id);

    const first = await generateDueReminders(now);
    expect(first.created).toBe(1);

    const second = await generateDueReminders(now);
    expect(second.created).toBe(0);
    expect(
      await prisma.notification.count({ where: { type: "due.reminder" } }),
    ).toBe(1);
  });

  it("counts the day in UTC even if the server is in another time zone", async () => {
    const real = new Date();
    // 15:00 UTC today: in New York it is still the same day, but its local midnight
    // (04:00/05:00 UTC) is later than the UTC midnight dueDate is stored at.
    const now = new Date(
      Date.UTC(real.getUTCFullYear(), real.getUTCMonth(), real.getUTCDate(), 15),
    );
    process.env.TZ = "America/New_York";
    const { owner, list } = await seedOwnerList();
    const today = isoDay(now, 0);
    await seedCardDue(list.id, "Due today", today, owner.id);

    const result = await generateDueReminders(now);
    expect(result.created).toBe(1);

    const note = await prisma.notification.findFirstOrThrow({
      where: { type: "due.reminder" },
    });
    expect(note.title).toBe(fmt(en.notifications.dueReminder.soonTitle, { card: "Due today" }));
    const expectedDay = new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(today));
    expect(note.body).toBe(fmt(en.notifications.dueReminder.body, { date: expectedDay }));
  });

  it("notifies about an overdue card only once, not every day", async () => {
    const now = new Date();
    const { owner, list } = await seedOwnerList();
    await seedCardDue(list.id, "Overdue", isoDay(now, -2), owner.id);

    expect((await generateDueReminders(now)).created).toBe(1);
    // The next day it is still overdue, but the reminder was already sent after it fell due.
    const tomorrow = new Date(now.getTime() + DAY_MS);
    const next = await generateDueReminders(tomorrow);
    expect(next).toEqual({ created: 0, scanned: 1 });
  });

  it("does not repeat the overdue reminder if one was already sent after the due date", async () => {
    const now = new Date();
    const { owner, board, list } = await seedOwnerList();
    const card = await seedCardDue(list.id, "Overdue", isoDay(now, -3), owner.id);
    // Reminder sent yesterday, with the card already overdue.
    await prisma.notification.create({
      data: {
        userId: owner.id,
        type: "due.reminder",
        title: fmt(en.notifications.dueReminder.overdueTitle, { card: "Overdue" }),
        boardId: board.id,
        cardId: card.id,
        createdAt: new Date(now.getTime() - DAY_MS),
      },
    });

    expect(await generateDueReminders(now)).toEqual({ created: 0, scanned: 1 });
  });

  it("ignores cards that fell due more than 7 days ago", async () => {
    const now = new Date();
    const { owner, list } = await seedOwnerList();
    await seedCardDue(list.id, "Forgotten", isoDay(now, -8), owner.id);
    await seedCardDue(list.id, "Recent", isoDay(now, -7), owner.id);

    expect(await generateDueReminders(now)).toEqual({ created: 1, scanned: 1 });
  });

  it("does not notify an assignee who is no longer a board member", async () => {
    const now = new Date();
    const { list } = await seedOwnerList();
    const expelled = await seedUser();
    // Orphan assignment: like the ones removal from the board used to leave behind.
    await seedCardDue(list.id, "Due today", isoDay(now, 0), expelled.id);

    expect(await generateDueReminders(now)).toEqual({ created: 0, scanned: 1 });
    expect(
      await prisma.notification.count({ where: { userId: expelled.id } }),
    ).toBe(0);
  });

  it("writes each reminder in the assignee's language, with that language's date format", async () => {
    const now = new Date();
    const { owner, board, list } = await seedOwnerList();
    const spanish = await seedUser();
    await prisma.user.update({ where: { id: spanish.id }, data: { locale: "es" } });
    await prisma.boardMember.create({
      data: { boardId: board.id, userId: spanish.id, role: "EDITOR" },
    });
    const today = isoDay(now, 0);
    const card = await seedCardDue(list.id, "Due today", today, owner.id);
    await prisma.cardAssignee.create({ data: { cardId: card.id, userId: spanish.id } });

    expect((await generateDueReminders(now)).created).toBe(2);

    const day = (intl: string) =>
      new Intl.DateTimeFormat(intl, { dateStyle: "medium", timeZone: "UTC" }).format(
        new Date(today),
      );
    const toSpanish = await prisma.notification.findFirstOrThrow({
      where: { userId: spanish.id },
    });
    const toOwner = await prisma.notification.findFirstOrThrow({
      where: { userId: owner.id },
    });
    expect(toSpanish.title).toBe(fmt(es.notifications.dueReminder.soonTitle, { card: "Due today" }));
    expect(toSpanish.body).toBe(fmt(es.notifications.dueReminder.body, { date: day("es-ES") }));
    expect(toOwner.title).toBe(fmt(en.notifications.dueReminder.soonTitle, { card: "Due today" }));
    expect(toOwner.body).toBe(fmt(en.notifications.dueReminder.body, { date: day("en") }));
  });
});
