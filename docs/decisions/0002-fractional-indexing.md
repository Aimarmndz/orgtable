# ADR 0002 — Fractional indexing para el orden de listas y tarjetas

**Estado:** aceptada · **Fecha:** 2026-06-04

## Contexto

El núcleo de un tablero Kanban es reordenar listas y tarjetas con drag & drop. Cada
movimiento debe persistirse de forma eficiente y soportar reordenamientos frecuentes
sin degradarse.

Opciones evaluadas para la columna de orden:

1. **Entero/float `position`** (p. ej. `0.5` entre `0` y `1`): se queda sin precisión
   de coma flotante tras pocas inserciones repetidas en el mismo hueco, rompiendo el
   orden de forma silenciosa. O bien obliga a reindexar muchas filas por movimiento.
2. **LexoRank** (estilo Jira): robusto pero con lógica de rebalanceo compleja.
3. **Fractional indexing** (librería `fractional-indexing` de Figma, ~1 KB).

## Decisión

Usar **fractional indexing**. Las columnas `List.position` y `Card.position` son
`String` (clave lexicográfica). Para insertar/mover entre dos vecinas A y B se calcula
`generateKeyBetween(A.position, B.position)`; al final, `generateKeyBetween(last, null)`.

## Justificación

- **Un movimiento = un solo `UPDATE`** de la fila que se mueve. Nunca se tocan las
  vecinas, así que no hay tormentas de escritura ni reindexado.
- El orden es estable y se mantiene con una simple ordenación lexicográfica en SQL.
- Mover una tarjeta entre listas es el mismo `UPDATE` cambiando `listId` y `position`.

## Consecuencias

- Dos clientes concurrentes podrían generar la misma clave al mover al mismo punto
  exacto. En el MVP (un solo usuario) no aplica; cuando llegue el tiempo real
  (ver `docs/roadmap.md`) se regenerará la clave del "perdedor".
- **Collation "C" obligatoria** (añadido 2026-09-24). Las claves (base62 `0-9A-Za-z`)
  solo están bien ordenadas byte a byte. Con la collation por defecto de una BD glibc
  (`en_US.utf8` en la imagen Debian de postgres, Ubuntu o servicios gestionados)
  `ORDER BY position` deja `Zz` (lo que genera arrastrar al principio) después de `a0`:
  la tarjeta reaparece al final al refrescar y `createCard`/`createList`, que buscan la
  última con `ORDER BY position DESC`, generan claves repetidas. La migración
  `20260924000000_position_collate_c` fija `TEXT COLLATE "C"` en `List`, `Card`,
  `Checklist` y `ChecklistItem.position`. Prisma no modela la collation, así que el
  esquema sigue diciendo `String` y no aparece deriva; cualquier columna de posición
  nueva debe crearse con `COLLATE "C"` a mano en su migración. No se ordena en JS ni con
  `localeCompare`: el orden lo da la BD.
- La migración no reescribe valores. Las instalaciones que ya corrían sobre glibc pueden
  tener claves repetidas; se detectan con
  `SELECT "listId", position, count(*) FROM "Card" GROUP BY 1, 2 HAVING count(*) > 1`
  (y lo mismo con `"boardId"` en `"List"`). Reasignarlas es decisión del propietario de
  la instalación, con copia de seguridad previa (`scripts/backup.sh`).

Ver `docs/drag-and-drop.md` para el uso desde la UI.
