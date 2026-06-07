"use client";

import { useMemo, useState } from "react";
import type { ListDTO } from "@/app/lib/types";
import { labelBackground } from "@/app/lib/colors";

// Vista de calendario mensual (Hito 7): coloca las tarjetas con fecha de vencimiento en
// la rejilla del mes. Solo lectura visual; al pulsar una tarjeta se abre su modal (el
// mismo de la vista de tablero). Ver docs/calendar.md.

type DayCard = {
  id: string;
  title: string;
  dueKey: string; // YYYY-MM-DD (parte de fecha del dueDate, sin zona horaria)
  color: string | null; // color de la primera etiqueta, si la hay
  listTitle: string;
};

const WEEKDAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

// Clave de día local YYYY-MM-DD. Se compara con dueDate.slice(0,10) (la fecha que el
// usuario eligió), evitando desfases de zona horaria.
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function CalendarView({
  lists,
  onOpenCard,
}: {
  lists: ListDTO[];
  onOpenCard: (cardId: string) => void;
}) {
  // Mes mostrado (primer día del mes). Arranca en el mes actual.
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

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

  const monthLabel = new Intl.DateTimeFormat("es", {
    month: "long",
    year: "numeric",
  }).format(month);

  const goToToday = () => {
    const now = new Date();
    setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
  };
  const shift = (delta: number) =>
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col rounded-2xl border border-border bg-surface/90 p-3 shadow-[0_2px_8px_-4px_oklch(0.27_0.022_52/0.2)] backdrop-blur-sm sm:p-4">
        {/* Cabecera: mes + navegación */}
        <div className="flex items-center justify-between gap-3 px-1 pb-3">
          <h2 className="font-display text-lg font-bold capitalize tracking-tight">
            {monthLabel}
          </h2>
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

        {/* Rejilla de días */}
        <div className="grid flex-1 auto-rows-fr grid-cols-7 gap-1">
          {days.map(({ date, key, inMonth }) => {
            const cards = byDay.get(key) ?? [];
            const isToday = key === todayKey;
            return (
              <div
                key={key}
                className={`flex min-h-20 flex-col gap-1 rounded-lg border p-1.5 ${
                  inMonth
                    ? "border-border/70 bg-bg/40"
                    : "border-transparent bg-transparent text-ink-muted/60"
                } ${isToday ? "ring-2 ring-accent/50" : ""}`}
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
                <div className="flex flex-col gap-1">
                  {cards.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => onOpenCard(c.id)}
                      title={`${c.title} · ${c.listTitle}`}
                      className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-1.5 py-1 text-left text-xs leading-tight transition-colors hover:border-accent/50"
                    >
                      <span
                        aria-hidden
                        className="size-1.5 shrink-0 rounded-full"
                        style={{ background: c.color ?? "var(--ink-muted)" }}
                      />
                      <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

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
