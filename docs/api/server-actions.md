# Server Actions reference

This document lists the project's Server Actions (Next.js 16 + Prisma 7). It is a
reference for contributors: for each action it describes the signature, what it
validates, which authorization it applies, what it does in the database and which side
effects it produces (`revalidatePath`, `redirect`).

All actions live in `app/lib/actions/` and start with the `"use server"` directive.

## Common pattern

Most actions follow the same four-step flow:

1. **Validate** the input with a [zod](https://zod.dev) schema from
   `app/lib/validators.ts`.
2. **Authorize** through the Data Access Layer (`app/lib/dal.ts`): `requireUser`
   (requires a session) or `requireBoardAccess` (requires board membership). Some actions
   apply an **owner-only** check directly in the query.
3. **Mutate** the database with Prisma.
4. **Revalidate** the cache of the affected route with `revalidatePath` and, where
   relevant, **redirect** with `redirect`.

> About the validate/authorize order: in several actions authorization happens **before**
> the body is validated (for example `createBoard`, `createList`), because the action
> first has to work out which board the mutation belongs to. The principle is the same:
> the database is never touched before authorization.

### Error messages and language

Error messages returned to forms are shown to people, so they are in the language of the
request (the `locale` cookie, then `Accept-Language`, then English). The zod schemas carry
message **keys** (for example `"errors.validation.titleRequired"`) instead of text, and
the action resolves them with `issueMessage(m, issue)` from `app/i18n/server.ts`. The
messages live in `locales/<code>/errors.json`. See
[`docs/DECISIONES.md`](../DECISIONES.md) ("Bilingual interface").

### Two invocation styles

| Style | Actions | Input | Return | Effects |
| --- | --- | --- | --- | --- |
| **Form** (`<form action={...}>`) | `completeSetup`, `login`, `logout`, `createBoard`, `renameBoard`, `deleteBoard`, `createList`, `renameList`, `deleteList`, `createCard`, `renameCard`, `deleteCard` | `FormData` (sometimes preceded by `_prev` for `useActionState`) | `void` or `{ error?: string }` | `revalidatePath` and/or `redirect` |
| **Drag and drop** (imperative call from the client) | `reorderList`, `moveCard` | A typed **object** | `{ ok: boolean }` | `revalidatePath`, no `redirect` |

Form actions receive `FormData` and usually end by redirecting or revalidating a route so
the server renders again. Drag-and-drop actions receive a plain object (the client has
already computed the new position), update **a single row** and return `{ ok: boolean }`
so the UI can roll back the optimistic move if something fails. See
[docs/drag-and-drop.md](../drag-and-drop.md).

### Positioning (fractional indexing)

Actions that **create** items (`createList`, `createCard`) compute the new item's
position with `positionAtEnd` from `app/lib/ordering.ts`, which generates a lexicographic
key at the end of the list using *fractional indexing*. This happens inside a transaction
that locks the parent row, so two simultaneous inserts never get the same position.
Drag-and-drop actions do not compute the position: they receive it from the client and
check it with `isValidPositionKey` before saving it. See
[docs/drag-and-drop.md](../drag-and-drop.md#the-server-only-appends-and-validates-what-it-receives).

---

## Summary table

| Action | File | Input | Return | Validates (zod) | Authorization | Effects |
| --- | --- | --- | --- | --- | --- | --- |
| `completeSetup` | `setup.ts` | `(_prev, FormData)` | `Promise<SetupState>` | `setupSchema` | None (only while setup is not done) | `createSession`, `redirect` |
| `login` | `auth.ts` | `(_prev, FormData)` | `Promise<AuthState>` | `loginSchema` | None (it is the login) | `createSession`, `redirect` |
| `logout` | `auth.ts` | `()` | `Promise<void>` | — | — | `deleteSession`, `redirect` |
| `createBoard` | `boards.ts` | `(FormData)` | `Promise<void>` | `boardTitleSchema` | `requireUser` | `revalidatePath`, `redirect` |
| `renameBoard` | `boards.ts` | `(FormData)` | `Promise<void>` | `boardTitleSchema` | `requireBoardAccess` | `revalidatePath` |
| `deleteBoard` | `boards.ts` | `(FormData)` | `Promise<void>` | — | `requireUser` + owner only | `revalidatePath`, `redirect` |
| `createList` | `lists.ts` | `(FormData)` | `Promise<void>` | `listTitleSchema` | `requireBoardAccess` | `revalidatePath` |
| `renameList` | `lists.ts` | `(FormData)` | `Promise<void>` | `listTitleSchema` | `requireBoardAccess` | `revalidatePath` |
| `deleteList` | `lists.ts` | `(FormData)` | `Promise<void>` | — | `requireBoardAccess` | `revalidatePath` |
| `reorderList` | `lists.ts` | `({ listId, position })` | `Promise<{ ok: boolean }>` | `reorderListSchema` (`isValidPositionKey`) | `requireBoardAccess` | `revalidatePath` |
| `createCard` | `cards.ts` | `(FormData)` | `Promise<void>` | `cardTitleSchema` | `requireBoardAccess` | `revalidatePath` |
| `renameCard` | `cards.ts` | `(FormData)` | `Promise<void>` | `cardTitleSchema` | `requireBoardAccess` | `revalidatePath` |
| `deleteCard` | `cards.ts` | `(FormData)` | `Promise<void>` | — | `requireBoardAccess` | `revalidatePath` |
| `moveCard` | `cards.ts` | `({ cardId, toListId, position })` | `Promise<{ ok: boolean }>` | `moveCardSchema` (`isValidPositionKey`) | `requireBoardAccess` | `revalidatePath` |

---

## Setup

### `completeSetup`

**File:** `app/lib/actions/setup.ts` (the transaction lives in `completeInstanceSetup`,
`app/lib/services/setup.ts`)

```ts
export type SetupState = {
  error?: string;
  values?: { instanceName: string; name: string; email: string };
};

export async function completeSetup(
  _prev: SetupState,
  formData: FormData,
): Promise<SetupState>
```

Action of the setup wizard. It is built for `useActionState`, so it receives the previous
state `_prev` and returns a `SetupState` with an optional error message. Errors also
return `values` (what was typed, **never** the password) so the form is not cleared.

- **Early exit:** if `isSetupComplete()` is already true, it calls `redirect("/login")`
  before validating and before spending time on bcrypt (the action ID is still in the
  `/setup` bundle and can be called by hand).
- **Validates:** `setupSchema` on the `instanceName`, `name`, `email` and `password`
  fields. On failure it returns the first zod error message.
- **Authorization:** there is no session yet. The protection is that setup can only be
  completed **once**. Checking `setupCompletedAt` again inside the transaction is **not
  enough on its own** (under READ COMMITTED, two simultaneous submissions would both pass
  it), so the transaction starts with an advisory lock that serializes submissions. The
  reasoning is in [`DECISIONES.md`](../DECISIONES.md) (setup advisory lock entry).
- **Database** (`completeInstanceSetup`, all inside `prisma.$transaction`):
  - `pg_advisory_xact_lock(hashtext('orgtable:setup'))`;
  - reads `InstanceConfig` (`id: "singleton"`) again; if `setupCompletedAt` is already
    set, it returns `{ ok: false, reason: "ALREADY_SETUP" }` (it does not throw);
  - creates the `User` with `role: "ADMIN"` and the hashed password (`hashPassword`,
    email lower-cased);
  - upserts `InstanceConfig` with `instanceName` and `setupCompletedAt`, and returns
    `{ ok: true, userId }`.
- **Effects:**
  - `ALREADY_SETUP` → `redirect("/login")`;
  - on an exception (database down, duplicate email…) it logs the cause without the
    FormData or the email (`describeSetupError`) and returns a generic "could not
    complete the setup" error together with `values`;
  - on success it creates the session (`createSession(userId)`), audits
    `setup.completed` and calls `redirect("/boards")`.

> Implementation detail: `redirect()` is called **outside** the `try/catch`, because it
> throws Next's internal `NEXT_REDIRECT` exception, which the transaction's `catch` must
> not swallow.

See [docs/authentication.md](../authentication.md) and
[docs/database.md](../database.md).

---

## Auth

### `login`

**File:** `app/lib/actions/auth.ts`

```ts
export type AuthState = { error?: string; values?: { email: string } };

export async function login(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState>
```

Signs a person in. Built for `useActionState` (receives `_prev`, returns `AuthState`).
Errors also return `values` (the typed email, **never** the password) to refill the form.

- **Attempt limits:** per IP (only when the IP is trustworthy, `TRUSTED_PROXY_HOPS > 0`)
  before validating, and per account (normalized email) before verifying; the account
  limit resets after a successful login. If either limit is hit, it returns a "too many
  attempts, try again in N s" error with `values`. Values and reasoning are in
  [ADR 0009](../decisions/0009-in-memory-rate-limit.md).
- **Validates:** `loginSchema` on `email` and `password`. On failure it returns a
  "check your email and password" error with `values`.
- **Authorization:** none beforehand (this is the front door).
- **Database:** looks up the `User` by email (lower-cased) and checks the password with
  `verifyPasswordOrDummy` (`app/lib/auth.ts`): if the user does not exist, it compares
  against a valid dummy bcrypt hash of the same cost, so **timing does not reveal**
  whether an email is registered. If there is no user or the password is wrong, it
  returns an "incorrect credentials" error with `values`.
- **Effects:** audits `auth.login_failed` (without the typed email),
  `auth.login_rate_limited` (once per blocked window) or `auth.login`. On success it calls
  `createSession(user.id)`, restores the `locale` cookie from `User.locale` (the
  account's language wins over the browser's) and calls `redirect("/boards")`.

Step by step in [docs/authentication.md](../authentication.md#login).

### `logout`

**File:** `app/lib/actions/auth.ts`

```ts
export async function logout(): Promise<void>
```

Ends the session. Takes no parameters.

- **Validates:** nothing.
- **Authorization:** none (signing out is always safe).
- **Database:** no change to domain data; `deleteSession` removes the session and its
  cookie.
- **Effects:** `deleteSession()`, audits `auth.logout` and calls `redirect("/login")`.

See [docs/authentication.md](../authentication.md).

---

## Boards

### `createBoard`

**File:** `app/lib/actions/boards.ts`

```ts
export async function createBoard(formData: FormData): Promise<void>
```

- **Authorization:** `requireUser()` (requires a valid session; otherwise redirects to
  `/login`).
- **Validates:** `boardTitleSchema` on the `title` field. On failure it **returns without
  doing anything** (no error is shown).
- **Database:** creates the `Board` with `ownerId = user.id` and, in the same nested
  write, a `BoardMember` with `role: "OWNER"`. The creator is both owner and member of the
  board; authorization is always checked against `board_members`.
- **Effects:** `revalidatePath("/boards")` and `redirect(\`/board/${board.id}\`)`.

### `renameBoard`

**File:** `app/lib/actions/boards.ts`

```ts
export async function renameBoard(formData: FormData): Promise<void>
```

- **Authorization:** `requireBoardAccess(boardId)` (requires board membership; otherwise
  redirects to `/boards`).
- **Validates:** `boardTitleSchema` on `title`. On failure it returns without doing
  anything.
- **Database:** `board.update` changing the `title`.
- **Effects:** `revalidatePath(\`/board/${boardId}\`)`. No redirect.

### `deleteBoard`

**File:** `app/lib/actions/boards.ts`

```ts
export async function deleteBoard(formData: FormData): Promise<void>
```

- **Authorization:** `requireUser()` **+ owner only**. Unlike the others, it does not use
  `requireBoardAccess`: it uses `board.deleteMany({ where: { id, ownerId: user.id } })`,
  which deletes only if the user is the owner and **does not fail** otherwise (non-owners
  see no error).
- **Validates:** nothing.
- **Database:** `deleteBoardWithAttachments` (`app/lib/services/attachments.ts`), which
  runs the `board.deleteMany` and, after the commit, deletes the attachment files. Lists
  and cards are deleted by cascade (see the schema in [docs/database.md](../database.md)
  and [docs/attachments.md](../attachments.md)).
- **Effects:** if the board was deleted, `revalidateBoard(boardId)` (notifies open tabs);
  always `revalidatePath("/boards")` and `redirect("/boards")`.

---

## Lists

### `createList`

**File:** `app/lib/actions/lists.ts`

```ts
export async function createList(formData: FormData): Promise<void>
```

- **Authorization:** `requireBoardAccess(boardId)`.
- **Validates:** `listTitleSchema` on `title`. On failure it returns without doing
  anything.
- **Database:** `createListAtEnd` (`app/lib/services/lists.ts`): inside a transaction it
  locks the board (`FOR UPDATE`), finds the last list and creates the new one with
  `positionAtEnd(last?.position ?? null)` (*fractional indexing*, appended at the end).
- **Effects:** `revalidatePath(\`/board/${boardId}\`)`.

### `renameList`

**File:** `app/lib/actions/lists.ts`

```ts
export async function renameList(formData: FormData): Promise<void>
```

- **Authorization:** first resolves the list's `boardId` (`list.findUnique`); if the list
  does not exist, it returns. Then `requireBoardAccess(list.boardId)`.
- **Validates:** `listTitleSchema` on `title`. On failure it returns without doing
  anything.
- **Database:** `list.update` changing the `title`.
- **Effects:** `revalidatePath(\`/board/${list.boardId}\`)`.

### `deleteList`

**File:** `app/lib/actions/lists.ts`

```ts
export async function deleteList(formData: FormData): Promise<void>
```

- **Authorization:** resolves the list's `boardId`; if the list does not exist, it
  returns. Then `requireBoardAccess(list.boardId)`.
- **Validates:** nothing.
- **Database:** `deleteListWithAttachments` (`app/lib/services/attachments.ts`):
  `list.delete` and, after the commit, the attachment files. The list's cards are deleted
  by cascade (`onDelete: Cascade` in the schema, see [docs/database.md](../database.md)).
- **Effects:** `revalidatePath(\`/board/${list.boardId}\`)`.

### `reorderList`

**File:** `app/lib/actions/lists.ts`

```ts
export async function reorderList(input: {
  listId: string;
  position: string;
}): Promise<{ ok: boolean }>
```

**Drag-and-drop** action: saves a list's new order. It receives an object (not
`FormData`) and returns `{ ok: boolean }`.

- **Authorization:** resolves the list's `boardId`; if the list does not exist, it returns
  `{ ok: false }`. Then `requireBoardAccess(list.boardId)`.
- **Validates:** `reorderListSchema` (zod) before any query. The **client computes** the
  new position key (*fractional indexing*) and the server checks it with
  `isValidPositionKey`; an invalid key returns `{ ok: false }` and is not saved. The rule
  is described in
  [docs/drag-and-drop.md](../drag-and-drop.md#key-validation-isvalidpositionkey).
- **Database:** `list.update` changing only the `position` of **one row**.
- **Effects:** `revalidatePath(\`/board/${list.boardId}\`)`; returns `{ ok: true }`. No
  redirect.

See [docs/drag-and-drop.md](../drag-and-drop.md).

---

## Cards

> Internal helper `boardIdForList(listId)`: given a `listId`, returns the `boardId` it
> belongs to (to authorize and revalidate), or `null` if the list does not exist.

### `createCard`

**File:** `app/lib/actions/cards.ts`

```ts
export async function createCard(formData: FormData): Promise<void>
```

- **Authorization:** gets `boardId` through `boardIdForList(listId)`; if it is `null`, it
  returns. Then `requireBoardAccess(boardId)`.
- **Validates:** `cardTitleSchema` on `title`. On failure it returns without doing
  anything.
- **Database:** `createCardAtEnd` (`app/lib/services/cards.ts`): inside a transaction it
  locks the list (`FOR UPDATE`), finds the last card and creates the new one with
  `positionAtEnd(last?.position ?? null)` (*fractional indexing*, at the end of the list).
- **Effects:** `revalidatePath(\`/board/${boardId}\`)`.

### `renameCard`

**File:** `app/lib/actions/cards.ts`

```ts
export async function renameCard(formData: FormData): Promise<void>
```

- **Authorization:** looks up the card selecting `list.boardId`; if it does not exist, it
  returns. Then `requireBoardAccess(card.list.boardId)`.
- **Validates:** `cardTitleSchema` on `title`. On failure it returns without doing
  anything.
- **Database:** `card.update` changing the `title`.
- **Effects:** `revalidatePath(\`/board/${card.list.boardId}\`)`.

### `deleteCard`

**File:** `app/lib/actions/cards.ts`

```ts
export async function deleteCard(formData: FormData): Promise<void>
```

- **Authorization:** looks up the card selecting `list.boardId`; if it does not exist, it
  returns. Then `requireBoardAccess(card.list.boardId)`.
- **Validates:** nothing.
- **Database:** `deleteCardWithAttachments` (`app/lib/services/attachments.ts`):
  `card.delete` and, after the commit, the attachment files.
- **Effects:** `revalidatePath(\`/board/${card.list.boardId}\`)`.

### `moveCard`

**File:** `app/lib/actions/cards.ts`

```ts
export async function moveCard(input: {
  cardId: string;
  toListId: string;
  position: string;
}): Promise<{ ok: boolean }>
```

**Drag-and-drop** action: moves a card, which may change list and/or position. It
receives an object (not `FormData`) and returns `{ ok: boolean }`.

- **Authorization:** gets the target list's `boardId` through
  `boardIdForList(input.toListId)`; if it is `null`, it returns `{ ok: false }`. Then
  `requireBoardAccess(boardId)`, and `cardBelongsToBoard` checks that the card belongs to
  that same board (prevents moving a card from a board you cannot edit).
- **Validates:** `moveCardSchema` (zod) before any query. The **client computes** the new
  position key (*fractional indexing*) and the server checks it with
  `isValidPositionKey`; an invalid key returns `{ ok: false }` and is not saved. The rule
  is described in
  [docs/drag-and-drop.md](../drag-and-drop.md#key-validation-isvalidpositionkey).
- **Database:** a single `card.update` that sets `listId: toListId` and `position`.
- **Effects:** `revalidatePath(\`/board/${boardId}\`)`; returns `{ ok: true }`. No
  redirect.

See [docs/drag-and-drop.md](../drag-and-drop.md).

---

## Board roles and administration

Every mutation that goes through `requireBoardAccess` **also checks the role** with the
helpers in `app/lib/roles.ts` (`canEditBoard`, `canManageBoard`). If the role is not
enough, the action does nothing (forms) or returns `{ ok: false }` (drag and drop). See
[docs/authorization.md](../authorization.md).

### Board members — `app/lib/actions/members.ts`

Board **owner** (`OWNER`) only.

- **`addBoardMember(_prev, formData)`** — `{ boardId, email, role }`. Validates with
  `addMemberSchema`. Looks up an existing user by email; if none exists, it returns an
  error. Creates the row in `board_members`. Returns `{ error?, message?, values? }` for
  `useActionState`; `values` (the submitted `{ email, role }`) only comes with `error`, so
  the form is not cleared on failure.
- **`updateBoardMemberRole(formData)`** — `{ boardId, userId, role }`. Changes a member's
  role. The board owner's role cannot be changed. If the user is not a member or already
  has that role, it does nothing (no audit, no notification).
- **`removeBoardMember(formData)`** — `{ boardId, userId }`. Removes a member and their
  card assignments on the board (`removeMemberFromBoard`, one transaction). The owner
  cannot be removed. If the user was not a member, nothing is audited or notified.

All three call `revalidateBoard(boardId)`, so other connected members see the change
live.

### User administration — `app/lib/actions/admin.ts`

Global **administrator** only (`requireAdmin`).

- **`createUser(_prev, formData)`** — `{ name, email, password, role }`. Validates with
  `createUserSchema`, checks the email is unique, hashes the password and creates the
  account. Returns `{ error?, field?, message?, values? }` for `useActionState`; `field`
  (`"email"`) marks the field with the error, and `values` (`{ name, email, role }`,
  **never** the password) only comes with `error`, so the form is not cleared.
- **`updateUserRole(formData)`** — `{ userId, role }`. Changes the global role. You cannot
  change your own role. The result is reported by redirecting with a query string.
- **`resetUserPassword(formData)`** — `{ userId, password }`. Resets the password and, in
  the same transaction (`resetPasswordAndRevokeAccess`), revokes all the user's sessions
  and **deletes their API tokens** (see [docs/admin.md](../admin.md)). Reported by
  redirecting with a query string.
- **`revokeUserSessions(formData)`** — `{ userId }`. Ends all the user's active sessions
  immediately; API tokens remain valid. Reported by redirecting with a query string.
- **`deleteUser(formData)`** — `{ userId }`. Deletes the account. You cannot delete
  yourself, nor a user who owns boards (cascade). Reported by redirecting with a query
  string.

---

## Sign-up, own account and instance

| Action | File | Who | What it does |
|---|---|---|---|
| `register` | `actions/register.ts` | Anonymous, when sign-up is open | Creates a `MEMBER` account with `termsAcceptedAt`, signs in and redirects to `/boards`. |
| `updateProfile` | `actions/account.ts` | The person themselves | Name and email; changing the email requires `currentPassword`. |
| `changePassword` | `actions/account.ts` | The person themselves | Checks the current password and ends the other sessions. |
| `revokeSession` / `revokeOtherSessions` | `actions/account.ts` | The person themselves | Ends one of their own sessions, or all except the current one. |
| `deleteAccount` | `actions/account.ts` | The person themselves | With the password: deletes the account and its boards (and files) and redirects to `/login?account=deleted`. Not allowed for the last `ADMIN` account. |
| `saveInstanceSettings` | `actions/instance.ts` | `ADMIN` | Instance name, open or closed sign-up, and the operator's legal details. |

All of them validate with zod (`registerSchema`, `profileSchema`, `changePasswordSchema`,
`deleteAccountSchema` and `instanceSettingsSchema` in `validators.ts`) and audit the event.

## See also

- [docs/authentication.md](../authentication.md) — sessions, `requireUser`,
  `requireBoardAccess` and the Data Access Layer.
- [docs/authorization.md](../authorization.md) — the role model and where it applies.
- [docs/drag-and-drop.md](../drag-and-drop.md) — optimistic reordering and client-side
  *fractional indexing*.
- [docs/database.md](../database.md) — Prisma schema, relations and cascade deletes.

---

In short: every Server Action follows the validate → authorize → mutate → revalidate
pattern, in two variants: form actions that receive `FormData` and usually redirect, and
drag-and-drop actions (`reorderList`, `moveCard`) that receive an object and return
`{ ok: boolean }`.
