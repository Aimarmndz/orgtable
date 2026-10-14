# ADR 0015 — Reminders through an external cron endpoint (no in-process scheduler)

**Status:** accepted · **Date:** 2026-06-07 · **Related:** [ADR 0004](./0004-no-redis-mvp.md), [ADR 0012](./0012-notifications.md)

> **Amended on 2026-09-24:** the reminder policy (day counted in UTC, a single overdue
> reminder and a 7-day window) replaces the "once per day idempotency" described below.
> See [`docs/reminders.md`](../reminders.md) and [`docs/DECISIONES.md`](../DECISIONES.md).

## Context

The reminders feature adds **due-date reminders**: notifying a card's assignees when it is
due soon or already overdue. That requires running work **periodically**.

## Decision

- An **endpoint** `POST /api/cron/reminders` that runs the reminder pass, **triggered by an
  external scheduler** (system cron, a sidecar in `docker compose`, a GitHub Actions
  `schedule`, the platform's cron...), not a timer inside the app process.
- It is protected with a **shared secret** in `Authorization: Bearer <CRON_SECRET>`,
  compared in **constant time** (`crypto.timingSafeEqual`). If `CRON_SECRET` is not set,
  the endpoint answers `503` (disabled).
- The logic lives in a **testable service** (`generateDueReminders(now)`), with `now`
  injected. It is **idempotent per day**: it does not repeat the reminder for the same
  card to the same person on the same day (dedup by
  `(userId, cardId, type, createdAt >= start-of-today)`, using the soft reference
  `Notification.cardId`).

## Rationale

- **Zero new infrastructure** (consistent with ADR 0004): we do not add a job queue or a
  scheduler process. A self-hosted app usually has cron available already.
- **No in-process state**: a `setInterval` timer does not survive restarts nor coordinate
  across replicas; an endpoint triggered from outside is trivial to operate and to make
  idempotent.
- **Reuses `notify()`** ([ADR 0012](./0012-notifications.md)): reminders are one more
  emitter of in-app notifications; if email/Web Push is added in the future, they will
  travel the same path.

## Consequences

- An external cron has to be configured (documented in `docs/reminders.md`); if it is not
  configured, there are simply no reminders (the rest of the app is not affected).
- The frequency is decided by whoever operates the instance (e.g. once a day). The daily
  dedup avoids spam even if it is invoked several times.
- **Email and per-user preferences** are left as an extension (backlog): they fit as
  another consumer of `notify()` plus a preferences model, without changing this design.
- Documented in [`docs/reminders.md`](../reminders.md).
