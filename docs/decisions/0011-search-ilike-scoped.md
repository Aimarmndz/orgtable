# ADR 0011 — Search with server-scoped ILIKE (no search engine)

**Status:** accepted · **Date:** 2026-06-07 · **Related:** [ADR 0004](./0004-no-redis-mvp.md), [ADR 0006](./0006-rbac-explicit-guards.md)

## Context

The search feature adds global search over boards and cards. The usual options range
from a dedicated engine (Elasticsearch, Meilisearch, Typesense) to PostgreSQL's native
full-text search (`tsvector`/`tsquery`, GIN indexes) or a simple substring match
(`ILIKE`).

## Decision

Implement search as a **case-insensitive substring match (`ILIKE`)** on
`title`/`description`, expressed with Prisma (`contains` + `mode: "insensitive"`),
**scoped in the `WHERE`** to the boards the user owns or is a member of. The query lives
in `app/lib/queries.ts` (`searchForUser`).

## Rationale

- **Zero infrastructure.** Consistent with ADR 0004/0007/0009: a self-hosted app should
  not require a separate search service or an indexing process.
- **Enough at the target scale.** A typical self-hosted instance has thousands, not
  millions, of cards. `ILIKE '%term%'` resolves in milliseconds at that scale.
- **Authorization is part of the query**, not a post-filter: the same
  `OR: [{ ownerId }, { members: { some } }]` pattern that `getBoardsForUser` already uses.
  The server is the only authority (ADR 0006); a result cannot leak data from someone
  else's board.
- **No derived state to maintain.** There is no index that can drift out of sync with the
  data: the search runs directly on the source of truth.

## Consequences

- `ILIKE '%term%'` does not use a standard B-tree index (the leading wildcard prevents
  it), so it is a scan. Acceptable at the target scale; if it ever became noticeable, the
  natural improvement is PostgreSQL full-text search (`tsvector` column + GIN index)
  **without changing the interface** of `searchForUser`, or the `pg_trgm` extension with a
  GIN index to speed up the `ILIKE` as it is.
- There is no relevance ranking and no typo tolerance (fuzzy). Results are sorted by
  `updatedAt` (most recent first), which is a reasonable proxy.
- The minimum query is 2 characters, to avoid very low-value scans.
- Documented in [`docs/search.md`](../search.md).
