import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { buildContentSecurityPolicy, generateNonce } from "@/app/lib/csp";
import { proxy, config } from "@/proxy";

// The CSP is the last barrier against XSS: these tests pin the directives that cannot be
// relaxed without a deliberate decision (see docs/DECISIONES.md, 2026-09-24).
describe("buildContentSecurityPolicy", () => {
  const prod = buildContentSecurityPolicy("abc123", false);

  it("only allows own scripts with the request's nonce", () => {
    expect(prod).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(prod).not.toContain("'unsafe-inline' 'strict-dynamic'");
  });

  it("does not allow eval in production, but does in development", () => {
    expect(prod).not.toContain("unsafe-eval");
    expect(buildContentSecurityPolicy("abc123", true)).toContain("'unsafe-eval'");
  });

  it("in production inline styles require a nonce", () => {
    expect(prod).toContain("style-src-elem 'self' 'nonce-abc123'");
    expect(prod).not.toContain("style-src-elem 'self' 'unsafe-inline'");
  });

  it("prevents embedding the app, plugins and changing the base", () => {
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("base-uri 'self'");
    expect(prod).toContain("form-action 'self'");
  });

  it("does not force HTTPS on resources (installations over http://IP)", () => {
    expect(prod).not.toContain("upgrade-insecure-requests");
  });
});

describe("generateNonce", () => {
  it("generates 128 bits in base64, different on every call", () => {
    const a = generateNonce();
    expect(atob(a)).toHaveLength(16);
    expect(generateNonce()).not.toBe(a);
  });
});

describe("proxy (per-request CSP)", () => {
  // Next's matcher is a regular expression over the path.
  const matches = (path: string) =>
    config.matcher.some((m) => new RegExp(`^${m}$`).test(path));

  it("runs on pages and leaves out /api, static files and .svg", () => {
    expect(matches("/")).toBe(true);
    expect(matches("/login")).toBe(true);
    expect(matches("/boards/abc")).toBe(true);
    expect(matches("/api/v1/boards")).toBe(false);
    expect(matches("/_next/static/chunks/app.js")).toBe(false);
    expect(matches("/logo.svg")).toBe(false);
  });

  it("/login gets the CSP with the same nonce the layout sees", () => {
    const res = proxy(new NextRequest("http://localhost:3000/login"));
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    // This is how NextResponse.next({ request }) forwards the request headers.
    const nonce = res.headers.get("x-middleware-request-x-nonce");
    expect(nonce).toBeTruthy();
    expect(csp).toContain(`'nonce-${nonce}'`);
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("/ gets the CSP with or without a session (the page decides: landing or /login)", () => {
    const withSession = proxy(
      new NextRequest("http://localhost:3000/", { headers: { cookie: "session=x" } }),
    );
    expect(withSession.headers.get("Content-Security-Policy")).toContain(
      "script-src 'self' 'nonce-",
    );

    const anonymous = proxy(new NextRequest("http://localhost:3000/"));
    expect(anonymous.status).toBe(200);
    expect(anonymous.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("only the root is public: private routes still redirect without a session", () => {
    for (const path of ["/boards", "/board/abc", "/settings", "/admin/users", "/search"]) {
      const res = proxy(new NextRequest(`http://localhost:3000${path}`));
      expect(res.status, path).toBe(307);
      expect(res.headers.get("location"), path).toBe("http://localhost:3000/login");
    }
  });
});
