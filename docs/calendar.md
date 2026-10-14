# Calendar view

The calendar view shows a board's cards that have a **due date** on a monthly grid. It is
another way of looking at the same board: it adds no data and does not change the model.

## How to use it

- The board header has a **Board / Calendar** switch.
- **Calendar** shows the current month; the arrows change the month and "Today" returns
  to the current one. Today is highlighted with an accent ring.
- Each card with a due date appears as a chip on its day, with the color dot of its first
  label. **Clicking it opens its modal** (the same one as in the board view), so you can
  edit it, tick off checklist items and so on without switching views.
- Cards **without** a due date do not appear; a note at the bottom says how many there
  are.

## Technical design

- Client Component `app/components/board/calendar-view.tsx`, rendered by `BoardView` when
  the active view is `calendar`. The active view is local client state (`useState`), not
  part of the URL: switching views neither reloads nor navigates.
- It reuses `BoardView`'s `selectedCardId` to open the modal, so card details and real
  time (`router.refresh()`) keep working the same way.
- The grid has 6 weeks (42 cells), starting on the **Monday** of the week containing day 1.
- **No time-zone drift**: cards are indexed by the date part of `dueDate` (`YYYY-MM-DD`,
  via `slice(0,10)`) and each cell is compared with the same local `YYYY-MM-DD` key. The
  time part of `dueDate` is not used (dates are picked with an `<input type="date">`, so
  they represent a day, not an instant).

## Files

- `app/components/board/calendar-view.tsx` — the monthly grid.
- `app/components/board/board-view.tsx` — the switch and the conditional render.

## Rescheduling by dragging

With edit permission, you can **drag a card to another day** to change its due date. It
uses `@dnd-kit` (draggable chips, cells as drop zones) and a focused `setCardDueDate`
action that **only** touches the date (it does not overwrite the description). The board
resyncs through real time after revalidation.

- While dragging, a copy of the chip (`DragOverlay`) follows the pointer; the original
  stays dimmed on its day (moving it with `transform` got it clipped by the calendar's
  `overflow-y-auto`). The copy is rendered in a portal to `document.body` because the
  panel uses `backdrop-blur`, and a `backdrop-filter` creates a containing block that
  would offset the `position: fixed` copy from the pointer.
- **Keyboard**: with focus on a chip, Space picks it up, the arrow keys move it to the
  neighbouring day (left/right) or to the same weekday in the previous/next week
  (up/down), and Space or Enter drops it; Escape cancels. Enter without dragging opens
  the card. Coordinates are computed by `calendarKeyboardCoordinates`
  (`app/lib/board-collision.ts`); screen reader announcements are in the interface
  language.
- If the server does not save the new date (rejection or network failure), the card
  stays on its day and an error notice appears on its own row, below the month and the
  navigation (`role="alert"`). It clears when another drag starts.

## Possible improvements

- A **global** calendar across all of the user's boards (today it is per board).
