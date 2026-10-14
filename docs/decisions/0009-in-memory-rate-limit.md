# ADR 0009 — In-memory rate limiting (no dependencies)

**Status:** accepted · **Date:** 2026-06-05 · **Related:** [ADR 0007](./0007-pg-notify-over-redis.md)

## Context

Login needs protection against brute force. The usual solutions use Redis or a dedicated
service to count attempts in a way that is shared across instances.

## Decision

Implement an **in-memory** limiter (fixed window, a `Map` on `globalThis`), with no
external dependencies. Two limits for login (`app/lib/actions/auth.ts`):

- **Per IP**: 10 attempts every 10 minutes. Only applied when there is a trustworthy IP.
- **Per account** (normalized email): 20 failed attempts every 15 minutes, whether or not
  the email belongs to a real account. Reset after a successful login.

### Client IP and `TRUSTED_PROXY_HOPS` (review of 2026-09-24)

`X-Forwarded-For` is written by the client: each proxy **appends** the IP it sees, but
whatever came before comes from the request, and Next only fills the header in if it is
missing (`??=`). The initial version took the **first** value, so sending a different
header on each attempt was enough to land each one in a new counter.

Now the IP comes from `app/lib/client-ip.ts` with the `TRUSTED_PROXY_HOPS` variable
(integer >= 0, default 0):

- `0`: `X-Forwarded-For` and `X-Real-IP` are ignored. There is no IP (a Server Action
  cannot read the socket's), so only the per-account limit applies. A shared `unknown`
  counter is not used, since it would block everyone's login at once.
- `N > 0`: the Nth value **counting from the right** is taken, the one added by the
  outermost trusted proxy. With an nginx in front (`$proxy_add_x_forwarded_for`),
  `N = 1`. It is only safe if the app is **not** reachable bypassing that proxy; if it
  is, the client gets to choose its IP again.

The same IP is the one stored in `AuditLog.ip`: with `0` it stays empty.

A rejected attempt only writes `auth.login_rate_limited` the **first** time in each
window (`firstBlock`), so a sustained attack does not flood the audit table.

## Rationale

- **Zero infrastructure.** Consistent with the rest of the project (ADR 0004/0007): do not
  add Redis to a self-hosted app that already tries to minimize moving parts.
- **The default case is a single instance**, where an in-memory counter is exact and
  sufficient.
- **Acceptable degradation with multiple instances.** With N replicas the effective limit
  is N×10 attempts (and N×20 per account): it still stops a massive brute-force attack,
  just less strictly. It is a reasonable compromise compared with adding a shared store.

## Consequences

- **Locking out other people's accounts**: anyone who knows an email can use up its 20
  attempts and keep that person from signing in for up to 15 minutes. This is accepted in
  exchange for slowing down attacks spread across many IPs; a lower threshold would make
  this risk worse.
- Without a trustworthy IP (`TRUSTED_PROXY_HOPS=0`) there is no global limit: trying one
  password against many different emails is only slowed down by the cost of bcrypt.
- The state is lost when the process restarts (an attacker gets a fresh window after a
  restart). Acceptable for the threat model of a self-hosted instance.
- If a strict global limit is ever needed, the implementation in `app/lib/rate-limit.ts`
  can be replaced with one backed by Postgres without touching its callers.
- Documented in [`docs/operations.md`](../operations.md).
