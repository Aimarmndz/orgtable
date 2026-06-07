import { describe, it, expect } from "vitest";
import {
  cardMatchesFilters,
  filtersActive,
  EMPTY_FILTERS,
  type BoardFilters,
} from "@/app/lib/board-filters";
import type { CardDTO } from "@/app/lib/types";

// Hoy fijo (UTC) para los tests de vencimiento.
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0); // 2026-06-15

function card(over: Partial<CardDTO>): CardDTO {
  return {
    id: "c1",
    title: "Tarjeta",
    position: "a0",
    description: null,
    dueDate: null,
    labels: [],
    checklists: [],
    attachments: [],
    assignees: [],
    comments: [],
    ...over,
  };
}

const f = (over: Partial<BoardFilters>): BoardFilters => ({
  ...EMPTY_FILTERS,
  ...over,
});

describe("board-filters", () => {
  it("sin filtros activos todo pasa", () => {
    expect(filtersActive(EMPTY_FILTERS)).toBe(false);
    expect(cardMatchesFilters(card({}), EMPTY_FILTERS, NOW)).toBe(true);
  });

  it("filtra por etiqueta (OR dentro de la dimensión)", () => {
    const c = card({ labels: [{ id: "L1", name: "a", color: "blue" }] });
    expect(cardMatchesFilters(c, f({ labelIds: ["L1"] }), NOW)).toBe(true);
    expect(cardMatchesFilters(c, f({ labelIds: ["L2"] }), NOW)).toBe(false);
    expect(cardMatchesFilters(c, f({ labelIds: ["L2", "L1"] }), NOW)).toBe(true);
  });

  it("filtra por asignado", () => {
    const c = card({ assignees: [{ id: "U1", name: "Ana" }] });
    expect(cardMatchesFilters(c, f({ assigneeIds: ["U1"] }), NOW)).toBe(true);
    expect(cardMatchesFilters(c, f({ assigneeIds: ["U2"] }), NOW)).toBe(false);
  });

  it("combina dimensiones con AND", () => {
    const c = card({
      labels: [{ id: "L1", name: "a", color: "blue" }],
      assignees: [{ id: "U1", name: "Ana" }],
    });
    expect(
      cardMatchesFilters(c, f({ labelIds: ["L1"], assigneeIds: ["U1"] }), NOW),
    ).toBe(true);
    expect(
      cardMatchesFilters(c, f({ labelIds: ["L1"], assigneeIds: ["U2"] }), NOW),
    ).toBe(false);
  });

  it("filtra por estado de vencimiento", () => {
    const overdue = card({ dueDate: "2026-06-10T00:00:00.000Z" });
    const future = card({ dueDate: "2026-06-20T00:00:00.000Z" });
    const undated = card({ dueDate: null });

    expect(cardMatchesFilters(overdue, f({ due: "overdue" }), NOW)).toBe(true);
    expect(cardMatchesFilters(future, f({ due: "overdue" }), NOW)).toBe(false);
    expect(cardMatchesFilters(undated, f({ due: "overdue" }), NOW)).toBe(false);

    expect(cardMatchesFilters(future, f({ due: "due" }), NOW)).toBe(true);
    expect(cardMatchesFilters(undated, f({ due: "due" }), NOW)).toBe(false);

    expect(cardMatchesFilters(undated, f({ due: "none" }), NOW)).toBe(true);
    expect(cardMatchesFilters(future, f({ due: "none" }), NOW)).toBe(false);
  });
});
