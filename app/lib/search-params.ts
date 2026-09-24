/**
 * Primer valor de un parámetro de búsqueda de la URL.
 *
 * En Next, `searchParams` da un array cuando la clave se repite (`?q=a&q=b`), aunque el
 * tipo de la página diga `string`. Tratarlo como string rompía `/search` (`q.trim()` no
 * existe en un array). Nos quedamos con el primero, que es lo que haría un formulario.
 */
export function firstParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
