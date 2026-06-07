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

  // Regla lateral tintada con el color de la primera etiqueta (o el borde si no hay).
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
      className={`group cursor-pointer rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink shadow-[0_1px_2px_oklch(0.27_0.022_52/0.06)] transition hover:border-accent/40 hover:shadow-[0_4px_12px_-4px_oklch(0.27_0.022_52/0.15)] ${
        canEdit ? "active:cursor-grabbing" : ""
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
            aria-label={`Subtareas: ${done} de ${total} completadas`}
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
              {formatDue(due)}
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
    </div>
  );
}
