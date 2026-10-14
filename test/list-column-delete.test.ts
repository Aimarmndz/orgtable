import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { ListDTO } from "@/app/lib/types";

// The project has no jsdom (and does not set one up): as in
// delete-board-button-focus.test.ts, useState/useRef/useEffect are replaced with a
// minimal harness that re-runs the component as a function, attaches the ✕'s ref to a
// fake button and runs the effects whose dependencies change (render → refs → effects).
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
// useSortable, the permissions context and the messages context need a real React tree;
// here only the delete confirmation matters, so they are replaced with fixed values.
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
vi.mock("@/app/i18n/client", async () => {
  const { messagesFor } = await import("@/app/i18n/config");
  const m = messagesFor("en");
  return { useI18n: () => ({ locale: "en", intl: "en", m }) };
});
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

// With an active filter BoardView passes only the visible cards: here one of several.
const list = {
  id: "l1",
  title: "To do",
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
  if (!found) throw new Error(`Not found: ${what}`);
  return found;
}

function render(): Element {
  cursor = 0;
  pendingEffects = [];
  const tree = ListColumn({ list, onOpenCard: () => {} }) as Element;
  // React unmounts the ✕ when confirming (ref to null) and mounts it again on cancel.
  const button = findIn(tree, hasText("✕"));
  const ref = button?.props.ref as { current: unknown } | undefined;
  if (ref) triggerRef = ref;
  if (triggerRef) triggerRef.current = ref ? trigger : null;
  for (const effect of pendingEffects) effect();
  return tree;
}

function openConfirmation(): Element {
  const initial = render();
  (find(initial, hasText("✕"), "the ✕").props.onClick as () => void)();
  return render();
}

const isForm = (el: Element) => el.type === "form";

beforeEach(() => {
  slots.length = 0;
  triggerRef = null;
  trigger.focus.mockClear();
});

describe("ListColumn: delete confirmation", () => {
  it("does not steal focus on mount (every column of the board has its own ✕)", () => {
    render();
    expect(trigger.focus).not.toHaveBeenCalled();
  });

  it("cancelling with \"No\" returns focus to the ✕", () => {
    const confirming = openConfirmation();
    (find(confirming, hasText("No"), "\"No\"").props.onClick as () => void)();
    const back = render();
    expect(findIn(back, isForm)).toBeNull();
    expect(trigger.focus).toHaveBeenCalledTimes(1);
  });

  it("cancelling with Escape closes the confirmation, returns focus and does not propagate", () => {
    const form = find(openConfirmation(), isForm, "the form");
    const stopPropagation = vi.fn();
    (form.props.onKeyDown as (e: { key: string; stopPropagation: () => void }) => void)(
      { key: "Escape", stopPropagation },
    );
    const back = render();
    expect(findIn(back, isForm)).toBeNull();
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(trigger.focus).toHaveBeenCalledTimes(1);
  });

  it("another key inside the confirmation neither closes it nor moves focus", () => {
    const form = find(openConfirmation(), isForm, "the form");
    (form.props.onKeyDown as (e: { key: string; stopPropagation: () => void }) => void)(
      { key: "Tab", stopPropagation: () => {} },
    );
    expect(findIn(render(), isForm)).not.toBeNull();
    expect(trigger.focus).not.toHaveBeenCalled();
  });

  it("\"Yes\" does not announce the number of visible cards (with filters they are not all)", () => {
    const yes = find(openConfirmation(), hasText("Yes"), "\"Yes\"");
    // Before: "…and its 1 cards", although the cascading delete also takes the cards
    // hidden by the filter.
    expect(yes.props["aria-label"]).toBe(
      "Yes, delete the list To do and all its cards",
    );
  });
});
