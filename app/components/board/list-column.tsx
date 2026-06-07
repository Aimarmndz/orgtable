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
  sortingDisabled = false,
}: {
  list: ListDTO;
  onOpenCard: (cardId: string) => void;
  sortingDisabled?: boolean;
}) {
  const { canEdit } = useBoardPerms();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: list.id,
    data: { type: "list" },
    disabled: !canEdit || sortingDisabled,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex max-h-full w-72 shrink-0 flex-col rounded-2xl border border-border/50 bg-column/95 shadow-[0_2px_8px_-4px_oklch(0.27_0.022_52/0.2)] backdrop-blur-sm"
    >
      <div className="flex items-center gap-1.5 px-3.5 py-3">
        <span
          {...(canEdit ? attributes : {})}
          {...(canEdit ? listeners : {})}
          className={`flex-1 text-xs font-semibold uppercase tracking-wide ${
            canEdit ? "cursor-grab active:cursor-grabbing" : ""
          }`}
        >
          {list.title}
        </span>
        <span className="rounded-full bg-black/5 px-1.5 font-mono text-[11px] tabular-nums text-ink-muted dark:bg-white/10">
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
              sortingDisabled={sortingDisabled}
            />
          ))}
        </div>
      </SortableContext>

      {canEdit && <AddCardForm listId={list.id} />}
    </div>
  );
}
