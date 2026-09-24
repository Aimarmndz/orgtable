import { describe, it, expect } from "vitest";
import { buildContentSecurityPolicy, generateNonce } from "@/app/lib/csp";

// La CSP es la última barrera ante un XSS: estos tests fijan las directivas que no se
// pueden relajar sin decidirlo (ver docs/DECISIONES.md, 2026-09-24).
describe("buildContentSecurityPolicy", () => {
  const prod = buildContentSecurityPolicy("abc123", false);

  it("solo permite scripts propios con el nonce de la petición", () => {
    expect(prod).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(prod).not.toContain("'unsafe-inline' 'strict-dynamic'");
  });

  it("no permite eval en producción, pero sí en desarrollo", () => {
    expect(prod).not.toContain("unsafe-eval");
    expect(buildContentSecurityPolicy("abc123", true)).toContain("'unsafe-eval'");
  });

  it("en producción los estilos inline exigen nonce", () => {
    expect(prod).toContain("style-src-elem 'self' 'nonce-abc123'");
    expect(prod).not.toContain("style-src-elem 'self' 'unsafe-inline'");
  });

  it("impide embeber la app, plugins y cambiar la base", () => {
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("base-uri 'self'");
    expect(prod).toContain("form-action 'self'");
  });

  it("no fuerza HTTPS en los recursos (instalaciones por http://IP)", () => {
    expect(prod).not.toContain("upgrade-insecure-requests");
  });
});

describe("generateNonce", () => {
  it("genera 128 bits en base64 y distinto en cada llamada", () => {
    const a = generateNonce();
    expect(atob(a)).toHaveLength(16);
    expect(generateNonce()).not.toBe(a);
  });
});
