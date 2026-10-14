import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { cookies } from "next/headers";
import { prisma } from "@/app/lib/prisma";
import { notify, recipientI18n } from "@/app/lib/notifications";
import {
  addBoardMember,
  removeBoardMember,
  updateBoardMemberRole,
} from "@/app/lib/actions/members";
import { addComment } from "@/app/lib/actions/comments";
import { fmt } from "@/app/i18n/format";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  seedList,
  seedCard,
  addMember,
  loginAs,
  en,
  es,
} from "./helpers";

beforeEach(async () => {
  await resetDb();
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await disconnect();
});

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function setUserLocale(userId: string, locale: string | null): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { locale } });
}

async function notificationsOf(userId: string) {
  return prisma.notification.findMany({
    where: { userId },
    select: { type: true, title: true, body: true },
  });
}

describe("notify (integration)", () => {
  it("returns true and stores the row when the notification is created", async () => {
    const user = await seedUser();

    const ok = await notify({
      userId: user.id,
      type: "member.added",
      title: "You were added",
    });

    expect(ok).toBe(true);
    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(1);
  });

  it("returns false and logs the failure without the text if the insert fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    // A userId that does not exist: the foreign key makes the insert fail.
    const ok = await notify({
      userId: "does-not-exist",
      type: "comment.added",
      title: "Private title",
      body: "Private body",
    });

    expect(ok).toBe(false);
    expect(await prisma.notification.count()).toBe(0);
    expect(logged).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(logged.mock.calls[0]);
    expect(serialized).toContain("does-not-exist");
    expect(serialized).not.toContain("Private");
  });
});

// Notifications are rendered when created, in the RECIPIENT's language (User.locale,
// English when unset); the message returned to the form is in the ACTOR's language.
describe("notification language (integration)", () => {
  it("recipientI18n uses User.locale and falls back to English", async () => {
    const spanish = await seedUser();
    const unset = await seedUser();
    const unknown = await seedUser();
    await setUserLocale(spanish.id, "es");
    await setUserLocale(unknown.id, "xx");

    expect((await recipientI18n(spanish.id)).locale).toBe("es");
    expect((await recipientI18n(unset.id)).locale).toBe("en");
    expect((await recipientI18n(unknown.id)).locale).toBe("en");
    expect((await recipientI18n("does-not-exist")).locale).toBe("en");
  });

  it("an invitation for a user with locale “es” is written in Spanish", async () => {
    const owner = await seedUser();
    const guest = await seedUser();
    await setUserLocale(guest.id, "es");
    const board = await seedBoard(owner.id, "Roadmap");
    await loginAs(owner.id);

    const state = await addBoardMember(
      {},
      form({ boardId: board.id, email: guest.email, role: "EDITOR" }),
    );

    // The actor has no language preference: the form answer is in English.
    expect(state.message).toBe(
      fmt(en.errors.members.added, { name: "Test user", role: en.notifications.roles.EDITOR }),
    );
    expect(await notificationsOf(guest.id)).toEqual([
      {
        type: "member.added",
        title: fmt(es.notifications.memberAdded.title, { board: "Roadmap" }),
        body: fmt(es.notifications.memberAdded.body, { role: es.notifications.roles.EDITOR }),
      },
    ]);
  });

  it("an invitation for a user with locale null is written in English", async () => {
    const owner = await seedUser();
    const guest = await seedUser();
    const board = await seedBoard(owner.id, "Roadmap");
    await loginAs(owner.id);

    await addBoardMember({}, form({ boardId: board.id, email: guest.email, role: "VIEWER" }));

    expect(await notificationsOf(guest.id)).toEqual([
      {
        type: "member.added",
        title: fmt(en.notifications.memberAdded.title, { board: "Roadmap" }),
        body: fmt(en.notifications.memberAdded.body, { role: en.notifications.roles.VIEWER }),
      },
    ]);
  });

  it("an actor browsing in Spanish gets a Spanish answer, the recipient still gets English", async () => {
    const owner = await seedUser();
    const guest = await seedUser();
    const board = await seedBoard(owner.id, "Roadmap");
    await loginAs(owner.id);
    (await cookies()).set("locale", "es");

    const state = await addBoardMember(
      {},
      form({ boardId: board.id, email: guest.email, role: "EDITOR" }),
    );

    expect(state.message).toBe(
      fmt(es.errors.members.added, { name: "Test user", role: es.notifications.roles.EDITOR }),
    );
    const [note] = await notificationsOf(guest.id);
    expect(note?.title).toBe(fmt(en.notifications.memberAdded.title, { board: "Roadmap" }));
  });

  it("role change and removal follow each recipient's language", async () => {
    const owner = await seedUser();
    const spanish = await seedUser();
    const english = await seedUser();
    await setUserLocale(spanish.id, "es");
    const board = await seedBoard(owner.id, "Roadmap");
    await addMember(board.id, spanish.id, "EDITOR");
    await addMember(board.id, english.id, "EDITOR");
    await loginAs(owner.id);

    for (const userId of [spanish.id, english.id]) {
      await updateBoardMemberRole(form({ boardId: board.id, userId, role: "VIEWER" }));
      await removeBoardMember(form({ boardId: board.id, userId }));
    }

    const byType = async (userId: string, type: string) =>
      (await notificationsOf(userId)).find((n) => n.type === type);

    expect(await byType(spanish.id, "member.role_changed")).toEqual({
      type: "member.role_changed",
      title: fmt(es.notifications.memberRoleChanged.title, { board: "Roadmap" }),
      body: fmt(es.notifications.memberRoleChanged.body, { role: es.notifications.roles.VIEWER }),
    });
    expect((await byType(spanish.id, "member.removed"))?.title).toBe(
      fmt(es.notifications.memberRemoved.title, { board: "Roadmap" }),
    );
    expect(await byType(english.id, "member.role_changed")).toEqual({
      type: "member.role_changed",
      title: fmt(en.notifications.memberRoleChanged.title, { board: "Roadmap" }),
      body: fmt(en.notifications.memberRoleChanged.body, { role: en.notifications.roles.VIEWER }),
    });
    expect((await byType(english.id, "member.removed"))?.title).toBe(
      fmt(en.notifications.memberRemoved.title, { board: "Roadmap" }),
    );
  });

  it("comment.added is written in each assignee's language", async () => {
    const owner = await seedUser();
    const spanish = await seedUser();
    const english = await seedUser();
    await setUserLocale(spanish.id, "es");
    const board = await seedBoard(owner.id);
    await addMember(board.id, spanish.id, "EDITOR");
    await addMember(board.id, english.id, "EDITOR");
    const card = await seedCard((await seedList(board.id)).id, "Launch");
    await prisma.cardAssignee.createMany({
      data: [
        { cardId: card.id, userId: spanish.id },
        { cardId: card.id, userId: english.id },
      ],
    });
    await loginAs(owner.id);

    await addComment(form({ cardId: card.id, text: "Ready" }));

    const [toSpanish] = await notificationsOf(spanish.id);
    const [toEnglish] = await notificationsOf(english.id);
    expect(toSpanish?.title).toBe(fmt(es.notifications.commentAdded.title, { card: "Launch" }));
    expect(toEnglish?.title).toBe(fmt(en.notifications.commentAdded.title, { card: "Launch" }));
    expect(toSpanish?.title).not.toBe(toEnglish?.title);
  });
});
