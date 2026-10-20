# Board menu (right click)

Inside a board, a right click opens orgtable's own menu instead of the browser's. What it
offers depends on what is under the pointer and on the viewer's role: only what the role
allows is listed (no greyed-out options), and every action checks the role again on the
server.

## What it offers

| Where | Options |
| --- | --- |
| **Background** (empty space, header) | Add list · Change background · Rename board · View as calendar/board · Filter cards · Members and visibility · Copy link · Export to JSON · Organization settings |
| **List** | Add card · Rename list · Move left / right · Sort by due date · Move all cards to… · Delete list (with an inline confirmation that says how many cards go with it) |
| **Card** | Open · Rename · Labels · Due date (today, tomorrow, next Monday, in a week, a date, remove) · Assign · Move to (another list, top or bottom of its list) · Duplicate · Copy link · Delete (inline confirmation) |

- **Change background**: the six board colours plus *Slate* and *Ink*, or *Automatic* (the
  colour derived from the board's id). Owners only; every member sees the change.
  `pickBoardColor` still draws from the original six, so boards that never chose a colour
  keep theirs.
- **Duplicate** copies the card right below itself, titled "<title> (copy)": description,
  due date, labels and checklists (with their ticks). Attachments, comments and assignees
  stay with the original.
- **Move all cards to…** appends the list's cards to the end of the other list, in order.
- **Sort by due date** puts the soonest first and the cards without a date last.
- A **viewer** gets Open card and Copy link on a card, and the board's menu elsewhere
  (calendar, filters, members, link, export).
- **Organization settings** is only listed for people who belong to the organization; a
  guest would get a 404 there.

## Mouse, keyboard and touch

- **Shift + right click** always opens the browser's menu. So does a right click on a field,
  a link or selected text, where copy, paste and "open in a new tab" are what people want.
- **Keyboard**: the context-menu key or **Shift+F10** on a focused card or list opens its
  menu next to it. Arrows move, Home/End jump, → opens a submenu, ← or Escape goes back,
  Enter or Space runs an item, the letter shown on the right runs it directly (L, C, F, N,
  R, D, Del…), Tab closes. On close, focus returns where it was.
- **Touch**: holding a card, list or the background for half a second opens the same menu
  as a sheet from the bottom, with Open, Move, Duplicate and Link as big buttons on top.
  Submenus replace the list, with a back button. Moving the finger first scrolls or drags
  as before; the long press cancels a pending drag, and the lift of that finger is not
  taken as a tap on the sheet.
- The menu never leaves the window: it flips to the other side of the pointer, and
  submenus open to the left when the right has no room.

## Design

- `app/components/board/context-menu.tsx` draws a menu from a description of its entries
  (items, separators, custom content such as the colour grid or a rename field): a popover
  with flyout submenus, or a bottom sheet, from the same entries.
- `app/components/board/board-menu.tsx` builds those entries for the target (board, list,
  card) from the board's current data, and runs the actions.
- `app/lib/board-menu.ts` holds the pure parts: placement (`menuPosition`,
  `submenuPosition`), the due-date shortcuts (`dueShortcuts`, local days) and the position
  keys of the move actions (`neighbourKey`, `edgeKey`). Covered by `test/board-menu.test.ts`.
- `BoardView` finds the target through `data-card-id` / `data-list-id` on the card and the
  column, and keeps the background chosen in the menu until the server confirms it.
- New Server Actions: `setBoardBackground`, `duplicateCard`, `sortListByDue` and
  `moveAllCardsTo`; `renameBoard` now takes an object and returns the board's new path.
  The others (labels, due date, assignees, rename, delete, move) are the ones the card
  modal and drag and drop already use. Permissions and the cross-board check of
  `moveAllCardsTo` are covered by `test/integration/board-menu.int.test.ts`.
