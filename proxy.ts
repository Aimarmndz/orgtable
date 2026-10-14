import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { buildContentSecurityPolicy, generateNonce } from "@/app/lib/csp";

// In Next.js 16 middleware is called `proxy` (Node.js runtime). It does two things:
//
// 1. OPTIMISTIC auth check: it only checks whether the session cookie EXISTS, without
//    validating it cryptographically (the DAL in app/lib/dal.ts does that on every
//    protected layout/page). It avoids rendering private routes for someone who is
//    clearly not signed in. See docs/authentication.md.
// 2. Content-Security-Policy with a per-request nonce (app/lib/csp.ts). It is set on the
//    request (Next extracts the nonce for its scripts; the root layout reads it from
//    `x-nonce` for the theme script) and on the response (enforced by the browser).

// /register checks by itself whether sign-up is open; /legal is readable without a
// session (the privacy policy must be readable BEFORE creating an account). Search
// engines read /robots.txt without a cookie. `/` (exactly, not its subpaths) decides by
// itself too: the public landing or a redirect to /login (app/page.tsx).
const PUBLIC_PATHS = ["/login", "/setup", "/register", "/legal", "/robots.txt"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic =
    pathname === "/" ||
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const hasSession = request.cookies.has("session");

  if (!isPublic && !hasSession) {
    return NextResponse.redirect(new URL("/login", request.nextUrl));
  }

  const nonce = generateNonce();
  const csp = buildContentSecurityPolicy(
    nonce,
    process.env.NODE_ENV === "development",
  );
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Excludes API routes (their CSP is in next.config.ts), static assets and images.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.svg$).*)"],
};
