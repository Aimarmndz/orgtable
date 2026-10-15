# Roles and permissions of an organization

Every member of an organization holds one **base role** and, optionally, one **custom role**
the organization defined. What they may do is a set of named **permissions**
(`app/lib/permissions.ts`), checked by the services against the database; the pages only
hide what is not allowed.

## Base roles

| Role       | Permissions     | Besides the permissions                                                              |
| ---------- | --------------- | ------------------------------------------------------------------------------------ |
| **Owner**  | All 13          | Rename the organization, change its address, appoint admins and owners, delete it.   |
| **Admin**  | All 13          | Change roles of plain members, reset passwords of accounts the organization created. |
| **Member** | `boards.create` | Edit the boards shared with the organization.                                        |

Base roles cannot be edited or deleted. The escalation rules of `app/lib/roles.ts` still hold
(nobody grants above their own role, only owners appoint admins, the last owner stays).

## Custom roles

Owners and admins create them at **Settings › Roles and permissions**
(`/<slug>/settings/roles`): a name, a colour, a description and any of the permissions below.
A member with a custom role holds **exactly** its permissions instead of the member defaults,
so a role can also do less than a plain member (an empty role cannot create boards). It always
sits on top of the base role _Member_: making someone an admin or owner drops it.

| Group             | Permission            | What it allows                                                                 |
| ----------------- | --------------------- | ------------------------------------------------------------------------------ |
| Boards            | `boards.view_all`     | Read every board of the organization, private ones too, without an invitation. |
|                   | `boards.create`       | Create boards in the organization.                                             |
|                   | `boards.visibility`   | Switch a board it can open between "whole organization" and private.           |
|                   | `boards.delete`       | Delete a board of the organization it can open.                                |
| People            | `people.invite`       | Create employee accounts, as plain members only.                               |
|                   | `people.teams`        | Manage teams.                                                                  |
|                   | `people.roles`        | Change other people's role. **Base roles only**: never in a custom role.       |
|                   | `people.remove`       | Remove plain members (never admins or owners).                                 |
| Integrations      | `integrations.manage` | Manage webhooks and apps.                                                      |
|                   | `apikeys.manage`      | Manage the organization's API keys.                                            |
| Data and security | `audit.view`          | Read the organization's activity log.                                          |
|                   | `data.export`         | Export the organization's data.                                                |
|                   | `backups.manage`      | Schedule backups, change where they go, restore.                               |

## Rules that keep it safe

- **Nobody escalates through a custom role.** Changing roles (`people.roles`) is never part of
  one, and only owners and admins create, edit, assign or delete roles. A role is stored with
  only the permissions the person saving it holds, and the list is sanitized again every time it
  is read (`permissionsOf`), so a row written by hand cannot smuggle in a base-only permission.
- **Roles never cross organizations.** A member's custom role is a foreign key on
  `(workspaceId, customRoleId)`: the database itself refuses a role of another organization, and
  a `CHECK` refuses a custom role on an admin or owner. Services look roles up by
  `{ workspaceId, id }`, so a foreign id reads as "not found".
- **Deleting a role** turns its holders into plain members in the same transaction.
- **Board access** is still decided only in `app/lib/access.ts`: `boards.view_all` is one more
  way in there (read-only on private boards), next to explicit memberships and the base roles.

## Where it lives

| Piece                       | File                                                             |
| --------------------------- | ---------------------------------------------------------------- |
| Permission catalogue, rules | `app/lib/permissions.ts`                                         |
| Effective access            | `app/lib/access.ts` (`workspaceAccessOf`, board access)          |
| Custom roles (rules)        | `app/lib/services/roles.ts`                                      |
| Actions                     | `app/lib/actions/roles.ts`                                       |
| Pages                       | `app/(app)/[workspace]/settings/roles/`                          |
| Tests                       | `test/permissions.test.ts`, `test/integration/roles.int.test.ts` |
