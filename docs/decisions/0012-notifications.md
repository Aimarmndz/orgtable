# ADR 0012 — In-app notifications over the pub/sub bus (no email or queue)

**Status:** accepted · **Date:** 2026-06-07 · **Related:** [ADR 0007](./0007-pg-notify-over-redis.md), [ADR 0004](./0004-no-redis-mvp.md)

## Context

The notifications feature adds notifications for events that matter to a person (you
were added to a board, your role changed, you were removed). We need to decide **where
they are delivered** (in-app, email, browser push), **how they are delivered live** and
**how they are stored**.

## Decision

- **In-app only**, for now: a bell in the top bar with an unread counter and a dropdown.
  No email or Web Push.
- **Persistence** in a per-user `Notification` table, with the **text already rendered in
  Spanish** (not a structured payload): the app was single-language at the time, so
  rendering is trivial. `boardId` is a **soft** reference (string without an FK).
- **Live delivery reusing the realtime bus** from the realtime feature
  ([ADR 0007](./0007-pg-notify-over-redis.md)): a **per-user** channel (`user:<id>`) is
  added next to the per-board channel (`board:<id>`). `notify()` writes the row and
  publishes a "ping"; an SSE stream (`/api/notifications/stream`) forwards it and the
  client calls `router.refresh()`.
- **Best-effort**, like the audit log: if creating the notification or publishing fails,
  the mutation that triggered it (adding a member, etc.) is not affected.

## Rationale

- **Zero new infrastructure.** No job queue or email service is added: the pub/sub bus
  already exists and the optional PostgreSQL `LISTEN/NOTIFY` bridge covers the
  multi-instance case without Redis (consistent with ADR 0004/0007).
- **The "ping" carries no data.** Like the board event, it only signals that there is
  something new; the client reloads and the server queries again. That way the content
  does not have to be serialized through the channel and there is no risk of leaks
  between users: each tab only reads ITS OWN notifications (the `WHERE` carries the
  session's `userId`).
- **Pre-rendered text** avoids a templates/i18n layer for a single-language app.

## Consequences

- No notifications outside the app (if you have no tab open, you see them the next time
  you come in). Email/Web Push remain a future evolution; they would fit as one more
  consumer of the same `notify()`.
- The set of events is small and lives in `app/lib/notifications.ts`
  (`NotificationType`). Adding a new event means calling `notify()` from the relevant
  action.
- Documented in [`docs/notifications.md`](../notifications.md); the per-user channel is
  also described in [`docs/realtime.md`](../realtime.md).
