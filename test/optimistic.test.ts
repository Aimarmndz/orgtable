import { describe, it, expect, vi, afterEach } from "vitest";
import { redirect } from "next/navigation";
import { persistOptimistic } from "@/app/lib/optimistic";

const log = { message: "[test] failed", context: { cardId: "c1" } };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("persistOptimistic", () => {
  it("undoes nothing if the server confirms", async () => {
    const onFailure = vi.fn();
    await persistOptimistic(async () => ({ ok: true }), onFailure, log);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("undoes if the server rejects the change ({ ok: false })", async () => {
    const onFailure = vi.fn();
    await persistOptimistic(async () => ({ ok: false }), onFailure, log);
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it("undoes and logs the error if the call fails, without propagating the rejection", async () => {
    const onFailure = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("network down");
    await expect(
      persistOptimistic(() => Promise.reject(boom), onFailure, log),
    ).resolves.toBeUndefined();
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith("[test] failed", {
      cardId: "c1",
      error: boom,
    });
  });

  it("rethrows Next's redirects without undoing (the router handles them)", async () => {
    const onFailure = vi.fn();
    let redirectError: unknown;
    try {
      redirect("/login");
    } catch (e) {
      redirectError = e;
    }
    await expect(
      persistOptimistic(() => Promise.reject(redirectError), onFailure, log),
    ).rejects.toBe(redirectError);
    expect(onFailure).not.toHaveBeenCalled();
  });
});
