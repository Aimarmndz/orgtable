import "server-only";
import { prisma } from "@/app/lib/prisma";
import { publishUserEvent } from "@/app/lib/realtime/bus";
import { i18nFor, type I18n } from "@/app/i18n/server";

// In-app notifications. `notify` writes a row and publishes an event on the bus so that the
// recipient's tab updates its bell at once. Like the audit log, it is best-effort: it must
// never break the action that triggers it. See docs/notifications.md and the Notification
// model in prisma/schema.prisma.
//
// The text is rendered when the notification is created, in the RECIPIENT's language
// (User.locale, English when unset), with the templates in locales/<lang>/notifications.json.
// It is stored as text: if the person changes language later, existing notifications keep
// the language they were written in.

export type NotificationType =
  | "member.added"
  | "member.removed"
  | "member.role_changed"
  | "card.assigned"
  | "comment.added"
  | "due.reminder";

/**
 * Messages in the language of the person a notification is for. Callers that already
 * loaded the user's `locale` use i18nFor(locale) directly and skip this query.
 */
export async function recipientI18n(userId: string): Promise<I18n> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { locale: true },
  });
  return i18nFor(user?.locale);
}

/**
 * Creates the notification and sends the live update. Returns true if the row was stored
 * (even if the live update fails: the bell will see it on reload) and false if it could not
 * be created, so that whoever counts notifications (the reminders cron) does not report one
 * that does not exist.
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
    // Best-effort: a failed notification must not bring down the main mutation. Logged
    // without title or body, which carry user content.
    console.error("[notify] could not create the notification", {
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
    console.error("[notify] could not publish the live update", {
      type: params.type,
      userId: params.userId,
      code: errorCode(error),
    });
  }
  return true;
}

// Prisma error code (P2003…) or error name, without the full message, which may include
// values from the query.
function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
    if (error instanceof Error) return error.name;
  }
  return "unknown";
}
