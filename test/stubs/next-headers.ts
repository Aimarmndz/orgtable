// Stub de `next/headers` para los tests de integración. Fuera de Next no hay petición,
// así que cookies y cabeceras viven en un almacén MUTABLE a nivel de módulo:
//  - `cookies()` se comporta como el store de Next (`get`/`set`/`delete`/`has`), de modo
//    que createSession() escribe la cookie y verifySession()/requireUser() la leen. Así
//    se pueden probar las Server Actions con sesión (helper `loginAs` en
//    test/integration/helpers.ts).
//  - `headers()` devuelve las cabeceras inyectadas con `__setHeaders` (p. ej.
//    X-Forwarded-For para el rate limit del login).
// Los helpers `__*` solo existen en el stub; `resetDb()` los limpia antes de cada test.

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

/** Sustituye las cabeceras de la "petición" en curso. */
export function __setHeaders(init: Record<string, string>): void {
  requestHeaders = new Headers(init);
}

/** Vacía cookies y cabeceras (estado de una petición nueva y anónima). */
export function __clearCookies(): void {
  cookieJar.clear();
  requestHeaders = new Headers();
}

/** Opciones con las que se guardó una cookie (secure, httpOnly…), para aserciones. */
export function __getCookieOptions(
  name: string,
): Record<string, unknown> | undefined {
  return cookieJar.get(name)?.options;
}
