# User administration

By default, accounts are created by the instance **administrator** in `/admin/users`. If
the administrator opens **sign-up** in `/admin/instance`, anyone can create a `MEMBER`
account at `/register` (see [privacy.md](./privacy.md)). The first administrator is
whoever completes the initial setup wizard (see
[`docs/setup-wizard.md`](./setup-wizard.md)).

Administration has three tabs: **Users** (`/admin/users`), **Instance**
(`/admin/instance`: name, open or closed sign-up and the operator's legal details) and
**Audit** (`/admin/audit`). Only users with the global `ADMIN` role see the
**Administration** link in the account menu and can access it. The route is protected by
`requireAdmin()` on the server (see [`docs/authorization.md`](./authorization.md)).

## What the administrator can do

- **Create accounts**: name, email, initial password and global role (`MEMBER` or
  `ADMIN`). The user can sign in with that password.
- **Change the global role** of any other account (promote to admin or demote).
- **Reset the password** of any account (by typing a new one). It also closes all the
  user's sessions and **deletes all their API tokens**: use it when an account may be
  compromised. The user will have to create new tokens in `/settings`.
- **Sign out** an account: revokes its browser sessions, but **not** its API tokens.
- **Delete accounts** (their sessions and tokens are deleted in cascade).

## Safeguards

To avoid leaving the instance without an administrator or losing data by accident:

- **You cannot change your own role** or **delete your own account from this page**.
  This stops the only administrator from locking themselves out. To hand over
  administration, promote someone else to `ADMIN` first. Each person can still delete
  their own account from *Settings › Privacy and data*, except the last `ADMIN` account.
- **A user who owns boards cannot be deleted**: deleting them would cascade to their
  boards and all their content. The administrator must transfer or delete those boards
  first. The action is blocked with a warning.

## Implementation notes

- Server Actions: [`app/lib/actions/admin.ts`](../app/lib/actions/admin.ts).
- Creating a user uses `useActionState` to give inline feedback and clear the form on
  success.
- Per-row actions (change role, reset password, delete) return their result through a
  redirect with a query string (`?ok=…` / `?error=…`) that the page turns into a notice.
  This avoids a stateful Client Component for every table row.
- Passwords are stored with bcrypt (see [`docs/authentication.md`](./authentication.md)).
