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
import { useBoardPerms } from "./board-perms";

export function ListColumn({
  list,
  onOpenCard,
}: {
  list: ListDTO;
  onOpenCard: (cardId: string) => void;
}) {
  const { canEdit } = useBoardPerms();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: list.id, data: { type: "list" }, disabled: !canEdit });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex max-h-full w-72 shrink-0 flex-col rounded-xl bg-column shadow-sm"
    >
      <div className="flex items-center gap-1 px-3 py-2.5">
        <span
          {...(canEdit ? attributes : {})}
          {...(canEdit ? listeners : {})}
          className={`flex-1 text-sm font-semibold ${
            canEdit ? "cursor-grab active:cursor-grabbing" : ""
          }`}
        >
          {list.title}
        </span>
        <span className="rounded bg-black/5 px-1.5 text-xs tabular-nums text-ink-muted dark:bg-white/10">
          {list.cards.length}
        </span>
        {canEdit && (
          <form action={deleteList}>
            <input type="hidden" name="listId" value={list.id} />
            <button
              className="grid size-6 place-items-center rounded text-ink-muted transition-colors hover:bg-black/5 hover:text-danger dark:hover:bg-white/10"
              aria-label={`Borrar lista ${list.title}`}
            >
              ✕
            </button>
          </form>
        )}
      </div>

      <SortableContext
        items={list.cards.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex min-h-1 flex-col gap-2 overflow-y-auto px-2">
          {list.cards.map((card) => (
            <CardItem
              key={card.id}
              card={card}
              listId={list.id}
              onOpen={onOpenCard}
            />
          ))}
        </div>
      </SortableContext>

      {canEdit && <AddCardForm listId={list.id} />}
    </div>
  );
}
