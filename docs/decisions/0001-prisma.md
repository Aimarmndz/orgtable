# ADR 0001 — Prisma as the ORM

**Status:** accepted · **Date:** 2026-06-04

## Context

orgtable needs a data access layer on top of PostgreSQL that is comfortable for
contributors, with versioned migrations and good integration with TypeScript and
Next.js 16 (packaged in Docker with `output: standalone`).

**Prisma** and **Drizzle ORM** were evaluated.

## Decision

Use **Prisma 7** with the `@prisma/adapter-pg` driver adapter on top of `pg` (node-postgres).

## Rationale

- Prisma is the most popular ORM in the ecosystem, with the best out-of-the-box
  experience for people who are not fluent in SQL: declarative schema, generated types and
  guided migrations (`migrate dev`). This lowers the entry barrier for contributors.
- Prisma 7 changed its architecture in a way that favors self-hosting:
  - The **query engine is WASM** (not a Rust binary), so the client is packaged cleanly
    into the Docker image without copying per-platform engines.
  - The direct connection goes through a **driver adapter** (`PrismaPg`), which gives
    explicit control over the `pg` pool.
- Migrations (`prisma migrate deploy`) are idempotent and fit the container start-up.

## Consequences

- The connection URL **no longer** lives in `schema.prisma` (Prisma 7 forbids it): it goes
  in `prisma.config.ts` for the CLI, and at runtime it is passed through the adapter.
- `prisma.config.ts` must load `.env` by hand (`process.loadEnvFile()`), because Prisma 7
  no longer does it automatically.
- Accepted trade-off: Drizzle would produce somewhat smaller images and more transparent
  SQL, but Prisma wins on DX for the project's target audience.

See `docs/database.md` for the implementation details.
