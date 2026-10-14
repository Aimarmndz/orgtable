# ADR 0008 — Server-side session store for immediate revocation

**Status:** accepted · **Date:** 2026-06-05 · **Related:** [ADR 0004](./0004-no-redis-mvp.md)

## Context

The MVP used **stateless JWT** sessions: the token was signed and validated only by its
signature, without storing anything in the database. Advantage: zero queries to
authenticate. Drawback, documented as a known limitation: **a token could not be revoked
instantly**. `logout` deleted the local cookie, but a stolen token or a session on another
device stayed valid until it expired (7 days).

The realtime feature called for "immediate session revocation (sessions table)".

## Decision

Introduce a **`Session`** table and validate every request against it. The cookie is still
a signed JWT, but its payload carries the **session id** (`sid`). The DAL:

1. Verifies the JWT signature and expiry (as before).
2. Looks up the `Session` row by `sid` and rejects it if it does not exist, is revoked
   (`revokedAt`) or has expired (`expiresAt`).

## Rationale

- **Immediate, real revocation.** Setting `revokedAt` invalidates the session on the next
  request. It enables: a logout that really revokes, "sign out on all devices" when the
  password changes, and forced sign-out by the administrator.
- **No Redis.** PostgreSQL is reused (consistent with [ADR 0007](./0007-pg-notify-over-redis.md)).
  No separate session store is needed.
- **Bounded cost.** It is **one** query per request, memoized with React's `cache()`
  (only once per render). For this kind of self-hosted app, the cost is negligible
  compared with the security gain.
- **Role changes do not need revocation.** The role is read fresh from the database on
  every request, so changes take effect on their own.

## Consequences

- New `Session` migration (`userId`, `userAgent`, `createdAt`, `expiresAt`, `revokedAt`;
  FK to the user with cascade delete).
- `login` and the setup create a session row; `logout` revokes it; a password reset and a
  forced sign-out revoke all of the user's sessions.
- This removes the "no immediate revocation" limitation that
  [`docs/authentication.md`](../authentication.md) described for the MVP.
- A periodic cleanup of expired/revoked sessions would be useful (future maintenance
  task); it is not critical because the DAL already rejects them.
