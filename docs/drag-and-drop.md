# Drag & Drop en orgtable

Esta guía explica cómo funciona el arrastrar y soltar (drag & drop) de listas y
tarjetas en orgtable, pensada para quienes contribuyen al proyecto. El sistema
combina la librería `@dnd-kit` en el cliente, un estado optimista local y Server
Actions que persisten **un único cambio de fila** usando *fractional indexing*.

Archivos implicados:

- `app/components/board/board-view.tsx` — orquesta todo el D&D y el estado optimista.
- `app/components/board/list-column.tsx` — columna/lista arrastrable + `SortableContext` de sus tarjetas.
- `app/components/board/card-item.tsx` — tarjeta arrastrable.
- `app/lib/board-collision.ts` — detección de colisiones y flechas del teclado (puro,
  cubierto por `test/board-collision.test.ts`).
- `app/lib/optimistic.ts` — `persistOptimistic`: guarda el cambio y lo deshace si falla.
- `app/lib/actions/cards.ts` — Server Action `moveCard`.
- `app/lib/actions/lists.ts` — Server Action `reorderList`.
- `app/lib/ordering.ts` — ayudantes de ordenación en el servidor.

---

## Librería: `@dnd-kit`

Se usan tres paquetes de `@dnd-kit`:

- `@dnd-kit/core` — el `DndContext`, los sensores y el `DragOverlay`.
- `@dnd-kit/sortable` — los `SortableContext` y el hook `useSortable`.
- `@dnd-kit/utilities` — el helper `CSS` para aplicar las transformaciones.

### Estructura de contextos

`BoardView` envuelve todo el tablero en un único `DndContext`. La detección de
colisiones es `boardCollisionDetection` (`app/lib/board-collision.ts`): `closestCorners`
(que funciona mejor que `closestCenter` entre contenedores verticales y horizontales),
pero **al arrastrar una lista solo considera otras listas**. Sin ese filtro, la copia
flotante de la lista (baja, en la parte de arriba de la columna) queda más cerca de la
primera tarjeta de la columna de destino que de la propia columna, `over` es una tarjeta
y el reordenado se descartaba. `handleDragEnd` además traduce una tarjeta a su lista
como defensa.

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

Dentro hay dos niveles de `SortableContext`:

- **Columnas (horizontal):** en `BoardView`, un `SortableContext` con
  `horizontalListSortingStrategy` envuelve todas las listas.

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

- **Tarjetas (vertical):** dentro de cada `ListColumn`, otro `SortableContext`
  con `verticalListSortingStrategy` envuelve las tarjetas de esa lista.

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

Tanto `ListColumn` como `CardItem` usan `useSortable` (con `data: { type: "list" }`
y `data: { type: "card", listId }` respectivamente) y aplican
`CSS.Translate.toString(transform)` para moverse mientras se arrastran, bajando la
opacidad a `0.4` en su sitio original (`isDragging`).

### Sensores

```tsx
const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  useSensor(KeyboardSensor, {
    coordinateGetter: boardKeyboardCoordinates,
    keyboardCodes: DRAG_KEYBOARD_CODES,
  }),
);
```

- **Puntero**: el `distance: 5` significa que el puntero debe desplazarse al menos 5 px
  antes de que comience un arrastre. Así un simple clic (abrir la tarjeta, el formulario
  de "añadir") no inicia un arrastre accidental.
- **Teclado**: con el foco en una tarjeta (o en el título de una lista), **Espacio** la
  coge, las **flechas** la mueven, **Espacio** o **Intro** la sueltan y **Escape**
  cancela. **Intro no coge**: con el foco en una tarjeta, Intro (y Espacio si no se
  puede arrastrar, p. ej. como Lector o con filtros) la abre. Las tarjetas usan las
  coordenadas de `@dnd-kit/sortable`; las listas, `boardKeyboardCoordinates`, que salta
  directamente a la columna vecina (las de sortable se iban primero a la primera tarjeta
  de la propia columna y la primera flecha no hacía nada).
- **Lectores de pantalla**: las instrucciones y los anuncios de dnd-kit (en inglés por
  defecto) se pasan en español por `accessibility`, y `aria-roledescription` es
  «tarjeta»/«lista» en vez de «sortable».

---

## Estado optimista

`BoardView` es un componente cliente que mantiene las listas (con sus tarjetas
anidadas) en `useState`, inicializado a partir de las props que llegan del
servidor:

```tsx
const [lists, setLists] = useState<ListDTO[]>(board.lists);
```

Durante un arrastre, este estado local se actualiza **al instante** para que la
interfaz se sienta fluida, antes (y con independencia) de que la Server Action
confirme el cambio.

Cuando el servidor envía datos nuevos —por ejemplo al crear o borrar una lista o
tarjeta, o tras un `revalidatePath`— el estado local se resincroniza durante el render
(patrón «ajustar estado cuando cambia una prop», sin `useEffect`):

```tsx
const [syncedBoard, setSyncedBoard] = useState(board);
if (board !== syncedBoard) {
  setSyncedBoard(board);
  setLists(board.lists);
  if (dragSnapshot) setDragSnapshot(board.lists);
}
```

### Deshacer

Al empezar un arrastre se guarda una **instantánea** de las listas (`dragSnapshot`). Se
vuelve a ella si:

- se **cancela** el arrastre (Escape) o se suelta fuera de cualquier zona: `onDragOver`
  puede haber movido la tarjeta a otra lista solo en el estado local;
- el servidor **rechaza** el cambio (`{ ok: false }`) o la llamada **falla**: la Server
  Action se ejecuta con `persistOptimistic`, que en ese caso restaura la instantánea,
  muestra un aviso con `role="alert"` en la cabecera del tablero («No se pudo mover la
  tarjeta/lista. Inténtalo de nuevo.», se borra al empezar el siguiente arrastre) y
  hace `router.refresh()` para traer los datos reales. Las redirecciones de Next (sesión
  caducada) se relanzan sin tocar y las gestiona el router.

Si llegan datos del servidor en mitad del arrastre, la instantánea pasa a ser esos
datos, para no volver a un estado anterior a ellos.

---

## Los tres manejadores

El `DndContext` registra tres manejadores que viven en `BoardView`.

### `onDragStart` — `handleDragStart`

Guarda el `id` del elemento que se está arrastrando. Ese id sirve después para
saber qué pintar en el `DragOverlay` y para localizar el elemento activo.

```tsx
function handleDragStart(event: DragStartEvent) {
  setActiveId(String(event.active.id));
  setDragSnapshot(lists);
}
```

`onDragCancel` (`handleDragCancel`) limpia el `activeId` y restaura la instantánea.

### `onDragOver` — `handleDragOver`

Mueve **visualmente** una tarjeta de una lista a otra mientras el puntero pasa por
encima, actualizando solo el estado local (todavía sin persistir nada).

- Si lo que se arrastra es una **lista**, se ignora aquí (las listas se reordenan
  en `onDragEnd`).
- Para una tarjeta, calcula el contenedor de origen (`from`) y el de destino
  (`to`). Si son distintos, quita la tarjeta de la lista origen y la inserta en la
  lista destino en la posición sobre la que está el puntero (al final si se
  suelta sobre el cuerpo de la lista, o en el índice de la tarjeta sobre la que se
  pasa).

Esto produce la sensación de que la tarjeta "salta" en vivo de columna en columna.

### `onDragEnd` — `handleDragEnd`

Limpia el `activeId`, calcula la posición final y **persiste** el cambio. Hay dos
ramas:

**1. Reordenar listas (columnas).** Si el elemento activo es una lista, se usa
`arrayMove` para reordenar el array local, se calcula la nueva clave de posición
entre los vecinos y se llama a `reorderList`:

```tsx
const reordered = arrayMove(lists, oldIndex, newIndex);
const movedIdx = reordered.findIndex((l) => l.id === activeIdStr);
const position = generateKeyBetween(
  reordered[movedIdx - 1]?.position ?? null,
  reordered[movedIdx + 1]?.position ?? null,
);
setLists(/* aplica la nueva position a la lista movida */);
void persistOptimistic(
  () => reorderList({ listId: activeIdStr, position }),
  () => revertTo(snapshot),
  { message: "[tablero] fallo al reordenar la lista", context: { listId: activeIdStr } },
);
```

**2. Mover/reordenar una tarjeta.** Una tarjeta puede:

- **Reordenarse dentro de la misma lista:** si se soltó sobre otra tarjeta del
  mismo contenedor, se reordena con `arrayMove`.
- **Cambiar de lista:** el cambio de contenedor ya lo realizó `onDragOver`; aquí
  solo se calcula la posición final en el contenedor en el que ha quedado.

En ambos casos se calcula la clave de posición entre los vecinos de la tarjeta y
se llama a `moveCard`:

```tsx
const position = generateKeyBetween(
  finalList.cards[idx - 1]?.position ?? null,
  finalList.cards[idx + 1]?.position ?? null,
);
setLists(/* aplica la nueva position a la tarjeta movida */);
void persistOptimistic(
  () => moveCard({ cardId: activeIdStr, toListId: container, position }),
  () => revertTo(snapshot),
  { message: "[tablero] fallo al mover la tarjeta", context: { cardId: activeIdStr, toListId: container } },
);
```

---

## Fractional indexing en el cliente

El **cliente** es quien calcula la nueva clave de posición, no el servidor. Para
ello usa `generateKeyBetween(before, after)` de la librería
[`fractional-indexing`](https://www.npmjs.com/package/fractional-indexing).

La idea: cada lista y cada tarjeta tiene una `position` que es una clave string
ordenable lexicográficamente. Para insertar un elemento entre dos vecinos basta con
generar una clave intermedia entre las posiciones de esos vecinos (que vienen en
los propios datos del estado local). Cualquiera de los extremos puede ser `null`
(principio o final de la lista):

```tsx
import { generateKeyBetween } from "fractional-indexing";

const position = generateKeyBetween(
  vecinoAnterior?.position ?? null, // before
  vecinoSiguiente?.position ?? null, // after
);
```

Como la clave generada queda estrictamente entre las dos vecinas, **nunca hace
falta reescribir las posiciones de los demás elementos**: solo cambia la fila que
se ha movido.

Para más contexto, consulta:

- `docs/decisions/0002-fractional-indexing.md` — por qué se eligió este enfoque.
- `docs/database.md` — cómo se modela el campo `position` en la base de datos.

### El servidor solo ordena "al final" y valida lo que llega

`app/lib/ordering.ts` (módulo `server-only`) expone dos funciones basadas en la
misma librería:

- `positionAtEnd(lastPosition)` — clave posterior a la del último elemento. La usan
  las altas (`createList`, `createCard`, checklists e ítems, y los `POST` de la API
  v1) a través de `createListAtEnd`/`createCardAtEnd`/`createChecklistAtEnd`/
  `createChecklistItemAtEnd` (`app/lib/services/`). Cada alta va en una transacción
  que bloquea la fila padre (`SELECT … FOR UPDATE` sobre el tablero, la lista, la
  tarjeta o el checklist): sin el bloqueo, dos altas simultáneas leían la misma
  última posición y guardaban la **misma** clave, y a partir de ahí
  `generateKeyBetween(a, a)` rompía el arrastre en esa lista.
- `isValidPositionKey(key)` — valida la clave que calcula el cliente antes de
  guardarla. El reordenamiento por arrastre lo calcula siempre el cliente y lo envía
  ya resuelto; si el servidor guardara una clave mal formada (`'x'`, `'a00'`…),
  `positionAtEnd` lanzaría para siempre al crear en esa lista o tablero.

#### Validación de la clave (`isValidPositionKey`)

Este es el único sitio que explica la regla; las demás páginas enlazan aquí.

1. **Forma**: alfabeto base62 de la librería, empieza por letra y tiene como
   máximo `POSITION_KEY_MAX` caracteres. La librería por sí sola acepta claves como
   `'a0 '` (con espacio), por eso hace falta la regex.
2. **Estructura**: se intenta `generateKeyBetween(key, null)`; si la librería lanza
   (parte entera mal formada, fracción acabada en `0`…), la clave no es válida.

`moveCard` y `reorderList` validan con zod (`z.string().refine(isValidPositionKey)`)
**antes de cualquier consulta**. Una clave inválida devuelve `{ ok: false }` y no se
guarda nada.

**Límite de longitud.** Las claves crecen al insertar una y otra vez en el mismo
hueco (aproximadamente un carácter cada seis inserciones). `POSITION_KEY_MAX` es
1024 caracteres, unas 6000 inserciones seguidas en el mismo hueco (con el tope
anterior de 64 bastaban 373); evita guardar cadenas enormes y queda por debajo del
máximo de una entrada del índice `(listId, position)`. Si una clave legítima lo
superase, `moveCard`/`reorderList`
devolverían `{ ok: false }` para ese hueco. Hoy `BoardView` no mira ese resultado
(`void moveCard(...)`): el movimiento optimista se queda en pantalla y se deshace
al refrescar, sin aviso.

---

## Persistencia: una sola fila por movimiento

Las dos Server Actions de arrastre son deliberadamente mínimas. Ambas:

1. Validan la entrada con zod, incluida la clave de posición (ver
   [Validación de la clave](#validación-de-la-clave-isvalidpositionkey)).
2. Resuelven el `boardId` afectado.
3. Validan el acceso con `requireBoardAccess(boardId)` y el rol con `canEditBoard`.
4. Hacen **un único `UPDATE`** de la fila movida.
5. Llaman a `revalidateBoard(boardId)` (revalida la ruta y avisa por el bus en vivo).

**`moveCard`** (`app/lib/actions/cards.ts`) — mover/reordenar una tarjeta; puede
cambiar de lista y/o de posición:

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
  // La tarjeta debe ser de ese mismo tablero (IDOR).
  if (!(await cardBelongsToBoard(cardId, boardId))) return { ok: false };

  await prisma.card.update({
    where: { id: cardId },
    data: { listId: toListId, position },
  });
  revalidateBoard(boardId);
  return { ok: true };
}
```

**`reorderList`** (`app/lib/actions/lists.ts`) — reordenar una columna:

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

Gracias al cálculo fraccional, **nunca se reescriben las filas vecinas**: cada
arrastre es exactamente un `UPDATE`.

---

## DragOverlay

Mientras se arrastra, `@dnd-kit` puede renderizar un elemento "flotante" que sigue
al puntero a través del `DragOverlay`. `BoardView` decide qué pintar según si el
elemento activo es una tarjeta o una lista:

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

`CardItem` acepta una prop `overlay` que ajusta su estilo (sombra más marcada y
sin opacidad reducida) y oculta el botón de borrar, para que la copia flotante se
vea correctamente.

---

## Diagrama del flujo

```
   Usuario arrastra una lista o tarjeta
                 │
                 ▼
   onDragStart  →  guarda activeId  →  DragOverlay pinta el elemento flotante
                 │
                 ▼
   onDragOver   →  (solo tarjetas) mueve la tarjeta entre listas
                 │   en el estado LOCAL (optimista, sin red)
                 ▼
   onDragEnd    →  calcula la nueva position con generateKeyBetween(before, after)
                 │   y actualiza el estado LOCAL al instante
                 ▼
   Server Action  (moveCard / reorderList)
                 │   requireBoardAccess + UN ÚNICO UPDATE de la fila movida
                 ▼
   revalidatePath('/board/<id>')
                 │
                 ▼
   Llegan datos nuevos  →  resincronización en el render  →  setLists(board.lists)
   (si la acción devuelve { ok: false } o falla: se restaura la instantánea,
    se avisa en la cabecera y router.refresh())
                 (resincroniza el estado optimista con el servidor)
```

---

En resumen: el cliente mueve la UI de forma optimista y calcula la posición con
*fractional indexing*, y cada arrastre se persiste con un único `UPDATE` validado
en el servidor seguido de una revalidación.
