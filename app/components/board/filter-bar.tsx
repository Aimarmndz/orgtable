"use client";

import { useEffect, useId, useState } from "react";
import { labelBackground, labelText } from "@/app/lib/colors";
import {
  type BoardFilters,
  type DueFilter,
  filtersActive,
  EMPTY_FILTERS,
} from "@/app/lib/board-filters";
import type { LabelDTO } from "@/app/lib/types";
import type { BoardMemberDTO } from "./members-panel";
import { useI18n } from "@/app/i18n/client";

// Message key of each due-date option, in display order.
const DUE_OPTIONS = [
  { value: "any", key: "dueAny" },
  { value: "overdue", key: "dueOverdue" },
  { value: "due", key: "dueSet" },
  { value: "none", key: "dueNone" },
] as const satisfies readonly { value: DueFilter; key: string }[];

// Board filter bar. Presentation only: it hides the cards that do not match; it does not
// change any data. See docs/filters.md.
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
  const { m } = useI18n();
  const t = m.boards.filters;
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
        // "Filter cards" in the board menu clicks this.
        data-filter-trigger=""
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
        {t.button}
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
          {/* Anchored to the left at any width: "Filter" is the first button of its
              group, so the 288 px always fit to its right (with the header on one row the
              rest of the group is wider; when it wraps, the group starts at the edge).
              Anchored to the right it overflowed on the left when the header wrapped. */}
          <div
            role="dialog"
            aria-label={t.dialog}
            className="absolute left-0 top-11 z-40 w-72 max-w-[calc(100vw-2rem)] space-y-4 rounded-xl border border-border bg-surface p-4 text-ink shadow-[0_24px_48px_-24px_oklch(0.27_0.022_52/0.4)]"
          >
            {/* Labels */}
            <div>
              <h3
                id={`${idPrefix}-labels`}
                className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
              >
                {t.labels}
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
                    // Unselected: ink text on the surface with a border in the colour
                    // (it used to be white text with opacity-55, ~2.2:1 contrast).
                    // Selected: filled with the colour, with a ✓ and a ring.
                    return (
                      <button
                        key={l.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle("labelIds", l.id)}
                        style={
                          on
                            ? { background: color, borderColor: color, color: labelText(l.color) }
                            : { borderColor: color }
                        }
                        className={`inline-flex items-center gap-1 rounded-full border-2 px-2.5 py-0.5 text-xs font-medium transition ${
                          on
                            ? "ring-2 ring-ink/40 ring-offset-1 ring-offset-surface"
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
                <p className="mt-1 text-xs text-ink-muted">{t.noLabels}</p>
              )}
            </div>

            {/* Assignees */}
            <div>
              <h3
                id={`${idPrefix}-assignees`}
                className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
              >
                {t.assignees}
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

            {/* Due date */}
            <div>
              <h3
                id={`${idPrefix}-due`}
                className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
              >
                {t.due}
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
                    {t[o.key]}
                  </button>
                ))}
              </div>
            </div>

            {active && (
              <button
                onClick={() => onChange(EMPTY_FILTERS)}
                className="w-full rounded-lg border border-border py-1.5 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                {t.clear}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
