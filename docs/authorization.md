# Authorization and roles

orgtable has **two independent levels of roles**:

- **Global role** (`User.role`): `ADMIN` or `MEMBER`. Decides who administers the
  instance (creates accounts, changes roles, resets passwords, deletes users).
- **Board role** (`BoardMember.role`): `OWNER`, `EDITOR` or `VIEWER`. Decides what each
  person can do **inside a specific board**.

Both models are part of the schema (see `docs/database.md`) and every mutation enforces
them.

## Board role hierarchy

```
VIEWER  <  EDITOR  <  OWNER
```

| Action | VIEWER | EDITOR | OWNER |
| --- | :---: | :---: | :---: |
| View the board, lists and cards | ✅ | ✅ | ✅ |
| Create/edit/move lists, cards and checklists | — | ✅ | ✅ |
| Apply existing labels to cards | — | ✅ | ✅ |
| Create/delete board labels | — | — | ✅ |
| Rename the board | — | — | ✅ |
| Invite/remove members and change their roles | — | — | ✅ |
| Delete the board | — | — | ✅ (owner only) |

A board's **owner** is its creator (`Board.ownerId`), who is also a member with the
`OWNER` role. The owner's role cannot be changed and the owner cannot be removed from the
board: it anchors ownership.

The helpers that encode this hierarchy live in
[`app/lib/roles.ts`](../app/lib/roles.ts):

```ts
canEditBoard(role)    // EDITOR or OWNER → can edit content
canManageBoard(role)  // OWNER only → can administer the board
```

This module deliberately does **not** import `server-only`: Client Components also import
it to hide the controls the user cannot use.

## Where authorization is enforced

The golden rule: **the server is the only authority**. The interface hides buttons for
convenience, but it is never the security barrier.

### 1. Data Access Layer (`app/lib/dal.ts`)

- `requireUser()` — requires a valid session (otherwise redirects to `/login`).
- `requireAdmin()` — requires `User.role === "ADMIN"` (otherwise redirects to `/boards`).
- `requireBoardAccess(boardId)` — requires board membership (otherwise redirects to
  `/boards`) and **returns the user's role** on that board.

### 2. Every Server Action

After `requireBoardAccess`, the action checks the role with the `roles.ts` helpers and,
if it is not enough, **does nothing** (form actions) or returns `{ ok: false }`
(drag-and-drop and other imperative actions):

```ts
export async function createList(formData: FormData) {
  const boardId = String(formData.get("boardId"));
  const { role } = await requireBoardAccess(boardId);
  if (!canEditBoard(role)) return; // security backstop
  // …
}
```

### 3. The interface (defense in depth)

The board component receives the viewer's role and exposes it through context
([`board-perms.tsx`](../app/components/board/board-perms.tsx)). With `canEdit` and
`canManage`, components hide drag and drop, the "add" forms, the delete buttons, editing
in the card modal and the member management panel. A `VIEWER` sees a **read-only** board.

## Why explicit guards instead of `forbidden()`

Next.js 16 provides `forbidden()`/`unauthorized()` to stop execution with a 403/401 page,
but they are **experimental** (they require `experimental.authInterrupts`). orgtable
prefers **explicit guards** (`if (!canEditBoard(role)) return;`) for three reasons: they
do not depend on an experimental API, they match the existing "fail silently" style of the
actions, and they let drag-and-drop actions return `{ ok: false }` so the client can roll
back its optimistic UI without throwing. The decision is recorded in
[ADR 0006](./decisions/0006-rbac-explicit-guards.md).

## Inviting members

Only **existing accounts** can be invited; there are no invitation emails. The flow is:

1. The account exists: the administrator created it in `/admin/users` (see
   [`docs/admin.md`](./admin.md)), or the person signed up, if the instance has open
   sign-up enabled.
2. The board owner opens **Members**, types the email of an existing person and picks a
   role (`EDITOR` or `VIEWER`).

If the email does not match any account, the invitation is rejected. This avoids
invitation emails, tokens and verification in a self-hosted app for small teams.
