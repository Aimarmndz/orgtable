import type { NextConfig } from "next";

// Security headers applied to every response. The page CSP carries a per-request nonce
// and is set by proxy.ts (app/lib/csp.ts); this file holds the static headers, a locked
// down CSP for /api, which only serves JSON, SSE and downloads, and another one for .svg
// files, which proxy.ts does not cover. See docs/security.md.
const securityHeaders = [
  // Anti-clickjacking: the app is never embedded in iframes.
  { key: "X-Frame-Options", value: "DENY" },
  // Prevents MIME sniffing (reinforces the forced download of attachments).
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // HSTS: browsers only honour it over HTTPS, so it does not affect installations on
  // http://IP:3000. No includeSubDomains: orgtable usually lives on someone's subdomain
  // and must not force HTTPS on its siblings.
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

// Maximum body size of a Server Action request. Next cuts off at 1 MB by default, before
// running the action, so a 3 MB attachment failed with a generic error instead of
// uploading. It must exceed the largest of the actions' own limits: MAX_ATTACHMENT_BYTES
// (10 MB, app/lib/storage.ts) and board import (5 MB, app/lib/actions/boards.ts). The
// 1 MB margin covers multipart overhead and lets a file slightly over 10 MB reach the
// action and get its own error message.
// It is a global limit and Next applies it before authentication: anyone can send 11 MB
// to an action. test/next-config.test.ts checks that it stays above 10 MB.
const ACTION_BODY_LIMIT_BYTES = 11 * 1024 * 1024;

const nextConfig: NextConfig = {
  // Produces .next/standalone (minimal Node server) to package the production Docker
  // image. Run with `node server.js`. See Dockerfile and docs/docker.md.
  output: "standalone",

  experimental: {
    serverActions: { bodySizeLimit: ACTION_BODY_LIMIT_BYTES },
    // proxy.ts also runs on page routes (where Server Actions arrive) and Next buffers
    // their body in memory up to 10 MB; anything beyond that reaches the action
    // TRUNCATED, with no error. That is why it matches the actions' limit.
    proxyClientMaxBodySize: ACTION_BODY_LIMIT_BYTES,
  },

  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/api/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "default-src 'none'; frame-ancestors 'none'",
          },
        ],
      },
      // .svg files are outside proxy.ts's matcher (they do not get the nonce CSP). An SVG
      // opened directly is a document that can run scripts on the app's origin, so they
      // are served with a CSP that only allows their inline styles.
      {
        source: "/:file(.*\\.svg)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
