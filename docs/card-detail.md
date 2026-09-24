# Detalle de tarjeta (Hito 2)

El **detalle de tarjeta** es el modal que se abre al pulsar sobre una tarjeta del
tablero. Permite enriquecer una tarjeta con todo el contexto que no cabe en su título:
**descripción**, **fecha de vencimiento**, **etiquetas de color** y **checklists** con
ítems marcables.

La interfaz vive en
[`app/components/card/card-modal.tsx`](../app/components/card/card-modal.tsx) y se apoya
en tres ficheros de Server Actions:

- [`app/lib/actions/cards.ts`](../app/lib/actions/cards.ts) — `updateCard`
- [`app/lib/actions/labels.ts`](../app/lib/actions/labels.ts) — etiquetas
- [`app/lib/actions/checklists.ts`](../app/lib/actions/checklists.ts) — checklists

> Para la firma completa de cada acción y sus garantías de autorización, ver
> [`docs/api/server-actions.md`](./api/server-actions.md). Para los modelos de datos,
> ver [`docs/database.md`](./database.md).

---

## El modal

El componente `CardModal` recibe la tarjeta (`CardDTO`), el `boardId`, las etiquetas del
tablero (`boardLabels: LabelDTO[]`), los miembros del tablero (`members`, para la sección
de asignados), el id del usuario actual (`currentUserId`, para saber qué comentarios puede
borrar) y un callback `onClose`.

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

### Estructura y cierre

El modal es un **`<dialog>` nativo** que se abre con `showModal()` dentro de un
`useLayoutEffect`, con `close()` en el cleanup. Así el navegador:

- vuelve **inerte** el resto de la página (el Tab no sale al tablero) y enfoca el primer
  control del modal;
- al cerrar, **devuelve el foco** a la tarjeta que lo abrió. Se usa un layout effect para
  que `close()` ocurra antes de que React quite el nodo: si se retira abierto, el foco no
  se restaura.

El `<dialog>` lleva `aria-labelledby` apuntando al título de la tarjeta. Ocupa toda la
ventana y hace de contenedor con scroll; el panel va dentro. Se cierra de tres maneras:

| Gesto | Mecanismo |
|-------|-----------|
| **Escape** | `onCancel` del `<dialog>`: `e.preventDefault()` + `onClose()`, para que cierre React (desmontando el modal) y no el navegador por su cuenta. |
| **Clic fuera** | `onClick` del `<dialog>` con `e.target === dialogRef.current`: como el panel va dentro, un clic cuyo destino es el propio `<dialog>` cae fuera del panel. |
| **Botón ✕** | El botón "Cerrar" de la cabecera llama a `onClose` directamente. |

La entrada se anima con dos keyframes definidos en `globals.css`: `overlay-in` sobre el
`::backdrop` (fade, 150 ms, solo con `motion-safe`) y `dialog-in` sobre el panel (fade +
leve `translateY`/`scale`, 180 ms). Ambas respetan `prefers-reduced-motion` (ver
[`docs/design-system.md`](./design-system.md)). El porqué del cambio a `<dialog>` está en
[`DECISIONES.md`](./DECISIONES.md) («Modal de tarjeta: `<dialog>` nativo, fechas y
confirmación de borrado»).

### Borrar la tarjeta

Solo quien puede editar ve **«Borrar tarjeta»** al pie del modal. Borrar es irreversible,
así que el primer clic no borra: muestra en línea «¿Borrar la tarjeta?» con **«Sí,
borrar»** y **«No»**, y mueve el foco a «No» (el botón pulsado desaparece y el teclado no
debe quedarse en `<body>`). Al cancelar, el foco vuelve a «Borrar tarjeta». No se usa
`window.confirm`. «Sí, borrar» envía `deleteCard` y cierra el modal.

### Origen de los datos (resincronización)

El modal **no mantiene su propia copia mutable** del estado de la tarjeta: lee los datos
directamente del estado del board (la `card` que recibe por props). Las acciones de
servidor llaman a `revalidateBoard(boardId)`, que revalida `/board/${boardId}` y publica
el cambio por el bus de tiempo real; eso provoca que el board se vuelva a renderizar con los datos frescos y el modal reciba la nueva `card`. Es decir, la
fuente de verdad es siempre el servidor: tras cada mutación el modal se **resincroniza**
en lugar de gestionar estado optimista local para estos campos.

---

## Edición de descripción y fecha de vencimiento

Descripción y vencimiento comparten un único `<form action={updateCard}>`:

```tsx
<form action={updateCard} className="mt-6 space-y-4">
  <input type="hidden" name="cardId" value={card.id} />
  <Textarea name="description" defaultValue={card.description ?? ""} … />
  <Input type="date" name="dueDate" defaultValue={dueValue} … />
  <Button type="submit" variant="subtle">Guardar cambios</Button>
</form>
```

- La descripción usa `<Textarea>` (`name="description"`), con `defaultValue` desde
  `card.description`.
- El vencimiento usa `<Input type="date" name="dueDate">`. El valor por defecto se obtiene
  recortando el ISO a `YYYY-MM-DD`: `card.dueDate ? card.dueDate.slice(0, 10) : ""`.

La acción **`updateCard(formData)`** ([`cards.ts`](../app/lib/actions/cards.ts)):

1. Resuelve el `boardId` de la tarjeta, autoriza con `requireBoardAccess` y exige
   `canEditBoard(role)`. Si la tarjeta no existe o el rol no puede editar, sale sin hacer
   nada.
2. Valida `{ description, dueDate }` con `cardDetailsSchema`
   ([`validators.ts`](../app/lib/validators.ts)): `description` se recorta y admite como
   máximo `CARD_DESCRIPTION_MAX` caracteres; `dueDate` tiene que ser `""` o una fecha
   `YYYY-MM-DD` válida (`z.iso.date()`, que rechaza fechas imposibles como `2026-02-31`).
3. **Si algo no valida, no se guarda nada**, ni siquiera la descripción, y el
   vencimiento anterior se mantiene. Guardar solo una parte perdería en silencio lo
   escrito en el otro campo; y antes una fecha no válida se convertía en `null` y
   **borraba** el vencimiento sin avisar.
4. Persiste `description || null` y `dueDate: toDueDate(...)` (`""` pasa a `null` y
   `YYYY-MM-DD` a medianoche UTC) con `prisma.card.update`, y llama a
   `revalidateBoard(boardId)`.

```ts
const parsed = cardDetailsSchema.safeParse({
  description: String(formData.get("description") ?? ""),
  dueDate: String(formData.get("dueDate") ?? "").trim(),
});
if (!parsed.success) return;

await prisma.card.update({
  where: { id: cardId },
  data: {
    description: parsed.data.description || null,
    dueDate: toDueDate(parsed.data.dueDate),
  },
});
```

---

## Etiquetas de color (a nivel de tablero)

Las etiquetas pertenecen al **tablero**, no a la tarjeta: una etiqueta se define una vez
y luego se puede asignar a cualquier tarjeta del tablero. En la tarjeta se muestran como
**badges** (pastillas de color).

### Modelos de datos

Los modelos `Label` y `CardLabel` **ya existían** antes del Hito 2 (forman parte del
esquema base). `CardLabel` es la tabla de unión muchos-a-muchos entre `Card` y `Label`:

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

### Crear etiquetas — `createLabel`

El subformulario `NewLabelForm` permite elegir un color de la paleta de etiquetas
(`LABEL_COLOR_KEYS`, ver [`colors.ts`](../app/lib/colors.ts)) y un nombre. Al enviar llama
a **`createLabel(formData)`** y resetea el formulario:

```tsx
action={async (formData) => {
  await createLabel(formData);
  ref.current?.reset();
}}
```

`createLabel` valida acceso al tablero, recorta el nombre a 40 caracteres (ignora vacíos),
valida que el color exista en `LABEL_COLORS` (cae a `"blue"` si no), crea el `Label` y
revalida.

### Asignar / quitar — `toggleCardLabel`

Cada etiqueta del tablero se pinta como un botón. Su estado (`on`) se calcula con un
`Set` de los ids de etiqueta ya asignados a la tarjeta:

```tsx
const assigned = new Set(card.labels.map((l) => l.id));
```

Al pulsar, se invoca **`toggleCardLabel`** dentro de `startTransition`, envuelta en
`runToggle` ([`card-modal-helpers.ts`](../app/components/card/card-modal-helpers.ts)):

```tsx
onClick={() =>
  startTransition(async () => {
    setLabelError(
      await runToggle(
        () => toggleCardLabel({ cardId: card.id, labelId: l.id }),
        "No se pudo cambiar la etiqueta.",
        "toggleCardLabel",
      ),
    );
  })
}
```

`runToggle` devuelve el mensaje de error para la interfaz si la acción responde
`{ ok: false }` o lanza (y lo registra en consola con el contexto), o `null` si fue bien;
los errores internos de Next (redirect a `/login` al caducar la sesión, `notFound`) los
relanza. El aviso sale con `role="alert"` **bajo la sección Etiquetas**, junto a lo que
falló (el modal tiene scroll y uno arriba del todo no se vería), y se borra en cuanto
otro cambio de etiqueta sale bien.

`toggleCardLabel` comprueba que la etiqueta sea del mismo tablero que la tarjeta, busca
la fila `CardLabel` por su clave compuesta `cardId_labelId` y, si existe, la borra; si
no, la crea: un **toggle** puro. Cada pastilla lleva `aria-pressed`; la asignada se
resalta con un anillo (`ring-2`) y un "✓". Las no asignadas **no** se atenúan: la
antigua `opacity-55` bajaba el contraste del texto blanco a ~2,2:1, por debajo de AA. El
fondo de cada pastilla usa `labelBackground(l.color)`.

---

## Checklists

Una tarjeta puede tener varias **checklists**, y cada checklist varios **ítems**
marcables. El encabezado de la sección muestra un contador global `done/total` y cada
checklist tiene su propia **barra de progreso**.

### Modelos nuevos

`Checklist` y `ChecklistItem` son **modelos nuevos** introducidos en el Hito 2:

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

Tanto checklists como ítems usan una clave `position` (fractional indexing) para
ordenarse; las acciones calculan la siguiente posición con `positionAtEnd`.

### Barra de progreso

Para cada checklist se calcula el porcentaje de ítems hechos:

```tsx
const total = checklist.items.length;
const done = checklist.items.filter((i) => i.done).length;
const pct = total ? Math.round((done / total) * 100) : 0;
```

Ese `pct` alimenta el ancho de una barra (`width: ${pct}%`) con color `bg-success`. El
contador global del encabezado de la sección suma los ítems de todas las checklists.

### Acciones de checklist

Todas las acciones resuelven el `boardId` recorriendo la relación
`item → checklist → card → list → board`, autorizan con `requireBoardAccess` y revalidan
`/board/${boardId}`.

| Acción | Entrada | Qué hace |
|--------|---------|----------|
| `createChecklist(formData)` | `cardId`, `title` | Crea una checklist al final de la tarjeta (título por defecto `"Checklist"`, máx. 80 caracteres). |
| `deleteChecklist(formData)` | `checklistId` | Borra la checklist (cascada sobre sus ítems). |
| `addChecklistItem(formData)` | `checklistId`, `text` | Añade un ítem (máx. 200 caracteres, ignora vacíos) al final. |
| `toggleChecklistItem({ itemId, done })` | objeto | Marca/desmarca un ítem (`update` de `done`). |
| `deleteChecklistItem(formData)` | `itemId` | Borra un ítem. |

Los formularios de creación (`NewChecklistForm`, el formulario de "+ Añadir ítem") usan el
mismo patrón de `action` asíncrono + `ref.current?.reset()` para limpiar el campo tras
enviar.

### `useTransition` en los toggles

Las acciones de **toggle** (que se disparan con un click, no con un submit de formulario)
se ejecutan dentro de una transición de React. El componente obtiene
`startTransition` de `useTransition`:

```tsx
const [, startTransition] = useTransition();
```

y lo pasa a cada `ChecklistBlock`. Marcar un ítem invoca `toggleChecklistItem` con el
mismo patrón `startTransition` + `runToggle` que las etiquetas:

```tsx
onClick={() =>
  canEdit &&
  startTransition(async () => {
    setItemError(
      await runToggle(
        () => toggleChecklistItem({ itemId: it.id, done: !it.done }),
        "No se pudo actualizar el ítem.",
        "toggleChecklistItem",
      ),
    );
  })
}
```

Esto mantiene la UI responsiva mientras la Server Action y la subsiguiente revalidación
están en curso: el board se resincroniza tras `revalidateBoard`, y el modal refleja el
nuevo estado del ítem (tachado + casilla en verde) sin recargar la página. Si falla, el
aviso (`role="alert"`) sale **bajo esa checklist**: cada `ChecklistBlock` guarda su propio
error, para que aparezca junto al ítem que falló.

---

## Resumen del flujo

1. El usuario abre la tarjeta → `CardModal` con los datos actuales del board.
2. Edita descripción/fecha (form → `updateCard`), gestiona etiquetas
   (`createLabel` / `toggleCardLabel`) o checklists
   (`createChecklist` / `addChecklistItem` / `toggleChecklistItem` /
   `deleteChecklistItem` / `deleteChecklist`).
3. Cada acción persiste en la base de datos y llama a `revalidateBoard`.
4. El board se vuelve a renderizar; el modal recibe la `card` actualizada y se
   **resincroniza**. No hay estado local duplicado para estos datos.

Ver también: [`docs/api/server-actions.md`](./api/server-actions.md) ·
[`docs/database.md`](./database.md).
