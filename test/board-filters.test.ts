import { describe, it, expect, afterEach, vi } from "vitest";
import {
  cardMatchesFilters,
  filtersActive,
  isOverdue,
  EMPTY_FILTERS,
  type BoardFilters,
} from "@/app/lib/board-filters";
import type { CardDTO } from "@/app/lib/types";

// Fixed "today" (UTC) for the due date tests.
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0); // 2026-06-15

function card(over: Partial<CardDTO>): CardDTO {
  return {
    id: "c1",
    title: "Card",
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
  it("with no active filters everything passes", () => {
    expect(filtersActive(EMPTY_FILTERS)).toBe(false);
    expect(cardMatchesFilters(card({}), EMPTY_FILTERS, NOW)).toBe(true);
  });

  it("filters by label (OR within the dimension)", () => {
    const c = card({ labels: [{ id: "L1", name: "a", color: "blue" }] });
    expect(cardMatchesFilters(c, f({ labelIds: ["L1"] }), NOW)).toBe(true);
    expect(cardMatchesFilters(c, f({ labelIds: ["L2"] }), NOW)).toBe(false);
    expect(cardMatchesFilters(c, f({ labelIds: ["L2", "L1"] }), NOW)).toBe(true);
  });

  it("filters by assignee", () => {
    const c = card({ assignees: [{ id: "U1", name: "Ana" }] });
    expect(cardMatchesFilters(c, f({ assigneeIds: ["U1"] }), NOW)).toBe(true);
    expect(cardMatchesFilters(c, f({ assigneeIds: ["U2"] }), NOW)).toBe(false);
  });

  it("combines dimensions with AND", () => {
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

  it("filters by due status", () => {
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
  // `now` built from a LOCAL date (the browser's), as in the app.
  const now = new Date(2026, 8, 24, 10, 0, 0).getTime(); // 2026-09-24 10:00 local

  it("a card due today is not overdue", () => {
    expect(isOverdue("2026-09-24T00:00:00.000Z", now)).toBe(false);
  });

  it("one due yesterday is", () => {
    expect(isOverdue("2026-09-23T00:00:00.000Z", now)).toBe(true);
  });

  it("matches the \"Overdue\" filter", () => {
    const today = card({ dueDate: "2026-09-24T00:00:00.000Z" });
    const yesterday = card({ dueDate: "2026-09-23T00:00:00.000Z" });
    expect(cardMatchesFilters(today, f({ due: "overdue" }), now)).toBe(false);
    expect(cardMatchesFilters(yesterday, f({ due: "overdue" }), now)).toBe(true);
  });
});

describe("formatDueDay", () => {
  // vi.unstubAllEnvs leaves TZ as it was; if it did not exist, it deletes it. Reassigning
  // the original value by hand stored the text "undefined", which Node treats as UTC for
  // the rest of the file.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("shows the stored day even if the local zone is behind UTC", async () => {
    // It used to be formatted in the local zone: in New York (UTC-4) it showed "Sep 23".
    vi.stubEnv("TZ", "America/New_York");
    // The formatters are cached at module level and may fix the zone when created: the
    // module has to be loaded AFTER changing TZ. With the static import at the top it kept
    // the machine's zone (UTC in CI) and the test passed even without `timeZone: "UTC"`.
    vi.resetModules();
    const { formatDueDay } = await import("@/app/lib/board-filters");
    expect(new Date("2026-09-24T00:00:00.000Z").getDate()).toBe(23); // the trap
    expect(formatDueDay("2026-09-24T00:00:00.000Z", "en")).toBe("Sep 24");
    const es = formatDueDay("2026-09-24T00:00:00.000Z", "es-ES");
    expect(es).toContain("24");
    expect(es).toContain("sept");
  });
});
