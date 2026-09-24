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
import { canEditBoard, canManageBoard, BOARD_ROLE_LABELS } from "@/app/lib/roles";
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

// Instrucciones para lectores de pantalla (dnd-kit las trae en inglés).
const screenReaderInstructions: ScreenReaderInstructions = {
  draggable:
    "Pulsa Espacio para coger el elemento, las flechas para moverlo, Espacio para soltarlo y Escape para cancelar. Intro abre la tarjeta.",
};

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
  const router = useRouter();
  const pathname = usePathname();
  const [lists, setLists] = useState<ListDTO[]>(board.lists);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Listas tal como estaban al empezar el arrastre, para deshacer el movimiento
  // optimista si se cancela (Escape) o si el servidor lo rechaza.
  const [dragSnapshot, setDragSnapshot] = useState<ListDTO[] | null>(null);
  // Aviso si el servidor no guarda un movimiento: sin él, la tarjeta o la lista vuelve
  // a su sitio sin explicación (el calendario avisa igual con dropError).
  const [moveError, setMoveError] = useState<string | null>(null);
  // Tarjeta abierta: se deriva de la URL (?card=…), no de un estado inicial. Así el
  // deep-link de /search o de una notificación abre la tarjeta aunque ya estés en este
  // tablero (Next no remonta el componente si solo cambian los searchParams).
  const searchParams = useSearchParams();
  const selectedCardId = searchParams.get("card");
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
    // Si llegan datos del servidor en mitad de un arrastre, la instantánea ya es vieja:
    // cancelar debe volver a estos datos, no a los de antes.
    if (dragSnapshot) setDragSnapshot(board.lists);
  }

  // Teclado además de puntero: con el foco en una tarjeta o lista, Espacio la coge,
  // las flechas la mueven y Espacio la suelta (accesibilidad sin ratón). Intro no coge:
  // queda para abrir la tarjeta (ver DRAG_KEYBOARD_CODES).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: boardKeyboardCoordinates,
      keyboardCodes: DRAG_KEYBOARD_CODES,
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

  // Abrir/cerrar la tarjeta cambia solo el ?card de la URL con la History API nativa,
  // que Next sincroniza con useSearchParams sin pedir la página al servidor. Al cerrar
  // se quita siempre, para que volver a pulsar la misma notificación la abra de nuevo.
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

  // Nombre legible de un elemento arrastrable/soltable para los anuncios accesibles.
  const describe = (id: UniqueIdentifier | undefined): string => {
    if (id === undefined) return "";
    const key = String(id);
    const list = lists.find((l) => l.id === key);
    if (list) return `la lista «${list.title}»`;
    const card = lists.flatMap((l) => l.cards).find((c) => c.id === key);
    return card ? `la tarjeta «${card.title}»` : "";
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Has cogido ${describe(active.id)}.`,
    onDragOver: ({ over }) =>
      over ? `Sobre ${describe(over.id)}.` : "Fuera de cualquier lista.",
    onDragEnd: ({ active, over }) =>
      over
        ? `Has soltado ${describe(active.id)} sobre ${describe(over.id)}.`
        : `Has soltado ${describe(active.id)} fuera de cualquier lista; no se mueve.`,
    onDragCancel: ({ active }) =>
      `Movimiento cancelado; ${describe(active.id)} vuelve a su sitio.`,
  };

  // Deshace un movimiento optimista que el servidor no guardó, avisa y pide los datos
  // reales.
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

  // Escape (teclado) o arrastre abortado: handleDragOver puede haber movido la tarjeta
  // a otra lista en el estado local; se vuelve a la instantánea.
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
      // Soltado fuera de cualquier zona: nada que guardar, se deshace lo que movió
      // handleDragOver.
      setLists(snapshot);
      return;
    }
    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);

    // Reordenar listas (columnas)
    if (isList(activeIdStr)) {
      const oldIndex = lists.findIndex((l) => l.id === activeIdStr);
      // Defensa: si `over` fuese una tarjeta, cuenta como su lista.
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
        () =>
          revertTo(snapshot, "No se pudo mover la lista. Inténtalo de nuevo."),
        {
          message: "[tablero] fallo al reordenar la lista",
          context: { listId: activeIdStr },
        },
      );
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
    void persistOptimistic(
      () => moveCard({ cardId: activeIdStr, toListId: container, position }),
      () =>
        revertTo(snapshot, "No se pudo mover la tarjeta. Inténtalo de nuevo."),
      {
        message: "[tablero] fallo al mover la tarjeta",
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
            {/* Fila propia (basis-full) sobre fondo de superficie: el fondo del tablero
                puede ser cualquier color y el rojo necesita contraste. */}
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
