import { describe, it, expect, vi } from "vitest";
import {
  closestCorners,
  type Active,
  type ClientRect,
  type DroppableContainer,
  type SensorContext,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  boardCollisionDetection,
  boardKeyboardCoordinates,
  calendarKeyboardCoordinates,
} from "@/app/lib/board-collision";

// Rectángulos sintéticos con la geometría real del tablero: columnas w-72 (288 px)
// separadas por gap-3 (12 px), tarjetas con 8 px de margen lateral bajo la cabecera, y
// la copia flotante de una lista (DragOverlay) de 288×48.
function rect(left: number, top: number, width: number, height: number): ClientRect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function droppable(id: string, type: "list" | "card" | "day"): DroppableContainer {
  return {
    id,
    key: id,
    data: { current: { type } },
    disabled: false,
    node: { current: null },
    rect: { current: null },
  } as unknown as DroppableContainer;
}

function active(id: string, type: "list" | "card"): Active {
  return {
    id,
    data: { current: { type } },
    rect: { current: { initial: null, translated: null } },
  };
}

// Columna A en x=0, B en x=300, C en x=600; una tarjeta en cada una, en y=49.
const rects = new Map<UniqueIdentifier, ClientRect>([
  ["A", rect(0, 0, 288, 190)],
  ["a1", rect(8, 49, 272, 60)],
  ["B", rect(300, 0, 288, 190)],
  ["b1", rect(308, 49, 272, 60)],
  ["C", rect(600, 0, 288, 190)],
  ["c1", rect(608, 49, 272, 60)],
]);
const containers = [
  droppable("A", "list"),
  droppable("a1", "card"),
  droppable("B", "list"),
  droppable("b1", "card"),
  droppable("C", "list"),
  droppable("c1", "card"),
];

describe("boardCollisionDetection", () => {
  // La copia de la lista A, soltada encima de la columna B.
  const overlayOnB = rect(300, 0, 288, 48);

  it("closestCorners a secas resuelve la lista arrastrada a una TARJETA (el fallo)", () => {
    const [first] = closestCorners({
      active: active("A", "list"),
      collisionRect: overlayOnB,
      droppableRects: rects,
      droppableContainers: containers,
      pointerCoordinates: null,
    });
    expect(first.id).toBe("b1");
  });

  it("con una lista activa resuelve a la columna", () => {
    const [first] = boardCollisionDetection({
      active: active("A", "list"),
      collisionRect: overlayOnB,
      droppableRects: rects,
      droppableContainers: containers,
      pointerCoordinates: null,
    });
    expect(first.id).toBe("B");
  });

  it("con una tarjeta activa sigue resolviendo a la tarjeta", () => {
    const [first] = boardCollisionDetection({
      active: active("a1", "card"),
      collisionRect: rect(308, 49, 272, 60),
      droppableRects: rects,
      droppableContainers: containers,
      pointerCoordinates: null,
    });
    expect(first.id).toBe("b1");
  });
});

function key(code: string) {
  const preventDefault = vi.fn();
  return { event: { code, preventDefault } as unknown as KeyboardEvent, preventDefault };
}

function context(over: Partial<SensorContext>): SensorContext {
  return {
    droppableRects: rects,
    droppableContainers: { getEnabled: () => containers },
    over: null,
    ...over,
  } as unknown as SensorContext;
}

describe("boardKeyboardCoordinates (listas)", () => {
  const args = (collisionRect: ClientRect) => ({
    active: "A",
    currentCoordinates: { x: collisionRect.left, y: collisionRect.top },
    context: context({ active: active("A", "list"), collisionRect }),
  });

  it("la flecha derecha salta a la columna vecina, no a la primera tarjeta propia", () => {
    const { event, preventDefault } = key("ArrowRight");
    expect(boardKeyboardCoordinates(event, args(rect(0, 0, 288, 48)))).toEqual({
      x: 300,
      y: 0,
    });
    expect(preventDefault).toHaveBeenCalled();
    expect(
      boardKeyboardCoordinates(key("ArrowRight").event, args(rect(300, 0, 288, 48))),
    ).toEqual({ x: 600, y: 0 });
  });

  it("la flecha izquierda vuelve a la columna anterior y no pasa de la primera", () => {
    expect(
      boardKeyboardCoordinates(key("ArrowLeft").event, args(rect(300, 0, 288, 48))),
    ).toEqual({ x: 0, y: 0 });
    expect(
      boardKeyboardCoordinates(key("ArrowLeft").event, args(rect(0, 0, 288, 48))),
    ).toBeUndefined();
  });

  it("arriba/abajo no mueven una lista", () => {
    const { event, preventDefault } = key("ArrowDown");
    expect(boardKeyboardCoordinates(event, args(rect(0, 0, 288, 48)))).toBeUndefined();
    expect(preventDefault).toHaveBeenCalled();
  });
});

describe("boardKeyboardCoordinates (tarjetas, izquierda/derecha)", () => {
  // Regresión: con la flecha izquierda, la propia columna de la tarjeta (su borde está
  // 8 px antes) contaba como «a la izquierda» y la tarjeta volvía a su sitio sin moverse.
  const args = (id: string, collisionRect: ClientRect, extra?: [string, ClientRect][]) => {
    const r = new Map(rects);
    const cs = [...containers];
    for (const [cid, cr] of extra ?? []) {
      r.set(cid, cr);
      cs.push(droppable(cid, "list"));
    }
    return {
      active: id,
      currentCoordinates: { x: collisionRect.left, y: collisionRect.top },
      context: {
        ...context({ active: active(id, "card"), collisionRect }),
        droppableRects: r,
        droppableContainers: { getEnabled: () => cs },
      } as unknown as SensorContext,
    };
  };

  it("izquierda lleva la tarjeta a la tarjeta de la columna anterior", () => {
    const { event, preventDefault } = key("ArrowLeft");
    expect(boardKeyboardCoordinates(event, args("b1", rect(308, 49, 272, 60)))).toEqual({
      x: 8,
      y: 49,
    });
    expect(preventDefault).toHaveBeenCalled();
  });

  it("derecha lleva la tarjeta a la columna siguiente", () => {
    expect(
      boardKeyboardCoordinates(key("ArrowRight").event, args("b1", rect(308, 49, 272, 60))),
    ).toEqual({ x: 608, y: 49 });
  });

  it("en una columna vacía apunta a la propia columna", () => {
    expect(
      boardKeyboardCoordinates(
        key("ArrowRight").event,
        args("c1", rect(608, 49, 272, 60), [["D", rect(900, 0, 288, 90)]]),
      ),
    ).toEqual({ x: 900, y: 0 });
  });

  it("no pasa de la primera ni de la última columna", () => {
    expect(
      boardKeyboardCoordinates(key("ArrowLeft").event, args("a1", rect(8, 49, 272, 60))),
    ).toBeUndefined();
    expect(
      boardKeyboardCoordinates(key("ArrowRight").event, args("c1", rect(608, 49, 272, 60))),
    ).toBeUndefined();
  });
});

describe("calendarKeyboardCoordinates", () => {
  // Rejilla de 3×2 celdas de 100×80 con gap-1 (4 px). La pastilla está en la celda
  // (0,0), desplazada 6 px a la derecha y 20 px hacia abajo.
  const cells = new Map<UniqueIdentifier, ClientRect>();
  const days: DroppableContainer[] = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      const id = `d${row}${col}`;
      cells.set(id, rect(col * 104, row * 84, 100, 80));
      days.push(droppable(id, "day"));
    }
  }
  const chip = rect(6, 20, 90, 24);
  const ctx = (overId: string | null) =>
    ({
      collisionRect: chip,
      droppableRects: cells,
      droppableContainers: { getEnabled: () => days },
      over: overId ? { id: overId } : null,
    }) as unknown as SensorContext;
  const run = (code: string, overId: string | null = "d00") =>
    calendarKeyboardCoordinates(key(code).event, {
      active: "card",
      currentCoordinates: { x: chip.left, y: chip.top },
      context: ctx(overId),
    });

  it("derecha va al día siguiente y abajo a la semana siguiente", () => {
    expect(run("ArrowRight")).toEqual({ x: 110, y: 20 });
    expect(run("ArrowDown")).toEqual({ x: 6, y: 104 });
  });

  it("sin celda vecina en esa dirección no se mueve", () => {
    expect(run("ArrowLeft")).toBeUndefined();
    expect(run("ArrowUp")).toBeUndefined();
  });

  it("sin `over` usa la celda que contiene la pastilla", () => {
    expect(run("ArrowRight", null)).toEqual({ x: 110, y: 20 });
  });

  it("ignora las teclas que no son flechas", () => {
    const { event, preventDefault } = key("KeyA");
    expect(
      calendarKeyboardCoordinates(event, {
        active: "card",
        currentCoordinates: { x: 0, y: 0 },
        context: ctx("d00"),
      }),
    ).toBeUndefined();
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
