# Drag and drop in orgtable

This guide explains how drag and drop of lists and cards works in orgtable. It is meant
for contributors. The system combines the `@dnd-kit` library on the client, local
optimistic state, and Server Actions that persist **a single row change** using
*fractional indexing*.

Files involved:

- `app/components/board/board-view.tsx` — orchestrates drag and drop and the optimistic state.
- `app/components/board/list-column.tsx` — draggable column/list plus the `SortableContext` of its cards.
- `app/components/board/card-item.tsx` — draggable card.
- `app/lib/board-collision.ts` — collision detection and arrow-key coordinates (pure,
  covered by `test/board-collision.test.ts`).
- `app/lib/optimistic.ts` — `persistOptimistic`: saves the change and undoes it if it fails.
- `app/lib/actions/cards.ts` — the `moveCard` Server Action.
- `app/lib/actions/lists.ts` — the `reorderList` Server Action.
- `app/lib/ordering.ts` — server-side ordering helpers.

---

## Library: `@dnd-kit`

Three `@dnd-kit` packages are used:

- `@dnd-kit/core` — the `DndContext`, the sensors and the `DragOverlay`.
- `@dnd-kit/sortable` — the `SortableContext`s and the `useSortable` hook.
- `@dnd-kit/utilities` — the `CSS` helper used to apply transforms.

### Context structure

`BoardView` wraps the whole board in a single `DndContext`. Collision detection is
`boardCollisionDetection` (`app/lib/board-collision.ts`): `closestCorners` (which works
better than `closestCenter` across vertical and horizontal containers), but **while a list
is being dragged it only considers other lists**. Without that filter, the floating copy of
the list (short, at the top of the column) ends up closer to the first card of the target
column than to the column itself, `over` is a card, and the reorder used to be discarded.
`handleDragEnd` also maps a card to its list as a safeguard.

```tsx
<DndContext
  id={dndId}
  sensors={sensors}
  collisionDetection={boardCollisionDetection}
  accessibility={{ screenReaderInstructions, announcements }}
  onDragStart={handleDragStart}
  onDragOver={handleDragOver}
  onDragEnd={handleDragEnd}
  onDragCancel={handleDragCancel}
>
```

Inside there are two levels of `SortableContext`:

- **Columns (horizontal):** in `BoardView`, a `SortableContext` with
  `horizontalListSortingStrategy` wraps all the lists.

  ```tsx
  <SortableContext
    items={lists.map((l) => l.id)}
    strategy={horizontalListSortingStrategy}
  >
    {lists.map((list) => (
      <ListColumn key={list.id} list={list} />
    ))}
  </SortableContext>
  ```

- **Cards (vertical):** inside each `ListColumn`, another `SortableContext` with
  `verticalListSortingStrategy` wraps the cards of that list.

  ```tsx
  <SortableContext
    items={list.cards.map((c) => c.id)}
    strategy={verticalListSortingStrategy}
  >
    {list.cards.map((card) => (
      <CardItem key={card.id} card={card} listId={list.id} />
    ))}
  </SortableContext>
  ```

Both `ListColumn` and `CardItem` use `useSortable` (with `data: { type: "list" }` and
`data: { type: "card", listId }` respectively) and apply
`CSS.Translate.toString(transform)` to move while dragged, lowering the opacity to `0.4`
in their original place (`isDragging`).

### Sensors

```tsx
const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  useSensor(KeyboardSensor, {
    coordinateGetter: boardKeyboardCoordinates,
    keyboardCodes: DRAG_KEYBOARD_CODES,
  }),
);
```

- **Pointer**: `distance: 5` means the pointer must move at least 5 px before a drag
  starts. A plain click (opening the card, the "add" form) therefore never starts an
  accidental drag.
- **Keyboard**: with focus on a card (or on a list title), **Space** picks it up, the
  **arrow keys** move it, **Space** or **Enter** drops it and **Escape** cancels.
  **Enter does not pick up**: with focus on a card, Enter (and Space when the card cannot
  be dragged, for example as a Viewer or while filtering) opens it. Coordinates come from
  `boardKeyboardCoordinates`: lists jump straight to the neighbouring column (the
  sortable defaults first went to the first card of the list's own column, so the first
  arrow press did nothing); cards, with left/right, jump to the vertically closest card
  in the neighbouring column, or to the column itself if it is empty (with the sortable
  defaults the left arrow sent them back to their own column). Up/down on a card still use
  the `@dnd-kit/sortable` defaults.
- **Screen readers**: dnd-kit's instructions and announcements (English-only by default)
  are passed in the interface language through `accessibility`, and
  `aria-roledescription` names the item as a card or list instead of "sortable".

---

## Optimistic state

`BoardView` is a client component that keeps the lists (with their nested cards) in
`useState`, initialized from the props sent by the server:

```tsx
const [lists, setLists] = useState<ListDTO[]>(board.lists);
```

During a drag, this local state is updated **immediately** so the interface feels
smooth, before (and independently of) the Server Action confirming the change.

When the server sends new data (for example after creating or deleting a list or card,
or after a revalidation), the local state is resynchronized during render (the "adjust
state when a prop changes" pattern, without `useEffect`):

```tsx
const [syncedBoard, setSyncedBoard] = useState(board);
if (board !== syncedBoard) {
  setSyncedBoard(board);
  setLists(board.lists);
  if (dragSnapshot) setDragSnapshot(board.lists);
}
```

### Undo

When a drag starts, a **snapshot** of the lists is saved (`dragSnapshot`). The board goes
back to it if:

- the drag is **canceled** (Escape) or dropped outside any drop zone: `onDragOver` may
  have moved the card to another list in the local state only;
- the server **rejects** the change (`{ ok: false }`) or the call **fails**: the Server
  Action runs through `persistOptimistic`, which then restores the snapshot, shows a
  `role="alert"` message in the board header ("could not move the card/list, try again";
  it is cleared when the next drag starts) and calls `router.refresh()` to fetch the real
  data. Next.js redirects (expired session) are rethrown untouched and handled by the
  router.

If server data arrives in the middle of a drag, the snapshot becomes that data, so the
board never reverts to a state older than it.

---

## The three handlers

The `DndContext` registers three handlers, all living in `BoardView`.

### `onDragStart` — `handleDragStart`

Stores the `id` of the item being dragged. That id is later used to decide what to render
in the `DragOverlay` and to locate the active item.

```tsx
function handleDragStart(event: DragStartEvent) {
  setActiveId(String(event.active.id));
  setDragSnapshot(lists);
}
```

`onDragCancel` (`handleDragCancel`) clears `activeId` and restores the snapshot.

### `onDragOver` — `handleDragOver`

**Visually** moves a card from one list to another while the pointer passes over it,
updating only the local state (nothing is persisted yet).

- If the dragged item is a **list**, it is ignored here (lists are reordered in
  `onDragEnd`).
- For a card, it works out the source container (`from`) and the target container
  (`to`). If they differ, it removes the card from the source list and inserts it into
  the target list at the position under the pointer (at the end if dropped on the list
  body, or at the index of the card being hovered).

This gives the feeling that the card "jumps" live from column to column.

### `onDragEnd` — `handleDragEnd`

Clears `activeId`, computes the final position and **persists** the change. There are
two branches:

**1. Reordering lists (columns).** If the active item is a list, `arrayMove` reorders the
local array, the new position key between the neighbours is computed and `reorderList`
is called:

```tsx
const reordered = arrayMove(lists, oldIndex, newIndex);
const movedIdx = reordered.findIndex((l) => l.id === activeIdStr);
const position = generateKeyBetween(
  reordered[movedIdx - 1]?.position ?? null,
  reordered[movedIdx + 1]?.position ?? null,
);
setLists(/* apply the new position to the moved list */);
void persistOptimistic(
  () => reorderList({ listId: activeIdStr, position }),
  () => revertTo(snapshot),
  { message: "[board] failed to reorder the list", context: { listId: activeIdStr } },
);
```

**2. Moving/reordering a card.** A card can:

- **Be reordered within the same list:** if it was dropped on another card in the same
  container, it is reordered with `arrayMove`.
- **Change list:** `onDragOver` already moved it to the new container; here only the
  final position in the container where it ended up is computed.

In both cases the position key between the card's neighbours is computed and `moveCard`
is called:

```tsx
const position = generateKeyBetween(
  finalList.cards[idx - 1]?.position ?? null,
  finalList.cards[idx + 1]?.position ?? null,
);
setLists(/* apply the new position to the moved card */);
void persistOptimistic(
  () => moveCard({ cardId: activeIdStr, toListId: container, position }),
  () => revertTo(snapshot),
  { message: "[board] failed to move the card", context: { cardId: activeIdStr, toListId: container } },
);
```

---

## Fractional indexing on the client

The **client**, not the server, computes the new position key. It uses
`generateKeyBetween(before, after)` from the
[`fractional-indexing`](https://www.npmjs.com/package/fractional-indexing) library.

The idea: every list and every card has a `position`, a lexicographically sortable
string key. To insert an item between two neighbours, it is enough to generate a key
between their positions (which are already in the local state). Either end can be `null`
(start or end of the list):

```tsx
import { generateKeyBetween } from "fractional-indexing";

const position = generateKeyBetween(
  previousNeighbour?.position ?? null, // before
  nextNeighbour?.position ?? null, // after
);
```

Because the generated key sits strictly between its two neighbours, **the positions of
the other items never need to be rewritten**: only the moved row changes.

For more context, see:

- `docs/decisions/0002-fractional-indexing.md` — why this approach was chosen.
- `docs/database.md` — how the `position` field is modeled in the database.

### The server only appends and validates what it receives

`app/lib/ordering.ts` (a `server-only` module) exposes two functions built on the same
library:

- `positionAtEnd(lastPosition)` — a key after the last item's key. It is used by
  creation (`createList`, `createCard`, checklists and items, and the v1 API `POST`s)
  through `createListAtEnd`/`createCardAtEnd`/`createChecklistAtEnd`/
  `createChecklistItemAtEnd` (`app/lib/services/`). Each creation runs in a transaction
  that locks the parent row (`SELECT … FOR UPDATE` on the board, list, card or
  checklist): without the lock, two simultaneous creations read the same last position
  and stored the **same** key, and from then on `generateKeyBetween(a, a)` broke dragging
  in that list.
- `isValidPositionKey(key)` — validates the key computed by the client before storing
  it. Drag reordering is always computed by the client and sent already resolved; if the
  server stored a malformed key (`'x'`, `'a00'`…), `positionAtEnd` would throw forever
  when creating in that list or board.

#### Key validation (`isValidPositionKey`)

This is the only place that explains the rule; other pages link here.

1. **Shape**: the library's base62 alphabet, starting with a letter, at most
   `POSITION_KEY_MAX` characters long. The library on its own accepts keys such as
   `'a0 '` (with a space), which is why the regex is needed.
2. **Structure**: `generateKeyBetween(key, null)` is attempted; if the library throws
   (malformed integer part, fraction ending in `0`…), the key is invalid.

`moveCard` and `reorderList` validate with zod (`z.string().refine(isValidPositionKey)`)
**before any query**. An invalid key returns `{ ok: false }` and nothing is stored.

**Length limit.** Keys grow when inserting again and again into the same gap (roughly one
character every six insertions). `POSITION_KEY_MAX` is 1024 characters, about 6,000
consecutive insertions into the same gap (the previous cap of 64 was reached after 373);
it avoids storing huge strings and stays below the maximum size of an entry in the
`(listId, position)` index. If a legitimate key ever exceeded it, `moveCard`/`reorderList`
would return `{ ok: false }` for that gap, and `persistOptimistic` would undo the move and
show the error message described in [Undo](#undo).

---

## Persistence: one row per move

Both drag Server Actions are deliberately minimal. Both:

1. Validate the input with zod, including the position key (see
   [Key validation](#key-validation-isvalidpositionkey)).
2. Resolve the affected `boardId`.
3. Check access with `requireBoardAccess(boardId)` and the role with `canEditBoard`.
4. Run **a single `UPDATE`** on the moved row.
5. Call `revalidateBoard(boardId)` (revalidates the route and notifies the live bus).

**`moveCard`** (`app/lib/actions/cards.ts`) — moves/reorders a card; it can change list
and/or position:

```ts
export async function moveCard(input: {
  cardId: string;
  toListId: string;
  position: string;
}): Promise<{ ok: boolean }> {
  const parsed = moveCardSchema.safeParse(input); // position: refine(isValidPositionKey)
  if (!parsed.success) return { ok: false };
  const { cardId, toListId, position } = parsed.data;
  const boardId = await boardIdForList(toListId);
  if (!boardId) return { ok: false };
  const { role } = await requireBoardAccess(boardId);
  if (!canEditBoard(role)) return { ok: false };
  // The card must belong to that same board (IDOR).
  if (!(await cardBelongsToBoard(cardId, boardId))) return { ok: false };

  await prisma.card.update({
    where: { id: cardId },
    data: { listId: toListId, position },
  });
  revalidateBoard(boardId);
  return { ok: true };
}
```

**`reorderList`** (`app/lib/actions/lists.ts`) — reorders a column:

```ts
export async function reorderList(input: {
  listId: string;
  position: string;
}): Promise<{ ok: boolean }> {
  const parsed = reorderListSchema.safeParse(input); // position: refine(isValidPositionKey)
  if (!parsed.success) return { ok: false };
  const { listId, position } = parsed.data;
  const list = await prisma.list.findUnique({
    where: { id: listId },
    select: { boardId: true },
  });
  if (!list) return { ok: false };
  const { role } = await requireBoardAccess(list.boardId);
  if (!canEditBoard(role)) return { ok: false };

  await prisma.list.update({ where: { id: listId }, data: { position } });
  revalidateBoard(list.boardId);
  return { ok: true };
}
```

Thanks to fractional keys, **neighbouring rows are never rewritten**: each drag is
exactly one `UPDATE`.

---

## DragOverlay

While dragging, `@dnd-kit` can render a "floating" element that follows the pointer
through the `DragOverlay`. `BoardView` decides what to render depending on whether the
active item is a card or a list:

```tsx
<DragOverlay>
  {activeCard ? (
    <CardItem card={activeCard} listId="" overlay />
  ) : activeList ? (
    <div className="w-72 rounded-xl bg-zinc-100 p-3 opacity-90 shadow-lg">
      <p className="font-semibold text-zinc-700">{activeList.title}</p>
    </div>
  ) : null}
</DragOverlay>
```

`CardItem` accepts an `overlay` prop that adjusts its style (stronger shadow, no reduced
opacity) and hides the delete button, so the floating copy looks right.

---

## Flow diagram

```
   User drags a list or a card
                 │
                 ▼
   onDragStart  →  stores activeId  →  DragOverlay renders the floating item
                 │
                 ▼
   onDragOver   →  (cards only) moves the card between lists
                 │   in LOCAL state (optimistic, no network)
                 ▼
   onDragEnd    →  computes the new position with generateKeyBetween(before, after)
                 │   and updates LOCAL state immediately
                 ▼
   Server Action  (moveCard / reorderList)
                 │   requireBoardAccess + ONE SINGLE UPDATE of the moved row
                 ▼
   revalidateBoard(boardId)  (revalidates /board/<id> and publishes the event)
                 │
                 ▼
   New data arrives  →  resync during render  →  setLists(board.lists)
   (if the action returns { ok: false } or fails: the snapshot is restored,
    an error shows in the header and router.refresh() runs)
                 (resyncs the optimistic state with the server)
```

---

In short: the client moves the UI optimistically and computes the position with
*fractional indexing*, and each drag is persisted with a single server-validated `UPDATE`
followed by a revalidation.
