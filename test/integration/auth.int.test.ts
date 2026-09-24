import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { login } from "@/app/lib/actions/auth";
import { __setHeaders } from "../stubs/next-headers";
import { resetDb, disconnect, seedUser } from "./helpers";

// Login (Server Action) contra la BD real: límites por IP y por cuenta, auditoría sin el
// email tecleado. TRUSTED_PROXY_HOPS se fija por test con vi.stubEnv.

beforeEach(async () => {
  await resetDb();
});
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await disconnect();
});

function form(email: string, password: string): FormData {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("password", password);
  return fd;
}

const TOO_MANY = /Demasiados intentos/;

describe("login: rate limit", () => {
  it("sin proxies de confianza, falsear X-Forwarded-For no evita el límite por cuenta", async () => {
    // hops = 0 (por defecto): la cabecera se ignora y solo cuenta el límite por email.
    for (let i = 0; i < 20; i++) {
      __setHeaders({ "x-forwarded-for": `203.0.113.${i}` });
      const r = await login({}, form("victima@test.local", "mala"));
      expect(r.error).toBe("Credenciales incorrectas.");
    }
    __setHeaders({ "x-forwarded-for": "203.0.113.200" });
    const blocked = await login({}, form("victima@test.local", "mala"));
    expect(blocked.error).toMatch(TOO_MANY);
  });

  it("con un proxy de confianza, la IP es la que añade el proxy y no la que envía el cliente", async () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    // El cliente pone una IP distinta en cada intento; el proxy añade siempre la real.
    for (let i = 0; i < 10; i++) {
      __setHeaders({ "x-forwarded-for": `198.51.100.${i}, 10.0.0.1` });
      const r = await login({}, form(`u${i}@test.local`, "mala"));
      expect(r.error).toBe("Credenciales incorrectas.");
    }
    __setHeaders({ "x-forwarded-for": "198.51.100.99, 10.0.0.1" });
    const blocked = await login({}, form("otro@test.local", "mala"));
    expect(blocked.error).toMatch(TOO_MANY);
  });

  it("el límite por cuenta cuenta solo fallos: un login correcto lo reinicia", async () => {
    await seedUser({ email: "ana@test.local", password: "correcta-123" });
    for (let i = 0; i < 19; i++) {
      await login({}, form("ana@test.local", "mala"));
    }
    await expect(login({}, form("ana@test.local", "correcta-123"))).rejects.toMatchObject({
      digest: expect.stringContaining("/boards"),
    });
    // Tras el éxito vuelven a caber 20 fallos antes del bloqueo.
    for (let i = 0; i < 20; i++) {
      const r = await login({}, form("ANA@test.local", "mala"));
      expect(r.error).toBe("Credenciales incorrectas.");
    }
    expect((await login({}, form("ana@test.local", "mala"))).error).toMatch(TOO_MANY);
  });

  it("un ataque sostenido deja una sola fila auth.login_rate_limited", async () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    __setHeaders({ "x-forwarded-for": "10.0.0.7" });
    for (let i = 0; i < 15; i++) {
      await login({}, form(`x${i}@test.local`, "mala"));
    }
    expect(
      await prisma.auditLog.count({ where: { action: "auth.login_rate_limited" } }),
    ).toBe(1);
  });

  it("un TRUSTED_PROXY_HOPS no válido falla con un error claro", async () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "uno");
    await expect(login({}, form("a@test.local", "mala"))).rejects.toThrow(
      /TRUSTED_PROXY_HOPS/,
    );
  });
});

describe("login: auditoría de fallos", () => {
  it("no guarda el email tecleado; si la cuenta existe guarda su userId", async () => {
    const u = await seedUser({ email: "real@test.local", password: "correcta-123" });
    await login({}, form("fantasma@test.local", "mala"));
    await login({}, form("real@test.local", "mala"));

    const rows = await prisma.auditLog.findMany({
      where: { action: "auth.login_failed" },
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(JSON.stringify(row)).not.toContain("@test.local");
      expect(row.detail).toBeNull();
    }
    expect(rows.map((r) => r.userId).sort()).toEqual([null, u.id].sort());
  });
});

describe("login: valores devueltos tras un error", () => {
  it("devuelve el email tecleado y nunca la contraseña", async () => {
    const state = await login({}, form("alguien@test.local", "secreto-pegado"));
    expect(state.error).toBe("Credenciales incorrectas.");
    expect(state.values).toEqual({ email: "alguien@test.local" });
    expect(JSON.stringify(state)).not.toContain("secreto-pegado");
  });

  it("también con un email mal formado", async () => {
    const state = await login({}, form("no-es-email", "secreto-pegado"));
    expect(state.error).toBe("Revisa el email y la contraseña.");
    expect(state.values).toEqual({ email: "no-es-email" });
    expect(JSON.stringify(state)).not.toContain("secreto-pegado");
  });
});
