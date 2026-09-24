"use client";

import { useId, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { generateKeyBetween } from "fractional-indexing";
import type { BoardDTO, ListDTO, CardDTO } from "@/app/lib/types";
import type { BoardRole } from "@/app/lib/roles";
import { canEditBoard, canManageBoard, BOARD_ROLE_LABELS } from "@/app/lib/roles";
import { moveCard } from "@/app/lib/actions/cards";
import { reorderList } from "@/app/lib/actions/lists";
import { boardBackgroundFor } from "@/app/lib/colors";
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

export function BoardView({
  board,
  viewerRole,
  members,
  currentUserId,
  initialCardId = null,
}: {
  board: BoardDTO;
  viewerRole: BoardRole;
  members: BoardMemberDTO[];
  currentUserId: string;
  initialCardId?: string | null;
}) {
  const [lists, setLists] = useState<ListDTO[]>(board.lists);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Tarjeta abierta. Puede venir preseleccionada por deep-link (?card=…) desde /search.
  const [selectedCardId, setSelectedCardId] = useState<string | null>(
    initialCardId,
  );
  const [membersOpen, setMembersOpen] = useState(false);
  // Vista activa: tablero (columnas) o calendario mensual (Hito 7).
  const [view, setView] = useState<"board" | "calendar">("board");
  // Filtros del tablero (Hito 12): solo presentación. `now` estable para "vencidas".
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [now] = useState(() => Date.now());

  const canEdit = canEditBoard(viewerRole);
  const canManage = canManageBoard(viewerRole);
  const filtering = filtersActive(filters);

  // Resincroniza con el servidor cuando llegan datos nuevos (patrón "ajustar estado
  // durante el render", sin useEffect): `board` solo cambia de referencia con datos
  // frescos del servidor.
  const [syncedBoard, setSyncedBoard] = useState(board);
  if (board !== syncedBoard) {
    setSyncedBoard(board);
    setLists(board.lists);
  }

  // Teclado además de puntero: con el foco en una tarjeta o lista, Espacio la coge,
  // las flechas la mueven y Espacio la suelta (accesibilidad sin ratón).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  // dnd-kit genera ids de accesibilidad con un contador global que no coincide entre
  // servidor y cliente (error de hidratación en aria-describedby); useId es estable.
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

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
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
    setActiveId(null);
    if (!over) return;
    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);

    // Reordenar listas (columnas)
    if (isList(activeIdStr)) {
      const oldIndex = lists.findIndex((l) => l.id === activeIdStr);
      const newIndex = lists.findIndex((l) => l.id === overIdStr);
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
      void reorderList({ listId: activeIdStr, position });
      return;
    }

    // Mover/reordenar tarjeta
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
    void moveCard({ cardId: activeIdStr, toListId: container, position });
  }

  return (
    <BoardPermsProvider role={viewerRole}>
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div
          className="flex flex-1 flex-col overflow-hidden"
          style={{ background: boardBackgroundFor(board) }}
        >
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 pb-2 pt-4">
            <h1 className="font-display text-2xl font-bold tracking-tight text-white drop-shadow-sm">
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
              {/* Conmutador Tablero / Calendario */}
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
                  Tablero
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
                  Calendario
                </button>
              </div>
              <span className="rounded-full bg-white/20 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
                {BOARD_ROLE_LABELS[viewerRole]}
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
                {canManage ? "Miembros" : "Ver miembros"}
                <span className="tabular-nums opacity-80">
                  · {members.length}
                </span>
              </button>
            </div>
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
                    onOpenCard={setSelectedCardId}
                    sortingDisabled={filtering}
                  />
                ))}
              </SortableContext>
              {canEdit && <AddListForm boardId={board.id} />}
            </div>
          ) : (
            <CalendarView
              lists={lists}
              onOpenCard={setSelectedCardId}
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
          onClose={() => setSelectedCardId(null)}
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
