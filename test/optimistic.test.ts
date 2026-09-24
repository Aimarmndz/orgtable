import { describe, it, expect, vi, afterEach } from "vitest";
import { redirect } from "next/navigation";
import { persistOptimistic } from "@/app/lib/optimistic";

const log = { message: "[test] fallo", context: { cardId: "c1" } };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("persistOptimistic", () => {
  it("no deshace nada si el servidor confirma", async () => {
    const onFailure = vi.fn();
    await persistOptimistic(async () => ({ ok: true }), onFailure, log);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("deshace si el servidor rechaza el cambio ({ ok: false })", async () => {
    const onFailure = vi.fn();
    await persistOptimistic(async () => ({ ok: false }), onFailure, log);
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it("deshace y registra el error si la llamada falla, sin propagar el rechazo", async () => {
    const onFailure = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("red caída");
    await expect(
      persistOptimistic(() => Promise.reject(boom), onFailure, log),
    ).resolves.toBeUndefined();
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith("[test] fallo", {
      cardId: "c1",
      error: boom,
    });
  });

  it("relanza las redirecciones de Next sin deshacer (las gestiona el router)", async () => {
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
