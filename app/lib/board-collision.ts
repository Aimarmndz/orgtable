// Detección de colisiones y navegación por teclado del arrastre del tablero, en un
// módulo PURO (sin React ni DOM) para poder testearlo con rectángulos sintéticos
// (test/board-collision.test.ts). Ver docs/drag-and-drop.md.
import {
  closestCorners,
  KeyboardCode,
  type CollisionDetection,
  type KeyboardCodes,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

type Typed = { data: { current?: { type?: unknown } } };

function isListDroppable(c: Typed): boolean {
  return c.data.current?.type === "list";
}

/**
 * `closestCorners`, pero al arrastrar una LISTA solo considera otras listas. Sin el
 * filtro, el rectángulo flotante de la lista (bajo, arriba de la columna) queda más
 * cerca de la primera tarjeta de la columna que de la propia columna, `over` resultaba
 * ser una tarjeta y el reordenado de listas se descartaba en casi todos los casos.
 */
export const boardCollisionDetection: CollisionDetection = (args) => {
  if (args.active.data.current?.type !== "list") return closestCorners(args);
  return closestCorners({
    ...args,
    droppableContainers: args.droppableContainers.filter(isListDroppable),
  });
};

/**
 * Teclas del `KeyboardSensor`. Espacio coge y suelta; Intro NO coge (queda libre para
 * abrir la tarjeta), pero sí suelta. Escape cancela.
 */
export const DRAG_KEYBOARD_CODES: KeyboardCodes = {
  start: [KeyboardCode.Space],
  cancel: [KeyboardCode.Esc],
  end: [KeyboardCode.Space, KeyboardCode.Enter, KeyboardCode.Tab],
};

type Rect = { left: number; top: number; width: number; right: number };

/** Columna más cercana a `refLeft` en la dirección pedida (`dir` = -1 izquierda, 1 derecha). */
function neighborColumn(
  columns: { rect: Rect }[],
  refLeft: number,
  dir: -1 | 1,
): { rect: Rect } | null {
  let best: { rect: Rect } | null = null;
  let bestDistance = Infinity;
  for (const column of columns) {
    const dx = column.rect.left - refLeft;
    if (dx * dir <= 0) continue;
    if (Math.abs(dx) < bestDistance) {
      best = column;
      bestDistance = Math.abs(dx);
    }
  }
  return best;
}

/**
 * Coordenadas del teclado para el tablero.
 *
 * - LISTA: `sortableKeyboardCoordinates` mezcla tarjetas y columnas y su propia primera
 *   tarjeta queda «a la derecha» (8 px de margen), así que la primera flecha no hacía
 *   nada; aquí la flecha salta directamente a la columna vecina.
 * - TARJETA con izquierda/derecha: para `sortableKeyboardCoordinates` la propia columna
 *   de la tarjeta queda «a la izquierda» (su borde está 8 px antes que el de la tarjeta),
 *   así que la flecha izquierda devolvía la tarjeta a su columna y nunca la movía. Aquí
 *   se salta a la columna vecina y, dentro de ella, a la tarjeta más cercana en vertical
 *   (o a la columna si está vacía). Arriba/abajo siguen con las de `@dnd-kit/sortable`.
 */
export const boardKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  args,
) => {
  const { active, collisionRect, droppableContainers, droppableRects } =
    args.context;
  const right = event.code === KeyboardCode.Right;
  const left = event.code === KeyboardCode.Left;
  const isList = active?.data.current?.type === "list";
  if (!isList && !right && !left) {
    return sortableKeyboardCoordinates(event, args);
  }
  if (!right && !left) {
    // Las listas solo se mueven en horizontal: arriba/abajo no hacen nada (y no
    // desplazan la página).
    if (event.code === KeyboardCode.Up || event.code === KeyboardCode.Down) {
      event.preventDefault();
    }
    return undefined;
  }
  event.preventDefault();
  if (!collisionRect) return undefined;

  const enabled = droppableContainers.getEnabled();
  const columns = enabled.filter(isListDroppable).flatMap((c) => {
    const rect = droppableRects.get(c.id);
    return rect ? [{ rect }] : [];
  });
  const dir = right ? 1 : -1;

  if (isList) {
    const target = neighborColumn(columns, collisionRect.left, dir);
    return target ? { x: target.rect.left, y: target.rect.top } : undefined;
  }

  // Tarjeta: la referencia es el borde de SU columna (la que contiene su centro), no el
  // de la tarjeta, para que la propia columna nunca cuente como vecina.
  const centerX = collisionRect.left + collisionRect.width / 2;
  const own = columns.find(
    (c) => centerX >= c.rect.left && centerX < c.rect.right,
  );
  const target = neighborColumn(
    columns,
    own ? own.rect.left : collisionRect.left,
    dir,
  );
  if (!target) return undefined;

  let bestCard: Rect | null = null;
  for (const c of enabled) {
    if (isListDroppable(c) || c.id === active?.id) continue;
    const r = droppableRects.get(c.id);
    if (!r) continue;
    const cx = r.left + r.width / 2;
    if (cx < target.rect.left || cx >= target.rect.right) continue;
    if (
      !bestCard ||
      Math.abs(r.top - collisionRect.top) < Math.abs(bestCard.top - collisionRect.top)
    ) {
      bestCard = r;
    }
  }
  const dest = bestCard ?? target.rect;
  return { x: dest.left, y: dest.top };
};

/**
 * Coordenadas del teclado para el calendario: cada flecha lleva la pastilla a la celda
 * vecina (día anterior/siguiente, misma columna una semana antes/después). Las de
 * `@dnd-kit/sortable` no sirven aquí porque la pastilla no es un elemento ordenable
 * (no devuelven nada) y las de por defecto avanzan 25 px por pulsación.
 */
export const calendarKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { context },
) => {
  const dir = {
    [KeyboardCode.Right]: { x: 1, y: 0 },
    [KeyboardCode.Left]: { x: -1, y: 0 },
    [KeyboardCode.Down]: { x: 0, y: 1 },
    [KeyboardCode.Up]: { x: 0, y: -1 },
  }[event.code];
  if (!dir) return undefined;
  event.preventDefault(); // las flechas desplazarían la página
  const { collisionRect, droppableContainers, droppableRects, over } = context;
  if (!collisionRect) return undefined;

  const cells = droppableContainers
    .getEnabled()
    .map((c) => droppableRects.get(c.id))
    .filter((r) => r !== undefined);
  // Celda actual: la que está debajo o, si no hay, la que contiene la pastilla.
  const current =
    (over ? droppableRects.get(over.id) : undefined) ??
    cells.find(
      (r) =>
        collisionRect.left >= r.left &&
        collisionRect.left < r.right &&
        collisionRect.top >= r.top &&
        collisionRect.top < r.bottom,
    );
  if (!current) return undefined;

  let best: { left: number; top: number; distance: number } | null = null;
  for (const r of cells) {
    const dx = r.left - current.left;
    const dy = r.top - current.top;
    // Misma fila (para izquierda/derecha) o misma columna (para arriba/abajo).
    const aligned =
      dir.x !== 0
        ? Math.abs(dy) < current.height / 2
        : Math.abs(dx) < current.width / 2;
    const ahead = dir.x !== 0 ? dx * dir.x > 0 : dy * dir.y > 0;
    if (!aligned || !ahead) continue;
    const distance = Math.abs(dx) + Math.abs(dy);
    if (!best || distance < best.distance) {
      best = { left: r.left, top: r.top, distance };
    }
  }
  if (!best) return undefined;
  // Conserva el desplazamiento de la pastilla dentro de la celda.
  return {
    x: best.left + (collisionRect.left - current.left),
    y: best.top + (collisionRect.top - current.top),
  };
};
