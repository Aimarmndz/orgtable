# Notifications

In-app notifications tell a person about events that affect them. They appear in the
**bell in the top bar**, with an unread count. The technical decision is in
[ADR 0012](./decisions/0012-notifications.md).

## What is notified

Types defined in `NotificationType` (`app/lib/notifications.ts`):

| Type | When | Link |
|------|------|------|
| `member.added` | You are added to a board | To the board |
| `member.role_changed` | Your role on a board changes | To the board |
| `member.removed` | You are removed from a board | No link (you no longer have access) |
| `card.assigned` | Someone assigns you to a card | To the card |
| `comment.added` | Someone comments on a card you are assigned to | To the card |
| `due.reminder` | A card you are assigned to is due soon or overdue | To the card |

Card collaboration events are described in
[docs/card-collaboration.md](./card-collaboration.md) and due-date reminders in
[docs/reminders.md](./reminders.md).

The text is rendered when the notification is created, in the **recipient's language**
(`User.locale`; English if the account has not chosen one), so rendering needs no
templates. Notifications already stored keep the language they were written in.

## How it works

1. The action that triggers the event (e.g. `addBoardMember` in
   `app/lib/actions/members.ts`) calls **`notify({ userId, type, title, body?, boardId? })`**.
2. `notify()` writes a row in `Notification` and **publishes an event on the bus** on the
   user's channel (`user:<id>`). It is best-effort: if something fails, the main mutation
   is not broken. It returns `true` if the row was saved (even if the live notice fails)
   and `false` otherwise; the failure is logged with `console.error` (type, ids and error
   code, never the title or body). The reminders cron uses that result so it does not
   count notices that do not exist.
3. The recipient's browser keeps an **EventSource** open to `/api/notifications/stream`.
   When it receives the "ping", it calls `router.refresh()`.
4. The layout (`app/(app)/layout.tsx`) queries the notifications and the count again, and
   the **bell** (`app/components/notifications-bell.tsx`) re-renders.

The "ping" carries no content: it only signals that there is something new. Each tab
only reads **its own** notifications (the `WHERE` includes the session's `userId`), so a
notification cannot leak to another person.

## Interaction

- **Opening a notification** marks it as read and, if it has a board or card, navigates
  to it.
- **Mark all as read** marks every notification of the user as read.
- Actions in `app/lib/actions/notifications.ts` (`markNotificationRead`,
  `markAllNotificationsRead`); the `WHERE` always includes the session's `userId`.

## Live delivery and multiple instances

It reuses the real-time bus ([docs/realtime.md](./realtime.md)). In the standard
deployment (a single instance), the per-user channel is an in-process `EventEmitter`.
With several instances, the optional PostgreSQL `LISTEN/NOTIFY` bridge
(`ORGTABLE_REALTIME_PG_NOTIFY=1`) also relays user events, not only board events.

## Limits and possible improvements

- In-app only: if you have no tab open, you will see the notifications the next time you
  sign in. Email or Web Push would fit as another consumer of `notify()`.
- The event catalog is deliberately small; adding a new one means calling `notify()`
  from the action that triggers it.
