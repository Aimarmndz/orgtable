import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { buildContentSecurityPolicy, generateNonce } from "@/app/lib/csp";
import { proxy, config } from "@/proxy";

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

describe("proxy (CSP por petición)", () => {
  // El matcher de Next es una expresión regular sobre la ruta.
  const matches = (path: string) =>
    config.matcher.some((m) => new RegExp(`^${m}$`).test(path));

  it("pasa por las páginas y deja fuera /api, los estáticos y los .svg", () => {
    expect(matches("/")).toBe(true);
    expect(matches("/login")).toBe(true);
    expect(matches("/boards/abc")).toBe(true);
    expect(matches("/api/v1/boards")).toBe(false);
    expect(matches("/_next/static/chunks/app.js")).toBe(false);
    expect(matches("/logo.svg")).toBe(false);
  });

  it("/login recibe la CSP con el mismo nonce que ve el layout", () => {
    const res = proxy(new NextRequest("http://localhost:3000/login"));
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    // NextResponse.next({ request }) reenvía así las cabeceras de la petición.
    const nonce = res.headers.get("x-middleware-request-x-nonce");
    expect(nonce).toBeTruthy();
    expect(csp).toContain(`'nonce-${nonce}'`);
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("/ con sesión recibe la CSP; sin sesión redirige a /login", () => {
    const withSession = proxy(
      new NextRequest("http://localhost:3000/", { headers: { cookie: "session=x" } }),
    );
    expect(withSession.headers.get("Content-Security-Policy")).toContain(
      "script-src 'self' 'nonce-",
    );

    const anonymous = proxy(new NextRequest("http://localhost:3000/"));
    expect(anonymous.status).toBe(307);
    expect(anonymous.headers.get("location")).toBe("http://localhost:3000/login");
  });
});
