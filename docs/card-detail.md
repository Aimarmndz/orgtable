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
tablero (`boardLabels: LabelDTO[]`) y un callback `onClose`.

```tsx
export function CardModal({
  card,
  boardId,
  boardLabels,
  onClose,
}: {
  card: CardDTO;
  boardId: string;
  boardLabels: LabelDTO[];
  onClose: () => void;
}) { /* … */ }
```

### Estructura y cierre

El modal se construye como un **overlay a pantalla completa** (`fixed inset-0 z-40`) con
un panel `role="dialog"` `aria-modal="true"` centrado. Se cierra de tres maneras:

| Gesto | Mecanismo |
|-------|-----------|
| **Escape** | `useEffect` registra un listener `keydown` en `window` que llama a `onClose` cuando `e.key === "Escape"`; se limpia al desmontar. |
| **Click fuera** | El `onClick` del overlay llama a `onClose`. El panel interior hace `onClick={(e) => e.stopPropagation()}` para que los clics dentro no se propaguen y no cierren. |
| **Botón ✕** | El botón "Cerrar" de la cabecera llama a `onClose` directamente. |

> Nota de implementación: aunque el rol ARIA es `dialog`, el cierre por Escape se gestiona
> de forma manual con un listener de teclado (no se delega en el comportamiento nativo del
> elemento `<dialog>`), lo que mantiene el control de cierre unificado con el click fuera.

La entrada se anima con dos keyframes definidos en `globals.css`: `overlay-in` (fade del
backdrop, 150 ms) y `dialog-in` (fade + leve `translateY`/`scale`, 180 ms). Ambas
respetan `prefers-reduced-motion` (ver [`docs/design-system.md`](./design-system.md)).

### Origen de los datos (resincronización)

El modal **no mantiene su propia copia mutable** del estado de la tarjeta: lee los datos
directamente del estado del board (la `card` que recibe por props). Las acciones de
servidor llaman a `revalidatePath(\`/board/${boardId}\`)`, lo que provoca que el board se
vuelva a renderizar con los datos frescos y el modal reciba la nueva `card`. Es decir, la
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

1. Resuelve el `boardId` de la tarjeta y autoriza con `requireBoardAccess`.
2. Normaliza los campos: `description` se recorta; si queda vacía se guarda como `null`.
3. `dueDate` se convierte a `Date`; si está vacía o es inválida (`Number.isNaN(getTime())`)
   se guarda como `null`.
4. Persiste con `prisma.card.update` y revalida `/board/${boardId}`.

```ts
await prisma.card.update({
  where: { id: cardId },
  data: {
    description: description || null,
    dueDate: due && !Number.isNaN(due.getTime()) ? due : null,
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

Al pulsar, se invoca **`toggleCardLabel`** dentro de `startTransition`:

```tsx
onClick={() =>
  startTransition(() => {
    toggleCardLabel({ cardId: card.id, labelId: l.id });
  })
}
```

`toggleCardLabel` busca la fila `CardLabel` por su clave compuesta
`cardId_labelId`; si existe la borra, si no la crea — un **toggle** puro. La etiqueta
asignada se resalta con un anillo (`ring-2`) y un "✓"; las no asignadas se atenúan
(`opacity-55`). El fondo de cada pastilla usa `labelBackground(l.color)`.

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

y lo pasa a cada `ChecklistBlock`. Marcar un ítem invoca:

```tsx
onClick={() =>
  startTransition(() => {
    toggleChecklistItem({ itemId: it.id, done: !it.done });
  })
}
```

Esto mantiene la UI responsiva mientras la Server Action y la subsiguiente revalidación
están en curso: el board se resincroniza al volver `revalidatePath`, y el modal refleja el
nuevo estado del ítem (tachado + casilla en verde) sin recargar la página.

`toggleCardLabel` (sección de etiquetas) usa exactamente el mismo patrón
`startTransition`.

---

## Resumen del flujo

1. El usuario abre la tarjeta → `CardModal` con los datos actuales del board.
2. Edita descripción/fecha (form → `updateCard`), gestiona etiquetas
   (`createLabel` / `toggleCardLabel`) o checklists
   (`createChecklist` / `addChecklistItem` / `toggleChecklistItem` /
   `deleteChecklistItem` / `deleteChecklist`).
3. Cada acción persiste en la base de datos y llama a `revalidatePath`.
4. El board se vuelve a renderizar; el modal recibe la `card` actualizada y se
   **resincroniza**. No hay estado local duplicado para estos datos.

Ver también: [`docs/api/server-actions.md`](./api/server-actions.md) ·
[`docs/database.md`](./database.md).
