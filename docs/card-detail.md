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

Descripción y vencimiento comparten un único formulario conectado a `updateCard` con
`useActionState`, para poder mostrar el error y desactivar el botón mientras guarda:

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

- La descripción usa `<Textarea>` (`name="description"`) con
  `maxLength={CARD_DESCRIPTION_MAX}` (5000). La constante está en
  [`app/lib/limits.ts`](../app/lib/limits.ts), un módulo sin dependencias, para no meter
  zod en el bundle del cliente; `validators.ts` la reexporta para los esquemas.
- El vencimiento usa `<Input type="date" name="dueDate">`. El valor por defecto se obtiene
  recortando el ISO a `YYYY-MM-DD`: `card.dueDate ? card.dueDate.slice(0, 10) : ""`.
- Si no se guarda, el formulario se rehidrata con lo enviado (`details.description`,
  `details.dueDate`): React resetea el formulario no controlado al acabar la acción y, sin
  esto, lo escrito se perdería. El error se enlaza al textarea con `aria-describedby`.

La acción **`updateCard(prev, formData): Promise<CardDetailsState>`**
([`cards.ts`](../app/lib/actions/cards.ts)) devuelve `{}` si guarda, o
`{ error, description, dueDate }` con lo enviado si no:

1. Normaliza los saltos de línea de la descripción (`\r\n` → `\n`): el navegador los
   envía como `\r\n`, pero `maxLength` los cuenta como un carácter, así que sin
   normalizar una descripción que en la UI mide 5000 se rechazaría.
2. Resuelve el `boardId` de la tarjeta y autoriza con `requireBoardAccess` + `canEditBoard`.
3. Valida `dueDate` con `dueDateSchema` (`"YYYY-MM-DD"` o vacío para quitarla). Una fecha
   inválida **no** se guarda como `null`: devuelve un error y no se guarda nada.
4. Si la descripción es igual a la guardada (tras normalizar y recortar), no se valida su
   longitud ni se reescribe; solo se actualiza la fecha. Así las tarjetas con
   descripciones anteriores al límite (más de 5000) pueden seguir cambiando el
   vencimiento desde el modal. Si ha cambiado, se valida con
   `cardDetailsSchema.shape.description` (recorte + máximo); vacía se guarda como `null`.
5. Si algo no valida no se guarda **nada**: guardar solo una parte perdería en silencio
   lo que el usuario escribió en la otra.
6. Persiste con `prisma.card.update` y revalida el tablero (`revalidateBoard`).

Mensajes de error que puede mostrar el modal:

| Caso | Mensaje |
| --- | --- |
| La tarjeta se borró mientras tanto | «La tarjeta ya no existe.» |
| Sin rol de edición | «No tienes permiso para editar esta tarjeta.» |
| Fecha no válida | «La fecha de vencimiento no es válida.» |
| Descripción nueva demasiado larga | «La descripción no puede superar 5000 caracteres (tiene N).» |

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
