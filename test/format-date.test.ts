import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  formatDate,
  formatDateTime,
  instanceTimeZone,
} from "@/app/lib/format-date";

// El servidor corre en UTC (contenedor). Se fuerza TZ=UTC para demostrar que el formato
// no depende de la zona del proceso sino de ORGTABLE_TIMEZONE.
beforeEach(() => {
  vi.stubEnv("TZ", "UTC");
  vi.stubEnv("ORGTABLE_TIMEZONE", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("format-date (zona de la instancia)", () => {
  it("por defecto usa Atlantic/Canary: 09:15 UTC en verano son las 10:15", () => {
    const text = formatDateTime(new Date("2026-07-15T09:15:00Z"));
    expect(text).toContain("10:15:00");
    expect(text).toContain("15/07/2026");
  });

  it("cerca de medianoche UTC la fecha es la del día siguiente en Canarias", () => {
    expect(formatDate(new Date("2026-07-15T23:30:00Z"))).toBe("16 jul 2026");
  });

  it("respeta ORGTABLE_TIMEZONE", () => {
    vi.stubEnv("ORGTABLE_TIMEZONE", "Europe/Madrid");
    expect(instanceTimeZone()).toBe("Europe/Madrid");
    expect(formatDateTime(new Date("2026-07-15T09:15:00Z"))).toContain("11:15:00");
  });

  it("una zona no válida falla con un mensaje claro en vez de mostrar horas falsas", () => {
    vi.stubEnv("ORGTABLE_TIMEZONE", "Canarias/Las_Palmas");
    expect(() => formatDate(new Date())).toThrow(/ORGTABLE_TIMEZONE/);
  });
});
