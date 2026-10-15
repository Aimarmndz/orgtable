# Data layer

This guide documents how orgtable talks to PostgreSQL: the ORM (Prisma 7), the
configuration specific to this version, the schema models and the ordering strategy that
makes drag and drop possible.

The stack is **Next.js 16 + Prisma 7 + PostgreSQL**. If you come from projects on Prisma
5/6, pay attention: **Prisma 7 introduces significant changes** in how the connection and
the query engine are configured. The sections below explain what changed and why the code
looks the way it does.

Related architecture decisions:

- [`docs/decisions/0001-prisma.md`](decisions/0001-prisma.md): why Prisma, and how it is
  configured in version 7.
- [`docs/decisions/0002-fractional-indexing.md`](decisions/0002-fractional-indexing.md):
  why lists and cards are ordered with fractional indexing.

---

## Key files

| File | Role |
| --- | --- |
| `prisma/schema.prisma` | Models, enums, indexes and relations. |
| `prisma/migrations/` | Versioned SQL migrations. |
| `prisma.config.ts` | Prisma 7 CLI configuration (Migrate). |
| `app/lib/prisma.ts` | Runtime client (`PrismaClient` with a driver adapter). |

---

## Prisma 7: what changed from earlier versions

Prisma 7 reorganizes where the connection URL lives and how the client connects. These
four facts are the basis of the whole data layer. **Do not copy them from old tutorials**:
most of them describe Prisma 5/6.

### 1. The `url` no longer goes in `schema.prisma`

In earlier versions the `datasource` block had `url = env("DATABASE_URL")`. Prisma 7 **no
longer allows** this. The schema only declares the provider:

```prisma
datasource db {
  provider = "postgresql"
}
```

The URL that the **Migrate CLI** needs (for `migrate dev`, `migrate deploy`, etc.) is now
defined in `prisma.config.ts`, in the `datasource.url` field, using the `env()` helper
exported by `prisma/config`:

```ts
// prisma.config.ts
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: { path: path.join("prisma", "migrations") },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
```

### 2. Prisma 7 does not load `.env` automatically

Older versions read `.env` implicitly. Prisma 7 no longer does, so `prisma.config.ts`
loads it by hand with **`process.loadEnvFile()`**, a native Node API (available since
20.12). **The project does not use the `dotenv` dependency**:

```ts
// prisma.config.ts
try {
  process.loadEnvFile(path.join(process.cwd(), ".env"));
} catch {
  // No .env: the variables already come from the environment (e.g. docker-compose).
}
```

The `try/catch` is deliberate: in CI and in production there is no `.env` (variables are
injected by the environment), and the block simply skips it.

### 3. The query engine is WASM, not a Rust binary

Historically Prisma embedded a query engine as a **Rust binary**, which meant declaring
`binaryTargets` in the generator and copying engines into the Docker image for each
platform. In Prisma 7 **the query engine is WASM**, and the runtime connection to the
database goes through a **driver adapter**.

orgtable uses `@prisma/adapter-pg` (the `PrismaPg` class) on top of the `pg` driver
(node-postgres). The `PrismaClient` is created with the adapter:

```ts
// app/lib/prisma.ts (abridged)
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function createPrismaClient() {
  const url = process.env.DATABASE_URL;
  // Without DATABASE_URL the adapter would silently fall back to the libpq defaults
  // (PGHOST/localhost…). It is not required during `next build`, which does not use the DB.
  if (!url && process.env.NEXT_PHASE !== "phase-production-build") {
    throw new Error(/* DATABASE_URL is not configured */);
  }
  const adapter = new PrismaPg(buildPoolConfig(url), {
    onPoolError: (err) => console.error(/* … */ err.message),
  });
  return new PrismaClient({ adapter });
}
```

- The `DATABASE_URL` guard is a security control (see [security.md](./security.md)); if
  you change this function, keep it.
- `buildPoolConfig` sets a 5-second `connectionTimeoutMillis` (with the `pg` default of 0,
  a request that finds no free connection waits forever; Prisma 7 no longer applies the
  5-second `connect_timeout` that Prisma 6 had) and an explicit 10-second
  `idleTimeoutMillis`. `test/integration/prisma-pool.int.test.ts` checks both.
- `onPoolError` logs failures of idle connections (Postgres restarted, network cut). It
  logs only the message, never the connection string, which contains the password.

The real code is in [`app/lib/prisma.ts`](../app/lib/prisma.ts).

Practical consequence: **no `binaryTargets`** in the generator and no engine binaries to
copy into the container. The Docker image is simpler and more portable.

### 4. The client is a singleton on `globalThis`

The client is stored on `globalThis` and reused, **in development and in production**:

```ts
// app/lib/prisma.ts
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

globalForPrisma.prisma = prisma;
```

- In development, Next.js hot-reloads modules (HMR). If every reload created a new
  `PrismaClient`, connections would pile up until the **PostgreSQL pool is exhausted**.
- In production, Turbopack evaluates the module once per layer (route handlers on one
  side, RSC/SSR on the other). Without `globalThis` there would be two pools and twice the
  connections to Postgres. `realtime/bus.ts` and `rate-limit.ts` use the same pattern.

`app/lib/prisma.ts` starts with `import "server-only"`, so this module can never end up in
a client bundle.

---

## Models

The schema lives in `prisma/schema.prisma`. Summary:

| Model | Represents | Why it exists |
| --- | --- | --- |
| `InstanceConfig` | Global instance configuration (single row). | Instance name, `setupCompletedAt` (the source of truth for "already configured"), open sign-up and the operator's legal details. |
| `User` | A user account. | Authentication, board ownership, interface language (`locale`). |
| `Session` | A browser session. | Lets sessions be revoked immediately (see [authentication.md](./authentication.md)). |
| `Board` | A board (a project or space). | Container for lists, labels and members. |
| `List` | A column within a board. | Groups cards; ordered by drag and drop. |
| `Card` | A card within a list. | Unit of work; ordered and movable between lists. |
| `Label` | A colored label of a board. | Visual classification of cards. |
| `CardLabel` | Many-to-many join between `Card` and `Label`. | A card can have several labels and vice versa. |
| `Checklist` / `ChecklistItem` | Checklists of a card and their items. | Sub-tasks with progress. |
| `Attachment` | A file attached to a card. | Metadata; the file itself is on disk (see [attachments.md](./attachments.md)). |
| `CardAssignee` | Many-to-many join between `Card` and `User`. | Card assignees (board members only). |
| `Comment` | A comment on a card. | Flat discussion thread. |
| `BoardMember` | A user's membership in a board, with a role. | Single point of per-board authorization. |
| `Workspace` / `WorkspaceMember` | A personal workspace or an organization, and who is in it with which base role. | Board URLs (`/<workspace>/<board>`) and multi-tenancy (see [workspaces.md](./workspaces.md)). |
| `Team` / `TeamMember` / `TeamBoard` | A team of an organization, its people and the role it holds on some boards. | Shared access to boards (see [teams.md](./teams.md)). Every foreign key includes `workspaceId`. |
| `WorkspaceCustomRole` | A role an organization defines, with a set of permissions. | Custom roles (see [roles.md](./roles.md)). Members point to it with a composite key that includes the workspace, so a role never crosses organizations. |
| `Notification` | An in-app notification for a user. | Notification bell, deep-links to boards and cards. |
| `ApiToken` | A personal API token (hashed). | Public REST API access, with scope and optional expiry. |
| `AuditLog` | A security/operations event. | Audit log in `/admin/audit`, with limited retention. |

### `InstanceConfig`

A **single row** with a fixed `id` (`"singleton"`). It models the configuration of the
whole self-hosted instance.

The key field is **`setupCompletedAt` (optional DateTime)**: it is the **source of truth
for "the instance is configured"**. While it is `null`, the **setup wizard** (`/setup`) is
active and guides the initial configuration; once it holds a date, the wizard is closed.
All startup logic must check this field, not infer the state from somewhere else.

```prisma
model InstanceConfig {
  id               String    @id @default("singleton")
  instanceName     String
  setupCompletedAt DateTime?
  createdAt        DateTime  @default(now())
  registrationOpen Boolean   @default(false)
  // … operator's legal details (operatorName, operatorEmail, …), legalUpdatedAt
}
```

`registrationOpen` turns on open sign-up at `/register` (closed by default). The
`operator*` fields hold the legal details of **whoever runs the instance**, shown on the
`/legal/*` pages; see [privacy.md](./privacy.md).

### `User`

A user account. `email` is unique, `passwordHash` stores the already-hashed password
(never in plain text) and `role` uses the `Role` enum (`ADMIN` | `MEMBER`, default
`MEMBER`). `termsAcceptedAt` records when someone accepted the policy at sign-up (null for
accounts created by the admin or the wizard). `locale` is the interface language the
person chose (null until they pick one, in which case the browser decides). It relates to
the `Board`s the user owns (`boards`), their `memberships` (`BoardMember` rows), sessions,
notifications, API tokens, assigned cards and comments.

### `Board`

A board. It has an `owner` (relation to `User`, with `onDelete: Cascade`: deleting the
user deletes their boards) and optional presentation fields (`description`, `background`).
It groups `lists`, `labels` and `members`. It has `@@index([ownerId])` to list a user's
boards quickly.

### `List`

A column of a board. It belongs to a `board` (cascade) and is ordered by the
**`position` (string)** column, using fractional indexing (see below). Indexed by
`boardId`.

### `Card`

A card within a list. It belongs to a `list` (cascade), has optional `description` and
`dueDate`, and is ordered by **`position` (string)**. The
`@@index([listId, position])` index reads the cards of a list **already sorted**. Labels
are reached through the `labels` relation (via `CardLabel`); it also has checklists,
attachments, assignees and comments.

### `Label`

A colored label, defined **at board level** (it belongs to a `board`, cascade). It has a
`name` and a `color`. Indexed by `boardId`.

### `CardLabel`

**Many-to-many** join table between `Card` and `Label`. Its primary key is composite
(`@@id([cardId, labelId])`), which prevents adding the same label twice to the same card.
Both relations cascade. Extra index on `labelId`.

### `BoardMember`

A user's membership in a board, with a `role` (enum `BoardRole`: `OWNER` | `EDITOR` |
`VIEWER`, default `EDITOR`). Composite primary key (`@@id([boardId, userId])`).

`BoardMember` existed in the schema from the first migration, before multi-user support
shipped. This was deliberate: **every Server Action has been authorized through this
table from the start**, so adding multi-user support did not require re-migrating the
schema or rewriting the permission layer.

---

## Ordering for drag and drop: fractional indexing

The `position` columns of `List`, `Card`, `Checklist` and `ChecklistItem` are **neither
integers nor floats**: they are **lexicographic string keys** generated with the
[`fractional-indexing`](https://github.com/rocicorp/fractional-indexing) library (the
technique popularized by Figma).

The idea: each row's position is a string that sorts alphabetically. To insert or move a
row between two neighbours, an **intermediate** key between the previous and the next one
is generated with `generateKeyBetween(prev, next)`:

```ts
import { generateKeyBetween } from "fractional-indexing";

// Insert between two existing cards:
const position = generateKeyBetween(prevCard.position, nextCard.position);

// At the start of the list (no previous neighbour):
const first = generateKeyBetween(null, firstCard.position);

// At the end (no next neighbour):
const last = generateKeyBetween(lastCard.position, null);
```

**Why this beats an integer or float position:**

- **Moving a row updates ONLY that row.** With an integer position (0, 1, 2…), inserting
  in the middle means renumbering all the neighbours: many writes and contention. With
  fractional indexing a single `UPDATE` is enough.
- **No reindexing and no collisions.** There is always a key between two different keys,
  so there is no need to reserve gaps or "compact" periodically, as happens when a float
  runs out of precision between two very close values.
- **Concurrency-friendly.** Since each move touches a single row, two users moving
  different cards almost never collide.

In the database these columns are `TEXT COLLATE "C"` (byte-by-byte order). With the
default glibc collation, `'Zz'` would sort after `'a0'`. Prisma does not model collations;
the `20260924000000_position_collate_c` migration sets it.

The `@@index([listId, position])` index on `Card` uses this to return the cards of a list
already sorted, without an extra in-memory sort.

See [`docs/decisions/0002-fractional-indexing.md`](decisions/0002-fractional-indexing.md)
for the full reasoning, and [`docs/drag-and-drop.md`](./drag-and-drop.md) for the client
side.

---

## Commands

Generate the Prisma client (after changing the schema):

```bash
pnpm exec prisma generate
```

Create and apply a migration in **development** (generates the SQL and applies it to your
local database):

```bash
pnpm exec prisma migrate dev --name <name>
```

Apply pending migrations in **production** or when the container starts (generates
nothing new, it only applies what is already versioned):

```bash
pnpm exec prisma migrate deploy
```

In **production the container entrypoint applies the migrations**: startup runs
`prisma migrate deploy` before starting the app, so the schema is always up to date with
no manual steps.

> After a migration, restart `pnpm dev`: regenerating the Prisma client while the dev
> server is running leaves it with a stale client (errors such as
> `findMany of undefined`).
