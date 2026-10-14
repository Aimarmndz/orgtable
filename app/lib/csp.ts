// Content-Security-Policy for HTML pages. proxy.ts builds it on every request with a new
// nonce; Next reads the nonce from the header and applies it to its own scripts
// (see node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
//
// Decisions (docs/DECISIONES.md, 2026-09-24):
// - No `upgrade-insecure-requests`: orgtable is often installed at http://IP:3000; that
//   directive would move every resource to https and the app would not load.
// - `style-src-attr 'unsafe-inline'`: React renders `style` attributes in the server HTML
//   (board background colour, dnd-kit transforms) and a nonce does not cover attributes.
//   <style>/<link> elements still require a nonce or the same origin.
// - Development only: `'unsafe-eval'` (React rebuilds error stacks with eval) and inline
//   styles without a nonce (Turbopack and the error overlay inject <style> without one).
//   When a nonce is present the browser ignores 'unsafe-inline', hence the nonce is
//   dropped. The production build triggers no violations (checked with Playwright).

export function buildContentSecurityPolicy(nonce: string, isDev: boolean): string {
  const styleSources = isDev ? "'self' 'unsafe-inline'" : `'self' 'nonce-${nonce}'`;
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src ${styleSources}`,
    `style-src-elem ${styleSources}`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  return directives.join("; ");
}

/** Random 128-bit nonce in base64, one per request. */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
