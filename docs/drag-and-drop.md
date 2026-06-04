# Drag & Drop en orgtable

Esta guía explica cómo funciona el arrastrar y soltar (drag & drop) de listas y
tarjetas en orgtable, pensada para quienes contribuyen al proyecto. El sistema
combina la librería `@dnd-kit` en el cliente, un estado optimista local y Server
Actions que persisten **un único cambio de fila** usando *fractional indexing*.

Archivos implicados:

- `app/components/board/board-view.tsx` — orquesta todo el D&D y el estado optimista.
- `app/components/board/list-column.tsx` — columna/lista arrastrable + `SortableContext` de sus tarjetas.
- `app/components/board/card-item.tsx` — tarjeta arrastrable.
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

`BoardView` envuelve todo el tablero en un único `DndContext` con detección de
colisiones `closestCorners` (que funciona mejor que `closestCenter` cuando se
arrastra entre contenedores verticales y horizontales):

```tsx
<DndContext
  sensors={sensors}
  collisionDetection={closestCorners}
  onDragStart={handleDragStart}
  onDragOver={handleDragOver}
  onDragEnd={handleDragEnd}
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

### Sensor

Se registra un único `PointerSensor` con una restricción de activación por
distancia:

```tsx
const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
);
```

El `distance: 5` significa que el puntero debe desplazarse al menos 5 px antes de
que comience un arrastre. Así un simple clic (por ejemplo en "borrar tarjeta" o en
el formulario de "añadir") no inicia un arrastre accidental.

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
tarjeta, o tras un `revalidatePath`— el estado local se resincroniza con un
`useEffect` que depende del `board`:

```tsx
useEffect(() => {
  setLists(board.lists);
}, [board]);
```

De este modo el estado optimista nunca diverge permanentemente del servidor: las
acciones de arrastre actualizan la UI de inmediato y la siguiente revalidación
trae la verdad canónica.

---

## Los tres manejadores

El `DndContext` registra tres manejadores que viven en `BoardView`.

### `onDragStart` — `handleDragStart`

Guarda el `id` del elemento que se está arrastrando. Ese id sirve después para
saber qué pintar en el `DragOverlay` y para localizar el elemento activo.

```tsx
function handleDragStart(event: DragStartEvent) {
  setActiveId(String(event.active.id));
}
```

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
void reorderList({ listId: activeIdStr, position });
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
void moveCard({ cardId: activeIdStr, toListId: container, position });
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

### El servidor solo ordena "al final"

`app/lib/ordering.ts` (módulo `server-only`) expone dos ayudantes basados en la
misma librería:

```ts
export function positionAtEnd(lastPosition: string | null): string {
  return generateKeyBetween(lastPosition, null);
}

export function positionBetween(
  before: string | null,
  after: string | null,
): string {
  return generateKeyBetween(before, after);
}
```

En la práctica el servidor solo usa `positionAtEnd` cuando **crea** una lista o
tarjeta nueva (`createList`, `createCard`): busca la posición del último elemento
y genera una clave posterior a él. El reordenamiento por arrastre lo calcula
siempre el cliente y lo envía ya resuelto.

---

## Persistencia: una sola fila por movimiento

Las dos Server Actions de arrastre son deliberadamente mínimas. Ambas:

1. Resuelven el `boardId` afectado.
2. Validan el acceso con `requireBoardAccess(boardId)`.
3. Hacen **un único `UPDATE`** de la fila movida.
4. Llaman a `revalidatePath('/board/<boardId>')`.

**`moveCard`** (`app/lib/actions/cards.ts`) — mover/reordenar una tarjeta; puede
cambiar de lista y/o de posición:

```ts
export async function moveCard(input: {
  cardId: string;
  toListId: string;
  position: string;
}): Promise<{ ok: boolean }> {
  const boardId = await boardIdForList(input.toListId);
  if (!boardId) return { ok: false };
  await requireBoardAccess(boardId);

  await prisma.card.update({
    where: { id: input.cardId },
    data: { listId: input.toListId, position: input.position },
  });
  revalidatePath(`/board/${boardId}`);
  return { ok: true };
}
```

**`reorderList`** (`app/lib/actions/lists.ts`) — reordenar una columna:

```ts
export async function reorderList(input: {
  listId: string;
  position: string;
}): Promise<{ ok: boolean }> {
  const list = await prisma.list.findUnique({
    where: { id: input.listId },
    select: { boardId: true },
  });
  if (!list) return { ok: false };
  await requireBoardAccess(list.boardId);

  await prisma.list.update({
    where: { id: input.listId },
    data: { position: input.position },
  });
  revalidatePath(`/board/${list.boardId}`);
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
   Llegan datos nuevos  →  useEffect([board])  →  setLists(board.lists)
                 (resincroniza el estado optimista con el servidor)
```

---

En resumen: el cliente mueve la UI de forma optimista y calcula la posición con
*fractional indexing*, y cada arrastre se persiste con un único `UPDATE` validado
en el servidor seguido de una revalidación.
