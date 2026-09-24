import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseTrustedProxyHops,
  pickClientIp,
  resolveClientIp,
} from "@/app/lib/client-ip";

// IP del cliente para el rate limit del login: solo se confía en X-Forwarded-For si se
// declaran proxies de confianza, y se toma el valor que añadió el más externo (contando
// desde la derecha). El primer valor lo escribe el cliente y no vale.
describe("pickClientIp", () => {
  it("con hops = 0 ignora la cabecera", () => {
    expect(pickClientIp("1.2.3.4", 0)).toBeNull();
  });

  it("sin cabecera o vacía devuelve null", () => {
    expect(pickClientIp(null, 1)).toBeNull();
    expect(pickClientIp("", 1)).toBeNull();
  });

  it("toma el N-ésimo valor desde la derecha", () => {
    expect(pickClientIp("1.2.3.4, 10.0.0.1", 1)).toBe("10.0.0.1");
    expect(pickClientIp("1.2.3.4, 10.0.0.1", 2)).toBe("1.2.3.4");
  });

  it("con menos valores que proxies declarados devuelve null", () => {
    expect(pickClientIp("10.0.0.1", 2)).toBeNull();
  });

  it("recorta espacios y acepta IPv6", () => {
    expect(pickClientIp("  1.2.3.4  ", 1)).toBe("1.2.3.4");
    expect(pickClientIp("falsa, 2001:db8::1", 1)).toBe("2001:db8::1");
  });

  it("un valor que no es una IP devuelve null", () => {
    expect(pickClientIp("1.2.3.4, unknown", 1)).toBeNull();
    expect(pickClientIp("1.2.3.4, ", 1)).toBeNull();
  });

  // Regresión: con proxies que escriben la IP con el puerto de origen (Azure Application
  // Gateway, IIS ARR), el valor no pasaba isIP y el login se quedaba sin límite por IP.
  it("quita el puerto de IPv4 y de IPv6 entre corchetes", () => {
    expect(pickClientIp("1.2.3.4:5678", 1)).toBe("1.2.3.4");
    expect(pickClientIp("falsa, [2001:db8::1]:443", 1)).toBe("2001:db8::1");
    expect(pickClientIp("[::1]", 1)).toBe("::1");
  });

  it("no parte una IPv6 sin corchetes ni acepta basura con puerto", () => {
    expect(pickClientIp("2001:db8::1:443", 1)).toBe("2001:db8::1:443");
    expect(pickClientIp("unknown:80", 1)).toBeNull();
    expect(pickClientIp("999.1.1.1:80", 1)).toBeNull();
    expect(pickClientIp("[1.2.3.4]:80", 1)).toBeNull();
    expect(pickClientIp("1.2.3.4:123456", 1)).toBeNull();
  });
});

describe("resolveClientIp", () => {
  it("con hops = 0 no hay IP ni problema", () => {
    expect(resolveClientIp("1.2.3.4", 0)).toEqual({ ip: null, problem: null });
    expect(resolveClientIp(null, 0)).toEqual({ ip: null, problem: null });
  });

  it("indica por qué no hay IP cuando hay proxies declarados", () => {
    expect(resolveClientIp(null, 1)).toEqual({ ip: null, problem: "missing-header" });
    expect(resolveClientIp("10.0.0.1", 2)).toEqual({
      ip: null,
      problem: "too-few-values",
    });
    expect(resolveClientIp("1.2.3.4, unknown", 1)).toEqual({
      ip: null,
      problem: "not-an-ip",
    });
    expect(resolveClientIp("1.2.3.4", 1)).toEqual({ ip: "1.2.3.4", problem: null });
  });
});

// El aviso se guarda en un Set del módulo: cada test importa una copia nueva para empezar
// sin avisos previos.
describe("aviso de proxy mal configurado", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.resetModules();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  async function freshPick() {
    return (await import("@/app/lib/client-ip")).pickClientIp;
  }

  it("avisa una vez por motivo, sin la cabecera ni la IP", async () => {
    const pick = await freshPick();
    pick("203.0.113.7, unknown", 1);
    pick("203.0.113.8, unknown", 1);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toMatch(/TRUSTED_PROXY_HOPS=1/);
    expect(message).toMatch(/no es una IP/);
    expect(message).not.toMatch(/203\.0\.113/);
    // Puede haber otro aviso con otro motivo: el texto no debe prometer que es el último.
    expect(message).toMatch(/una vez por motivo y proceso/);

    pick("10.0.0.1", 2);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[1][0])).toMatch(/menos valores/);
  });

  it("no avisa con hops = 0 ni cuando obtiene la IP", async () => {
    const pick = await freshPick();
    pick(null, 0);
    pick("1.2.3.4", 0);
    pick("1.2.3.4", 1);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("parseTrustedProxyHops", () => {
  it("sin definir o vacío es 0", () => {
    expect(parseTrustedProxyHops(undefined)).toBe(0);
    expect(parseTrustedProxyHops("")).toBe(0);
    expect(parseTrustedProxyHops("  ")).toBe(0);
  });

  it("acepta enteros >= 0", () => {
    expect(parseTrustedProxyHops("0")).toBe(0);
    expect(parseTrustedProxyHops("2")).toBe(2);
    expect(parseTrustedProxyHops(" 1 ")).toBe(1);
  });

  it("rechaza lo que no es un entero >= 0", () => {
    for (const bad of ["-1", "1.5", "uno", "1e2"]) {
      expect(() => parseTrustedProxyHops(bad)).toThrow(/TRUSTED_PROXY_HOPS/);
    }
  });
});
