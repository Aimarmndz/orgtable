# Card collaboration: assignees and comments

Board members can be **assigned** to a card and can **comment** on it. The design
decision is in [ADR 0014](./decisions/0014-card-collaboration.md).

## Assignees

- In the card modal, the **Assignees** section shows who is assigned (avatars with their
  initial) and, for users who can edit, a list of board members to assign with one click.
  An assignee can be removed with the ✕.
- The card face on the board shows the assignees' avatars, so you can see at a glance who
  is working on it.
- **Only board members can be assigned**: the server checks it (`assignMemberToCard` in
  `app/lib/services/assignees.ts`). Assigning and unassigning require edit permission.
- Assigning someone else sends them a `card.assigned` notification
  ([docs/notifications.md](./notifications.md)).
- **Removing a member from a board deletes their assignments** on that board's cards
  (`removeMemberFromBoard` in `app/lib/services/members.ts`, in the same transaction as
  the membership). Otherwise they would keep receiving the card title and comment text
  from a board they no longer have access to.

## Comments

- The **Comments** section of the modal is a flat thread: each comment shows its author,
  date and text. Commenting requires edit permission (viewers cannot comment).
- A comment can be **deleted** by its **author** or by the board **owner**.
- When someone comments, the card's **assignees** (except the author) who are still board
  members receive a `comment.added` notification. The membership filter also covers
  orphaned assignments left by member removals made before assignments were cleaned up
  (they were not deleted from the database).

## Files

- `CardAssignee` and `Comment` models in `prisma/schema.prisma` (migration
  `…_card_collaboration`).
- Testable services: `app/lib/services/assignees.ts` (`assignMemberToCard`),
  `app/lib/services/cards.ts` (`cardContext`), `app/lib/services/members.ts`
  (`removeMemberFromBoard`).
- Server Actions: `app/lib/actions/assignees.ts`, `app/lib/actions/comments.ts`.
- UI: sections in `app/components/card/card-modal.tsx`; avatars in
  `app/components/board/card-item.tsx`.
- DTOs and reads: `app/lib/types.ts` (`AssigneeDTO`, `CommentDTO`), `getBoardWithLists` in
  `app/lib/queries.ts`. The API exposes them in card responses
  (`app/lib/api/serialize.ts`).
- Tests: `test/integration/collaboration.int.test.ts` and
  `test/integration/members.int.test.ts`.

## Limits and possible improvements

- Flat thread, with no nested replies or reactions (reactions are in the backlog).
- Creating/deleting comments and assignments **through the API** is a possible extension
  (today the API exposes them read-only; the interface covers writes).
- @mentions that notify a specific user: a natural extension of parsing the text.
