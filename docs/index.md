# orgtable documentation

orgtable is an open-source (AGPL-3.0-or-later), self-hosted Kanban board app, a Trello
alternative, built with Next.js 16, Prisma 7 and PostgreSQL.

This documentation is for both people who want to **self-host** the app and people who
want to **contribute** to the code.

## Self-hosting

- [**Installation**](./installation.md) — the one-command installer and the manual installation.
- [**Setup wizard**](./setup-wizard.md) — what happens on first start.
- [**Self-hosting**](./self-hosting.md) — running in production: backups, updates, reverse proxy and TLS.
- [**Privacy, open sign-up and GDPR**](./privacy.md) — your instance's legal details, retention periods, user rights and the checklist for opening a public instance.

## Contributing

- [**Architecture**](./architecture.md) — system overview and code structure.
- [**Database**](./database.md) — the schema, Prisma 7 and the ordering strategy.
- [**Authentication**](./authentication.md) — JWT sessions, the DAL and route protection.
- [**Authorization and roles**](./authorization.md) — board roles, permissions and where they are enforced.
- [**Administration**](./admin.md) — users, instance settings (sign-up and legal details) and the audit log.
- [**Operations**](./operations.md) — rate limiting, audit log, backups, updates and scheduled tasks.
- [**Security (posture and audit)**](./security.md) — threat model, findings and controls.
- [**Drag and drop**](./drag-and-drop.md) — `@dnd-kit` and fractional indexing.
- [**Real time**](./realtime.md) — live sync with SSE and the pub/sub bus.
- [**Notifications**](./notifications.md) — per-user in-app notifications on the same bus.
- [**Card details**](./card-detail.md) — the card modal, labels, due dates and checklists.
- [**Card collaboration**](./card-collaboration.md) — assignees and comments.
- [**Search**](./search.md) — global search across boards and cards, scoped by access.
- [**Board filters**](./filters.md) — narrow the visible cards by label, assignee and due date.
- [**Calendar view**](./calendar.md) — cards with a due date on a monthly grid.
- [**Due-date reminders**](./reminders.md) — the reminder cron job and drag to reschedule.
- [**Attachments**](./attachments.md) — files on cards, storage and authorized download.
- [**Design system**](./design-system.md) — OKLCH tokens, light and dark themes, components.
- [**Translations**](../locales/README.md) — how the interface languages work and how to add one.
- [**Docker**](./docker.md) — the multi-stage image and the orchestration.
- [**Server Actions API**](./api/server-actions.md) — catalog of server mutations.
- [**Public API (REST v1)**](./api/public-api.md) — automate boards with access tokens.
- [**Contributing**](./contributing.md) — development environment and conventions.
- [**Tests and continuous integration**](./testing.md) — Vitest and the GitHub Actions workflow.

## Decisions

Technical decisions and their rationale are recorded in the
[decision log](./DECISIONES.md), newest first. The earlier architecture decision records
(ADRs) are in [`decisions/`](./decisions/):

- [0001 — Prisma as the ORM](./decisions/0001-prisma.md)
- [0002 — Fractional indexing for ordering](./decisions/0002-fractional-indexing.md)
- [0003 — Database credentials in `.env`](./decisions/0003-db-creds-in-env.md)
- [0004 — No Redis in the MVP](./decisions/0004-no-redis-mvp.md)
- [0005 — Initial AGPL-3.0 license (historical)](./decisions/0005-agpl.md)
- [0006 — Role-based authorization with explicit guards](./decisions/0006-rbac-explicit-guards.md)
- [0007 — PostgreSQL LISTEN/NOTIFY instead of Redis](./decisions/0007-pg-notify-over-redis.md)
- [0008 — Server-side session store](./decisions/0008-session-store.md)
- [0009 — In-memory rate limiting](./decisions/0009-in-memory-rate-limit.md)
- [0010 — Attachments on local disk](./decisions/0010-local-file-storage.md)
- [0011 — Search with ILIKE, scoped on the server](./decisions/0011-search-ilike-scoped.md)
- [0012 — In-app notifications over the pub/sub bus](./decisions/0012-notifications.md)
- [0013 — Public API with hashed personal tokens](./decisions/0013-api-tokens.md)
- [0014 — Card collaboration model (assignees and comments)](./decisions/0014-card-collaboration.md)
- [0015 — Reminders through an external cron endpoint](./decisions/0015-reminders-cron.md)
- [0016 — Proprietary license (historical; the current license is AGPL-3.0-or-later, see the decision log)](./decisions/0016-licencia-propietaria.md)

## Roadmap

What has shipped and what is planned is in the [roadmap](./roadmap.md).
