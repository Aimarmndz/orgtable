import { describe, it, expect } from "vitest";
import nextConfig from "@/next.config";
import { MAX_ATTACHMENT_BYTES } from "@/app/lib/storage";
// The same rule compiler Next's router uses at runtime: that way the test understands
// parameters with a regex (`/:file(.*\\.svg)`) the same way the server does.
import { buildCustomRoute } from "next/dist/server/lib/router-utils/filesystem";

// Minimum headroom for the multipart overhead (boundaries, headers of each part and form
// fields). Next's guide recommends 10–20 KB; more is required here.
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/** Headers next.config.ts applies to a given path, merged in order. */
async function headersFor(path: string): Promise<Map<string, string>> {
  const rules = (await nextConfig.headers?.()) ?? [];
  const result = new Map<string, string>();
  for (const rule of rules) {
    if (buildCustomRoute("header", rule).match(path)) {
      for (const { key, value } of rule.headers) result.set(key, value);
    }
  }
  return result;
}

describe("Server Actions body size limit", () => {
  // With Next's default (1 MB) any attachment over 1 MB failed before reaching
  // uploadAttachment.
  it("lets through an attachment of the maximum size with its multipart overhead", () => {
    const limit = nextConfig.experimental?.serverActions?.bodySizeLimit;
    expect(typeof limit).toBe("number");
    expect(limit).toBeGreaterThan(MAX_ATTACHMENT_BYTES + MULTIPART_OVERHEAD_BYTES);
  });

  // proxy.ts runs on page routes: if it buffers less than that, the body reaches the
  // action truncated without any error.
  it("proxy buffers the full body of those requests", () => {
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBe(
      nextConfig.experimental?.serverActions?.bodySizeLimit,
    );
  });
});

describe("security headers (next.config.ts)", () => {
  it.each(["/", "/login", "/api/v1/boards"])("%s carries the fixed headers", async (path) => {
    const h = await headersFor(path);
    expect(h.get("Strict-Transport-Security")).toBe("max-age=31536000");
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("X-Frame-Options")).toBe("DENY");
    expect(h.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("/api/v1 gets a locked-down CSP (only JSON, SSE and downloads)", async () => {
    const h = await headersFor("/api/v1/boards");
    expect(h.get("Content-Security-Policy")).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
  });

  it("pages do not get the static CSP: proxy.ts sets it with a nonce", async () => {
    expect((await headersFor("/login")).has("Content-Security-Policy")).toBe(false);
  });

  // proxy.ts excludes .svg from its matcher: without this rule they were served without a
  // CSP and an SVG opened directly could run scripts on the app's origin.
  it.each(["/file.svg", "/icons/logo.svg"])("%s gets a CSP that blocks scripts", async (path) => {
    const h = await headersFor(path);
    expect(h.get("Content-Security-Policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    );
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
