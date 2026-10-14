import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  formatDate,
  formatDateTime,
  instanceTimeZone,
} from "@/app/lib/format-date";

// The server runs in UTC (container). TZ=UTC is forced to show that the output depends on
// ORGTABLE_TIMEZONE, not on the process time zone.
beforeEach(() => {
  vi.stubEnv("TZ", "UTC");
  vi.stubEnv("ORGTABLE_TIMEZONE", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("format-date (instance time zone)", () => {
  it("defaults to Atlantic/Canary: 09:15 UTC in summer is 10:15", () => {
    const text = formatDateTime(new Date("2026-07-15T09:15:00Z"), "es-ES");
    expect(text).toContain("10:15:00");
    expect(text).toContain("15/07/2026");
  });

  it("near midnight UTC the date is already the next day in the Canaries", () => {
    expect(formatDate(new Date("2026-07-15T23:30:00Z"), "es-ES")).toBe("16 jul 2026");
  });

  it("formats in the reader's language", () => {
    expect(formatDate(new Date("2026-07-15T12:00:00Z"), "en")).toBe("Jul 15, 2026");
  });

  it("honours ORGTABLE_TIMEZONE", () => {
    vi.stubEnv("ORGTABLE_TIMEZONE", "Europe/Madrid");
    expect(instanceTimeZone()).toBe("Europe/Madrid");
    expect(formatDateTime(new Date("2026-07-15T09:15:00Z"), "es-ES")).toContain("11:15:00");
  });

  it("an invalid zone fails with a clear message instead of showing wrong times", () => {
    vi.stubEnv("ORGTABLE_TIMEZONE", "Canarias/Las_Palmas");
    expect(() => formatDate(new Date(), "en")).toThrow(/ORGTABLE_TIMEZONE/);
  });
});
