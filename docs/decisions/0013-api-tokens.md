# ADR 0013 — Public API with hashed personal tokens (Bearer)

**Status:** accepted · **Date:** 2026-06-07 · **Related:** [ADR 0006](./0006-rbac-explicit-guards.md), [ADR 0008](./0008-session-store.md)

## Context

The public API feature opens a REST API (`/api/v1`) so orgtable can be used from scripts
or other applications. We need to decide **how that API authenticates** (without browser
cookies) and **how the credentials are stored**.

## Decision

- **Personal access tokens** (PAT) that the user creates in `/settings`. The request sends
  them in `Authorization: Bearer <token>`.
- **The token is never stored in plain text**: only its **SHA-256 hash**
  (`ApiToken.tokenHash`, unique) and a visible **prefix** to identify it in the list. The
  full token is shown **only once**, when it is created.
- The API **reuses the existing role-based authorization**: once the token resolves to a
  user, each endpoint checks the board role against `board_members` again (just like the
  Server Actions, [ADR 0006](./0006-rbac-explicit-guards.md)). A token acts **as its
  owner**, with exactly the same access, no more and no less.
- API mutations call `revalidateBoard()`, so changes made through the API also reach
  connected browsers live (via the realtime feature).

## Rationale

- **Unsalted SHA-256 is enough for a high-entropy token.** The token is 24 random bytes
  (not a human password), so there is no dictionary attack to mitigate with
  bcrypt/argon2; a fast hash also lets it be resolved with a single `findUnique` on the
  hash. (User passwords do use bcrypt: the risk there is different.)
- **Consistent with the revocation model** ([ADR 0008](./0008-session-store.md)): revoking
  means deleting the row; the token stops working instantly.
- **Reusing authorization** avoids a second source of truth for permissions: the server is
  still the only authority and there is no way for the API to grant more than the UI does.
- **Zero new dependencies**: `node:crypto` is already available.

## Consequences

- No OAuth and no per-token scopes: a token has all of the user's access. If finer-grained
  permissions were needed in the future (read-only, a specific board), columns would be
  added to `ApiToken` along with an extra check, without changing the authentication
  model.
- `lastUsedAt` is updated on every request (best-effort); it is a cheap write and helps
  the user spot tokens that are in use or unused.
- Tokens **do not depend on the `Session` table**: signing out or "End sessions" in
  `/admin/users` does not invalidate them. That is why **resetting a user's password**
  (an administrator action) **also deletes all their tokens** in the same transaction
  that revokes their sessions (`resetPasswordAndRevokeAccess` in
  `app/lib/services/users.ts`, added on 2026-09-24): if the account was compromised, a
  token created by the attacker would leave the API open. The user will have to create
  new tokens. See [`docs/api/public-api.md`](../api/public-api.md) and
  [`docs/admin.md`](../admin.md).
- The initial surface covers boards, lists and cards (essential CRUD); checklists, labels
  and attachments are the natural extension.
- Documented in [`docs/api/public-api.md`](../api/public-api.md).
