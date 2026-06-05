"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
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
} from "@dnd-kit/sortable";
import { generateKeyBetween } from "fractional-indexing";
import type { BoardDTO, ListDTO, CardDTO } from "@/app/lib/types";
import { moveCard } from "@/app/lib/actions/cards";
import { reorderList } from "@/app/lib/actions/lists";
import { boardBackgroundFor } from "@/app/lib/colors";
import { ListColumn } from "./list-column";
import { CardItem } from "./card-item";
import { AddListForm } from "./add-list-form";
import { CardModal } from "../card/card-modal";

export function BoardView({ board }: { board: BoardDTO }) {
  const [lists, setLists] = useState<ListDTO[]>(board.lists);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  // Resincroniza con el servidor cuando llegan datos nuevos (patrón "ajustar estado
  // durante el render", sin useEffect): `board` solo cambia de referencia con datos
  // frescos del servidor.
  const [syncedBoard, setSyncedBoard] = useState(board);
  if (board !== syncedBoard) {
    setSyncedBoard(board);
    setLists(board.lists);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

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
    <>
      <DndContext
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
          <div className="shrink-0 px-4 pb-2 pt-4">
            <h1 className="text-xl font-semibold tracking-tight text-white drop-shadow-sm">
              {board.title}
            </h1>
          </div>
          <div className="flex flex-1 items-start gap-3 overflow-x-auto px-4 pb-4">
            <SortableContext
              items={lists.map((l) => l.id)}
              strategy={horizontalListSortingStrategy}
            >
              {lists.map((list) => (
                <ListColumn
                  key={list.id}
                  list={list}
                  onOpenCard={setSelectedCardId}
                />
              ))}
            </SortableContext>
            <AddListForm boardId={board.id} />
          </div>
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
          onClose={() => setSelectedCardId(null)}
        />
      )}
    </>
  );
}
