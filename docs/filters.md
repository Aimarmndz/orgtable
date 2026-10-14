# Board filters

The board view has **filters** to narrow down the visible cards. They only affect
presentation: they hide the cards that do not match and change no data.

## How to use them

- In the board header, the **Filter** button (with a count of active filters) opens a
  panel with three dimensions:
  - **Labels**: only cards with at least one of the chosen labels.
  - **Assignees**: only cards assigned to at least one of the chosen people.
  - **Due date**: `Any` / `Overdue` / `With date` / `No date`.
- Within a dimension the logic is **OR** (any match counts); across dimensions it is
  **AND** (all must match). "Clear filters" resets them.
- While a filter is active, **dragging is disabled** (positions would be computed over a
  visible subset); after clearing, it is available again.
- **Overdue** cards are those whose due day is before today (the browser's local day): a
  card due today does not count. The same rule (`isOverdue`) paints the card's date red,
  so the filter and the card never disagree.
- Each option is a button with `aria-pressed` (screen readers announce whether it is
  active) inside a group labeled by its title. Unselected labels use ink text with a
  border in their color; selected ones are filled with their color and show a ✓.

## Design

- The logic lives in a **pure, testable** module, `app/lib/board-filters.ts`
  (`cardMatchesFilters`, `filtersActive`, `isOverdue`, `formatDueDay`), shared and covered
  by `test/board-filters.test.ts`. `formatDueDay` formats the due date in UTC (it is a
  calendar date stored at midnight UTC), so it shows the same day in every time zone.
- Filter state is local client state in `BoardView` (not part of the URL). The bar is
  `app/components/board/filter-bar.tsx`. `BoardView` filters the cards it passes to each
  `ListColumn` and propagates `sortingDisabled` to `ListColumn`/`CardItem`.

## Search vs. filters

Filters narrow down **one board** you already have open. **Global search**
([docs/search.md](./search.md)) finds boards and cards across the whole instance.

## Possible improvements (backlog)

- Saved quick filters per board.
- Filter by checklist status.
- PostgreSQL **full-text** search (`tsvector` + GIN) behind `searchForUser` (today
  `ILIKE`, which suits self-hosted scale — see
  [ADR 0011](./decisions/0011-search-ilike-scoped.md)).
