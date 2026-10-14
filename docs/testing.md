# Tests and continuous integration

orgtable has tests written with **Vitest** and a **GitHub Actions** workflow that runs on
every push to `main` and on every pull request.

There are two levels: **unit tests** (no database or network) and **integration tests**
(API routes, Server Actions and services against a real PostgreSQL database).

## Running locally

```bash
pnpm test           # unit tests (fast, no database)
pnpm test:watch # unit tests in watch mode
pnpm typecheck  # tsc --noEmit
pnpm lint       # eslint

# Integration: needs a test database (its name MUST end in `_test`).
# Create orgtable_test in your dev Postgres and apply the migrations once:
createdb -h localhost -p 5433 -U orgtable orgtable_test   # or through docker exec psql
DATABASE_URL='postgresql://orgtable:PASS@localhost:5433/orgtable_test' pnpm exec prisma migrate deploy
# then:
DATABASE_URL='postgresql://orgtable:PASS@localhost:5433/orgtable_test' pnpm test:integration
```

## What each file covers

The full inventory is `ls test/*.test.ts test/integration/*.int.test.ts`. The tables group
the files by area so you know where to look or where to add a test; the individual cases
are in each file's `describe`/`it` blocks, so they are not repeated here. Add a new file to
the row of its area.

### Unit tests

They live in `test/` and use no database or network. Not all of them are pure logic:
`ops-scripts.test.ts` runs the `scripts/` scripts and `install.sh` with bash and a fake
`docker` on the `PATH`, `storage.test.ts` writes to a temporary directory, and the UI tests
render components with `react-dom/server` (there is no jsdom).

| Area | Files (`test/<name>.test.ts`) |
|------|----------|
| Authorization, session and security | `roles`, `tokens`, `auth`, `client-ip`, `rate-limit`, `csp`, `next-config`, `user-agent` |
| Validation and data | `validators`, `ordering`, `colors`, `search-params`, `format-date`, `initials`, `client-imports` (no client component imports zod or `validators.ts`) |
| Translations | `i18n` (every registered language has the same keys as English, with the same placeholders and tags and the plural forms its grammar needs; see [`locales/README.md`](../locales/README.md)) |
| Board and cards (client logic) | `board-filters`, `board-collision`, `optimistic`, `card-modal-helpers` |
| Real time | `realtime-bus` (`LISTEN/NOTIFY` bridge with a fake `pg`), `realtime-reconnect` |
| UI and accessibility | `card-item`, `calendar-view`, `list-column-delete`, `members-panel`, `admin-forms-a11y`, `form-error-reannounce`, `delete-board-button`, `delete-board-button-focus`, `metadata`, `contrast` (reads `app/globals.css`) |
| Operations | `ops-scripts`, `storage` |

### Integration tests

They exercise the code **against a real (throwaway) PostgreSQL database**, in
`test/integration/`:

| Area | Files (`test/integration/<name>.int.test.ts`) |
|------|----------|
| Public API (`/api/v1`) | `boards-api`, `board-detail-api`, `cards-api`, `api-scopes`, `api-auth` |
| Server Action authorization | `authz-actions`, `cards-actions`, `security`, `labels`, `members`, `board-metadata` |
| Session, login and administration | `session`, `auth`, `setup`, `users`, `admin-users`, `admin-revocation`, `tokens`, `audit` |
| Accounts, sign-up and privacy | `account`, `registration`, `maintenance` |
| Cards and collaboration | `cards-due-date`, `collaboration` |
| List and card order | `positions`, `position-collation` |
| Attachments | `attachments-delete`, `attachments-download` |
| Notifications and reminders | `notifications`, `notifications-read`, `reminders`, `cron-reminders` |
| Real time (SSE) | `realtime` |
| Database and test utilities | `helpers`, `prisma-pool` |

How they work:

- They use **the same `PrismaClient` as the app**, pointed at the test database through
  `DATABASE_URL`. They call the `app/api/v1/**` **route handlers directly** with a
  `Request` (Bearer token), without starting a server.
- **Safety guard** (`test/integration/helpers.ts`): it refuses to truncate unless the
  database name ends in `_test`, so dev or production data is never touched.
- Before each test, `resetDb()` runs `TRUNCATE … CASCADE` on every table in the schema
  (read from `pg_tables`, excluding `_prisma_migrations`), and clears the stub's cookies
  and headers and the rate-limit counters.
- `vitest.integration.config.ts` aliases `next/cache` and `next/headers` to stubs (outside
  Next there is no revalidation store or request), as well as `server-only` and `@/`. It
  also sets:
  - `TZ=UTC`, so date logic (reminders) is deterministic.
  - A test `SESSION_SECRET` (a fixed key that protects nothing real), needed to sign
    sessions.
  - `fileParallelism: false`: all files share the same database and empty it between
    tests, so they cannot run at the same time.
- **Server Actions with a session**: the `next/headers` stub (`test/stubs/next-headers.ts`)
  keeps cookies and headers in memory.
  - `loginAs(userId)` (in `helpers.ts`) creates a real session (a `Session` row plus a
    signed cookie); from then on the DAL sees that user. Calling it again switches user.
  - To inject headers (for example `X-Forwarded-For`), use `__setHeaders`;
    `__clearCookies` clears the cookies and `__clearHeaders` the headers. They are
    imported from `../stubs/next-headers`.
  - Order: `loginAs` only clears cookies, so headers set earlier with `__setHeaders` are
    kept (for example `X-Forwarded-Proto: https` → `Secure` cookie). `resetDb` clears
    both, so set headers after `resetDb`.
  - Next redirects are checked through their `digest`:
    `rejects.toMatchObject({ digest: expect.stringContaining(";/boards;") })`.
- Account creation logic lives in `app/lib/services/users.ts` (`createUserAccount`) so it
  can be tested without a request context (cookies/admin); the `createUser` Server Action
  reuses it.

## Configuration details

- `vitest.config.ts` defines two aliases so app modules can be imported outside Next:
  - `server-only` → an empty stub (`test/stubs/server-only.ts`): there is no
    server/client boundary in tests.
  - `@/…` → the project root, the same alias the app uses.
- Tests import `describe/it/expect` from `vitest` (no globals).

## Continuous integration

`.github/workflows/ci.yml` starts a **PostgreSQL service** (`postgres:17`, database
`orgtable_test`) and runs, in order:

1. **Shellcheck** on `scripts/*.sh`, `install.sh` and `docker-entrypoint.sh`. `shellcheck`
   is preinstalled on the runner; locally, install it with `brew install shellcheck` and
   run:
   ```bash
   shellcheck scripts/*.sh install.sh docker-entrypoint.sh
   ```
2. **Compose variables**: checks that `docker compose config` passes `CRON_SECRET`,
   `TRUSTED_PROXY_HOPS`, `ORGTABLE_TIMEZONE`, `ORGTABLE_AUDIT_RETENTION_DAYS`,
   `ORGTABLE_SOURCE_URL`, `ORGTABLE_LANDING` and `ORGTABLE_INSTALL_URL` to the `app`
   container. If one drops out of `environment:`, the
   feature that depends on it stops working under Docker without any error. Locally:
   ```bash
   CRON_SECRET=probe TRUSTED_PROXY_HOPS=7 ORGTABLE_TIMEZONE=Europe/Madrid \
     ORGTABLE_AUDIT_RETENTION_DAYS=45 ORGTABLE_SOURCE_URL=https://example.org/fork \
     ORGTABLE_LANDING=on ORGTABLE_INSTALL_URL=https://example.org/fork/install.sh \
     docker compose config | grep -E 'CRON_SECRET|TRUSTED_PROXY_HOPS|ORGTABLE_'
   ```
3. **License**: checks that `package.json` declares `AGPL-3.0-or-later`, that `LICENSE` is
   the AGPL with its attribution term (section 7(b)), and that no traces of the former
   proprietary license remain outside the historical record. The commands are in the
   "Check license" step of `ci.yml`; copy them from there to reproduce it locally.

These three steps run before pnpm and Node are installed. Then, on Node 22 (pnpm comes from
`pnpm/action-setup`, which reads `packageManager`):

4. `pnpm install --frozen-lockfile`: installs from the lockfile (reproducible).
5. `pnpm audit --prod --audit-level high`: fails on high or critical vulnerabilities in
   production dependencies.
6. `pnpm exec prisma generate`: generates the Prisma client (needed by typecheck and
   build).
7. `pnpm lint`
8. `pnpm typecheck`
9. `pnpm test`: unit tests, including the translation check (`test/i18n.test.ts`).
10. `pnpm exec prisma migrate deploy`: creates the schema in the service's test database.
11. `pnpm test:integration`: integration tests against that database.
12. `pnpm build`

`DATABASE_URL` points to the service database (`…/orgtable_test`). The build does not
connect to it (dynamic routes); the integration tests do.
