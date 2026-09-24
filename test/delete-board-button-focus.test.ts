import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement, ReactNode } from "react";

// No hay jsdom en el proyecto (ni se monta): para probar la devolución del foco se
// sustituyen useState/useRef/useEffect por un arnés mínimo que re-ejecuta el
// componente como función, adjunta las refs a botones falsos y corre los efectos cuyas
// dependencias cambian, en el mismo orden que React (render → refs → efectos).
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
vi.mock("@/app/lib/actions/boards", () => ({ deleteBoard: vi.fn() }));

const { DeleteBoardButton } = await import(
  "@/app/(app)/boards/delete-board-button"
);

type Props = Record<string, unknown> & { children?: ReactNode };
type Element = ReactElement<Props>;

const trigger = { focus: vi.fn() };
let triggerRef: { current: unknown } | null = null;

function render(): Element {
  cursor = 0;
  pendingEffects = [];
  const tree = DeleteBoardButton({
    boardId: "b1",
    title: "Plan",
    className: "x",
  }) as Element;
  // React desmonta el ✕ al confirmar (ref a null) y lo vuelve a montar al cancelar.
  const ref = tree.props.ref as { current: unknown } | undefined;
  if (ref) triggerRef = ref;
  if (triggerRef) triggerRef.current = ref ? trigger : null;
  for (const effect of pendingEffects) effect();
  return tree;
}

function findIn(tree: Element, text: string): Element | null {
  const children = ([] as ReactNode[]).concat(tree.props.children ?? []);
  for (const child of children) {
    if (child === text) return tree;
    if (child && typeof child === "object" && "props" in child) {
      const found = findIn(child as Element, text);
      if (found) return found;
    }
  }
  return null;
}

function findByText(tree: Element, text: string): Element {
  const found = findIn(tree, text);
  if (!found) throw new Error(`No se encontró el elemento con el texto «${text}»`);
  return found;
}

beforeEach(() => {
  slots.length = 0;
  triggerRef = null;
  trigger.focus.mockClear();
});

describe("DeleteBoardButton: foco al cancelar", () => {
  it("al montarse no roba el foco (cada tablero de la rejilla tiene su ✕)", () => {
    render();
    expect(trigger.focus).not.toHaveBeenCalled();
  });

  it("cancelar con «No» devuelve el foco al ✕", () => {
    const initial = render();
    (initial.props.onClick as () => void)();
    const form = render();
    expect(form.type).toBe("form");

    (findByText(form, "No").props.onClick as () => void)();
    const back = render();
    expect(back.type).toBe("button");
    expect(trigger.focus).toHaveBeenCalledTimes(1);
  });

  it("cancelar con Escape devuelve el foco al ✕", () => {
    (render().props.onClick as () => void)();
    const form = render();
    (form.props.onKeyDown as (e: { key: string }) => void)({ key: "Escape" });
    render();
    expect(trigger.focus).toHaveBeenCalledTimes(1);
  });

  it("otra tecla dentro de la confirmación no la cierra ni mueve el foco", () => {
    (render().props.onClick as () => void)();
    const form = render();
    (form.props.onKeyDown as (e: { key: string }) => void)({ key: "Tab" });
    expect(render().type).toBe("form");
    expect(trigger.focus).not.toHaveBeenCalled();
  });
});
