"use client";

import { useEffect, useRef, useState } from "react";
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
import { useI18n } from "@/app/i18n/client";
import { fmt } from "@/app/i18n/format";

export function ListColumn({
  list,
  onOpenCard,
  sortingDisabled = false,
}: {
  list: ListDTO;
  onOpenCard: (cardId: string) => void;
  sortingDisabled?: boolean;
}) {
  const { m } = useI18n();
  const { canEdit } = useBoardPerms();
  // Deleting a list takes all its cards with it (cascade) and cannot be undone: the ✕
  // asks for a second inline confirmation ("Delete? Yes / No") instead of deleting on
  // the first click, which also lands right next to the drag handle.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // On cancel the form unmounts with focus inside; without moving focus back to the ✕
  // it would fall to <body> and keyboard users would lose their place on the board (same
  // pattern as DeleteBoardButton). Only after cancelling: when the board mounts every
  // column has its ✕ and none of them should steal focus.
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  useEffect(() => {
    if (!confirmingDelete && restoreFocus.current) {
      restoreFocus.current = false;
      deleteTriggerRef.current?.focus();
    }
  }, [confirmingDelete]);

  function cancelDelete() {
    restoreFocus.current = true;
    setConfirmingDelete(false);
  }
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
    // dnd-kit announces "sortable" by default.
    attributes: { roleDescription: m.boards.list.roleDescription },
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
      // The board menu finds the list under a right click by this (board-menu.tsx).
      data-list-id={list.id}
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
        {canEdit &&
          (confirmingDelete ? (
            <form
              action={deleteList}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  // Keep the Escape from reaching other board handlers.
                  e.stopPropagation();
                  cancelDelete();
                }
              }}
              className="flex items-center gap-1 text-xs font-medium"
            >
              <input type="hidden" name="listId" value={list.id} />
              <span className="text-ink-muted">{m.boards.confirm.deletePrompt}</span>
              <button
                type="submit"
                className="rounded px-1.5 py-0.5 text-danger transition-colors hover:bg-danger/10"
                // No count: with active filters `list.cards` only holds the visible ones,
                // but the cascade also deletes the hidden ones.
                aria-label={fmt(m.boards.list.confirmDelete, { title: list.title })}
              >
                {m.boards.confirm.yes}
              </button>
              <button
                type="button"
                autoFocus
                onClick={cancelDelete}
                className="rounded px-1.5 py-0.5 text-ink-muted transition-colors hover:bg-black/5 hover:text-ink dark:hover:bg-white/10"
                aria-label={m.boards.list.keep}
              >
                {m.boards.confirm.no}
              </button>
            </form>
          ) : (
            <button
              ref={deleteTriggerRef}
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="grid size-6 place-items-center rounded text-ink-muted transition-colors hover:bg-black/5 hover:text-danger dark:hover:bg-white/10"
              aria-label={fmt(m.boards.list.delete, { title: list.title })}
            >
              ✕
            </button>
          ))}
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

      {canEdit && <AddCardForm listId={list.id} listTitle={list.title} />}
    </div>
  );
}
