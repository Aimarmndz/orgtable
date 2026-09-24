import { describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import {
  formatCommentTime,
  formatDueDate,
  runToggle,
} from "@/app/components/card/card-modal-helpers";

describe("formatCommentTime", () => {
  // 09:15 UTC en septiembre = 10:15 en Canarias (WEST, UTC+1). Solo comprueba que la
  // zona recibida llega a Intl; el desajuste de hidratación lo evita useHydrated en el
  // componente, que no tiene test (no hay jsdom en el proyecto).
  const iso = "2026-09-24T09:15:00.000Z";

  it("formatea en la zona indicada", () => {
    expect(formatCommentTime(iso, "Atlantic/Canary")).toContain("10:15");
    expect(formatCommentTime(iso, "UTC")).toContain("9:15");
  });
});

describe("formatDueDate", () => {
  it("muestra la fecha de calendario legible, no el ISO crudo", () => {
    expect(formatDueDate("2026-09-24T00:00:00.000Z")).toBe(
      "24 de septiembre de 2026",
    );
  });

  it("no retrocede un día aunque el proceso corra al oeste de UTC", () => {
    const tz = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      expect(formatDueDate("2026-01-01T00:00:00.000Z")).toBe(
        "1 de enero de 2026",
      );
    } finally {
      // Asignar undefined a process.env lo guarda como el texto "undefined".
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });
});

describe("runToggle", () => {
  it("devuelve null si la acción va bien", async () => {
    await expect(
      runToggle(async () => ({ ok: true }), "fallo", "prueba"),
    ).resolves.toBeNull();
  });

  it("devuelve el mensaje si la acción responde ok: false", async () => {
    await expect(
      runToggle(async () => ({ ok: false }), "fallo", "prueba"),
    ).resolves.toBe("fallo");
  });

  it("captura un rechazo y devuelve el mensaje", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      runToggle(
        () => Promise.reject(new Error("red caída")),
        "fallo",
        "prueba",
      ),
    ).resolves.toBe("fallo");
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("relanza los errores internos de Next (redirect)", async () => {
    await expect(
      runToggle(
        async () => {
          redirect("/login");
        },
        "fallo",
        "prueba",
      ),
    ).rejects.toThrow("NEXT_REDIRECT");
  });
});
