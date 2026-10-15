# Organizations and workspaces

orgtable is a free service for people and companies: anyone signs up for themselves or
registers their organization, and organizations create their employees' accounts. The same code
runs a private instance for one person or team.

## Workspaces

Every board lives in a **workspace**, the first segment of its URL:

```
https://orgtable.example.org/<workspace>/<board>
```

- **Personal**: one per account, created with it. Its address is the person's handle, taken
  from their **name** (never the email, so shared links do not reveal addresses).
- **Organization**: registered by anyone, free (`/register` › "For my organization", or
  _Create an organization_ on `/boards`). Its address is chosen when it is created.

Both share one namespace and the same rules (`app/lib/slugs.ts`): 3 to 39 lowercase letters,
digits and single hyphens, and none of the app's own routes or official-sounding words
(`admin`, `login`, `settings`, `support`…).

A board's second segment is its **slug**, from the title and unique in its workspace (`roadmap`,
`roadmap-2`; `settings` and `members` are reserved). It follows the title when the board is
renamed. The board's **id** works in its place (`/<workspace>/<id>`) and redirects to the
canonical address, as does the old `/board/<id>`; the query string (`?card=…`) is kept.

## Roles

| Workspace role | Can                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Owner**      | Everything: name, address, admins and owners, deleting the organization.                                               |
| **Admin**      | Create employee accounts, remove members, reset the password of accounts the organization created, manage every board. |
| **Member**     | Create boards and work on the boards shared with the organization.                                                     |

On top of these, each organization can define **custom roles** with exactly the permissions it
wants to give (see [roles and permissions](./roles.md)).

Rules that make escalation impossible (`app/lib/roles.ts`, enforced in
`app/lib/services/workspaces.ts` against the database):

- Nobody grants a role above their own; only owners grant admin or owner.
- Admins act only on members, never on other admins or owners.
- Nobody changes their own role.
- An organization always keeps an owner: the last one can be neither demoted nor removed, nor
  delete their account (row locks make simultaneous changes safe).
- A suspended organization is frozen: no member, role, password, name or address changes.

## Who can open a board

Decided in one place, `app/lib/access.ts`, which every page, Server Action, route handler, the
API, search, real time, attachments and notifications use. The effective role is the higher of:

1. the explicit board membership (owner, editor, viewer), and
2. what the workspace role gives: owners and admins manage **every** board of the organization;
   members **edit** the boards whose visibility is _Everyone in the organization_ and see nothing
   of the _Private_ ones.

A suspended workspace gives nobody access. Someone outside the organization added to one board
(a guest) sees that board only, and the names (not the emails) of the organization's people.

## Settings of an organization

Every member of an organization opens its settings at `/<slug>/settings`. Each section is its
own page with its own address, listed in a side menu (on a phone, `/<slug>/settings` is the
list of sections and every page has a "back" link instead of the menu):

| Page                           | What                                                            |
| ------------------------------ | --------------------------------------------------------------- |
| `/<slug>/settings`             | Index of the sections                                           |
| `/<slug>/settings/general`     | Name and address (owners), leaving, the danger zone (owners)    |
| `/<slug>/settings/members`     | Who is in the organization and their role                       |
| `/<slug>/settings/members/new` | Create an employee account (`people.invite`)                    |
| `/<slug>/settings/roles`       | Base and custom roles; `/roles/<id>` edits one (owners, admins) |

The pages only show what the person's role allows; the services check everything again. How
the tenant boundary is enforced is in [authorization](./authorization.md#tenant-isolation).

## Employees

Owners and admins create accounts for their employees on _Settings › Members_. With
[email](./email.md) on, the person gets an invitation to choose their own password; without it,
the organization sets an initial one. These accounts belong to the person (their own personal
workspace, data export, deletion) but the organization can reset their password, so:

- they can only be invited to boards of **that** organization (otherwise an organization could
  register someone else's address and receive what they are invited to);
- creating organizations and employees follows the instance's open sign-up switch (on a private
  instance only the instance administrator can) and is rate limited.

## Deleting

- **An organization** (owners, after typing its address): all its boards, lists, cards and
  attachment files. Employee accounts stay, without it.
- **An account**: its personal workspace with its boards; organizations where it was alone; in
  the others its boards are handed to an owner.

## The instance administrator

`/admin/workspaces` shows figures of the whole service and every workspace (name, address,
owners, members and boards count) with suspend, reactivate and delete. The administrator has no
access to anyone's boards by being one.
