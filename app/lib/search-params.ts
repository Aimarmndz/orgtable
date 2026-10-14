/**
 * First value of a URL search parameter.
 *
 * In Next, `searchParams` yields an array when the key is repeated (`?q=a&q=b`), even
 * though the page type says `string`. Treating it as a string broke `/search`
 * (`q.trim()` does not exist on an array). We keep the first one, as a form would.
 */
export function firstParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
