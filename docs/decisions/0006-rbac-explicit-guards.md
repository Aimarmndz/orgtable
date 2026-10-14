# ADR 0006 — Role-based authorization with explicit guards

**Status:** accepted · **Date:** 2026-06-05

## Context

The multi-user feature introduces per-board roles (`OWNER`/`EDITOR`/`VIEWER`) and a
global role (`ADMIN`/`MEMBER`). We need to decide **how** authorization is enforced in
Server Actions and pages.

Next.js 16 offers the `forbidden()` and `unauthorized()` functions, which throw an
interrupt and render a 403/401 page. They are convenient, but **experimental**: they
require enabling `experimental.authInterrupts` in `next.config.ts`.

## Decision

Use **explicit guards** with pure helpers, not the experimental APIs:

```ts
const { role } = await requireBoardAccess(boardId);
if (!canEditBoard(role)) return;          // form action → no-op
if (!canEditBoard(role)) return { ok: false }; // drag & drop action → roll back
```

The role hierarchy lives in `app/lib/roles.ts` (`canEditBoard`, `canManageBoard`),
shared between server and client.

## Rationale

- **No experimental dependencies**: `authInterrupts` may change or require
  `forbidden.tsx` files. Explicit guards are standard and stable.
- **Consistency with the existing code**: actions already "fail silently" when the input
  does not validate (`if (!parsed.success) return;`). The role check follows the same
  pattern.
- **Optimistic UI**: drag & drop actions return `{ ok: false }` instead of throwing; the
  client can roll back its state without an error overlay.
- **Defense in depth**: the UI hides controls according to the role (`board-perms.tsx`),
  but the real barrier is the server guard, which always runs.

## Consequences

- Every mutating Server Action adds one guard line. It is repetitive but explicit and
  easy to audit.
- Administration pages are protected with `requireAdmin()` (redirects to `/boards`), not
  with `forbidden()`.
- If `authInterrupts` becomes stable in the future, we could migrate to `forbidden()` to
  show custom 403 pages without changing the permission model.
