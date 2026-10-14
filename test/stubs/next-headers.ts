// `next/headers` stub for the integration tests. Outside Next there is no request, so
// cookies and headers live in a MUTABLE module-level store:
//  - `cookies()` behaves like Next's store (`get`/`set`/`delete`/`has`), so
//    createSession() writes the cookie and verifySession()/requireUser() read it. This
//    makes it possible to test Server Actions with a session (the `loginAs` helper in
//    test/integration/helpers.ts).
//  - `headers()` returns the headers injected with `__setHeaders` (e.g.
//    X-Forwarded-For for the login rate limit).
// The `__*` helpers only exist in the stub; `resetDb()` clears them before each test.

type StoredCookie = {
  name: string;
  value: string;
  options: Record<string, unknown>;
};

const cookieJar = new Map<string, StoredCookie>();
let requestHeaders = new Headers();

export async function headers(): Promise<Headers> {
  return requestHeaders;
}

export async function cookies() {
  return {
    get: (name: string) => {
      const c = cookieJar.get(name);
      return c ? { name: c.name, value: c.value } : undefined;
    },
    set: (name: string, value: string, options: Record<string, unknown> = {}) => {
      cookieJar.set(name, { name, value, options });
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
    has: (name: string) => cookieJar.has(name),
  };
}

/** Replaces the headers of the current "request". */
export function __setHeaders(init: Record<string, string>): void {
  requestHeaders = new Headers(init);
}

/**
 * Clears only the cookies. Kept separate from `__clearHeaders` because `loginAs` calls it
 * and must keep the headers injected earlier (X-Forwarded-Proto decides the session
 * cookie's Secure flag and X-Forwarded-For the rate-limit IP).
 */
export function __clearCookies(): void {
  cookieJar.clear();
}

/** Clears the headers injected with `__setHeaders`. */
export function __clearHeaders(): void {
  requestHeaders = new Headers();
}

/** Options a cookie was stored with (secure, httpOnly…), for assertions. */
export function __getCookieOptions(
  name: string,
): Record<string, unknown> | undefined {
  return cookieJar.get(name)?.options;
}
