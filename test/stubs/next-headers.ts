// Stub de `next/headers` para los tests de integración. `headers()` devuelve un objeto
// con `.get()` (lo usa recordAudit, que de todas formas es best-effort); `cookies()` no
// se ejerce en los tests de la API (autenticación por Bearer, no por cookie).
export async function headers(): Promise<Headers> {
  return new Headers();
}

export async function cookies() {
  return {
    get: () => undefined,
    set: () => {},
    delete: () => {},
  };
}
