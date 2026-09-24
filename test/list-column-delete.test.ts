import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { ListDTO } from "@/app/lib/types";

// No hay jsdom en el proyecto (ni se monta): igual que en
// delete-board-button-focus.test.ts, se sustituyen useState/useRef/useEffect por un
// arnés mínimo que re-ejecuta el componente como función, adjunta la ref del ✕ a un
// botón falso y corre los efectos cuyas dependencias cambian (render → refs → efectos).
type Slot = unknown;
const slots: Slot[] = [];
let cursor = 0;
let pendingEffects: Array<() => void> = [];

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState<T>(initial: T) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      const set = (next: T | ((prev: T) => T)) => {
        slots[i] =
          typeof next === "function"
            ? (next as (prev: T) => T)(slots[i] as T)
            : next;
      };
      return [slots[i] as T, set];
    },
    useRef<T>(initial: T) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    },
    useEffect(effect: () => void, deps: unknown[]) {
      const i = cursor++;
      const prev = slots[i] as unknown[] | undefined;
      if (!prev || deps.some((d, k) => !Object.is(d, prev[k]))) {
        slots[i] = deps;
        pendingEffects.push(effect);
      }
    },
  };
});
// useSortable y el contexto de permisos necesitan un árbol de React de verdad; aquí
// solo importa la confirmación de borrado, así que se sustituyen por valores fijos.
vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: () => null,
  verticalListSortingStrategy: {},
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));
vi.mock("@/app/components/board/board-perms", () => ({
  useBoardPerms: () => ({ canEdit: true }),
}));
vi.mock("@/app/lib/actions/lists", () => ({ deleteList: vi.fn() }));
vi.mock("@/app/components/board/card-item", () => ({ CardItem: () => null }));
vi.mock("@/app/components/board/add-card-form", () => ({
  AddCardForm: () => null,
}));

const { ListColumn } = await import("@/app/components/board/list-column");

type Props = Record<string, unknown> & { children?: ReactNode };
type Element = ReactElement<Props>;

const trigger = { focus: vi.fn() };
let triggerRef: { current: unknown } | null = null;

// Con un filtro activo BoardView pasa solo las tarjetas visibles: aquí una de varias.
const list = {
  id: "l1",
  title: "Pendiente",
  position: "a0",
  cards: [{ id: "c1" }],
} as unknown as ListDTO;

function findIn(tree: Element, match: (el: Element) => boolean): Element | null {
  if (match(tree)) return tree;
  const children = ([] as ReactNode[]).concat(tree.props.children ?? []);
  for (const child of children) {
    if (child && typeof child === "object" && "props" in child) {
      const found = findIn(child as Element, match);
      if (found) return found;
    }
  }
  return null;
}

function hasText(text: string) {
  return (el: Element) =>
    ([] as ReactNode[]).concat(el.props.children ?? []).includes(text);
}

function find(tree: Element, match: (el: Element) => boolean, what: string): Element {
  const found = findIn(tree, match);
  if (!found) throw new Error(`No se encontró ${what}`);
  return found;
}

function render(): Element {
  cursor = 0;
  pendingEffects = [];
  const tree = ListColumn({ list, onOpenCard: () => {} }) as Element;
  // React desmonta el ✕ al confirmar (ref a null) y lo vuelve a montar al cancelar.
  const button = findIn(tree, hasText("✕"));
  const ref = button?.props.ref as { current: unknown } | undefined;
  if (ref) triggerRef = ref;
  if (triggerRef) triggerRef.current = ref ? trigger : null;
  for (const effect of pendingEffects) effect();
  return tree;
}

function openConfirmation(): Element {
  const initial = render();
  (find(initial, hasText("✕"), "el ✕").props.onClick as () => void)();
  return render();
}

const isForm = (el: Element) => el.type === "form";

beforeEach(() => {
  slots.length = 0;
  triggerRef = null;
  trigger.focus.mockClear();
});

describe("ListColumn: confirmación de borrado", () => {
  it("al montarse no roba el foco (cada columna del tablero tiene su ✕)", () => {
    render();
    expect(trigger.focus).not.toHaveBeenCalled();
  });

  it("cancelar con «No» devuelve el foco al ✕", () => {
    const confirming = openConfirmation();
    (find(confirming, hasText("No"), "«No»").props.onClick as () => void)();
    const back = render();
    expect(findIn(back, isForm)).toBeNull();
    expect(trigger.focus).toHaveBeenCalledTimes(1);
  });

  it("cancelar con Escape cierra la confirmación, devuelve el foco y no propaga", () => {
    const form = find(openConfirmation(), isForm, "el formulario");
    const stopPropagation = vi.fn();
    (form.props.onKeyDown as (e: { key: string; stopPropagation: () => void }) => void)(
      { key: "Escape", stopPropagation },
    );
    const back = render();
    expect(findIn(back, isForm)).toBeNull();
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(trigger.focus).toHaveBeenCalledTimes(1);
  });

  it("otra tecla dentro de la confirmación no la cierra ni mueve el foco", () => {
    const form = find(openConfirmation(), isForm, "el formulario");
    (form.props.onKeyDown as (e: { key: string; stopPropagation: () => void }) => void)(
      { key: "Tab", stopPropagation: () => {} },
    );
    expect(findIn(render(), isForm)).not.toBeNull();
    expect(trigger.focus).not.toHaveBeenCalled();
  });

  it("el «Sí» no anuncia el número de tarjetas visibles (con filtros no son todas)", () => {
    const yes = find(openConfirmation(), hasText("Sí"), "«Sí»");
    // Antes: «…y sus 1 tarjetas», aunque el borrado en cascada se lleve también las
    // ocultas por el filtro.
    expect(yes.props["aria-label"]).toBe(
      "Sí, borrar la lista Pendiente y todas sus tarjetas",
    );
  });
});
