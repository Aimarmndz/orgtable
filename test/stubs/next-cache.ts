// Stub de `next/cache` para los tests de integración: fuera del runtime de Next no hay
// store de revalidación, así que estas funciones son no-ops. Ver vitest.integration.config.ts.
export function revalidatePath(): void {}
export function revalidateTag(): void {}
export function refresh(): void {}
