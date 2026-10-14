import { describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import {
  formatCommentTime,
  formatDueDate,
  runToggle,
} from "@/app/components/card/card-modal-helpers";

describe("formatCommentTime", () => {
  // 09:15 UTC in September = 10:15 in the Canary Islands (WEST, UTC+1). It only checks
  // that the given zone reaches Intl; the hydration mismatch is avoided by useHydrated in
  // the component, which has no test (the project has no jsdom).
  const iso = "2026-09-24T09:15:00.000Z";

  it("formats in the given zone", () => {
    expect(formatCommentTime(iso, "en", "Atlantic/Canary")).toContain("10:15");
    expect(formatCommentTime(iso, "en", "UTC")).toContain("9:15");
  });

  it("formats in the given language", () => {
    expect(formatCommentTime(iso, "en", "UTC")).toContain("Sep");
    expect(formatCommentTime(iso, "es-ES", "UTC")).toContain("sept");
  });
});

describe("formatDueDate", () => {
  it("shows the readable calendar date, not the raw ISO", () => {
    expect(formatDueDate("2026-09-24T00:00:00.000Z", "en")).toBe("September 24, 2026");
    expect(formatDueDate("2026-09-24T00:00:00.000Z", "es-ES")).toBe(
      "24 de septiembre de 2026",
    );
  });

  it("does not go back a day even if the process runs west of UTC", () => {
    const tz = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      expect(formatDueDate("2026-01-01T00:00:00.000Z", "en")).toBe("January 1, 2026");
    } finally {
      // Assigning undefined to process.env stores it as the text "undefined".
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });
});

describe("runToggle", () => {
  it("returns null if the action succeeds", async () => {
    await expect(
      runToggle(async () => ({ ok: true }), "failed", "test"),
    ).resolves.toBeNull();
  });

  it("returns the message if the action answers ok: false", async () => {
    await expect(
      runToggle(async () => ({ ok: false }), "failed", "test"),
    ).resolves.toBe("failed");
  });

  it("catches a rejection and returns the message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      runToggle(
        () => Promise.reject(new Error("network down")),
        "failed",
        "test",
      ),
    ).resolves.toBe("failed");
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("rethrows Next's internal errors (redirect)", async () => {
    await expect(
      runToggle(
        async () => {
          redirect("/login");
        },
        "failed",
        "test",
      ),
    ).rejects.toThrow("NEXT_REDIRECT");
  });
});
