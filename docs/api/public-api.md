# Public API (REST v1)

orgtable exposes a REST API under `/api/v1` so you can automate boards from scripts or
other applications. The design decision is recorded in
[ADR 0013](../decisions/0013-api-tokens.md).

## Authentication

Requests are authenticated with a **personal access token** in the `Authorization`
header:

```
Authorization: Bearer orgt_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- Create and revoke your tokens in **Settings** (`/settings`). The full token is shown
  **only once**, so store it safely. The database keeps only its SHA-256 hash.
- A token acts **as you**: it has the same access to boards as you (same role). The
  server checks the board role again on every request.
- **Scope**: when you create the token you choose **Read and write** or **Read only**. A
  read-only token can make `GET` requests but gets `403` on any `POST`/`PATCH`/`DELETE`.
- **Expiry**: optionally, the token expires (30/90/365 days). An expired token is rejected
  with `401` (it is not deleted; Settings shows it as expired).
- Revoking a token (deleting it in Settings) invalidates it immediately.

## Conventions

- Request and response bodies are **JSON** (`Content-Type: application/json`).
- Dates are returned in **ISO 8601** (UTC).
- The API answers in **English only**, whatever the language of the account: it is meant
  for programs.
- Errors have the shape `{ "error": "message" }` and a suitable HTTP status:

| Status | Meaning |
|--------|---------|
| `401` | Missing or invalid token |
| `403` | Authenticated, but not allowed (for example, editing as a viewer) |
| `404` | Does not exist **or** you have no access (the API does not say which) |
| `422` | Invalid body (validation) |

> Returning `404` (not `403`) for someone else's resource is intentional: the API does not
> reveal that boards you do not belong to exist.

## Endpoints

### Boards

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/api/v1/boards` | member | Your boards (summary) |
| `POST` | `/api/v1/boards` | — | Creates a board (you become its owner) |
| `GET` | `/api/v1/boards/:id` | member | The board with its lists and cards |
| `PATCH` | `/api/v1/boards/:id` | owner | Renames the board |
| `DELETE` | `/api/v1/boards/:id` | owner | Deletes the board |

### Lists

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/api/v1/boards/:id/lists` | member | The board's lists, in order |
| `POST` | `/api/v1/boards/:id/lists` | editor | Creates a list at the end |

### Cards

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/api/v1/lists/:id/cards` | member | The list's cards, in order |
| `POST` | `/api/v1/lists/:id/cards` | editor | Creates a card at the end |
| `GET` | `/api/v1/cards/:id` | member | A card's details |
| `PATCH` | `/api/v1/cards/:id` | editor | Updates the title, description or due date |
| `DELETE` | `/api/v1/cards/:id` | editor | Deletes the card |

**Bodies:**

- Create a board / list: `{ "title": "…" }`.
- Create a card: `{ "title": "…", "description"?: string|null, "dueDate"?: "YYYY-MM-DD"|null }`.
- Update a card (`PATCH`): any of `title`, `description`, `dueDate` (at least one).
- `description`: at most 5000 characters.
- `dueDate`: `"YYYY-MM-DD"` (stored at midnight UTC) or an ISO 8601 date-time with a time
  zone (`"2026-07-01T09:00:00Z"`, `"2026-07-01T09:00:00+02:00"`). `null` removes the due
  date. Any other value, including the empty string `""` or an impossible date such as
  `"2026-02-31"`, returns `422` and changes nothing.

## Examples

```bash
TOKEN="orgt_…"
BASE="https://your-instance/api/v1"

# List boards
curl -H "Authorization: Bearer $TOKEN" "$BASE/boards"

# Create a board
curl -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"title":"Sprint 12"}' "$BASE/boards"

# Create a list on a board
curl -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"title":"In progress"}' "$BASE/boards/<boardId>/lists"

# Create a card with a due date
curl -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"title":"Review PR","dueDate":"2026-07-01"}' "$BASE/lists/<listId>/cards"

# Edit a card
curl -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"title":"Reviewed","dueDate":null}' "$BASE/cards/<cardId>"
```

## Real time

API mutations publish the same events as the interface, so browsers with the board open
see the changes live (see [docs/realtime.md](../realtime.md)).

## Implementation

- Authentication and authorization: `app/lib/api/auth.ts` (Bearer → user, role per board).
- Token generation and hashing: `app/lib/api/tokens.ts`. Responses: `app/lib/api/respond.ts`
  (validation errors use the shared zod schemas, whose message keys are resolved to
  English there).
- JSON serialization: `app/lib/api/serialize.ts`.
- Routes: `app/api/v1/**`. Token management: `/settings` (`app/(app)/settings`).

## Limits and future work

- Tokens support a **scope** (read only) and an **expiry date**; there is no per-board
  scope yet.
- The API covers boards, lists and cards. Checklists, labels, attachments and members are
  future work. Adding a resource means one more route handler that reuses
  `authenticateApiToken` + `apiBoardRole` + `isReadOnly`.
- API **rate limiting** and an **OpenAPI** reference are also future work.
