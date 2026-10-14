import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement, ReactNode } from "react";

// The project has no jsdom (and does not set one up): to test focus restoration,
// useState/useRef/useEffect are replaced with a minimal harness that re-runs the
// component as a function, attaches the refs to fake buttons and runs the effects whose
// dependencies change, in the same order as React (render → refs → effects).
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
// Without a React tree there is no context for useI18n(): it returns English directly.
vi.mock("@/app/i18n/client", async () => {
  const { messagesFor } = await import("@/app/i18n/config");
  const m = messagesFor("en");
  return { useI18n: () => ({ locale: "en", intl: "en", m }) };
});

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
  // React unmounts the ✕ when confirming (ref to null) and mounts it again on cancel.
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
  if (!found) throw new Error(`No element found with the text "${text}"`);
  return found;
}

beforeEach(() => {
  slots.length = 0;
  triggerRef = null;
  trigger.focus.mockClear();
});

describe("DeleteBoardButton: focus on cancel", () => {
  it("does not steal focus on mount (every board in the grid has its own ✕)", () => {
    render();
    expect(trigger.focus).not.toHaveBeenCalled();
  });

  it("cancelling with \"No\" returns focus to the ✕", () => {
    const initial = render();
    (initial.props.onClick as () => void)();
    const form = render();
    expect(form.type).toBe("form");

    (findByText(form, "No").props.onClick as () => void)();
    const back = render();
    expect(back.type).toBe("button");
    expect(trigger.focus).toHaveBeenCalledTimes(1);
  });

  it("cancelling with Escape returns focus to the ✕", () => {
    (render().props.onClick as () => void)();
    const form = render();
    (form.props.onKeyDown as (e: { key: string }) => void)({ key: "Escape" });
    render();
    expect(trigger.focus).toHaveBeenCalledTimes(1);
  });

  it("another key inside the confirmation neither closes it nor moves focus", () => {
    (render().props.onClick as () => void)();
    const form = render();
    (form.props.onKeyDown as (e: { key: string }) => void)({ key: "Tab" });
    expect(render().type).toBe("form");
    expect(trigger.focus).not.toHaveBeenCalled();
  });
});
