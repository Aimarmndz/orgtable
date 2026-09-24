import { describe, it, expect, afterEach, vi } from "vitest";
import {
  cardMatchesFilters,
  filtersActive,
  isOverdue,
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

describe("isOverdue", () => {
  // `now` construido con fecha LOCAL (la del navegador), como en la app.
  const now = new Date(2026, 8, 24, 10, 0, 0).getTime(); // 24/09/2026 10:00 local

  it("la tarjeta que vence hoy no está vencida", () => {
    expect(isOverdue("2026-09-24T00:00:00.000Z", now)).toBe(false);
  });

  it("la que venció ayer sí", () => {
    expect(isOverdue("2026-09-23T00:00:00.000Z", now)).toBe(true);
  });

  it("coincide con el filtro «Vencidas»", () => {
    const today = card({ dueDate: "2026-09-24T00:00:00.000Z" });
    const yesterday = card({ dueDate: "2026-09-23T00:00:00.000Z" });
    expect(cardMatchesFilters(today, f({ due: "overdue" }), now)).toBe(false);
    expect(cardMatchesFilters(yesterday, f({ due: "overdue" }), now)).toBe(true);
  });
});

describe("formatDueDay", () => {
  // vi.unstubAllEnvs deja TZ como estaba; si no existía, la borra. Reasignar el valor
  // original a mano guardaba el texto "undefined", que Node trata como UTC para el
  // resto del archivo.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("muestra el día guardado aunque la zona local vaya por detrás de UTC", async () => {
    // Antes se formateaba en la zona local: en Nueva York (UTC-4) salía «23 sept».
    vi.stubEnv("TZ", "America/New_York");
    // El formateador es de módulo y fija la zona al importarse: hay que cargar el módulo
    // DESPUÉS de cambiar TZ. Con el import estático de la cabecera se quedaba con la zona
    // de la máquina (UTC en CI) y el test pasaba aunque se quitara `timeZone: "UTC"`.
    vi.resetModules();
    const { formatDueDay } = await import("@/app/lib/board-filters");
    expect(new Date("2026-09-24T00:00:00.000Z").getDate()).toBe(23); // la trampa
    const label = formatDueDay("2026-09-24T00:00:00.000Z");
    expect(label).toContain("24");
    expect(label).toContain("sept");
  });
});
