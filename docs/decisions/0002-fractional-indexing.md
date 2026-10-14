# ADR 0002 — Fractional indexing for the order of lists and cards

**Status:** accepted · **Date:** 2026-06-04

## Context

The core of a Kanban board is reordering lists and cards with drag & drop. Every move
must be persisted efficiently and support frequent reordering without degrading.

Options evaluated for the ordering column:

1. **Integer/float `position`** (e.g. `0.5` between `0` and `1`): runs out of
   floating-point precision after a few repeated insertions into the same gap, silently
   breaking the order. Or else it forces reindexing many rows per move.
2. **LexoRank** (Jira style): robust but with complex rebalancing logic.
3. **Fractional indexing** (Figma's `fractional-indexing` library, ~1 KB).

## Decision

Use **fractional indexing**. The `List.position` and `Card.position` columns are
`String` (lexicographic key). To insert/move between two neighbors A and B, compute
`generateKeyBetween(A.position, B.position)`; at the end, `generateKeyBetween(last, null)`.

## Rationale

- **One move = a single `UPDATE`** of the row being moved. Neighbours are never touched,
  so there are no write storms and no reindexing.
- The order is stable and is kept with a simple lexicographic sort in SQL.
- Moving a card between lists is the same `UPDATE`, changing `listId` and `position`.

## Consequences

- Two concurrent clients could generate the same key when moving to exactly the same spot.
  In the MVP (a single user) this does not apply; when realtime arrives
  (see `docs/roadmap.md`) the "loser's" key will be regenerated.
- **Collation "C" is mandatory** (added 2026-09-24). The keys (base62 `0-9A-Za-z`) are
  only correctly ordered byte by byte. With the default collation of a glibc database
  (`en_US.utf8` in the Debian postgres image, Ubuntu or managed services)
  `ORDER BY position` puts `Zz` (what dragging to the top generates) after `a0`: the card
  reappears at the bottom on refresh, and `createCard`/`createList`/`addChecklist`/
  `addChecklistItem`, which look for the last one with `ORDER BY position DESC`, generate
  duplicate keys. It also happens without dragging, just by appending: after `aZ` comes
  `aa`, which that collation places before `aB`…`aZ`, so from the 38th element of a list,
  board, card or checklist onwards `aZ` is taken as the last one and `aa` is repeated. The
  migration `20260924000000_position_collate_c` sets `TEXT COLLATE "C"` on `List`, `Card`,
  `Checklist` and `ChecklistItem.position`. Prisma does not model the collation, so the
  schema still says `String` and no drift shows up; any new position column must be
  created with `COLLATE "C"` by hand in its migration. Sorting is not done in JS or with
  `localeCompare`: the database provides the order.
- The migration does not rewrite values. Installations that already ran on glibc may have
  duplicate keys; they are detected with
  `SELECT "listId", position, count(*) FROM "Card" GROUP BY 1, 2 HAVING count(*) > 1`
  and the same with `"boardId"` on `"List"`, `"cardId"` on `"Checklist"` and
  `"checklistId"` on `"ChecklistItem"`. Reassigning them is up to the owner of the
  installation, with a prior backup (`scripts/backup.sh`).

See `docs/drag-and-drop.md` for how the UI uses it.
