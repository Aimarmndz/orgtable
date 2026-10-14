# Contributing guide

Thanks for your interest in contributing to **orgtable**! This guide helps you run the
project locally and contribute code without surprises.

orgtable is a self-hosted Trello alternative built with **Next.js 16**, **Prisma 7**,
**PostgreSQL**, **Tailwind 4** and **TypeScript**.

---

## Requirements

- **Node.js 22+**. Some dependencies need a recent Node version, so do not use anything
  older than 22.
- **Docker**, to run a local PostgreSQL database without installing Postgres on your
  machine.
- **pnpm** 11 (enable it with `corepack enable`; the exact version is pinned in the
  `packageManager` field of `package.json`). Do not use npm or yarn: the lockfile is
  `pnpm-lock.yaml`.

---

## Setting up the development environment

Follow these steps in order.

### 1. Clone and install dependencies

```bash
git clone https://github.com/Aimarmndz/orgtable.git
cd orgtable
pnpm install
```

### 2. Start PostgreSQL with Docker

Start a Postgres container for development. We use port **5433** on the host (mapped to
5432 in the container) so it does not clash with a local Postgres you may already be
running on 5432:

```bash
docker run -d --name orgtable-dev-pg \
  -e POSTGRES_USER=orgtable \
  -e POSTGRES_PASSWORD=devpass \
  -e POSTGRES_DB=orgtable \
  -p 5433:5432 \
  postgres:17-alpine
```

To stop and start the container later:

```bash
docker stop orgtable-dev-pg
docker start orgtable-dev-pg
```

### 3. Create the `.env` file

Copy the template and point it at the Postgres you just started:

```bash
cp .env.example .env
```

Edit `.env` so that `DATABASE_URL` uses port **5433** and the container's user, password
and database, and set a `SESSION_SECRET`:

```dotenv
DATABASE_URL="postgresql://orgtable:devpass@localhost:5433/orgtable"
SESSION_SECRET="any-secret-for-development"
```

> `SESSION_SECRET` is required and must be **at least 16 characters** long: with a shorter
> one the app cannot create sessions, and sign-in (and the setup wizard) fail. Generate
> one with `openssl rand -hex 32`.

The other variables are optional; they are all described in
[`installation.md`](./installation.md#environment-variables).

### 4. Apply migrations and generate the Prisma client

```bash
pnpm exec prisma migrate dev
pnpm exec prisma generate
```

- `prisma migrate dev` applies the existing migrations to your database.
- `prisma generate` generates the Prisma client the app uses.

### 5. Start the development server

```bash
pnpm dev
```

Open **http://localhost:3000** in your browser. The first time, the setup wizard
(`/setup`) greets you.

---

## Available scripts

Defined in `package.json`:

- **`pnpm dev`** — starts the Next.js development server (`next dev`) with hot reload.
- **`pnpm build`** — builds the app for production (`next build`).
- **`pnpm start`** — serves the production build (`next start`). Run `pnpm build` first.
- **`pnpm lint`** — runs ESLint on the project (`eslint`).
- **`pnpm typecheck`** — type check (`tsc --noEmit`).
- **`pnpm test`** — unit tests with Vitest (no database). `pnpm test:watch` runs them in
  watch mode.
- **`pnpm test:integration`** — integration tests against a real PostgreSQL database
  whose name ends in `_test`. See [`testing.md`](./testing.md).

---

## Working with the database

The schema lives in **`prisma/schema.prisma`**. Every change to the models goes through
a migration.

### Creating a migration

After editing `prisma/schema.prisma`, generate and apply a new migration with a
descriptive name:

```bash
pnpm exec prisma migrate dev --name <descriptive-name>
```

This creates the migration files, applies them to your database and regenerates the
client automatically. Restart `pnpm dev` afterwards: a running dev server keeps the old
client.

### Regenerating the client manually

If you need to regenerate the Prisma client without creating a migration:

```bash
pnpm exec prisma generate
```

For more on the data model, the design decisions and the use of *fractional indexing*
to order lists and cards, see [`database.md`](./database.md).

> Note: in Prisma 7 the database `url` does **not** live in `schema.prisma`. The Migrate
> CLI reads it from `prisma.config.ts` and, at runtime, `PrismaClient` connects through
> the `@prisma/adapter-pg` driver adapter (see `app/lib/prisma.ts`).

---

## Next.js 16 caveats (VERY IMPORTANT)

> **This is not the Next.js you know.** As [`AGENTS.md`](../AGENTS.md) warns, this version
> introduces *breaking changes*: APIs, conventions and file structure may differ from what
> you remember. **Before writing code, read the relevant guide in
> `node_modules/next/dist/docs/`** and pay attention to deprecation notices.

The most relevant changes to keep in mind:

- **Asynchronous APIs.** `params`, `searchParams`, `cookies()` and `headers()` are
  **asynchronous**: you must `await` them.

  ```ts
  // Page with asynchronous params
  export default async function Page({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    // ...
  }

  // cookies() / headers() too
  const cookieStore = await cookies();
  ```

- **The middleware is now `proxy.ts`.** The old `middleware.ts` is no longer used; the
  file is called **`proxy.ts`** and exports a `proxy` function:

  ```ts
  import type { NextRequest } from "next/server";

  export function proxy(req: NextRequest) {
    // ...
  }

  export const config = { matcher: ["/((?!_next/static).*)"] };
  ```

  It runs on the **Node.js** runtime.

- **Mutations with Server Actions.** Mutations (creating, editing or moving cards, etc.)
  are implemented as **Server Actions** marked with `'use server'`.

- **`revalidateTag` takes 2 arguments.** It is now called as `revalidateTag(tag, 'max')`.
  For *read-your-writes* scenarios there is the new `updateTag()` function.

When in doubt about any of these APIs, the source of truth is
`node_modules/next/dist/docs/`, not your memory or examples from the internet.

---

## Code conventions

- **Language.** Code, comments, documentation and commit messages are in English.
  Technical decisions are recorded in [`DECISIONES.md`](./DECISIONES.md) (newest first,
  in English; the file name is kept).
- **No hard-coded interface text.** Every visible string goes through the message
  catalogs in `locales/` (see [Translations](#translations)).
- **Strict TypeScript.** The project uses strict typing; avoid `any` and fix compiler
  errors instead of silencing them.
- **`import "server-only"`.** All server code that touches secrets or the database must
  import `server-only` so it never ends up in the client bundle.
- **Client vs Server Components.** Interactive components (drag and drop, dialogs,
  stateful forms) are **Client Components** (`'use client'`). Everything else is a
  **Server Component** by default.
- **Before opening a PR**, run the same checks as CI:

  ```bash
  pnpm lint
  pnpm typecheck
  pnpm test
  pnpm build
  ```

  All of them must pass. If you changed database code, also run
  `pnpm test:integration` (see [`testing.md`](./testing.md)).

---

## Translations

The interface is available in English (the default and reference language) and Spanish.
Messages live in JSON files, one folder per language (`locales/<code>/<area>.json`), so
you can translate without knowing the code.

- To fix a translation, edit the JSON file of that language.
- To add a language, copy `locales/en/`, translate it and register it with one line in
  `locales/index.ts`.
- `pnpm test` checks that every language has the same keys, placeholders and plural
  forms as English.

The full guide is in [`locales/README.md`](../locales/README.md).

---

## License

orgtable is free software under the **GNU AGPL-3.0-or-later** with an additional
attribution term (section 7(b)): see [`LICENSE`](../LICENSE). Your contributions are
published under the same license (*inbound = outbound*): you keep your copyright and do
not need to sign a separate agreement.

Every commit carries a `Signed-off-by` line ([DCO](https://developercertificate.org/)):
with it you certify that you have the right to contribute that code under the project's
license. `git commit -s` adds it for you.

---

In short: clone the repo, start Postgres with Docker on port 5433, set up `.env`, apply
the Prisma migrations and run `pnpm dev`, keeping in mind that Next.js 16 brings
*breaking changes* documented in `node_modules/next/dist/docs/`.
