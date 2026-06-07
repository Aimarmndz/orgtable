"use client";

import { useEffect, useState } from "react";
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
          <div
            role="dialog"
            aria-label="Filtros"
            className="absolute right-0 top-11 z-40 w-72 max-w-[calc(100vw-2rem)] space-y-4 rounded-xl border border-border bg-surface p-4 text-ink shadow-[0_24px_48px_-24px_oklch(0.27_0.022_52/0.4)]"
          >
            {/* Etiquetas */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Etiquetas
              </h3>
              {labels.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {labels.map((l) => {
                    const on = filters.labelIds.includes(l.id);
                    return (
                      <button
                        key={l.id}
                        onClick={() => toggle("labelIds", l.id)}
                        style={{ background: labelBackground(l.color) }}
                        className={`rounded-full px-2.5 py-1 text-xs font-medium text-white transition ${
                          on
                            ? "ring-2 ring-ink/40 ring-offset-1 ring-offset-surface"
                            : "opacity-55 hover:opacity-100"
                        }`}
                      >
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
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Asignados
              </h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {members.map((m) => {
                  const on = filters.assigneeIds.includes(m.id);
                  return (
                    <button
                      key={m.id}
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
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Vencimiento
              </h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {DUE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
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
