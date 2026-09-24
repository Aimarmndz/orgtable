-- Collation "C" (orden byte a byte) para las claves de fractional indexing.
--
-- Por qué: las claves de `fractional-indexing` (alfabeto base62 0-9A-Za-z) solo están
-- bien ordenadas comparando byte a byte. Con la collation por defecto de la BD
-- (p. ej. en_US.utf8 sobre glibc: postgres Debian, Ubuntu, servicios gestionados),
-- `ORDER BY position` ignora mayúsculas en primera pasada y deja 'Zz' DESPUÉS de 'a0'.
-- Consecuencias sin este cambio: una tarjeta arrastrada al principio aparece al final
-- al refrescar, y createCard/createList (que buscan la última con ORDER BY ... DESC)
-- calculan la clave a partir de una vecina equivocada y generan claves repetidas.
-- En postgres alpine (musl) el orden ya era byte a byte, así que allí no cambia nada.
--
-- Prisma no modela la collation de una columna en PostgreSQL: el esquema sigue diciendo
-- `String` y `prisma migrate diff` no detecta deriva. Ver ADR 0002.
--
-- ALTER ... TYPE reescribe la columna y reconstruye los índices que la usan
-- (Card_listId_position_idx). No modifica los valores: las claves que ya estén
-- repetidas en instalaciones glibc siguen repetidas (ver ADR 0002, «Consecuencias»).

ALTER TABLE "List" ALTER COLUMN "position" TYPE TEXT COLLATE "C";
ALTER TABLE "Card" ALTER COLUMN "position" TYPE TEXT COLLATE "C";
ALTER TABLE "Checklist" ALTER COLUMN "position" TYPE TEXT COLLATE "C";
ALTER TABLE "ChecklistItem" ALTER COLUMN "position" TYPE TEXT COLLATE "C";

-- Reversión (manual; Prisma no genera migraciones «down»). Devuelve las columnas a la
-- collation por defecto de la BD sin tocar los valores:
--   ALTER TABLE "List" ALTER COLUMN "position" TYPE TEXT COLLATE "default";
--   ALTER TABLE "Card" ALTER COLUMN "position" TYPE TEXT COLLATE "default";
--   ALTER TABLE "Checklist" ALTER COLUMN "position" TYPE TEXT COLLATE "default";
--   ALTER TABLE "ChecklistItem" ALTER COLUMN "position" TYPE TEXT COLLATE "default";
