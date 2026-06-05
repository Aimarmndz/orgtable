"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CardDTO } from "@/app/lib/types";
import { labelBackground } from "@/app/lib/colors";
import { useBoardPerms } from "./board-perms";

function formatDue(d: Date): string {
  return new Intl.DateTimeFormat("es", {
    day: "numeric",
    month: "short",
  }).format(d);
}

export function CardItem({
  card,
  listId,
  onOpen,
  overlay = false,
}: {
  card: CardDTO;
  listId: string;
  onOpen?: (cardId: string) => void;
  overlay?: boolean;
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
    id: card.id,
    data: { type: "card", listId },
    disabled: !canEdit,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging && !overlay ? 0.4 : 1,
  };

  const total = card.checklists.reduce((n, c) => n + c.items.length, 0);
  const done = card.checklists.reduce(
    (n, c) => n + c.items.filter((i) => i.done).length,
    0,
  );
  // Date.now() se lee una vez al montar (no en cada render) para no romper la pureza
  // del render; el badge de "vencida" no necesita actualizarse al segundo.
  const [now] = useState(() => Date.now());
  const due = card.dueDate ? new Date(card.dueDate) : null;
  const overdue = due ? due.getTime() < now : false;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(canEdit ? attributes : {})}
      {...(canEdit ? listeners : {})}
      onClick={() => onOpen?.(card.id)}
      className={`cursor-pointer rounded-lg bg-surface p-2.5 text-sm text-ink shadow-sm ring-1 ring-border/70 transition hover:ring-accent/50 ${
        canEdit ? "active:cursor-grabbing" : ""
      } ${overlay ? "rotate-2 shadow-lg" : ""}`}
    >
      {card.labels.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {card.labels.map((l) => (
            <span
              key={l.id}
              title={l.name}
              className="h-2 w-9 rounded-full"
              style={{ background: labelBackground(l.color) }}
            />
          ))}
        </div>
      )}

      <p className="break-words leading-snug">{card.title}</p>

      {(due || total > 0) && (
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
              {formatDue(due)}
            </span>
          )}
          {total > 0 && (
            <span
              className={`inline-flex items-center gap-1 ${
                done === total ? "text-success" : "text-ink-muted"
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
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
              {done}/{total}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
