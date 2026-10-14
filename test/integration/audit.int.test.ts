import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { recordAudit } from "@/app/lib/audit";
import { resetDb, disconnect } from "./helpers";

// recordAudit is best-effort: if the write fails it must not break the action, but it must
// not lose the event silently either. The log carries no detail, ip or personal data.

beforeEach(async () => {
  await resetDb();
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await disconnect();
});

describe("recordAudit: write failure", () => {
  it.each([
    ["FK to a userId that does not exist", { userId: "does-not-exist", detail: "private-data-xyz" }],
    ["null byte in detail", { detail: "private-data-xyz\u0000" }],
  ])("%s: resolves without throwing and logs it without the detail", async (_case, extra) => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      recordAudit({ action: "auth.login", ip: "192.0.2.10", ...extra }),
    ).resolves.toBeUndefined();

    expect(await prisma.auditLog.count()).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(spy.mock.calls[0]);
    expect(logged).toContain("auth.login");
    expect(logged).not.toContain("private-data-xyz");
    expect(logged).not.toContain("192.0.2.10");
    // Nor the userId: the Postgres FK error repeats it ("Key (userId)=(…)").
    expect(logged).not.toContain("does-not-exist");
  });

  it("logs nothing if the write succeeds", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await recordAudit({ action: "auth.login", ip: null });
    expect(await prisma.auditLog.count()).toBe(1);
    expect(spy).not.toHaveBeenCalled();
  });
});
