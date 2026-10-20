# Board menu (right click)

Inside a board, a right click opens orgtable's own menu instead of the browser's. What it
offers depends on what is under the pointer and on the viewer's role: only what the role
allows is listed (no greyed-out options), and every action checks the role again on the
server.

## What it offers

| Where | Options |
| --- | --- |
| **Background** (empty space, header) | Add list · Change background · Labels (rename, recolour, delete, create) · Rename board · View as calendar/board · Filter cards · Members and visibility · Copy link · Export to JSON · Organization settings |
| **List** | Add card · Rename list · Move left / right · Sort by due date · Move all cards to… · Delete list (with an inline confirmation that says how many cards go with it) |
| **Card** | Open · Rename · Labels · Due date (today, tomorrow, next Monday, in a week, a date, remove) · Assign · Move to (another list, top or bottom of its list) · Duplicate · Copy link · Delete (inline confirmation) |
| **Open card** (its own space, not a label, item or comment) | The same as on the card |

- **Change background** (`app/components/board/background-panel.tsx`, also on the right
  click of a board tile): the six board colours plus *Slate* and *Ink*, *Automatic* (the
  colour derived from the board's id), any colour from the picker (`#rrggbb`), or an image.
  Owners only; every member sees the change. `pickBoardColor` still draws from the original
  six, so boards that never chose a colour keep theirs.
  - The image is shrunk to 2560 px in the browser (WebP, or JPEG), checked by its bytes on the
    server (PNG, JPEG or WebP, never SVG, 3 MB at most), stored on the uploads volume
    (`background-<uuid>.<ext>`) and served by `/api/boards/<id>/background` only to people who
    can open the board. It covers the colour, which shows while it loads. Removing it, or
    deleting the board, deletes the file. Board exports and organization backups carry the
    colour, not the image (instance backups copy the whole uploads volume).
  - Over an image, or a free colour too light for white text, the header gets a dark veil
    (`boardNeedsScrim`).
- **Duplicate** copies the card right below itself, titled "<title> (copy)": description,
  due date, labels and checklists (with their ticks). Attachments, comments and assignees
  stay with the original.
- **Move all cards to…** appends the list's cards to the end of the other list, in order.
- **Sort by due date** puts the soonest first and the cards without a date last.
- A **viewer** gets Open card and Copy link on a card, and the board's menu elsewhere
  (calendar, filters, members, link, export).

- **Labels**: owners rename a label, change its colour or delete it (inline confirmation; it
  leaves every card that had it) from this panel or from the right click (or long press) on a
  label in the card, which offers *Edit* (`app/components/card/label-editor.tsx`; there is no
  visible pencil, by the owner's choice; Shift+F10 opens the menu from the keyboard). Besides the eight palette colours, a label
  takes any colour from the picker (`app/components/ui/color-picker.tsx`: a
  saturation/brightness square, a hue bar and the hex code), stored as `#rrggbb` and validated
  strictly (`labelColorChoiceSchema`). The text on it turns dark when the colour is light
  (`labelText`, WCAG contrast).
- **Organization settings** is only listed for people who belong to the organization; a
  guest would get a 404 there.

## Outside the board

Everywhere else in the signed-in app, a right click (or a half-second press on touch) opens
the same kind of menu, built by `app/components/app-context-menu.tsx` from what is under the
pointer:

- An element marked `data-menu-scope` (a board tile, a settings or administration row, a
  label, a checklist item, an attachment, a comment, an assignee in the card): its own
  buttons and links, named by `data-menu-label`, `aria-label` or their text, and run by
  clicking them, so every confirmation and permission stays as it is. `data-menu-title`
  titles the menu, `data-menu-skip` hides a control, `data-menu-copy` adds *Copy text*.
- A board tile (`data-menu-board`) whose board the person manages also gets *Rename board*
  and *Change background*, with the same form, swatches and Server Actions as the board's
  own menu.
- A link: Open, Open in a new tab (not for downloads) and Copy link.
- Then, always: *This page* (go back, refresh, copy its link, switch the theme), the sections
  of the side menu when there is one (`data-menu-nav`, settings and administration), and
  *Go to* (the current workspace, its settings, all boards, search, your settings).

The board (`data-own-menu`) and the open card keep their own menu; a link inside the board
gets the link menu. Inside the card's `<dialog>`, which makes the rest of the page inert, the
menu is drawn in the dialog itself.

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
