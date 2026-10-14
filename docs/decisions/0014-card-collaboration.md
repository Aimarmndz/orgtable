# ADR 0014 — Card collaboration model (assignees and comments)

**Status:** accepted · **Date:** 2026-06-07 · **Related:** [ADR 0006](./0006-rbac-explicit-guards.md), [ADR 0012](./0012-notifications.md)

## Context

The card collaboration feature adds **assigning members** to a card and **comments**. We
need to decide the data model, who can do what, and what happens on deletion.

## Decision

- **Assignees**: `CardAssignee` join table (cardId, userId). Only people who are **already
  members of the board** can be assigned; the server checks it (the
  `assignMemberToCard` service, reused by the Server Action). Assigning/unassigning
  requires **edit** permission (`canEditBoard`).
- **Comments**: `Comment` model (author, text, date), a **flat thread** with no nesting.
  Commenting requires edit permission; **deleting** can be done by the **author or the
  owner** of the board.
- **Cascade delete**: both `CardAssignee` and `Comment` are deleted with the card and with
  the user (`onDelete: Cascade`).
- **Notifications** reusing `notify()` ([ADR 0012](./0012-notifications.md)):
  `card.assigned` when assigning someone else; `comment.added` to the card's assignees
  (except the author).

## Rationale

- **Assigning only members** avoids an inconsistent state (assigning someone who cannot
  see the board) and keeps the server as the only authority
  ([ADR 0006](./0006-rbac-explicit-guards.md)). The logic lives in a testable service.
- **A flat thread** covers 95% of the cases (a short discussion on a card) without the
  complexity of reply trees; it fits a Trello clone.
- **Cascade on comments**: simplicity and consistent deletion of accounts/cards are
  favored over preserving history with a null author. If the discussion should ever be
  kept when an account is deleted, `authorId` would change to `onDelete: SetNull`
  (nullable) and the UI would show "deleted user".

## Consequences

- A comment disappears if its author (a member) is deleted. Acceptable: deleting accounts
  is rare and restricted (someone who owns boards cannot be deleted).
- The API exposes assignees and comments in card responses (read-only). Creating/deleting
  through the API is left as an extension; the interface already covers it fully.
- Assignees and comments are **not** included in board export/import (just like
  attachments): the export is a copy of the board's structural content.
- Documented in [`docs/card-collaboration.md`](../card-collaboration.md).
