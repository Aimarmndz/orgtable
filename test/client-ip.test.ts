import { describe, it, expect } from "vitest";
import { parseTrustedProxyHops, pickClientIp } from "@/app/lib/client-ip";

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
