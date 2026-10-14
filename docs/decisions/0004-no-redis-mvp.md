# ADR 0004 — No Redis in the MVP

**Status:** accepted · **Date:** 2026-06-04

## Context

Many self-hosted apps include Redis by default (sessions, cache, queues). Does orgtable
need it in its first release?

## Decision

**Do not** include Redis in the MVP. `docker-compose.yml` only has `app` + `postgres`.

## Rationale

- **Sessions**: they are stateless JWTs signed with `jose` and stored in an httpOnly
  cookie. There is no session store that requires Redis.
- **Realtime**: the MVP does not sync live between users, so there is no pub/sub.
- **Next cache**: on a single instance, the standalone build uses its disk/memory cache
  without needing an external store.

Adding Redis now would be dead complexity.

## Consequences

- Immediate session revocation is not possible in the MVP (limitation documented in
  `docs/authentication.md`).

## Update (realtime feature)

When realtime and session revocation were implemented, **Redis did not come in**. We
reconsidered this ADR's assumption and chose to reuse PostgreSQL:

- Pub/sub: in-process bus + optional PostgreSQL `LISTEN/NOTIFY`. See
  [ADR 0007](./0007-pg-notify-over-redis.md).
- Sessions: `Session` table in PostgreSQL. See [ADR 0008](./0008-session-store.md).

`docker-compose.yml` is still only `app` + `postgres`.
