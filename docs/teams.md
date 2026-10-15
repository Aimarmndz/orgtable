# Teams

A **team** is a group of people of an organization that gets access to some of its boards
together: instead of inviting five designers to six boards one by one, the _Design_ team gets
the six boards and the five people get them all. Teams live at **Settings › Teams**
(`/<slug>/settings/teams`).

## What a team gives

Each board a team holds has a role for it: **Reader** (`VIEWER`), **Editor** (`EDITOR`) or
**Manager** (`OWNER`). Every member of the team gets that role on that board, private boards
included. Someone who reaches a board by several paths (an explicit invitation, their
organization role, one or more teams) keeps the **highest** one. This is decided in one place,
`app/lib/access.ts`, which every page, action, the API, search, real time and attachments use.

Access through a team ends when the board is taken from the team, the person leaves the team,
the team is deleted or the person leaves the organization (their team memberships go with it).

## Who manages teams

People with the `people.teams` permission: owners and admins, and any custom role that holds it
(see [roles](./roles.md)). Every member of the organization can see the teams.

**A team never gives more than the person configuring it has.** They can only add a board they
can open themselves, and only with a role up to their own on it: a team lead who edits a board
cannot make a team its manager, and cannot hand out a private board they do not see.

## Isolation

`TeamMember` points to `WorkspaceMember` and `TeamBoard` to `Board` with foreign keys that
include `workspaceId`, and both point to `Team` the same way. The database itself refuses a
person or a board of another organization in a team, and a team of another organization in a
form is "not found" for the services, which look teams up by `{ workspaceId, id }`.

## Where it lives

| Piece   | File                                                                |
| ------- | ------------------------------------------------------------------- |
| Rules   | `app/lib/services/teams.ts`                                         |
| Actions | `app/lib/actions/teams.ts`                                          |
| Access  | `app/lib/access.ts` (`accessibleBoardsWhere`, `effectiveBoardRole`) |
| Pages   | `app/(app)/[workspace]/settings/teams/`                             |
| Tests   | `test/integration/teams.int.test.ts`                                |
