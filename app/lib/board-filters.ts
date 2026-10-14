// Board filters: PURE logic shared by client and server (no "server-only": the client
// uses it to hide cards and it is tested directly). Filtering is presentation only; it
// does not change any data. See docs/filters.md.
import type { CardDTO } from "@/app/lib/types";

export type DueFilter = "any" | "overdue" | "due" | "none";

export type BoardFilters = {
  labelIds: string[]; // the card must have AT LEAST one of these labels
  assigneeIds: string[]; // … and at least one of these assignees
  due: DueFilter;
};

export const EMPTY_FILTERS: BoardFilters = {
  labelIds: [],
  assigneeIds: [],
  due: "any",
};

/** Is any filter active? If not, nothing is filtered (and dragging stays enabled). */
export function filtersActive(f: BoardFilters): boolean {
  return f.labelIds.length > 0 || f.assigneeIds.length > 0 || f.due !== "any";
}

/**
 * Is it overdue? `dueDate` represents a DAY (picked with `<input type="date">` and stored
 * at midnight UTC), so its date part is compared with the LOCAL day of `now`, ignoring
 * the time: a card due today is not overdue until tomorrow. Comparing the instant with
 * `Date.now()` marked it overdue from 00:00 UTC on the same day.
 */
export function isOverdue(dueDate: string, now: number): boolean {
  const today = new Date(now);
  const todayDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return dueDate.slice(0, 10) < todayDay;
}

// One formatter per language, created once (building an Intl.DateTimeFormat per card
// is not free). `timeZone: "UTC"` because dueDate is a calendar date stored at midnight
// UTC: formatting it in the local zone showed the previous day west of Greenwich and
// broke server/client hydration.
const dueDayFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * Short due day for cards ("Sep 24", "24 sept"), the same in any time zone. `intl` is
 * the language's BCP 47 tag (`useI18n().intl`).
 */
export function formatDueDay(dueDate: string, intl: string): string {
  let format = dueDayFormats.get(intl);
  if (!format) {
    format = new Intl.DateTimeFormat(intl, {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
    dueDayFormats.set(intl, format);
  }
  return format.format(new Date(dueDate));
}

function matchesDue(card: CardDTO, due: DueFilter, now: number): boolean {
  if (due === "any") return true;
  if (due === "none") return card.dueDate === null;
  if (!card.dueDate) return false;
  if (due === "due") return true; // has a due date
  return isOverdue(card.dueDate, now);
}

/**
 * Does the card pass ALL active filters? Within each dimension (labels, assignees) the
 * logic is OR (at least one matches); across dimensions it is AND.
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
