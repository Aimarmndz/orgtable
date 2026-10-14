"use client";

import { useId, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
  type ScreenReaderInstructions,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { generateKeyBetween } from "fractional-indexing";
import type { BoardDTO, ListDTO, CardDTO } from "@/app/lib/types";
import type { BoardRole } from "@/app/lib/roles";
import { canEditBoard, canManageBoard } from "@/app/lib/roles";
import { moveCard } from "@/app/lib/actions/cards";
import { reorderList } from "@/app/lib/actions/lists";
import { boardBackgroundFor } from "@/app/lib/colors";
import {
  boardCollisionDetection,
  boardKeyboardCoordinates,
  DRAG_KEYBOARD_CODES,
} from "@/app/lib/board-collision";
import { persistOptimistic } from "@/app/lib/optimistic";
import { ListColumn } from "./list-column";
import { CardItem } from "./card-item";
import { AddListForm } from "./add-list-form";
import { CalendarView } from "./calendar-view";
import { FilterBar } from "./filter-bar";
import {
  EMPTY_FILTERS,
  filtersActive,
  cardMatchesFilters,
} from "@/app/lib/board-filters";
import { BoardPermsProvider } from "./board-perms";
import { MembersPanel, type BoardMemberDTO } from "./members-panel";
import { CardModal } from "../card/card-modal";
import { useI18n } from "@/app/i18n/client";
import { fmt } from "@/app/i18n/format";

export function BoardView({
  board,
  viewerRole,
  members,
  currentUserId,
}: {
  board: BoardDTO;
  viewerRole: BoardRole;
  members: BoardMemberDTO[];
  currentUserId: string;
}) {
  const { m } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [lists, setLists] = useState<ListDTO[]>(board.lists);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Lists as they were when the drag started, to undo the optimistic move if it is
  // cancelled (Escape) or the server rejects it.
  const [dragSnapshot, setDragSnapshot] = useState<ListDTO[] | null>(null);
  // Warning when the server does not save a move: without it, the card or list jumps
  // back with no explanation (the calendar warns the same way with dropError).
  const [moveError, setMoveError] = useState<string | null>(null);
  // Open card: derived from the URL (?card=…), not from initial state. That way a deep
  // link from /search or a notification opens the card even if you are already on this
  // board (Next does not remount the component when only searchParams change).
  const searchParams = useSearchParams();
  const selectedCardId = searchParams.get("card");
  const [membersOpen, setMembersOpen] = useState(false);
  // Active view: board (columns) or monthly calendar.
  const [view, setView] = useState<"board" | "calendar">("board");
  // Board filters: presentation only. Stable `now` for "overdue".
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [now] = useState(() => Date.now());

  const canEdit = canEditBoard(viewerRole);
  const canManage = canManageBoard(viewerRole);
  const filtering = filtersActive(filters);

  // Resync with the server when new data arrives ("adjust state during render" pattern,
  // no useEffect): `board` only changes reference with fresh server data.
  const [syncedBoard, setSyncedBoard] = useState(board);
  if (board !== syncedBoard) {
    setSyncedBoard(board);
    setLists(board.lists);
    // If server data arrives mid-drag, the snapshot is stale: cancelling must go back
    // to this data, not the previous one.
    if (dragSnapshot) setDragSnapshot(board.lists);
  }

  // Keyboard as well as pointer: with focus on a card or list, Space picks it up, the
  // arrows move it and Space drops it (mouse-free accessibility). Enter does not pick
  // up: it is kept for opening the card (see DRAG_KEYBOARD_CODES).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: boardKeyboardCoordinates,
      keyboardCodes: DRAG_KEYBOARD_CODES,
    }),
  );
  // dnd-kit generates accessibility ids from a global counter that differs between
  // server and client (hydration error on aria-describedby); useId is stable.
  const dndId = useId();

  const isList = (id: string) => lists.some((l) => l.id === id);
  const containerOf = (id: string): string | undefined => {
    if (isList(id)) return id;
    return lists.find((l) => l.cards.some((c) => c.id === id))?.id;
  };

  const activeCard: CardDTO | undefined = activeId
    ? lists.flatMap((l) => l.cards).find((c) => c.id === activeId)
    : undefined;
  const activeList: ListDTO | undefined =
    activeId && isList(activeId)
      ? lists.find((l) => l.id === activeId)
      : undefined;
  const selectedCard: CardDTO | undefined = selectedCardId
    ? lists.flatMap((l) => l.cards).find((c) => c.id === selectedCardId)
    : undefined;

  // Opening/closing the card only changes the URL's ?card with the native History API,
  // which Next syncs with useSearchParams without fetching the page from the server. It
  // is always removed on close, so clicking the same notification again reopens it.
  const openCard = (cardId: string) => {
    window.history.replaceState(
      null,
      "",
      `${pathname}?card=${encodeURIComponent(cardId)}`,
    );
  };
  const closeCard = () => {
    window.history.replaceState(null, "", pathname);
  };

  // Screen reader texts: dnd-kit's defaults are English-only, so they come from the
  // messages.
  const dnd = m.boards.dnd;
  const screenReaderInstructions: ScreenReaderInstructions = {
    draggable: dnd.instructions,
  };
  // Readable name of a draggable/droppable item for the accessible announcements.
  const describe = (id: UniqueIdentifier | undefined): string => {
    if (id === undefined) return "";
    const key = String(id);
    const list = lists.find((l) => l.id === key);
    if (list) return fmt(dnd.listName, { title: list.title });
    const card = lists.flatMap((l) => l.cards).find((c) => c.id === key);
    return card ? fmt(dnd.cardName, { title: card.title }) : "";
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => fmt(dnd.pickedUp, { item: describe(active.id) }),
    onDragOver: ({ over }) =>
      over ? fmt(dnd.over, { target: describe(over.id) }) : dnd.outside,
    onDragEnd: ({ active, over }) =>
      over
        ? fmt(dnd.dropped, {
            item: describe(active.id),
            target: describe(over.id),
          })
        : fmt(dnd.droppedOutside, { item: describe(active.id) }),
    onDragCancel: ({ active }) =>
      fmt(dnd.cancelled, { item: describe(active.id) }),
  };

  // Undoes an optimistic move the server did not save, warns, and fetches the real
  // data.
  const revertTo = (snapshot: ListDTO[], message: string) => {
    setLists(snapshot);
    setMoveError(message);
    router.refresh();
  };

  function handleDragStart(event: DragStartEvent) {
    setMoveError(null);
    setActiveId(String(event.active.id));
    setDragSnapshot(lists);
  }

  // Escape (keyboard) or aborted drag: handleDragOver may have moved the card to another
  // list in local state; go back to the snapshot.
  function handleDragCancel() {
    setActiveId(null);
    if (dragSnapshot) setLists(dragSnapshot);
    setDragSnapshot(null);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);
    if (isList(activeIdStr)) return;

    const from = containerOf(activeIdStr);
    const to = containerOf(overIdStr);
    if (!from || !to || from === to) return;

    setLists((prev) => {
      const fromList = prev.find((l) => l.id === from);
      const toList = prev.find((l) => l.id === to);
      if (!fromList || !toList) return prev;
      const card = fromList.cards.find((c) => c.id === activeIdStr);
      if (!card) return prev;

      const overIsList = isList(overIdStr);
      const overIdx = overIsList
        ? toList.cards.length
        : toList.cards.findIndex((c) => c.id === overIdStr);
      const insertAt = overIdx < 0 ? toList.cards.length : overIdx;

      return prev.map((l) => {
        if (l.id === from) {
          return { ...l, cards: l.cards.filter((c) => c.id !== activeIdStr) };
        }
        if (l.id === to) {
          const next = [...l.cards];
          next.splice(insertAt, 0, card);
          return { ...l, cards: next };
        }
        return l;
      });
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const snapshot = dragSnapshot ?? lists;
    setActiveId(null);
    setDragSnapshot(null);
    if (!over) {
      // Dropped outside any zone: nothing to save; undo what handleDragOver moved.
      setLists(snapshot);
      return;
    }
    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);

    // Reorder lists (columns)
    if (isList(activeIdStr)) {
      const oldIndex = lists.findIndex((l) => l.id === activeIdStr);
      // Defensive: if `over` were a card, it counts as its list.
      const overListId = containerOf(overIdStr);
      const newIndex = lists.findIndex((l) => l.id === overListId);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
      const reordered = arrayMove(lists, oldIndex, newIndex);
      const movedIdx = reordered.findIndex((l) => l.id === activeIdStr);
      const position = generateKeyBetween(
        reordered[movedIdx - 1]?.position ?? null,
        reordered[movedIdx + 1]?.position ?? null,
      );
      setLists(
        reordered.map((l) => (l.id === activeIdStr ? { ...l, position } : l)),
      );
      void persistOptimistic(
        () => reorderList({ listId: activeIdStr, position }),
        () => revertTo(snapshot, m.boards.board.moveListFailed),
        {
          message: "[board] failed to reorder the list",
          context: { listId: activeIdStr },
        },
      );
      return;
    }

    // Move/reorder a card
    const container = containerOf(activeIdStr);
    if (!container) return;
    let working = lists;
    const list = lists.find((l) => l.id === container);
    if (!list) return;

    if (!isList(overIdStr) && overIdStr !== activeIdStr) {
      if (containerOf(overIdStr) === container) {
        const fromIdx = list.cards.findIndex((c) => c.id === activeIdStr);
        const toIdx = list.cards.findIndex((c) => c.id === overIdStr);
        if (fromIdx >= 0 && toIdx >= 0) {
          working = lists.map((l) =>
            l.id === container
              ? { ...l, cards: arrayMove(l.cards, fromIdx, toIdx) }
              : l,
          );
          setLists(working);
        }
      }
    }

    const finalList = working.find((l) => l.id === container);
    if (!finalList) return;
    const idx = finalList.cards.findIndex((c) => c.id === activeIdStr);
    const position = generateKeyBetween(
      finalList.cards[idx - 1]?.position ?? null,
      finalList.cards[idx + 1]?.position ?? null,
    );
    setLists((prev) =>
      prev.map((l) =>
        l.id === container
          ? {
              ...l,
              cards: l.cards.map((c) =>
                c.id === activeIdStr ? { ...c, position } : c,
              ),
            }
          : l,
      ),
    );
    void persistOptimistic(
      () => moveCard({ cardId: activeIdStr, toListId: container, position }),
      () => revertTo(snapshot, m.boards.board.moveCardFailed),
      {
        message: "[board] failed to move the card",
        context: { cardId: activeIdStr, toListId: container },
      },
    );
  }

  return (
    <BoardPermsProvider role={viewerRole}>
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
        <div
          className="flex flex-1 flex-col overflow-hidden"
          style={{ background: boardBackgroundFor(board) }}
        >
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 pb-2 pt-4">
            <h1 className="min-w-0 max-w-full truncate font-display text-2xl font-bold tracking-tight text-white drop-shadow-sm">
              {board.title}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              {view === "board" && (
                <FilterBar
                  labels={board.labels}
                  members={members}
                  filters={filters}
                  onChange={setFilters}
                />
              )}
              {/* Board / Calendar switch */}
              <div className="flex items-center rounded-lg bg-white/20 p-0.5 backdrop-blur-sm">
                <button
                  onClick={() => setView("board")}
                  aria-pressed={view === "board"}
                  className={`rounded-md px-2.5 py-1 text-sm font-medium transition-colors ${
                    view === "board"
                      ? "bg-surface text-ink shadow-sm"
                      : "text-white hover:bg-white/10"
                  }`}
                >
                  {m.boards.board.viewBoard}
                </button>
                <button
                  onClick={() => setView("calendar")}
                  aria-pressed={view === "calendar"}
                  className={`rounded-md px-2.5 py-1 text-sm font-medium transition-colors ${
                    view === "calendar"
                      ? "bg-surface text-ink shadow-sm"
                      : "text-white hover:bg-white/10"
                  }`}
                >
                  {m.boards.board.viewCalendar}
                </button>
              </div>
              <span className="rounded-full bg-white/20 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
                {m.boards.roles[viewerRole]}
              </span>
              <button
                onClick={() => setMembersOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/20 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/30 backdrop-blur-sm"
              >
                <svg
                  className="size-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                {canManage ? m.boards.board.members : m.boards.board.viewMembers}
                <span className="tabular-nums opacity-80">
                  · {members.length}
                </span>
              </button>
            </div>
            {/* Own row (basis-full) on a surface background: the board background can be
                any colour and the red needs contrast. */}
            {moveError && (
              <p
                role="alert"
                className="basis-full rounded-lg bg-surface px-3 py-1.5 text-sm text-danger"
              >
                {moveError}
              </p>
            )}
          </div>
          {view === "board" ? (
            <div className="flex flex-1 items-start gap-3 overflow-x-auto px-4 pb-4">
              <SortableContext
                items={lists.map((l) => l.id)}
                strategy={horizontalListSortingStrategy}
              >
                {(filtering
                  ? lists.map((l) => ({
                      ...l,
                      cards: l.cards.filter((c) =>
                        cardMatchesFilters(c, filters, now),
                      ),
                    }))
                  : lists
                ).map((list) => (
                  <ListColumn
                    key={list.id}
                    list={list}
                    onOpenCard={openCard}
                    sortingDisabled={filtering}
                  />
                ))}
              </SortableContext>
              {canEdit && <AddListForm boardId={board.id} />}
            </div>
          ) : (
            <CalendarView
              lists={lists}
              onOpenCard={openCard}
              canEdit={canEdit}
            />
          )}
        </div>

        <DragOverlay>
          {activeCard ? (
            <CardItem card={activeCard} listId="" overlay />
          ) : activeList ? (
            <div className="w-72 rounded-xl bg-column p-3 opacity-95 shadow-lg">
              <p className="font-semibold">{activeList.title}</p>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {selectedCard && (
        <CardModal
          card={selectedCard}
          boardId={board.id}
          boardLabels={board.labels}
          members={members}
          currentUserId={currentUserId}
          onClose={closeCard}
        />
      )}

      {membersOpen && (
        <MembersPanel
          boardId={board.id}
          members={members}
          canManage={canManage}
          onClose={() => setMembersOpen(false)}
        />
      )}
    </BoardPermsProvider>
  );
}
