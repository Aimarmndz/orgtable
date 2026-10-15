import "server-only";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

// Fractional indexing ordering helpers. Each list/card position is a lexicographic
// string key; moving an item only updates its own row.
// See docs/decisions/0002-fractional-indexing.md.

/** Key between two neighbours (null = that end of the list is open). */
export function positionBetween(before: string | null, after: string | null): string {
  return generateKeyBetween(before, after);
}

/** `n` ascending keys after `lastPosition` (null = empty): appends a batch in one go. */
export function positionsAtEnd(lastPosition: string | null, n: number): string[] {
  return generateNKeysBetween(lastPosition, null, n);
}

/** Key to append an item at the end, given the last position (or null if empty). */
export function positionAtEnd(lastPosition: string | null): string {
  return generateKeyBetween(lastPosition, null);
}

// The library's base62 alphabet plus a length cap. Keys grow when inserting again and
// again into the SAME gap (≈1 character every 6 insertions): with a cap of 64, normal use
// reached 373 insertions and dragging started to fail. 1024 allows about 6000 in the same
// gap, prevents megabyte-long strings and stays well below the maximum size of an entry
// in Card's (listId, position) btree index (≈2700 bytes).
const POSITION_KEY_MAX = 1024;
const POSITION_KEY_SHAPE = new RegExp(`^[A-Za-z][0-9A-Za-z]{0,${POSITION_KEY_MAX - 1}}$`);

/**
 * Is `key` a position key the library can extend? The drag Server Actions (moveCard,
 * reorderList) receive the key from the client: if an invalid key ('x', 'a00'…) were
 * stored, `positionAtEnd` would throw forever when creating in that list or board. The
 * regex covers what the library does not validate (it accepts 'a0 ', with a space) and
 * `generateKeyBetween` covers the structure (integer part, fraction without a trailing '0').
 */
export function isValidPositionKey(key: string): boolean {
  if (!POSITION_KEY_SHAPE.test(key)) return false;
  try {
    generateKeyBetween(key, null);
    return true;
  } catch {
    // The library throws on malformed keys: here that simply means "not valid".
    return false;
  }
}
