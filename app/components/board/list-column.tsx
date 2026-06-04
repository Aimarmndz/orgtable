"use client";

import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ListDTO } from "@/app/lib/types";
import { deleteList } from "@/app/lib/actions/lists";
import { CardItem } from "./card-item";
import { AddCardForm } from "./add-card-form";

export function ListColumn({ list }: { list: ListDTO }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: list.id, data: { type: "list" } });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex max-h-full w-72 shrink-0 flex-col rounded-xl bg-zinc-100 p-2"
    >
      <div className="flex items-center justify-between px-1 py-1">
        <span
          {...attributes}
          {...listeners}
          className="flex-1 cursor-grab text-sm font-semibold text-zinc-700 active:cursor-grabbing"
        >
          {list.title}
        </span>
        <form action={deleteList}>
          <input type="hidden" name="listId" value={list.id} />
          <button
            className="rounded px-1.5 text-xs text-zinc-400 transition hover:text-red-600"
            aria-label={`Borrar lista ${list.title}`}
          >
            ✕
          </button>
        </form>
      </div>

      <SortableContext
        items={list.cards.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex min-h-2 flex-col gap-2 overflow-y-auto py-1">
          {list.cards.map((card) => (
            <CardItem key={card.id} card={card} listId={list.id} />
          ))}
        </div>
      </SortableContext>

      <AddCardForm listId={list.id} />
    </div>
  );
}
