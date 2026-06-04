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

Ver `docs/drag-and-drop.md` para el uso desde la UI.
