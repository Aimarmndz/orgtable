# Docker infrastructure

This guide explains how the **orgtable** container infrastructure is built and why each decision is where it is. It is meant for contributors who want to **understand or modify** the image and the orchestration. The infrastructure is in place and verified working end to end.

The stack is made of:

| Piece | File | Role |
| --- | --- | --- |
| App image | `Dockerfile` | Multi-stage build that produces the Next.js production image. |
| Orchestration | `docker-compose.yml` | Starts PostgreSQL + the app, with an internal network and healthchecks. |
| Container start-up | `docker-entrypoint.sh` | Applies the Prisma migrations and starts the server. |
| Build context | `.dockerignore` | Excludes what must not end up in the image (secrets included). |
| Next output | `next.config.ts` | `output: "standalone"` packages a minimal Node server. |

To install and run it on a real server, see [`installation.md`](./installation.md). For the data schema and migrations, see [`database.md`](./database.md).

---

## The `Dockerfile` (multi-stage)

The `Dockerfile` has three stages: `deps`, `builder` and `runner`. The idea is to build with every tool available but ship only what is essential to production.

### `deps` stage: installing dependencies

```dockerfile
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
```

It runs `pnpm install --frozen-lockfile` (pnpm comes from Corepack, in a `base` stage) on `node:22-alpine`. **Using Alpine here is deliberate, not cosmetic.**

Alpine Linux uses **musl libc** (not glibc). Prisma downloads *native engines* during installation, one of which is the **schema engine** used by `migrate deploy`. Installing inside Alpine downloads that binary for the **`linux-musl`** platform, which is exactly what the final container (also Alpine) runs. If the dependencies were installed on a glibc-based image (e.g. Debian `node:22`), the engine would be built for glibc and would fail in the Alpine `runner`. Keeping Alpine end to end guarantees that the engine matches the system it runs on.

### `builder` stage: generating Prisma Client and building Next

```dockerfile
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN pnpm exec prisma generate
RUN pnpm build
```

It reuses the `node_modules` installed in `deps`, copies the code and does two things: generates the Prisma Client and builds the app.

The key detail is the **dummy `DATABASE_URL`** defined *before* `prisma generate`:

- **Prisma 7 must resolve `DATABASE_URL` when loading `prisma.config.ts`.** If the variable is missing, loading the configuration throws and `prisma generate` / `pnpm build` do not even start.
- However, **neither `generate` nor the build actually connects to the database**. `generate` only produces the client (WASM query engine, no binary), and the app pages are **dynamic** (they depend on the session), so they do not query the database during the build. The URL only needs to *exist and be syntactically valid*; no connection to `localhost:5432` is ever opened.

After this, `pnpm build` produces `.next/standalone` thanks to `output: "standalone"` (see [`next.config.ts`](../next.config.ts)).

### `runner` stage: the final production image

```dockerfile
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apk add --no-cache openssl
RUN addgroup -g 1001 nodejs && adduser -u 1001 -G nodejs -S nextjs

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
# ... prisma/, prisma.config.ts, package.json

COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN mkdir -p .next/cache && chown nextjs:nodejs .next/cache

USER nextjs
EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
```

Key points of the `runner`:

- **`node:22-alpine`** again, so the Prisma schema engine (downloaded in `deps` for `linux-musl`) is compatible with the runtime system.
- **`apk add --no-cache openssl`**: the Prisma schema engine needs `openssl` to run `migrate deploy`. Alpine does not ship it by default, so it is installed explicitly.
- **Unprivileged `nextjs` user (non-root)**: the `nodejs` group and `nextjs` user are created and the image switches to that user with `USER nextjs`. The app never runs as root.
- **The code is read-only for the app**: `/app` stays owned by `root`, so the process cannot rewrite `server.js`, `.next` or `node_modules`. Only `.next/cache` (Next cache) and `/data/uploads` (attachments) are writable. There is no `chown -R /app`: besides making the code writable, it would duplicate `node_modules` in a new layer of hundreds of MB.
- **The production artefacts are copied**: `.next/standalone` (the minimal Node server), `.next/static`, `public`, plus `prisma/`, `prisma.config.ts` and `package.json` (needed for the migrations).

#### Why the **whole** `node_modules` is copied

This is the least obvious part. The `runner` copies **all** of `node_modules` from the `builder`, not just `prisma` and `@prisma`:

```dockerfile
COPY --from=builder /app/node_modules ./node_modules
```

The reason is the **Prisma CLI**. At start-up the entrypoint runs `prisma migrate deploy`, and that CLI depends on **hoisted transitive dependencies**, for example **`effect`**, which `@prisma/config` uses. The dependency tracing of `output: "standalone"` **only includes what the app itself imports**, not what the Prisma CLI imports. If only `prisma`/`@prisma` were copied, the CLI would be missing pieces such as `effect` and `migrate deploy` would fail. Copying the whole tree guarantees that both the app and the CLI have everything they need.

> **Possible improvement.** Copying the whole `node_modules` inflates the image. A `prod-deps` stage could run `pnpm install --prod --frozen-lockfile` and copy only that tree into the `runner`, reducing the final size.

### Entrypoint and command

```dockerfile
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
```

The `ENTRYPOINT` runs the start-up script (migrations), which finally `exec`s the `CMD` that starts the standalone server (`node server.js`).

---

## `docker-entrypoint.sh`: idempotent migrations

```sh
#!/bin/sh
set -e

echo "[orgtable] Applying database migrations..."
node node_modules/prisma/build/index.js migrate deploy

echo "[orgtable] Starting the server..."
exec "$@"
```

Every time the `app` container starts:

1. **It applies pending migrations** with `prisma migrate deploy`. This is **idempotent**: it only runs the migrations that have not been applied yet, comparing against the history recorded in the database. Starting the container many times never reapplies existing migrations.
2. The CLI is invoked by its **direct path** (`node node_modules/prisma/build/index.js`) instead of `npx`, so it **does not depend on the `.bin` symlinks** (which may be missing depending on how `node_modules` was copied or hoisted).
3. `exec "$@"` replaces the script process with the `CMD` (`node server.js`), so the Next server becomes PID 1 and receives the container signals correctly.

More on the schema and the migration flow in [`database.md`](./database.md).

---

## `docker-compose.yml`: orchestration

It defines two services (`postgres` and `app`), two volumes (`pgdata` for the database and `uploads` for attachments) and an internal bridge network (`orgtable`).

### `postgres` service

```yaml
postgres:
  image: postgres:17-alpine
  restart: unless-stopped
  environment:
    POSTGRES_USER: ${POSTGRES_USER}
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    POSTGRES_DB: ${POSTGRES_DB}
  volumes:
    - pgdata:/var/lib/postgresql/data
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
    interval: 5s
    timeout: 5s
    retries: 10
  networks:
    - orgtable
```

- **`postgres:17-alpine`** with persistence in the **`pgdata`** volume (data survives container re-creation).
- **Healthcheck with `pg_isready`**: marks the service `healthy` only when the database accepts connections. This is what lets `app` wait correctly (see below).
- **It exposes no port to the host.** PostgreSQL is only reachable from the internal `orgtable` network, never from outside the host. **This is a security decision**: the database must not be published on the host machine; only the app needs to talk to it, and it does so over the Docker network.

### `app` service

```yaml
app:
  build:
    context: .
    dockerfile: Dockerfile
  restart: unless-stopped
  depends_on:
    postgres:
      condition: service_healthy
  environment:
    DATABASE_URL: ${DATABASE_URL}
    SESSION_SECRET: ${SESSION_SECRET}
    NODE_ENV: production
    ORGTABLE_UPLOAD_DIR: ${ORGTABLE_UPLOAD_DIR:-/data/uploads}
    ORGTABLE_REALTIME_PG_NOTIFY: ${ORGTABLE_REALTIME_PG_NOTIFY:-0}
    CRON_SECRET: ${CRON_SECRET:-}
    TRUSTED_PROXY_HOPS: ${TRUSTED_PROXY_HOPS:-0}
    ORGTABLE_TIMEZONE: ${ORGTABLE_TIMEZONE:-Atlantic/Canary}
    ORGTABLE_AUDIT_RETENTION_DAYS: ${ORGTABLE_AUDIT_RETENTION_DAYS:-}
    ORGTABLE_SOURCE_URL: ${ORGTABLE_SOURCE_URL:-}
    ORGTABLE_LANDING: ${ORGTABLE_LANDING:-}
    ORGTABLE_INSTALL_URL: ${ORGTABLE_INSTALL_URL:-}
  volumes:
    - uploads:/data/uploads
  ports:
    - "${APP_PORT:-3000}:3000"
  healthcheck:
    test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:3000/api/health || exit 1"]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 20s
  networks:
    - orgtable
```

- **Local build** from the repository `Dockerfile` (`context: .`). The image is built on the user's server, not pulled from a registry.
- **`depends_on` with `condition: service_healthy`**: the app **does not start until PostgreSQL is `healthy`**. So when the entrypoint runs `migrate deploy`, the database is already accepting connections.
- **It only receives the variables under `environment:`**, not the whole `.env`. If a new variable is not added here, the app does not see it inside the container (CI checks this for the optional ones). What each one does: [variables table in `installation.md`](./installation.md#environment-variables).
- **`uploads` volume** mounted at `/data/uploads`: attachments survive container re-creation.
- **Publishes the port** `${APP_PORT:-3000}:3000` (configurable with `APP_PORT`, `3000` by default, on every interface). With `APP_PORT=127.0.0.1:3000` it is only published on localhost, which is what you want behind a reverse proxy ([self-hosting.md](./self-hosting.md#https-and-domain-reverse-proxy)). It is the only service exposed to the host.
- **Healthcheck with `wget`** against `http://127.0.0.1:3000/api/health`.

#### Why `127.0.0.1` and not `localhost` in the healthcheck

This detail used to be broken and was fixed: **`127.0.0.1` is used explicitly, not `localhost`.**

Inside the container, **`localhost` resolves to the IPv6 address `::1`**, while the Next standalone server listens on **IPv4 `0.0.0.0`** (set with `HOSTNAME=0.0.0.0` in the `Dockerfile`). With `localhost`, `wget` tried to connect over IPv6 to a server that was not listening there, and the healthcheck returned **"Connection refused"**, marking the container `unhealthy` even though the app worked. Forcing `127.0.0.1` (IPv4) points the check exactly where the server listens.

- **`start_period: 20s`**: gives the initial start-up some slack. The container first applies migrations and then starts the server, so for the first few seconds the endpoint does not answer yet; `start_period` keeps those early failures from counting as `unhealthy`.

### No Redis

The stack **does not include Redis**. This is a conscious decision, documented in [`docs/decisions/0004-no-redis-mvp.md`](./decisions/0004-no-redis-mvp.md).

---

## `.dockerignore`: what does NOT go into the image

The `.dockerignore` shrinks the build context and, above all, keeps secrets from leaking:

| Pattern | Reason |
| --- | --- |
| `node_modules` | Reinstalled inside the image (`pnpm install --frozen-lockfile`); the host copy is not sent. |
| `.next` | Build artefact, regenerated inside the container. |
| `.git`, `.gitignore` | History and metadata not needed in the image. |
| `.env`, `.env.*` | **CRITICAL: secrets must never end up in the image.** |
| `!.env.example` | Exception: the example without secrets is kept. |
| `docs`, `*.md`, `.claude`, `.agents`, `skills-lock.json` | Documentation and development tooling, irrelevant at runtime. |
| `backups`, `**/*.sql.gz`, `**/*.tar.gz`, `uploads`, `data`, `**/*.pem` | Backups (with personal data), development attachments and keys: `COPY . .` would put them in the builder and its cache. |
| `coverage`, `test`, `scripts`, `install.sh` | Tests and scripts that run on the host; the image does not use them. |
| `npm-debug.log*`, `*.tsbuildinfo` | Logs and temporary files. |

The most important point is the **`.env*` files**: credentials (`DATABASE_URL`, `SESSION_SECRET`, etc.) **are injected through the environment at runtime** (via `docker-compose.yml` / the host `.env`), never baked into the image. The only exception is `.env.example`, a template with no real values. This follows [`docs/decisions/0003-db-creds-in-env.md`](./decisions/0003-db-creds-in-env.md).

---

## Building and running locally

You need Docker and Docker Compose, and a `.env` file with the required variables (`install.sh` generates it; see [`installation.md`](./installation.md)).

Build the images:

```bash
docker compose build
```

Start the stack in the background:

```bash
docker compose up -d
```

Check the status and the logs:

```bash
docker compose ps
docker compose logs -f app
```

When both services show as `healthy`, the app is available at `http://localhost:${APP_PORT:-3000}`.

Stop the stack:

```bash
docker compose down
```

(`docker compose down -v` would also delete the `pgdata` and `uploads` volumes and, with them, **all the data and all the attachments**.)

---

## Start-up flow

The start-up order is coordinated by the Postgres healthcheck and the app entrypoint:

1. **`postgres` starts** and, once `pg_isready` answers, is marked **`healthy`**.
2. **`app` starts** (it was waiting on `depends_on: condition: service_healthy`). Its `ENTRYPOINT` runs `docker-entrypoint.sh`.
3. **The entrypoint applies the migrations** with `prisma migrate deploy` (idempotent: only the missing ones).
4. **The server starts** via `exec node server.js`, listening on IPv4 `0.0.0.0:3000`.
5. **The healthcheck passes**: `wget` to `http://127.0.0.1:3000/api/health` answers and `app` is marked **`healthy`**. `start_period` covers the time for migrations + start-up.

```
postgres (pg_isready) ──healthy──▶ app entrypoint (migrate deploy) ──▶ node server.js ──▶ /api/health OK ──▶ app healthy
```

---

**Summary:** a multi-stage Alpine build packages the Next standalone server with the whole `node_modules`, so the Prisma CLI can migrate the database at start-up, while Compose coordinates Postgres (private, with a healthcheck) and the app (migrates and starts), injecting secrets only at runtime.
