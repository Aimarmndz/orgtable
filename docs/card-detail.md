# Card details

The **card details** view is the modal that opens when you click a card on the board. It
lets you add all the context that does not fit in a card's title: a **description**, a
**due date**, **color labels** and **checklists** with tickable items.

The interface lives in
[`app/components/card/card-modal.tsx`](../app/components/card/card-modal.tsx) and relies
on three Server Action files:

- [`app/lib/actions/cards.ts`](../app/lib/actions/cards.ts) — `updateCard`
- [`app/lib/actions/labels.ts`](../app/lib/actions/labels.ts) — labels
- [`app/lib/actions/checklists.ts`](../app/lib/actions/checklists.ts) — checklists

> For the full signature of each action and its authorization guarantees, see
> [`docs/api/server-actions.md`](./api/server-actions.md). For the data models, see
> [`docs/database.md`](./database.md).

---

## The modal

The `CardModal` component receives the card (`CardDTO`), the `boardId`, the board's
labels (`boardLabels: LabelDTO[]`), the board members (`members`, for the assignees
section), the current user's id (`currentUserId`, to know which comments they can delete)
and an `onClose` callback.

```tsx
export function CardModal({
  card,
  boardId,
  boardLabels,
  members,
  currentUserId,
  onClose,
}: {
  card: CardDTO;
  boardId: string;
  boardLabels: LabelDTO[];
  members: BoardMemberDTO[];
  currentUserId: string;
  onClose: () => void;
}) { /* … */ }
```

### Structure and closing

The modal is a **native `<dialog>`** opened with `showModal()` inside a
`useLayoutEffect`, with `close()` in the cleanup. This way the browser:

- makes the rest of the page **inert** (Tab does not escape to the board) and focuses the
  first control in the modal;
- **returns focus** to the card that opened it when it closes. A layout effect is used so
  that `close()` runs before React removes the node: if the dialog is removed while open,
  focus is not restored.

The `<dialog>` has `aria-labelledby` pointing to the card title. It fills the whole
viewport and acts as the scroll container; the panel sits inside it. It closes in three
ways:

| Gesture | Mechanism |
|-------|-----------|
| **Escape** | The `<dialog>`'s `onCancel`: `e.preventDefault()` + `onClose()`, so React closes it (unmounting the modal) rather than the browser on its own. |
| **Click outside** | The `<dialog>`'s `onClick` with `e.target === dialogRef.current`: since the panel is inside, a click whose target is the `<dialog>` itself landed outside the panel. |
| **✕ button** | The "Close" button in the header calls `onClose` directly. |

The entrance is animated with two keyframes defined in `globals.css`: `overlay-in` on the
`::backdrop` (fade, 150 ms, `motion-safe` only) and `dialog-in` on the panel (fade plus a
slight `translateY`/`scale`, 180 ms). Both respect `prefers-reduced-motion` (see
[`docs/design-system.md`](./design-system.md)). The reasoning behind the switch to
`<dialog>` is recorded in [`DECISIONES.md`](./DECISIONES.md) (the entry on the native
`<dialog>` card modal, dates and delete confirmation).

### Deleting the card

Only people who can edit see **Delete card** at the bottom of the modal. Deleting cannot
be undone, so the first click does not delete: it shows an inline confirmation with
**Yes, delete** and **No**, and moves focus to **No** (the clicked button disappears and
keyboard focus must not fall back to `<body>`). On cancel, focus returns to **Delete
card**. `window.confirm` is not used. **Yes, delete** submits `deleteCard` and closes the
modal.

### Data source (resynchronization)

The modal **does not keep its own mutable copy** of the card's state: it reads the data
straight from the board state (the `card` it receives as a prop). Server actions call
`revalidateBoard(boardId)`, which revalidates `/board/${boardId}` and publishes the change
on the real-time bus; the board then re-renders with fresh data and the modal receives the
new `card`. In other words, the server is always the source of truth: after each mutation
the modal **resynchronizes** instead of managing local optimistic state for these fields.

---

## Editing the description and due date

The description and the due date share a single form wired to `updateCard` through
`useActionState`, so it can show errors and disable the button while saving:

```tsx
const [details, detailsAction, detailsPending] = useActionState<
  CardDetailsState,
  FormData
>(updateCard, {});

<form action={detailsAction} className="mt-6 space-y-4">
  <input type="hidden" name="cardId" value={card.id} />
  <Textarea
    name="description"
    maxLength={CARD_DESCRIPTION_MAX}
    defaultValue={details.description ?? card.description ?? ""}
    …
  />
  <Input type="date" name="dueDate" defaultValue={details.dueDate ?? dueValue} … />
  <Button type="submit" variant="subtle" disabled={detailsPending}>
    {detailsPending ? "Guardando…" : "Guardar cambios"}
  </Button>
  {details.error && <p role="alert">{details.error}</p>}
</form>
```

- The description uses `<Textarea>` (`name="description"`) with
  `maxLength={CARD_DESCRIPTION_MAX}` (5000). The constant lives in
  [`app/lib/limits.ts`](../app/lib/limits.ts), a dependency-free module, to keep zod out
  of the client bundle; `validators.ts` re-exports it for the schemas.
- The due date uses `<Input type="date" name="dueDate">`. The default value is obtained by
  trimming the ISO string to `YYYY-MM-DD`: `card.dueDate ? card.dueDate.slice(0, 10) : ""`.
- If saving fails, the form is rehydrated with what was submitted (`details.description`,
  `details.dueDate`): React resets the uncontrolled form when the action finishes and,
  without this, the user's input would be lost. The error is linked to the textarea with
  `aria-describedby`.

The **`updateCard(prev, formData): Promise<CardDetailsState>`** action
([`cards.ts`](../app/lib/actions/cards.ts)) returns `{}` when it saves, or
`{ error, description, dueDate }` with the submitted values when it does not:

1. Normalises line breaks in the description (`\r\n` → `\n`): the browser submits them as
   `\r\n`, but `maxLength` counts them as one character, so without normalizing a
   description that measures 5000 in the UI would be rejected.
2. Resolves the card's `boardId` and authorizes with `requireBoardAccess` + `canEditBoard`.
3. Validates `dueDate` with `dueDateSchema` (`"YYYY-MM-DD"`, or empty to clear it). An
   invalid date is **not** stored as `null`: it returns an error and nothing is saved.
4. If the description equals the stored one (after normalizing and trimming), its length
   is not validated and it is not rewritten; only the date is updated. This lets cards
   whose descriptions predate the limit (over 5000) still change their due date from the
   modal. If it changed, it is validated with `cardDetailsSchema.shape.description` (trim
   plus maximum); an empty description is stored as `null`.
5. If anything fails validation, **nothing** is saved: saving only part of it would
   silently lose what the user wrote in the other field.
6. Persists with `prisma.card.update` and revalidates the board (`revalidateBoard`).

Errors the modal can show (the text comes from `locales/` in the user's language):

| Case | Message |
| --- | --- |
| The card was deleted in the meantime | The card no longer exists. |
| No edit role | You do not have permission to edit this card. |
| Invalid date | The due date is not valid. |
| New description too long | The description cannot exceed 5000 characters (it has N). |

---

## Color labels (board level)

Labels belong to the **board**, not the card: a label is defined once and can then be
assigned to any card on the board. On the card they are shown as **badges** (colored
pills).

### Data models

The `Label` and `CardLabel` models are part of the base schema. `CardLabel` is the
many-to-many join table between `Card` and `Label`:

```prisma
model Label {
  id      String      @id @default(cuid())
  boardId String
  board   Board       @relation(fields: [boardId], references: [id], onDelete: Cascade)
  name    String
  color   String
  cards   CardLabel[]
}

model CardLabel {
  cardId  String
  labelId String
  @@id([cardId, labelId])
}
```

### Creating labels — `createLabel`

The `NewLabelForm` sub-form lets you pick a color from the label palette
(`LABEL_COLOR_KEYS`, see [`colors.ts`](../app/lib/colors.ts)) and a name. On submit it
calls **`createLabel(formData)`** and resets the form:

```tsx
action={async (formData) => {
  await createLabel(formData);
  ref.current?.reset();
}}
```

`createLabel` checks board access, trims the name to 40 characters (ignoring empty
names), checks that the color exists in `LABEL_COLORS` (falling back to `"blue"` if not),
creates the `Label` and revalidates.

### Assigning / removing — `toggleCardLabel`

Each board label is rendered as a button. Its state (`on`) is computed from a `Set` of the
label ids already assigned to the card:

```tsx
const assigned = new Set(card.labels.map((l) => l.id));
```

On click, **`toggleCardLabel`** is invoked inside `startTransition`, wrapped in
`runToggle` ([`card-modal-helpers.ts`](../app/components/card/card-modal-helpers.ts)):

```tsx
onClick={() =>
  startTransition(async () => {
    setLabelError(
      await runToggle(
        () => toggleCardLabel({ cardId: card.id, labelId: l.id }),
        /* localized "could not change the label" message */,
        "toggleCardLabel",
      ),
    );
  })
}
```

`runToggle` returns the error message for the interface if the action responds
`{ ok: false }` or throws (and logs it to the console with its context), or `null` if it
succeeded; Next.js internal errors (redirect to `/login` when the session expires,
`notFound`) are rethrown. The message appears with `role="alert"` **below the Labels
section**, next to what failed (the modal scrolls, and a message at the very top would not
be visible), and it is cleared as soon as another label change succeeds.

`toggleCardLabel` checks that the label belongs to the same board as the card, looks up
the `CardLabel` row by its composite key `cardId_labelId` and deletes it if it exists, or
creates it otherwise: a pure **toggle**. Each pill has `aria-pressed`; the assigned one is
highlighted with a ring (`ring-2`) and a "✓". Unassigned pills are **not** dimmed: the old
`opacity-55` lowered the contrast of the white text to about 2.2:1, below AA. Each pill's
background uses `labelBackground(l.color)`.

---

## Checklists

A card can have several **checklists**, and each checklist several tickable **items**.
The section header shows an overall `done/total` counter and each checklist has its own
**progress bar**.

### Models

`Checklist` and `ChecklistItem`:

```prisma
model Checklist {
  id        String          @id @default(cuid())
  cardId    String
  title     String
  position  String
  items     ChecklistItem[]
}

model ChecklistItem {
  id          String    @id @default(cuid())
  checklistId String
  text        String
  done        Boolean   @default(false)
  position    String
}
```

Both checklists and items use a `position` key (fractional indexing) for ordering; the
actions compute the next position with `positionAtEnd`.

### Progress bar

For each checklist, the percentage of completed items is computed:

```tsx
const total = checklist.items.length;
const done = checklist.items.filter((i) => i.done).length;
const pct = total ? Math.round((done / total) * 100) : 0;
```

That `pct` drives the width of a bar (`width: ${pct}%`) colored `bg-success`. The overall
counter in the section header adds up the items of every checklist.

### Checklist actions

Every action resolves the `boardId` by walking the relation
`item → checklist → card → list → board`, authorizes with `requireBoardAccess` and
revalidates `/board/${boardId}`.

| Action | Input | What it does |
|--------|---------|----------|
| `createChecklist(formData)` | `cardId`, `title` | Creates a checklist at the end of the card (default title `"Checklist"`, max. 80 characters). |
| `deleteChecklist(formData)` | `checklistId` | Deletes the checklist (cascading to its items). |
| `addChecklistItem(formData)` | `checklistId`, `text` | Appends an item (max. 200 characters, ignores empty text). |
| `toggleChecklistItem({ itemId, done })` | object | Ticks/unticks an item (`update` of `done`). |
| `deleteChecklistItem(formData)` | `itemId` | Deletes an item. |

The creation forms (`NewChecklistForm`, the "+ Add item" form) use the same pattern of an
async `action` + `ref.current?.reset()` to clear the field after submitting.

### `useTransition` in toggles

**Toggle** actions (triggered by a click, not a form submit) run inside a React
transition. The component gets `startTransition` from `useTransition`:

```tsx
const [, startTransition] = useTransition();
```

and passes it to each `ChecklistBlock`. Ticking an item calls `toggleChecklistItem` with
the same `startTransition` + `runToggle` pattern as labels:

```tsx
onClick={() =>
  canEdit &&
  startTransition(async () => {
    setItemError(
      await runToggle(
        () => toggleChecklistItem({ itemId: it.id, done: !it.done }),
        /* localized "could not update the item" message */,
        "toggleChecklistItem",
      ),
    );
  })
}
```

This keeps the UI responsive while the Server Action and the following revalidation are
in flight: the board resyncs after `revalidateBoard`, and the modal shows the item's new
state (struck through, green checkbox) without reloading the page. If it fails, the
message (`role="alert"`) appears **below that checklist**: each `ChecklistBlock` keeps its
own error so it shows next to the item that failed.

---

## Flow summary

1. The user opens the card → `CardModal` with the board's current data.
2. They edit the description/date (form → `updateCard`), manage labels
   (`createLabel` / `toggleCardLabel`) or checklists
   (`createChecklist` / `addChecklistItem` / `toggleChecklistItem` /
   `deleteChecklistItem` / `deleteChecklist`).
3. Each action persists to the database and calls `revalidateBoard`.
4. The board re-renders; the modal receives the updated `card` and **resynchronizes**.
   There is no duplicated local state for this data.

See also: [`docs/api/server-actions.md`](./api/server-actions.md) ·
[`docs/database.md`](./database.md).
