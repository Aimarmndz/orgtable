@AGENTS.md

# Project context and decisions

orgtable is a self-hosted, open-source Kanban app, a Trello alternative (Next.js 16,
Prisma 7, PostgreSQL). This file is the working context for agents and contributors: it
summarizes the current state, the conventions and the decisions behind each feature. The
technical decisions with their full rationale are in `docs/DECISIONES.md` (the live
decision log) and, for the earlier architecture decisions, in `docs/decisions/` (ADRs);
here each one gets a one-line summary.

## Conventions

- **Language**: code, comments, documentation (`docs/`) and commit messages are in
  English. Technical decisions are recorded in `docs/DECISIONES.md`, also in English (the
  file name is kept). The interface is bilingual (English by default, plus Spanish); all
  visible text lives in `locales/` (see `locales/README.md`).
- **Commit authorship**: NEVER add `Co-Authored-By: Claude …` or any AI co-author to
  commits (explicit instruction from the owner; it **overrides** any environment default).
  Only **human** co-authors are added, and only when explicitly requested. Every commit
  carries `Signed-off-by` (DCO, `git commit -s`).
- **Security**: posture and audit in `docs/security.md` (plus the root `SECURITY.md`).
  Adversarial multi-agent audit + `pnpm audit`. Key fixes: the `moveCard` IDOR (the card
  must belong to the destination board, `cardBelongsToBoard`), `SESSION_SECRET` and
  `DATABASE_URL` are required, security headers in `next.config.ts`, security overrides in
  `pnpm-workspace.yaml`. Authorization tests in `test/integration/` (IDOR, 403/404).
- **Tests/CI**: two levels. **Unit** tests (no database or network) in `test/` with
  `pnpm test`, including the translation check `test/i18n.test.ts` (same keys,
  placeholders and plural forms in every language). **Integration** tests in
  `test/integration/` (`pnpm test:integration`): they call the route handlers in
  `app/api/v1/**` and the services against a real PostgreSQL database whose name must end
  in `_test` (guard in `test/integration/helpers.ts`); `vitest.integration.config.ts`
  aliases `next/cache`, `next/headers` and `server-only`. Account creation lives in
  `app/lib/services/users.ts` so it can be tested. GitHub Actions
  (`.github/workflows/ci.yml`) starts a Postgres service and runs lint + typecheck + unit
  tests + `migrate deploy` + integration tests + build on every push and PR. See
  `docs/testing.md`.
- **Architecture**: Server Actions (`app/lib/actions/`) + Data Access Layer
  (`app/lib/dal.ts`) + Prisma. Every mutation validates with zod, authorizes through the
  DAL and revalidates the route. See `docs/architecture.md` and
  `docs/api/server-actions.md`.
- **Authorization**: the server is the only authority; the UI only hides controls. See
  `docs/authorization.md`.
- **Next.js 16 / Prisma 7**: there are breaking changes compared with earlier versions
  (see `AGENTS.md`). `params`/`searchParams` are asynchronous; the middleware is called
  `proxy.ts`; the database URL lives in `prisma.config.ts` + a driver adapter, not in the
  schema.

## Status

The shipped features and the planned work are in `docs/roadmap.md`. Organizations have a
full admin panel (one page per section, `app/(app)/[workspace]/settings/`): custom roles and
permissions (`app/lib/permissions.ts`, `docs/roles.md`), teams, security policy, activity
log, brand, webhooks and integrations (`app/lib/webhooks/`), organization API keys and
backups (`app/lib/backups/`). Accounts have two-step verification. Secrets the app must read
back are encrypted with `ORGTABLE_SECRET_KEY` (`app/lib/crypto/secrets.ts`). Planned themes:
PWA and mobile, automations, table and swimlane views, templates / archive, card activity
history, accessibility; later ideas (SSO/OIDC, passkeys, observability) are listed there too.

Multi-tenancy rules for new features: settings pages go through `requireOrgSettings` /
`requireOrgPermission` (`app/lib/org-settings.ts`); services re-check membership and look rows
up by `{ workspaceId, id }`; join tables carry `workspaceId` in composite foreign keys; board
access is decided only in `app/lib/access.ts`; cross-tenant cases get an integration test.

## Decisions (summary)

- ADR 0001 — Prisma as the ORM.
- ADR 0002 — Fractional indexing for the order of lists and cards.
- ADR 0003 — Database credentials in `.env`.
- ADR 0004 — No Redis in the MVP (it would come with real time / rate limiting).
- ADR 0005 — Initial license (historical).
- ADR 0006 — Role-based authorization with explicit guards (not the experimental
  `forbidden()`). Board roles OWNER/EDITOR/VIEWER in `app/lib/roles.ts`.
- ADR 0007 — PostgreSQL `LISTEN/NOTIFY` (not Redis) for real-time pub/sub.
- ADR 0008 — `Session` table for immediate session revocation.
- ADR 0009 — In-memory rate limiting (no Redis) for sign-in.
- ADR 0010 — Attachments on local disk (a volume), not S3.
- ADR 0011 — Search with `ILIKE`, scoped on the server (no external search engine).
- ADR 0012 — In-app notifications over the pub/sub bus (no email, no queue).
- ADR 0013 — Public API with hashed personal tokens (Bearer, reuses the RBAC).
- ADR 0014 — Card collaboration: assignees (members only) and comments (flat thread,
  cascade delete).
- ADR 0015 — Due-date reminders through an external cron endpoint (secret, no in-process
  scheduler).
- ADR 0016 — Proprietary license (historical, superseded).
- Current license: AGPL-3.0-or-later with a section 7(b) attribution term (`LICENSE`); see
  `docs/DECISIONES.md`. Later decisions (fonts, open sign-up and GDPR, bilingual
  interface…) are recorded there.

## Feature notes

- **Multi-user**: `BoardMember`/`BoardRole`/`User.role` have been in the schema from the
  start. Role guards in every action, a members panel per board and `/admin/users` for
  account management. Open sign-up is optional per instance (off by default); otherwise
  the admin creates the accounts.
- **Real time**: SSE at `/api/boards/[id]/stream` + a pub/sub bus (`app/lib/realtime/`).
  Every mutation calls `revalidateBoard()` (revalidates + publishes). Sessions are backed
  by the `Session` table (the JWT carries `sid`), so revocation is immediate.
- **Operations**: sign-in rate limiting (`app/lib/rate-limit.ts`, in memory) + audit log
  (`app/lib/audit.ts`, `/admin/audit`); attachments on disk (`app/lib/storage.ts`, volume
  `/data/uploads`, downloaded through an authorizing route handler); board export/import
  (JSON); `scripts/{backup,restore,update}.sh`.
- **Visual design** (warm editorial): sand/paper/espresso with a terracotta accent.
  Typefaces Bricolage Grotesque + Figtree + Geist Mono (SIL OFL 1.1, loaded with
  `next/font/google`). Tokens in `app/globals.css`; see `DESIGN.md`.
- **Search**: `searchForUser` in `app/lib/queries.ts` (ILIKE scoped by access), `/search`
  page, a search box in the navbar (`app/components/search-box.tsx`) and a `?card=`
  deep-link that opens a card. See `docs/search.md`.
- **Calendar**: Board/Calendar switch in `BoardView` (local state, not in the URL).
  `app/components/board/calendar-view.tsx` places cards with a due date on a monthly grid
  and reuses the card modal. Indexed by `dueDate.slice(0,10)` to avoid time-zone shifts.
  Dragging a card to another day calls `setCardDueDate`. See `docs/calendar.md`.
- **Notifications**: `Notification` model. `notify()` in `app/lib/notifications.ts` writes
  and publishes on a **per-user** channel (`user:<id>`) of the real-time bus
  (`app/lib/realtime/bus.ts`); SSE stream `/api/notifications/stream` + the bell
  (`app/components/notifications-bell.tsx`). Best-effort, like the audit log. See
  `docs/notifications.md`.
- **Public API**: `ApiToken` model. REST `/api/v1/**` for boards, lists and cards; helpers
  in `app/lib/api/` (`auth.ts` Bearer → user + board role, `tokens.ts` SHA-256 hash,
  `respond.ts`, `serialize.ts`). Reuses the RBAC (`canEditBoard`/`canManageBoard`) and
  `revalidateBoard` (real time). Tokens have a `scope` (full/read) and an optional
  `expiresAt`; `isReadOnly(auth)` returns 403 in every write handler. Token management in
  `/settings`. The API answers in English only. See `docs/api/public-api.md`.
- **Card collaboration**: `CardAssignee` and `Comment` models. Actions in
  `actions/assignees.ts` and `actions/comments.ts`; testable logic in
  `services/assignees.ts` (`assignMemberToCard`, members only) and `services/cards.ts`
  (`cardContext`). Notifies `card.assigned` and `comment.added`. See
  `docs/card-collaboration.md`.
- **Reminders**: `Notification.cardId` for deep-links and deduplication.
  `services/reminders.ts` (`generateDueReminders(now)`) is triggered by
  `POST /api/cron/reminders` (Bearer secret, `timingSafeEqual`, 503 when `CRON_SECRET` is
  not set). See `docs/reminders.md`.
- **Board filters**: `app/lib/board-filters.ts` (pure, `cardMatchesFilters`, unit tested)
  and a `FilterBar` in the board header; `BoardView` filters the cards and disables
  dragging with `sortingDisabled`. See `docs/filters.md`.
- **Open sign-up, legal pages and GDPR**: operator details under Admin › Instance feed the
  `/legal/*` pages; everyone can export or delete their account from Settings › Privacy
  and data; `POST /api/cron/maintenance` deletes expired data. See `docs/privacy.md`.
- **Bilingual interface**: messages in `locales/<code>/<area>.json`, English as reference
  and fallback. Request language: `locale` cookie, then `Accept-Language`, then English.
  `User.locale` stores the account's choice (restores the cookie on sign-in and sets the
  language of that person's notifications). zod schemas carry message keys. Language
  picker in the footer of the public pages and in Settings › Appearance.
- **Navigation**: the workspace switcher in the top bar (`app/components/workspace-switcher.tsx`)
  shows the workspace of the URL; the account menu lists each organization's settings. See
  `docs/workspaces.md`.
- **Labels**: edited and deleted in the card and the board menu, with a palette key or a free
  `#rrggbb` colour (`app/components/ui/color-picker.tsx`). See `docs/board-menu.md`.
- **Right click everywhere**: `app/components/app-context-menu.tsx` builds the menu from the
  controls inside `data-menu-scope` elements, besides the board's own. New rows with actions
  should carry `data-menu-scope` and `data-menu-title`. See `docs/board-menu.md`.
- **Profile photos**: on the uploads volume, served by `/api/users/<id>/avatar` to people who
  share an organization or a board (`app/lib/services/avatars.ts`). See `docs/privacy.md`.
- **Migrations**: generated with `prisma migrate dev` against the local development
  database (Postgres on port 5433, container `orgtable-dev-pg`) and applied with
  `migrate deploy` when the container starts. Some early migrations were written by hand;
  their SQL matches the schema, so `migrate dev` detects no drift.
- **Dev note**: regenerating the Prisma client (`prisma migrate dev`/`generate`) while the
  dev server is running leaves it with a stale client (`findMany of undefined` errors);
  **restart `next dev`** after a migration.
