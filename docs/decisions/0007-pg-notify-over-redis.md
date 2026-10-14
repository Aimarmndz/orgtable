# ADR 0007 — PostgreSQL LISTEN/NOTIFY instead of Redis for pub/sub

**Status:** accepted · **Date:** 2026-06-05 · **Related:** [ADR 0004](./0004-no-redis-mvp.md)

## Context

The realtime feature introduces live sync: when someone changes a board, everyone else
with that board open must see it without reloading. That needs a
**publish/subscribe** mechanism between the code that mutates (Server Actions) and the
open connections (SSE).

[ADR 0004](./0004-no-redis-mvp.md) anticipated that Redis would come in "when realtime
with pub/sub arrives". When implementing it, we reconsidered that assumption.

## Decision

**Do not add Redis.** The bus is **in-process** (an `EventEmitter`) by default, and for
multi-instance deployments **PostgreSQL `LISTEN/NOTIFY`** is used as an optional bridge
(`ORGTABLE_REALTIME_PG_NOTIFY=1`).

## Rationale

- **One less piece of infrastructure.** We already depend on PostgreSQL. Adding Redis
  would mean another service to install, operate, back up and monitor — exactly what a
  self-hosted app tries to avoid.
- **The default case needs nothing.** The standard deployment is a single app container:
  Server Actions and SSE share a process, so an in-memory `EventEmitter` is enough. Redis
  would be dead complexity for 95% of installations.
- **`LISTEN/NOTIFY` covers multi-instance.** For several replicas, Postgres already
  offers native pub/sub. orgtable's payload is tiny ("board X changed"), far below the
  8 KB limit of `NOTIFY`.
- **Safe degradation.** If the bridge fails, the in-process mode keeps working; a
  mutation never breaks because of a pub/sub problem.

## Consequences

- The bus lives in `app/lib/realtime/bus.ts` behind an interface (`publishBoardEvent` /
  `subscribeBoard`) that isolates the transport. If Redis were ever needed (e.g. for a
  very high fan-out scale), it would be added as another adapter without touching the
  Server Actions or the SSE endpoint.
- `docker-compose.yml` still has only `app` + `postgres`.
- ADR 0004 is **updated**: Redis does not come in with realtime; `LISTEN/NOTIFY` is
  chosen.
