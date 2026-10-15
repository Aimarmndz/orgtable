"use client";

import { useState, useSyncExternalStore } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CardDTO } from "@/app/lib/types";
import { labelBackground } from "@/app/lib/colors";
import { formatDueDay, isOverdue } from "@/app/lib/board-filters";
import { useBoardPerms } from "./board-perms";
import { useI18n } from "@/app/i18n/client";
import { fmt } from "@/app/i18n/format";

// Empty subscription: useSyncExternalStore is only used to know whether we hydrated.
const subscribeNothing = () => () => {};

export function CardItem({
  card,
  listId,
  onOpen,
  overlay = false,
  sortingDisabled = false,
}: {
  card: CardDTO;
  listId: string;
  onOpen?: (cardId: string) => void;
  overlay?: boolean;
  sortingDisabled?: boolean;
}) {
  const { m, intl } = useI18n();
  const { canEdit } = useBoardPerms();
  const draggable = canEdit && !sortingDisabled;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: card.id,
    data: { type: "card", listId },
    disabled: !draggable,
    // dnd-kit announces "sortable" by default.
    attributes: { roleDescription: m.boards.card.roleDescription },
  });

  // Side rule tinted with the first label's colour (or the border if there is none).
  const firstLabel = card.labels[0];
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging && !overlay ? 0.4 : 1,
    borderLeftColor: firstLabel ? labelBackground(firstLabel.color) : undefined,
    borderLeftWidth: firstLabel ? "3px" : undefined,
  };

  const total = card.checklists.reduce((n, c) => n + c.items.length, 0);
  const done = card.checklists.reduce(
    (n, c) => n + c.items.filter((i) => i.done).length,
    0,
  );
  const attachCount = card.attachments.length;
  // Date.now() is read once on mount (not on every render) to keep rendering pure; the
  // "overdue" badge does not need to update every second.
  const [now] = useState(() => Date.now());
  // "Overdue" depends on the browser's LOCAL day, which the server does not know: it is
  // only computed after hydration (false on the server and during hydration), so the
  // server HTML and the client's first render match.
  const hydrated = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
  const due = card.dueDate;
  const overdue = hydrated && due ? isOverdue(due, now) : false;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(draggable ? attributes : {})}
      {...(draggable ? listeners : {})}
      // Always focusable and announced as a button (also for viewers or with filters,
      // when dnd-kit does not add its attributes). The floating copy gets no focus. No
      // aria-label: the name comes from the content (labels, title, due date...) and an
      // aria-label with only the title would hide it.
      role="button"
      tabIndex={overlay ? -1 : 0}
      // The board menu finds the card under a right click by this (board-menu.tsx).
      data-card-id={overlay ? undefined : card.id}
      onClick={() => onOpen?.(card.id)}
      onKeyDown={(e) => {
        // dnd-kit first (Space picks up the card if it is draggable; if it does, it marks
        // the event with preventDefault). During a keyboard drag, Enter drops the card
        // and must not open it.
        if (draggable) listeners?.onKeyDown?.(e);
        if (e.defaultPrevented || isDragging || overlay) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault(); // Space would scroll the page.
          onOpen?.(card.id);
        }
      }}
      className={`group cursor-pointer rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink shadow-[0_1px_2px_oklch(0.27_0.022_52/0.06)] transition hover:border-accent/40 hover:shadow-[0_4px_12px_-4px_oklch(0.27_0.022_52/0.15)] ${
        draggable ? "active:cursor-grabbing" : ""
      } ${overlay ? "rotate-2 shadow-lg" : ""}`}
    >
      {card.labels.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-x-2.5 gap-y-1">
          {card.labels.map((l) => (
            <span
              key={l.id}
              className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted"
            >
              <span
                className="size-1.5 rounded-full"
                style={{ background: labelBackground(l.color) }}
              />
              {l.name}
            </span>
          ))}
        </div>
      )}

      <p className="break-words font-medium leading-snug">{card.title}</p>

      {total > 0 && (
        <div className="mt-2.5 flex items-center gap-2">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"
            role="progressbar"
            aria-valuenow={done}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-label={fmt(m.boards.card.subtasks, { done, total })}
          >
            <div
              className={`h-full rounded-full transition-[width] duration-200 ease-out ${
                done === total ? "bg-success" : "bg-accent"
              }`}
              style={{ width: `${Math.round((done / total) * 100)}%` }}
            />
          </div>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-muted">
            {done}/{total}
          </span>
        </div>
      )}

      {(due || attachCount > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {due && (
            <span
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${
                overdue
                  ? "bg-danger/15 text-danger"
                  : "bg-surface-2 text-ink-muted"
              }`}
            >
              <svg
                className="size-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              {formatDueDay(due, intl)}
              {/* Red is only visual: the screen reader needs the state as text. */}
              {overdue && <span className="sr-only">{m.boards.card.overdue}</span>}
            </span>
          )}
          {attachCount > 0 && (
            <span className="inline-flex items-center gap-1 text-ink-muted">
              <svg
                className="size-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
              {attachCount}
            </span>
          )}
        </div>
      )}

      {(card.assignees.length > 0 || card.comments.length > 0) && (
        <div className="mt-2 flex items-center justify-between gap-2">
          {card.comments.length > 0 ? (
            <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
              <svg
                className="size-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              {card.comments.length}
            </span>
          ) : (
            <span />
          )}
          {card.assignees.length > 0 && (
            <div className="flex -space-x-1.5">
              {card.assignees.slice(0, 4).map((a) => (
                <span
                  key={a.id}
                  title={a.name}
                  className="grid size-5 place-items-center rounded-full bg-surface-2 text-[10px] font-semibold uppercase text-ink-muted ring-2 ring-surface"
                >
                  {a.name.charAt(0)}
                </span>
              ))}
              {card.assignees.length > 4 && (
                <span className="grid size-5 place-items-center rounded-full bg-surface-2 text-[9px] font-semibold text-ink-muted ring-2 ring-surface">
                  +{card.assignees.length - 4}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
