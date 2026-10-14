# orgtable architecture

This guide gives contributors an overview of the system. It describes the actual
repository layout, the server/client boundary, the path a request takes, and the
Next.js 16 conventions worth keeping in mind.

> Before writing code, also read [`AGENTS.md`](../AGENTS.md): this version of Next.js has
> breaking changes compared with earlier versions, and the local documentation in
> `node_modules/next/dist/docs/` is the source of truth.

## Overview

orgtable is a self-hosted Trello alternative built on:

| Layer | Technology |
| --- | --- |
| Framework | Next.js 16 (App Router) |
| UI | React 19 |
| ORM | Prisma 7 (with the `@prisma/adapter-pg` driver adapter) |
| Database | PostgreSQL |
| Sessions | Signed JWT (`jose`) in an `httpOnly` cookie, backed by a `Session` table |
| Drag and drop | `@dnd-kit` + `fractional-indexing` |
| Internationalization | Own helpers on native `Intl`, messages in `locales/` (English and Spanish) |

The execution model is **server by default**: pages, layouts, data reads and mutations
(Server Actions) run on the server. Interactivity (dragging cards, forms with live
feedback) lives in **client islands** marked with `'use client'`. Persistence is
PostgreSQL through Prisma 7.

## Folder map

Application code lives under `app/`. Abridged tree:

```
app/
├── layout.tsx                  # Root layout (theme, CSP nonce, I18nProvider)
├── page.tsx                    # Entry point: decides setup / login / boards
├── globals.css
├── icon.svg
├── robots.ts                   # robots.txt depending on the instance
├── setup/                      # Initial setup wizard (public)
├── (auth)/                     # Public auth routes: login/, register/
├── (public)/legal/             # Legal pages generated from the operator's data
├── (app)/                      # Authenticated route group
│   ├── layout.tsx              # SECURE security boundary (DAL)
│   ├── boards/                 # The user's boards (+ import/delete)
│   ├── board/[id]/page.tsx     # A single board (async params)
│   ├── search/                 # Global search
│   ├── settings/               # Profile, sessions, API tokens, appearance, data
│   └── admin/                  # users/, audit/, instance/ (admins only)
├── api/
│   ├── health/route.ts         # Health check (does not touch the DB)
│   ├── boards/[id]/stream      # Real-time SSE stream of a board
│   ├── boards/[id]/export      # Board export (JSON)
│   ├── notifications/stream    # Per-user SSE stream of notifications
│   ├── attachments/[id]        # Authorized attachment download
│   ├── account/export          # Download of the user's own data
│   ├── cron/                   # reminders, maintenance (Bearer secret)
│   └── v1/                     # Public REST API (personal tokens)
├── i18n/                       # config, server/client helpers, rich(), formatting
├── components/
│   ├── board/                  # Board client islands (board-view, list-column,
│   │                           # card-item, calendar-view, filter-bar, members-panel…)
│   ├── card/                   # Card modal
│   └── …                       # Navbar pieces, language picker, theme toggle, ui/
└── lib/
    ├── prisma.ts               # PrismaClient singleton (server-only)
    ├── session.ts              # JWT + Session row, cookie handling
    ├── auth.ts                 # Password hashing and verification
    ├── dal.ts                  # Data Access Layer (secure authorization)
    ├── roles.ts                # Board role helpers (canEditBoard, canManageBoard)
    ├── ordering.ts             # Fractional indexing helpers
    ├── queries.ts              # Reads (authorization in the WHERE clause)
    ├── validators.ts           # Shared zod schemas
    ├── types.ts                # Server → client DTOs
    ├── realtime/               # Pub/sub bus, SSE, revalidateBoard()
    ├── api/                    # Public API helpers (Bearer auth, serialization)
    ├── services/               # Business logic without request context (testable)
    └── actions/                # Server Actions ('use server'): auth, boards, lists,
                                # cards, labels, checklists, comments, members, …
locales/                        # Messages per language (en/, es/); see locales/README.md
proxy.ts                        # Optimistic auth check + per-request CSP nonce
```

### Main routes

| Route | Access | Description |
| --- | --- | --- |
| `/` | mixed | Entry point; redirects depending on instance and session state |
| `/setup` | public | Initial setup wizard (locked once completed) |
| `/login` | public | Sign in (`(auth)` group) |
| `/register` | public | Open sign-up, only if the instance allows it |
| `/legal/*` | public | Privacy policy, terms, cookies and legal notice |
| `/boards` | authenticated | The user's boards (`(app)` group) |
| `/board/[id]` | authenticated | A board with its lists and cards |
| `/search` | authenticated | Search across boards and cards |
| `/settings` | authenticated | Account settings |
| `/admin/*` | admin | User management, audit log, instance settings |
| `/api/health` | public | Health check for docker-compose |
| `/api/v1/*` | API token | Public REST API |

Route groups in parentheses, such as `(auth)` and `(app)`, group pages without adding
segments to the URL: they let pages share a layout. The `(app)` layout is the gateway to
the authenticated area.

### Next.js 16 files

- **`proxy.ts`** (repository root) replaces the old *middleware*. In Next.js 16 the
  middleware is called `proxy` and runs on the Node.js runtime. Here it only does an
  **optimistic** authentication check (see below) and sets the per-request CSP nonce.
- **`prisma.config.ts`** (root) configures the Prisma 7 CLI: path of the schema, of the
  migrations, and the `DATABASE_URL` for Migrate. Prisma 7 does not load `.env`
  automatically, so the file does it by hand with `process.loadEnvFile`.
- **`next.config.ts`** enables `output: "standalone"` for the Docker build and sets the
  security headers.

## Server/client boundary

| Server | Client island (`'use client'`) |
| --- | --- |
| `page.tsx`, `layout.tsx` | `board-view.tsx`, `list-column.tsx`, `card-item.tsx`, `card-modal.tsx` |
| Reads in `lib/queries.ts` | Forms with `useActionState` (`login-form`, `setup-form`, `add-*-form`) |
| Server Actions in `lib/actions/*` (`'use server'`) | |
| DAL, prisma, session, auth, services | |

Sensitive code (database access, sessions, secrets) starts with `import "server-only"` so
the bundler **fails the build** if a client component imports it by mistake. This applies
to `lib/prisma.ts`, `lib/session.ts`, `lib/dal.ts`, `lib/queries.ts`, `lib/ordering.ts`,
the services, the real-time bus and the server-side i18n helpers, among others.

The bridge between both worlds is a set of **minimal serializable DTOs** (`lib/types.ts`):
`board/[id]/page.tsx` reads the board with Prisma and projects it to `BoardDTO` before
passing it to the `BoardView` client component. Client components never receive full
Prisma entities.

## Request flow and layered authorization

Authorization is deliberately **layered**: the `proxy` is fast but optimistic, and the
`DAL` is the real, secure check. A request to a private route goes through:

```
        HTTP request to /board/123
                  │
                  ▼
   ┌───────────────────────────────┐
   │ proxy.ts  (OPTIMISTIC check)   │  does the "session" cookie exist?
   │ - only checks THAT a cookie    │  no ─▶ redirect /login
   │   exists                       │
   │ - NO cryptographic validation  │
   └───────────────┬───────────────┘
                   │ yes
                   ▼
   ┌───────────────────────────────┐
   │ app/(app)/layout.tsx (SECURE) │  isSetupComplete() → otherwise /setup
   │ - through the DAL (server-only)│  requireUser()     → otherwise /login
   │ - really validates the JWT     │
   │   and the Session row          │
   └───────────────┬───────────────┘
                   │ valid user
                   ▼
   ┌───────────────────────────────┐
   │ page.tsx  (read)               │  requireUser() + queries.ts
   │ - getBoardWithLists(id, userId)│  (authorization in the WHERE)
   │ - projects to BoardDTO         │  missing / no access → notFound()
   └───────────────┬───────────────┘
                   │ render
                   ▼
   ┌───────────────────────────────┐
   │ Client island: BoardView       │  drag and drop, optimistic state
   └───────────────┬───────────────┘
                   │ the user changes something
                   ▼
   ┌───────────────────────────────┐
   │ Server Action ('use server')   │  1. validates with zod
   │ e.g. cards.ts:moveCard         │  2. requireBoardAccess(boardId) + role
   │                                │  3. writes with Prisma
   │                                │  4. revalidateBoard(id)
   └───────────────────────────────┘
```

### Each layer in detail

1. **`proxy.ts`: optimistic check.** It only checks whether the `session` cookie exists
   (`request.cookies.has("session")`). If it does not and the route is not public
   (`/login`, `/setup`, `/register`, `/legal`, `/robots.txt`), it redirects to `/login`.
   It neither decrypts nor validates the token: it just avoids rendering private routes
   for someone who has clearly not signed in.

2. **`app/(app)/layout.tsx`: secure check.** On every render it calls the DAL:
   `isSetupComplete()` (redirects to `/setup` if the instance is not configured) and
   `requireUser()` (redirects to `/login` if the JWT or its `Session` row is not valid).
   This is the real security boundary.

3. **Page: read.** `requireUser()` returns the user and `lib/queries.ts` reads the data.
   Read authorization is built into the `WHERE` of every query (`ownerId` or
   `members.some`), so a user can never read a board they neither own nor belong to.

4. **Mutations: Server Actions.** Every write is a Server Action (`'use server'`) that
   follows the same pattern: validate the input with a **zod** schema
   (`lib/validators.ts`), authorize with **`requireBoardAccess(boardId)`** from the DAL
   (which checks the `board_members` row and returns the role) plus the role helpers in
   `lib/roles.ts`, write with Prisma and finally call **`revalidateBoard()`**, which
   revalidates the route and publishes a real-time event. Drag and drop also keeps
   optimistic state on the client and computes the new position key with *fractional
   indexing* (`lib/ordering.ts`), so each move updates a single row.

For the session model, hashing, and why the check is split into two layers, see
[`docs/authentication.md`](./authentication.md). For roles, see
[`docs/authorization.md`](./authorization.md).

## Internationalization

The interface is available in English (default and fallback) and Spanish. Messages live
in `locales/<code>/<area>.json`; the helpers are in `app/i18n/`. The language of a request
comes from the `locale` cookie set by the language picker, otherwise from
`Accept-Language`, otherwise English. `User.locale` stores the account's choice: it
restores the cookie on sign-in and decides the language of the notifications written for
that person. The picker sits in the footer of the public pages and in
Settings › Appearance. The public REST API answers in English only. To add a language,
see [`locales/README.md`](../locales/README.md).

## Next.js 16 conventions to keep in mind

This version of the framework introduces breaking changes. Key points when contributing:

- **Async APIs.** `params`, `searchParams`, `cookies()` and `headers()` are **async** and
  must be awaited. For example, `board/[id]/page.tsx` does `const { id } = await params;`.
- **Mutations with Server Actions.** Writes from the UI go through Server Actions
  (`'use server'`), not API routes. Forms call them through the `action` prop; client
  forms use `useActionState` to show errors. Route handlers are used for streams,
  downloads, cron endpoints and the public API.
- **`export const dynamic = "force-dynamic"`.** Pages and layouts that depend on the
  database or on the session are marked this way so they are **not prerendered at build
  time**. This is critical for the Docker build, which runs **without** a database:
  without this flag the build would try to query Postgres and fail. It is used by the
  root `page.tsx`, `app/(app)/layout.tsx` and `app/setup/page.tsx`.
- **`output: "standalone"`.** `next.config.ts` produces a minimal Node server in
  `.next/standalone` that runs with `node server.js`, which keeps the production image
  small.
- **`proxy.ts` and `prisma.config.ts`** (described above) are new conventions in this
  version.

Remember: the source of truth is the local documentation in `node_modules/next/dist/docs/`.
Read it before writing new code, as [`AGENTS.md`](../AGENTS.md) says.

## Data and deployment

For the data model and migrations see [`docs/database.md`](./database.md); for container
packaging see [`docs/docker.md`](./docker.md); and to get an instance running see
[`docs/installation.md`](./installation.md).

---

**Summary:** orgtable is a server-first Next.js 16 app with client islands, layered
authorization (optimistic proxy → secure DAL → validated Server Actions) and persistence
in PostgreSQL through Prisma 7.
