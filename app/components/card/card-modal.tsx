"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type TransitionStartFunction,
} from "react";
import type { CardDTO, ChecklistDTO, LabelDTO } from "@/app/lib/types";
import {
  labelBackground,
  LABEL_COLORS,
  LABEL_COLOR_KEYS,
} from "@/app/lib/colors";
import { updateCard, deleteCard } from "@/app/lib/actions/cards";
import { toggleCardLabel, createLabel } from "@/app/lib/actions/labels";
import {
  createChecklist,
  deleteChecklist,
  addChecklistItem,
  toggleChecklistItem,
  deleteChecklistItem,
} from "@/app/lib/actions/checklists";
import { Button } from "../ui/button";
import { Input, Textarea } from "../ui/input";

const smallInput =
  "w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted/70 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25";

export function CardModal({
  card,
  boardId,
  boardLabels,
  onClose,
}: {
  card: CardDTO;
  boardId: string;
  boardLabels: LabelDTO[];
  onClose: () => void;
}) {
  const [, startTransition] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const assigned = new Set(card.labels.map((l) => l.id));
  const dueValue = card.dueDate ? card.dueDate.slice(0, 10) : "";
  const total = card.checklists.reduce((n, c) => n + c.items.length, 0);
  const done = card.checklists.reduce(
    (n, c) => n + c.items.filter((i) => i.done).length,
    0,
  );

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8"
      style={{ animation: "overlay-in 150ms ease-out" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="my-4 w-full max-w-2xl rounded-2xl border border-border bg-surface p-6 shadow-2xl"
        style={{ animation: "dialog-in 180ms ease-out" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold leading-snug text-balance">
            {card.title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            ✕
          </button>
        </div>

        {/* Etiquetas */}
        <section className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Etiquetas
          </h3>
          {boardLabels.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {boardLabels.map((l) => {
                const on = assigned.has(l.id);
                return (
                  <button
                    key={l.id}
                    onClick={() =>
                      startTransition(() => {
                        toggleCardLabel({ cardId: card.id, labelId: l.id });
                      })
                    }
                    style={{ background: labelBackground(l.color) }}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-white transition ${
                      on
                        ? "ring-2 ring-ink/40 ring-offset-1 ring-offset-surface"
                        : "opacity-55 hover:opacity-100"
                    }`}
                  >
                    {l.name}
                    {on && " ✓"}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">
              Aún no hay etiquetas en este tablero.
            </p>
          )}
          <NewLabelForm boardId={boardId} />
        </section>

        {/* Descripción + fecha */}
        <form action={updateCard} className="mt-6 space-y-4">
          <input type="hidden" name="cardId" value={card.id} />
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Descripción
            </h3>
            <Textarea
              name="description"
              rows={4}
              defaultValue={card.description ?? ""}
              placeholder="Añade más detalle…"
              className="mt-2 resize-y"
            />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="block text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Vencimiento
              </span>
              <Input
                type="date"
                name="dueDate"
                defaultValue={dueValue}
                className="mt-2 w-auto"
              />
            </label>
            <Button type="submit" variant="subtle">
              Guardar cambios
            </Button>
          </div>
        </form>

        {/* Checklists */}
        <section className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Checklists
            {total > 0 && (
              <span className="ml-1.5 font-normal normal-case tracking-normal">
                · {done}/{total} completado
              </span>
            )}
          </h3>
          <div className="mt-3 space-y-5">
            {card.checklists.map((cl) => (
              <ChecklistBlock
                key={cl.id}
                checklist={cl}
                startTransition={startTransition}
              />
            ))}
          </div>
          <NewChecklistForm cardId={card.id} />
        </section>

        {/* Borrar */}
        <div className="mt-8 flex justify-end border-t border-border pt-4">
          <form
            action={async (formData) => {
              await deleteCard(formData);
              onClose();
            }}
          >
            <input type="hidden" name="cardId" value={card.id} />
            <Button variant="danger" type="submit">
              Borrar tarjeta
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

function NewLabelForm({ boardId }: { boardId: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const [color, setColor] = useState<string>(LABEL_COLOR_KEYS[0]);

  return (
    <form
      ref={ref}
      action={async (formData) => {
        await createLabel(formData);
        ref.current?.reset();
      }}
      className="mt-3 flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="boardId" value={boardId} />
      <input type="hidden" name="color" value={color} />
      <div className="flex gap-1">
        {LABEL_COLOR_KEYS.map((k) => (
          <button
            type="button"
            key={k}
            onClick={() => setColor(k)}
            aria-label={`Color ${k}`}
            style={{ background: LABEL_COLORS[k] }}
            className={`size-5 rounded-full transition ${
              color === k
                ? "ring-2 ring-ink/40 ring-offset-1 ring-offset-surface"
                : ""
            }`}
          />
        ))}
      </div>
      <input
        name="name"
        required
        maxLength={40}
        placeholder="Nueva etiqueta"
        className={`${smallInput} min-w-32 flex-1`}
      />
      <Button type="submit" variant="subtle" className="px-3 py-1.5">
        Añadir
      </Button>
    </form>
  );
}

function ChecklistBlock({
  checklist,
  startTransition,
}: {
  checklist: ChecklistDTO;
  startTransition: TransitionStartFunction;
}) {
  const itemRef = useRef<HTMLFormElement>(null);
  const total = checklist.items.length;
  const done = checklist.items.filter((i) => i.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{checklist.title}</h4>
        <form action={deleteChecklist}>
          <input type="hidden" name="checklistId" value={checklist.id} />
          <button className="text-xs text-ink-muted transition-colors hover:text-danger">
            Eliminar
          </button>
        </form>
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-success transition-all duration-200 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs tabular-nums text-ink-muted">{pct}%</span>
      </div>

      <ul className="mt-2 space-y-1">
        {checklist.items.map((it) => (
          <li key={it.id} className="group flex items-center gap-2">
            <button
              onClick={() =>
                startTransition(() => {
                  toggleChecklistItem({ itemId: it.id, done: !it.done });
                })
              }
              aria-label={it.done ? "Marcar como pendiente" : "Marcar como hecho"}
              className={`grid size-4 shrink-0 place-items-center rounded border text-[10px] text-white transition-colors ${
                it.done
                  ? "border-success bg-success"
                  : "border-border hover:border-accent"
              }`}
            >
              {it.done && "✓"}
            </button>
            <span
              className={`flex-1 text-sm ${
                it.done ? "text-ink-muted line-through" : ""
              }`}
            >
              {it.text}
            </span>
            <form action={deleteChecklistItem}>
              <input type="hidden" name="itemId" value={it.id} />
              <button
                className="text-xs text-ink-muted opacity-0 transition hover:text-danger group-hover:opacity-100"
                aria-label="Borrar ítem"
              >
                ✕
              </button>
            </form>
          </li>
        ))}
      </ul>

      <form
        ref={itemRef}
        action={async (formData) => {
          await addChecklistItem(formData);
          itemRef.current?.reset();
        }}
        className="mt-2"
      >
        <input type="hidden" name="checklistId" value={checklist.id} />
        <input
          name="text"
          required
          maxLength={200}
          placeholder="+ Añadir ítem"
          className={smallInput}
        />
      </form>
    </div>
  );
}

function NewChecklistForm({ cardId }: { cardId: string }) {
  const ref = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={ref}
      action={async (formData) => {
        await createChecklist(formData);
        ref.current?.reset();
      }}
      className="mt-4 flex gap-2"
    >
      <input type="hidden" name="cardId" value={cardId} />
      <input
        name="title"
        maxLength={80}
        placeholder="Nueva checklist"
        className={`${smallInput} flex-1`}
      />
      <Button type="submit" variant="subtle">
        Añadir checklist
      </Button>
    </form>
  );
}
