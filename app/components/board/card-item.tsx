"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CardDTO } from "@/app/lib/types";
import { deleteCard } from "@/app/lib/actions/cards";

export function CardItem({
  card,
  listId,
  overlay = false,
}: {
  card: CardDTO;
  listId: string;
  overlay?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id, data: { type: "card", listId } });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging && !overlay ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group flex cursor-grab items-start justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-black/5 active:cursor-grabbing ${
        overlay ? "shadow-lg" : ""
      }`}
    >
      <span className="flex-1 break-words">{card.title}</span>
      {!overlay && (
        <form action={deleteCard}>
          <input type="hidden" name="cardId" value={card.id} />
          <button
            // Evita que el botón inicie el arrastre.
            onPointerDown={(e) => e.stopPropagation()}
            className="shrink-0 rounded px-1 text-xs text-zinc-300 opacity-0 transition hover:text-red-600 group-hover:opacity-100"
            aria-label="Borrar tarjeta"
          >
            ✕
          </button>
        </form>
      )}
    </div>
  );
}
