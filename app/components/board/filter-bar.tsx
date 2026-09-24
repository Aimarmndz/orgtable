"use client";

import { useEffect, useId, useState } from "react";
import { labelBackground } from "@/app/lib/colors";
import {
  type BoardFilters,
  type DueFilter,
  filtersActive,
  EMPTY_FILTERS,
} from "@/app/lib/board-filters";
import type { LabelDTO } from "@/app/lib/types";
import type { BoardMemberDTO } from "./members-panel";

const DUE_OPTIONS: { value: DueFilter; label: string }[] = [
  { value: "any", label: "Cualquiera" },
  { value: "overdue", label: "Vencidas" },
  { value: "due", label: "Con fecha" },
  { value: "none", label: "Sin fecha" },
];

// Barra de filtros del tablero (Hito 12). Solo afecta a la presentación: oculta las
// tarjetas que no encajan; no cambia datos. Ver docs/filters.md.
export function FilterBar({
  labels,
  members,
  filters,
  onChange,
}: {
  labels: LabelDTO[];
  members: BoardMemberDTO[];
  filters: BoardFilters;
  onChange: (f: BoardFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const idPrefix = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const active = filtersActive(filters);
  const count =
    filters.labelIds.length +
    filters.assigneeIds.length +
    (filters.due !== "any" ? 1 : 0);

  const toggle = (key: "labelIds" | "assigneeIds", id: string) => {
    const cur = filters[key];
    onChange({
      ...filters,
      [key]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    });
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium backdrop-blur-sm transition-colors ${
          active
            ? "bg-white/90 text-ink shadow-sm"
            : "bg-white/20 text-white hover:bg-white/30"
        }`}
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
          <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
        </svg>
        Filtrar
        {count > 0 && (
          <span className="grid min-w-4 place-items-center rounded-full bg-accent px-1 font-mono text-[10px] font-bold text-accent-ink tabular-nums">
            {count}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-30"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          {/* Anclado a la izquierda a cualquier ancho: «Filtrar» es el primer botón de su
              grupo, así que a su derecha siempre caben los 288 px (con la cabecera en una
              fila, el resto del grupo es más ancho; partida, el grupo empieza en el borde).
              Anclado a la derecha se salía por la izquierda al partirse la cabecera. */}
          <div
            role="dialog"
            aria-label="Filtros"
            className="absolute left-0 top-11 z-40 w-72 max-w-[calc(100vw-2rem)] space-y-4 rounded-xl border border-border bg-surface p-4 text-ink shadow-[0_24px_48px_-24px_oklch(0.27_0.022_52/0.4)]"
          >
            {/* Etiquetas */}
            <div>
              <h3
                id={`${idPrefix}-labels`}
                className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
              >
                Etiquetas
              </h3>
              {labels.length > 0 ? (
                <div
                  role="group"
                  aria-labelledby={`${idPrefix}-labels`}
                  className="mt-2 flex flex-wrap gap-1.5"
                >
                  {labels.map((l) => {
                    const on = filters.labelIds.includes(l.id);
                    const color = labelBackground(l.color);
                    // Sin seleccionar: texto de tinta sobre la superficie con el borde del
                    // color (antes texto blanco con opacity-55, ~2,2:1 de contraste).
                    // Seleccionada: rellena del color, con ✓ y anillo.
                    return (
                      <button
                        key={l.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle("labelIds", l.id)}
                        style={
                          on
                            ? { background: color, borderColor: color }
                            : { borderColor: color }
                        }
                        className={`inline-flex items-center gap-1 rounded-full border-2 px-2.5 py-0.5 text-xs font-medium transition ${
                          on
                            ? "text-white ring-2 ring-ink/40 ring-offset-1 ring-offset-surface"
                            : "text-ink hover:bg-surface-2"
                        }`}
                      >
                        {on && <span aria-hidden="true">✓</span>}
                        {l.name}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-1 text-xs text-ink-muted">Sin etiquetas.</p>
              )}
            </div>

            {/* Asignados */}
            <div>
              <h3
                id={`${idPrefix}-assignees`}
                className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
              >
                Asignados
              </h3>
              <div
                role="group"
                aria-labelledby={`${idPrefix}-assignees`}
                className="mt-2 flex flex-wrap gap-1.5"
              >
                {members.map((m) => {
                  const on = filters.assigneeIds.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle("assigneeIds", m.id)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                        on
                          ? "border-accent bg-accent/10 text-ink"
                          : "border-border text-ink-muted hover:text-ink"
                      }`}
                    >
                      {m.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Vencimiento */}
            <div>
              <h3
                id={`${idPrefix}-due`}
                className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
              >
                Vencimiento
              </h3>
              <div
                role="group"
                aria-labelledby={`${idPrefix}-due`}
                className="mt-2 flex flex-wrap gap-1.5"
              >
                {DUE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={filters.due === o.value}
                    onClick={() => onChange({ ...filters, due: o.value })}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                      filters.due === o.value
                        ? "border-accent bg-accent/10 text-ink"
                        : "border-border text-ink-muted hover:text-ink"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {active && (
              <button
                onClick={() => onChange(EMPTY_FILTERS)}
                className="w-full rounded-lg border border-border py-1.5 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                Limpiar filtros
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
