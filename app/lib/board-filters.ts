// Filtros de tablero (Hito 12), lógica PURA y compartida cliente/servidor (sin
// "server-only": el cliente la usa para ocultar tarjetas y se testea directamente). El
// filtrado es solo de presentación; no cambia datos. Ver docs/filters.md.
import type { CardDTO } from "@/app/lib/types";

export type DueFilter = "any" | "overdue" | "due" | "none";

export type BoardFilters = {
  labelIds: string[]; // la tarjeta debe tener AL MENOS una de estas etiquetas
  assigneeIds: string[]; // … y al menos uno de estos asignados
  due: DueFilter;
};

export const EMPTY_FILTERS: BoardFilters = {
  labelIds: [],
  assigneeIds: [],
  due: "any",
};

/** ¿Hay algún filtro activo? Si no, no se filtra nada (ni se desactiva el arrastre). */
export function filtersActive(f: BoardFilters): boolean {
  return f.labelIds.length > 0 || f.assigneeIds.length > 0 || f.due !== "any";
}

function matchesDue(card: CardDTO, due: DueFilter, now: number): boolean {
  if (due === "any") return true;
  if (due === "none") return card.dueDate === null;
  if (!card.dueDate) return false;
  if (due === "due") return true; // tiene vencimiento
  // "overdue": vencida (su día es anterior a hoy). Comparación por fecha, sin horas.
  const dueDay = card.dueDate.slice(0, 10);
  const today = new Date(now);
  const todayDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return dueDay < todayDay;
}

/**
 * ¿La tarjeta pasa TODOS los filtros activos? Dentro de cada dimensión (etiquetas,
 * asignados) la lógica es OR (al menos una coincide); entre dimensiones es AND.
 */
export function cardMatchesFilters(
  card: CardDTO,
  f: BoardFilters,
  now: number,
): boolean {
  if (f.labelIds.length > 0) {
    const has = card.labels.some((l) => f.labelIds.includes(l.id));
    if (!has) return false;
  }
  if (f.assigneeIds.length > 0) {
    const has = card.assignees.some((a) => f.assigneeIds.includes(a.id));
    if (!has) return false;
  }
  if (!matchesDue(card, f.due, now)) return false;
  return true;
}
