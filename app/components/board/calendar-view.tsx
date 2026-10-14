"use client";

import { useId, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
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
import { useI18n } from "@/app/i18n/client";
import { fmt, plural } from "@/app/i18n/format";

// Monthly calendar view with drag to reschedule: places the cards that have a due date
// on the month grid; clicking one opens its modal and (if you can edit) dragging it to
// another day changes its due date. See docs/calendar.md.

type DayCard = {
  id: string;
  title: string;
  dueKey: string; // YYYY-MM-DD (date part of dueDate, no time zone)
  color: string | null; // colour of the first label, if any
  listTitle: string;
};

// Short weekday names in the language `intl`, starting on Monday (the week always starts
// on Monday, whatever the language). 2024-01-01 was a Monday; UTC so the local zone
// cannot shift the day.
function weekdayNames(intl: string): string[] {
  const format = new Intl.DateTimeFormat(intl, { weekday: "short", timeZone: "UTC" });
  return Array.from({ length: 7 }, (_, i) =>
    format.format(new Date(Date.UTC(2024, 0, 1 + i))),
  );
}

// Space always picks up or drops a draggable chip (DRAG_KEYBOARD_CODES), so it must never
// open it. dnd-kit only cancels the keydown, but a native <button> activates on the Space
// keyup (Firefox does even when the keydown was cancelled): cancelling the keyup too
// stops picking up or dropping the chip from also opening the modal. Enter does not need
// this: the button activates on keydown, which dnd-kit already cancels when dropping.
export function preventSpaceActivation(e: {
  code: string;
  preventDefault: () => void;
}): void {
  if (e.code === "Space") e.preventDefault();
}

// Empty subscription to know, with useSyncExternalStore, whether we are in the browser.
const subscribeNothing = () => () => {};

// Local day key YYYY-MM-DD. Compared with dueDate.slice(0,10) (the date the user
// picked), avoiding time zone shifts.
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

// Visual content of the chip, shared by the real chip and the DragOverlay's floating
// copy.
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
  const { m } = useI18n();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
    disabled: !canEdit,
    // dnd-kit announces "draggable" by default.
    attributes: { roleDescription: m.boards.card.roleDescription },
  });
  // No transform: the original chip stays on its day (dimmed) and what follows the
  // pointer is the DragOverlay copy; moving it with transform got it clipped by the
  // calendar's overflow-y-auto.
  return (
    <button
      ref={setNodeRef}
      {...(canEdit ? attributes : {})}
      {...(canEdit ? listeners : {})}
      onClick={() => onOpen(card.id)}
      // Only when draggable: for read-only viewers Space still opens the card, as on any
      // button.
      onKeyUp={canEdit ? preventSpaceActivation : undefined}
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
  const { m, intl } = useI18n();
  const t = m.boards.calendar;
  // Month shown (first day of the month). Starts on the current month.
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  // Keyboard as well as pointer: Space picks up the chip, the arrows move it to the
  // neighbouring day and Space drops it. Enter does not pick up: it still opens the card.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: calendarKeyboardCoordinates,
      keyboardCodes: DRAG_KEYBOARD_CODES,
    }),
  );
  // Id stable between server and client for dnd-kit's accessibility attributes.
  const dndId = useId();
  const [activeId, setActiveId] = useState<string | null>(null);
  // Warning if the server did not save the new date (the card stays on its day).
  const [dropError, setDropError] = useState<string | null>(null);
  // The DragOverlay goes in a portal to document.body, which only exists in the browser:
  // on the server and during hydration this is false and it is not mounted.
  const inBrowser = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );

  const todayKey = useMemo(() => dayKey(new Date()), []);

  // Cards with a date, indexed by day. Those without a date are left out.
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

  // 6-week grid (42 days) starting on the Monday of the week of the 1st.
  const days = useMemo(() => {
    const firstWeekday = (month.getDay() + 6) % 7; // Mon=0 … Sun=6
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

  const monthLabel = new Intl.DateTimeFormat(intl, {
    month: "long",
    year: "numeric",
  }).format(month);
  const weekdays = useMemo(() => weekdayNames(intl), [intl]);
  // Day of a YYYY-MM-DD key for the announcements ("September 24"). In UTC because the
  // key is a calendar date, not an instant.
  const dayNameFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(intl, {
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      }),
    [intl],
  );

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
  // Screen reader texts: dnd-kit's defaults are English-only, so they come from the
  // messages.
  const screenReaderInstructions: ScreenReaderInstructions = {
    draggable: t.instructions,
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => fmt(t.pickedUp, { title: cardTitle(active.id) }),
    onDragOver: ({ over }) =>
      over ? fmt(t.over, { day: dayName(over.id) }) : t.outside,
    onDragEnd: ({ active, over }) =>
      over
        ? fmt(t.dropped, { title: cardTitle(active.id), day: dayName(over.id) })
        : fmt(t.droppedOutside, { title: cardTitle(active.id) }),
    onDragCancel: ({ active }) =>
      fmt(t.cancelled, { title: cardTitle(active.id) }),
  };

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
    setDropError(null);
  }

  // Dropping a card on a day reschedules its due date; the board resyncs through
  // realtime after revalidation.
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
      () => setDropError(t.dueDateFailed),
      {
        message: "[calendar] failed to change the due date",
        context: { cardId, dueDate: newKey },
      },
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col rounded-2xl border border-border bg-surface/90 p-3 shadow-[0_2px_8px_-4px_oklch(0.27_0.022_52/0.2)] backdrop-blur-sm sm:p-4">
        {/* Header: month + navigation */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 pb-3">
          <h2 className="font-display text-lg font-bold tracking-tight first-letter:uppercase">
            {monthLabel}
          </h2>
          {/* Own row below the month and the navigation (order-last basis-full), like the
              board's warning: between the two, at 375 px it had about 10 px and overflowed. */}
          {dropError && (
            <p role="alert" className="order-last basis-full text-xs text-danger">
              {dropError}
            </p>
          )}
          <div className="flex items-center gap-1">
            <button
              onClick={() => shift(-1)}
              aria-label={t.previousMonth}
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
              {t.today}
            </button>
            <button
              onClick={() => shift(1)}
              aria-label={t.nextMonth}
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

        {/* Weekday header */}
        <div className="grid grid-cols-7 gap-1 px-1 pb-1">
          {weekdays.map((w) => (
            <div
              key={w}
              className="text-center text-[11px] font-semibold uppercase tracking-wide text-ink-muted"
            >
              {w}
            </div>
          ))}
        </div>

        {/* Day grid (with drag to reschedule if you can edit) */}
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
          {/* In a portal to document.body: the panel has backdrop-blur, and
              backdrop-filter makes the panel the containing block of fixed descendants.
              Inside it, the copy (fixed, with viewport coordinates) was offset by the
              header and clipped by overflow-y-auto. The portal keeps the React context,
              so it stays inside the DndContext. Always mounted (not only with activeCard)
              so the drop animation can finish. */}
          {inBrowser &&
            createPortal(
              <DragOverlay>
                {activeCard ? (
                  <div className="flex w-full items-center gap-1.5 rounded-md border border-accent/50 bg-surface px-1.5 py-1 text-left text-xs leading-tight shadow-lg">
                    <ChipContent card={activeCard} />
                  </div>
                ) : null}
              </DragOverlay>,
              document.body,
            )}
        </DndContext>

        {undated > 0 && (
          <p className="px-1 pt-3 text-xs text-ink-muted">
            {plural(intl, t.undated, undated)}
          </p>
        )}
      </div>
    </div>
  );
}
