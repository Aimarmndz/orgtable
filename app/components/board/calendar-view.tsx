"use client";

import { useId, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type ScreenReaderInstructions,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import type { ListDTO } from "@/app/lib/types";
import { labelBackground } from "@/app/lib/colors";
import { setCardDueDate } from "@/app/lib/actions/cards";
import {
  calendarKeyboardCoordinates,
  DRAG_KEYBOARD_CODES,
} from "@/app/lib/board-collision";
import { persistOptimistic } from "@/app/lib/optimistic";

// Vista de calendario mensual (Hito 7) con arrastre para reprogramar (Hito 11): coloca las
// tarjetas con fecha de vencimiento en la rejilla del mes; al pulsar una se abre su modal y
// (si puedes editar) arrastrarla a otro día cambia su vencimiento. Ver docs/calendar.md.

type DayCard = {
  id: string;
  title: string;
  dueKey: string; // YYYY-MM-DD (parte de fecha del dueDate, sin zona horaria)
  color: string | null; // color de la primera etiqueta, si la hay
  listTitle: string;
};

const WEEKDAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

// Instrucciones para lectores de pantalla (dnd-kit las trae en inglés).
const screenReaderInstructions: ScreenReaderInstructions = {
  draggable:
    "Pulsa Espacio para coger la tarjeta, las flechas para cambiar de día, Espacio para soltarla y Escape para cancelar. Intro abre la tarjeta.",
};

// Día de una clave YYYY-MM-DD para los anuncios («24 de septiembre»). En UTC porque la
// clave es una fecha de calendario, no un instante.
const dayNameFormat = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

// Clave de día local YYYY-MM-DD. Se compara con dueDate.slice(0,10) (la fecha que el
// usuario eligió), evitando desfases de zona horaria.
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

// Contenido visual de la pastilla, compartido por la pastilla real y la copia flotante
// del DragOverlay.
function ChipContent({ card }: { card: DayCard }) {
  return (
    <>
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: card.color ?? "var(--ink-muted)" }}
      />
      <span className="min-w-0 flex-1 truncate">{card.title}</span>
    </>
  );
}

function CardChip({
  card,
  canEdit,
  onOpen,
}: {
  card: DayCard;
  canEdit: boolean;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
    disabled: !canEdit,
    // dnd-kit anuncia por defecto «draggable» (en inglés).
    attributes: { roleDescription: "tarjeta" },
  });
  // Sin transform: la pastilla original se queda en su día (atenuada) y lo que sigue al
  // puntero es la copia del DragOverlay; moverla con transform la recortaba el
  // overflow-y-auto del calendario.
  return (
    <button
      ref={setNodeRef}
      {...(canEdit ? attributes : {})}
      {...(canEdit ? listeners : {})}
      onClick={() => onOpen(card.id)}
      title={`${card.title} · ${card.listTitle}`}
      className={`flex items-center gap-1.5 rounded-md border border-border bg-surface px-1.5 py-1 text-left text-xs leading-tight transition-colors hover:border-accent/50 ${
        canEdit ? "cursor-grab active:cursor-grabbing" : ""
      } ${isDragging ? "opacity-40" : ""}`}
    >
      <ChipContent card={card} />
    </button>
  );
}

function DayCell({
  dayKeyStr,
  date,
  inMonth,
  isToday,
  canEdit,
  children,
}: {
  dayKeyStr: string;
  date: Date;
  inMonth: boolean;
  isToday: boolean;
  canEdit: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: dayKeyStr,
    disabled: !canEdit,
  });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-20 flex-col gap-1 rounded-lg border p-1.5 transition-colors ${
        inMonth
          ? "border-border/70 bg-bg/40"
          : "border-transparent bg-transparent text-ink-muted/60"
      } ${isToday ? "ring-2 ring-accent/50" : ""} ${
        isOver ? "border-accent bg-accent/10" : ""
      }`}
    >
      <span
        className={`px-0.5 font-mono text-[11px] tabular-nums ${
          isToday
            ? "font-bold text-accent"
            : inMonth
              ? "text-ink-muted"
              : "text-ink-muted/50"
        }`}
      >
        {date.getDate()}
      </span>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

export function CalendarView({
  lists,
  onOpenCard,
  canEdit,
}: {
  lists: ListDTO[];
  onOpenCard: (cardId: string) => void;
  canEdit: boolean;
}) {
  // Mes mostrado (primer día del mes). Arranca en el mes actual.
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  // Teclado además de puntero: Espacio coge la pastilla, las flechas la llevan al día
  // vecino y Espacio la suelta. Intro no coge: sigue abriendo la tarjeta.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: calendarKeyboardCoordinates,
      keyboardCodes: DRAG_KEYBOARD_CODES,
    }),
  );
  // Id estable entre servidor y cliente para los atributos de accesibilidad de dnd-kit.
  const dndId = useId();
  const [activeId, setActiveId] = useState<string | null>(null);
  // Aviso si el servidor no guardó la nueva fecha (la tarjeta se queda en su día).
  const [dropError, setDropError] = useState<string | null>(null);

  const todayKey = useMemo(() => dayKey(new Date()), []);

  // Tarjetas con fecha, indexadas por día. Las que no tienen fecha quedan fuera.
  const { byDay, undated } = useMemo(() => {
    const map = new Map<string, DayCard[]>();
    let undated = 0;
    for (const list of lists) {
      for (const card of list.cards) {
        if (!card.dueDate) {
          undated++;
          continue;
        }
        const dueKey = card.dueDate.slice(0, 10);
        const entry: DayCard = {
          id: card.id,
          title: card.title,
          dueKey,
          color: card.labels[0] ? labelBackground(card.labels[0].color) : null,
          listTitle: list.title,
        };
        const arr = map.get(dueKey);
        if (arr) arr.push(entry);
        else map.set(dueKey, [entry]);
      }
    }
    return { byDay: map, undated };
  }, [lists]);

  // Rejilla de 6 semanas (42 días) empezando en el lunes de la semana del día 1.
  const days = useMemo(() => {
    const firstWeekday = (month.getDay() + 6) % 7; // lun=0 … dom=6
    const gridStart = new Date(
      month.getFullYear(),
      month.getMonth(),
      1 - firstWeekday,
    );
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(
        gridStart.getFullYear(),
        gridStart.getMonth(),
        gridStart.getDate() + i,
      );
      return {
        date: d,
        key: dayKey(d),
        inMonth: d.getMonth() === month.getMonth(),
      };
    });
  }, [month]);

  const monthLabel = new Intl.DateTimeFormat("es-ES", {
    month: "long",
    year: "numeric",
  }).format(month);

  const goToToday = () => {
    const now = new Date();
    setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
  };
  const shift = (delta: number) =>
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  const activeCard: DayCard | undefined = activeId
    ? [...byDay.values()].flat().find((c) => c.id === activeId)
    : undefined;

  const cardTitle = (id: UniqueIdentifier) =>
    lists.flatMap((l) => l.cards).find((c) => c.id === String(id))?.title ?? "";
  const dayName = (id: UniqueIdentifier) =>
    dayNameFormat.format(new Date(`${String(id)}T00:00:00Z`));
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Has cogido la tarjeta «${cardTitle(active.id)}».`,
    onDragOver: ({ over }) =>
      over ? `Sobre el ${dayName(over.id)}.` : "Fuera del calendario.",
    onDragEnd: ({ active, over }) =>
      over
        ? `Has soltado la tarjeta «${cardTitle(active.id)}» en el ${dayName(over.id)}.`
        : `Has soltado la tarjeta «${cardTitle(active.id)}» fuera del calendario; no cambia.`,
    onDragCancel: ({ active }) =>
      `Movimiento cancelado; la tarjeta «${cardTitle(active.id)}» sigue en su día.`,
  };

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
    setDropError(null);
  }

  // Soltar una tarjeta en un día reprograma su vencimiento; el tablero se resincroniza
  // por el tiempo real tras revalidar.
  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const cardId = String(active.id);
    const newKey = String(over.id);
    const current = lists
      .flatMap((l) => l.cards)
      .find((c) => c.id === cardId)
      ?.dueDate?.slice(0, 10);
    if (current === newKey) return;
    void persistOptimistic(
      () => setCardDueDate({ cardId, dueDate: newKey }),
      () => setDropError("No se pudo cambiar la fecha. Inténtalo de nuevo."),
      {
        message: "[calendario] fallo al cambiar la fecha de vencimiento",
        context: { cardId, dueDate: newKey },
      },
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col rounded-2xl border border-border bg-surface/90 p-3 shadow-[0_2px_8px_-4px_oklch(0.27_0.022_52/0.2)] backdrop-blur-sm sm:p-4">
        {/* Cabecera: mes + navegación */}
        <div className="flex items-center justify-between gap-3 px-1 pb-3">
          <h2 className="font-display text-lg font-bold tracking-tight first-letter:uppercase">
            {monthLabel}
          </h2>
          {dropError && (
            <p role="alert" className="min-w-0 flex-1 text-xs text-danger">
              {dropError}
            </p>
          )}
          <div className="flex items-center gap-1">
            <button
              onClick={() => shift(-1)}
              aria-label="Mes anterior"
              className="grid size-8 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <svg
                className="size-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <button
              onClick={goToToday}
              className="rounded-lg px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              Hoy
            </button>
            <button
              onClick={() => shift(1)}
              aria-label="Mes siguiente"
              className="grid size-8 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <svg
                className="size-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>
        </div>

        {/* Cabecera de días de la semana */}
        <div className="grid grid-cols-7 gap-1 px-1 pb-1">
          {WEEKDAYS.map((w) => (
            <div
              key={w}
              className="text-center text-[11px] font-semibold uppercase tracking-wide text-ink-muted"
            >
              {w}
            </div>
          ))}
        </div>

        {/* Rejilla de días (con arrastre para reprogramar si puedes editar) */}
        <DndContext
          id={dndId}
          sensors={sensors}
          accessibility={{ screenReaderInstructions, announcements }}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <div className="grid flex-1 auto-rows-fr grid-cols-7 gap-1">
            {days.map(({ date, key, inMonth }) => (
              <DayCell
                key={key}
                dayKeyStr={key}
                date={date}
                inMonth={inMonth}
                isToday={key === todayKey}
                canEdit={canEdit}
              >
                {(byDay.get(key) ?? []).map((c) => (
                  <CardChip
                    key={c.id}
                    card={c}
                    canEdit={canEdit}
                    onOpen={onOpenCard}
                  />
                ))}
              </DayCell>
            ))}
          </div>
          <DragOverlay>
            {activeCard ? (
              <div className="flex w-full items-center gap-1.5 rounded-md border border-accent/50 bg-surface px-1.5 py-1 text-left text-xs leading-tight shadow-lg">
                <ChipContent card={activeCard} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {undated > 0 && (
          <p className="px-1 pt-3 text-xs text-ink-muted">
            {undated}{" "}
            {undated === 1
              ? "tarjeta sin fecha de vencimiento (no aparece en el calendario)."
              : "tarjetas sin fecha de vencimiento (no aparecen en el calendario)."}
          </p>
        )}
      </div>
    </div>
  );
}
