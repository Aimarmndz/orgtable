// `next/cache` stub for the integration tests: outside the Next runtime there is no
// revalidation store, so these functions are no-ops. See vitest.integration.config.ts.
export function revalidatePath(): void {}
export function revalidateTag(): void {}
export function refresh(): void {}
