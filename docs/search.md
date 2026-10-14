# Search

Global search finds **boards** and **cards** from anywhere in the app. It is read-only and
scoped to what the user can see. The technical decision is in
[ADR 0011](./decisions/0011-search-ilike-scoped.md).

## How to use it

- On medium and wider screens there is a **search box in the top bar**. On mobile, a
  magnifier icon leads to the search page.
- Typing and submitting (Enter) navigates to `/search?q=…`. The page renders the results
  on the server: no JavaScript is needed (progressive enhancement).
- Results are grouped into **Boards** and **Cards**. Each card shows its board and list,
  and clicking it opens it directly on its board through a `?card=<id>` **deep-link**
  (see below).

## What is searched

- **Boards**: by `title` and `description`.
- **Cards**: by `title` and `description`.

Matching is **case-insensitive substring** (`ILIKE`), with a minimum of 2 characters.
Results are sorted by `updatedAt` (most recent first) and capped (12 boards, 30 cards) to
keep the response light.

## Authorization

The query (`searchForUser` in `app/lib/queries.ts`) **puts the access filter in the
`WHERE` itself**: only boards the user owns or belongs to, and cards inside those boards.
It is the same pattern as `getBoardsForUser`. There is no filtering on the client or after
the query: the server is the only authority
([docs/authorization.md](./authorization.md)). A user never sees a card from a board they
do not belong to in the results.

## Deep-link to a card

`/board/<id>?card=<cardId>` opens the board with that card already open in its modal.
`BoardView` derives the open card from the URL with `useSearchParams()`, so the link also
works when you are already on that board (Next does not remount the component when only
the parameters change). Opening and closing a card updates `?card` with
`window.history.replaceState`, without requesting the page from the server; closing
removes it, so clicking the same notification again reopens it. If the id does not exist
on the board (for example, the card was deleted), nothing opens: a safe default.

## Components and files

- `app/lib/queries.ts` — `searchForUser(userId, query)` and the `SearchResults` type.
- `app/(app)/search/page.tsx` — the results page.
- `app/components/search-box.tsx` — the box (reusable GET form, used in the navbar and on
  the page).
- `app/(app)/board/[id]/page.tsx` + `app/components/board/board-view.tsx` — the deep-link.

## Known limits and possible improvements

- No relevance ranking or typo tolerance. Results are sorted by recency.
- `ILIKE '%term%'` is a scan (the leading wildcard prevents using a B-tree index). At the
  scale of a self-hosted instance it is instant; if it grew, the path is PostgreSQL
  full-text (`tsvector` + GIN) or `pg_trgm`, without changing the `searchForUser`
  interface. See the ADR for details.
