import "server-only";
import { generateKeyBetween } from "fractional-indexing";

// Ayudantes de ordenación por fractional indexing. La posición de cada lista/tarjeta
// es una clave string lexicográfica; mover un elemento solo actualiza su propia fila.
// Ver docs/decisions/0002-fractional-indexing.md.

/** Clave para añadir un elemento al final, dada la posición del último (o null si vacío). */
export function positionAtEnd(lastPosition: string | null): string {
  return generateKeyBetween(lastPosition, null);
}

/** Clave para insertar entre dos posiciones (cualquiera puede ser null en los extremos). */
export function positionBetween(
  before: string | null,
  after: string | null,
): string {
  return generateKeyBetween(before, after);
}
