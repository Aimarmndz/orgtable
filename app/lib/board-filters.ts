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

/**
 * ¿Está vencida? El `dueDate` representa un DÍA (se elige con `<input type="date">` y se
 * guarda a medianoche UTC), así que se compara su parte de fecha con el día LOCAL de
 * `now`, sin horas: la tarjeta que vence hoy no está vencida hasta mañana. Comparar el
 * instante con `Date.now()` la marcaba vencida desde las 00:00 UTC del mismo día.
 */
export function isOverdue(dueDate: string, now: number): boolean {
  const today = new Date(now);
  const todayDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return dueDate.slice(0, 10) < todayDay;
}

// Formateador de módulo (se crea una vez). `timeZone: "UTC"` porque el dueDate es una
// fecha de calendario guardada a medianoche UTC: formatearla en la zona local mostraba
// el día anterior al oeste de Greenwich y descuadraba la hidratación servidor/cliente.
const dueDayFormat = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** Día de vencimiento corto para las tarjetas («24 sept»), igual en cualquier zona. */
export function formatDueDay(dueDate: string): string {
  return dueDayFormat.format(new Date(dueDate));
}

function matchesDue(card: CardDTO, due: DueFilter, now: number): boolean {
  if (due === "any") return true;
  if (due === "none") return card.dueDate === null;
  if (!card.dueDate) return false;
  if (due === "due") return true; // tiene vencimiento
  return isOverdue(card.dueDate, now);
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
