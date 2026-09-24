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

// Alfabeto base62 de la librería y un tope de longitud: las claves reales rara vez pasan
// de unos pocos caracteres, así que 64 deja margen sin permitir cadenas de megabytes.
const POSITION_KEY_SHAPE = /^[A-Za-z][0-9A-Za-z]{0,63}$/;

/**
 * ¿Es `key` una clave de posición que la librería sabrá extender? Las Server Actions de
 * arrastre (moveCard, reorderList) reciben la clave del cliente: si se guardara una clave
 * inválida ('x', 'a00'…), `positionAtEnd` lanzaría para siempre al crear en esa lista o
 * tablero. La regex cubre lo que la librería no valida (acepta 'a0 ', con espacio) y
 * `generateKeyBetween` cubre la estructura (parte entera y fracción sin '0' final).
 */
export function isValidPositionKey(key: string): boolean {
  if (!POSITION_KEY_SHAPE.test(key)) return false;
  try {
    generateKeyBetween(key, null);
    return true;
  } catch {
    // La librería lanza con claves mal formadas: aquí eso significa «no válida».
    return false;
  }
}
