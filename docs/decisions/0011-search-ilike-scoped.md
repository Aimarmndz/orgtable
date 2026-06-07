# ADR 0011 — Búsqueda con ILIKE acotada en el servidor (sin motor de búsqueda)

**Estado:** aceptada · **Fecha:** 2026-06-07 · **Relacionada:** [ADR 0004](./0004-no-redis-mvp.md), [ADR 0006](./0006-rbac-explicit-guards.md)

## Contexto

El Hito 6 añade búsqueda global de tableros y tarjetas. Las opciones habituales van
desde un motor dedicado (Elasticsearch, Meilisearch, Typesense) hasta la búsqueda
full-text nativa de PostgreSQL (`tsvector`/`tsquery`, índices GIN) o una simple
coincidencia por subcadena (`ILIKE`).

## Decisión

Implementar la búsqueda como **coincidencia por subcadena insensible a mayúsculas
(`ILIKE`)** sobre `title`/`description`, expresada con Prisma (`contains` +
`mode: "insensitive"`), **acotada en el `WHERE`** a los tableros donde el usuario es
dueño o miembro. La consulta vive en `app/lib/queries.ts` (`searchForUser`).

## Justificación

- **Cero infraestructura.** Coherente con ADR 0004/0007/0009: una app self-hosted no
  debería exigir un servicio de búsqueda aparte ni un proceso de indexación.
- **Suficiente a la escala objetivo.** Una instancia self-hosted típica tiene miles,
  no millones, de tarjetas. `ILIKE '%term%'` resuelve en milisegundos a esa escala.
- **La autorización es parte de la consulta**, no un filtro posterior: el mismo patrón
  `OR: [{ ownerId }, { members: { some } }]` que ya usa `getBoardsForUser`. El servidor
  es la única autoridad (ADR 0006); es imposible que un resultado filtre datos de un
  tablero ajeno.
- **Sin estado derivado que mantener.** No hay índice que pueda quedar desincronizado
  con los datos: se busca directamente sobre la fuente de verdad.

## Consecuencias

- `ILIKE '%term%'` no usa un índice B-tree estándar (el comodín inicial lo impide), así
  que es un escaneo. Aceptable a la escala objetivo; si llegara a notarse, la vía de
  mejora natural es full-text de PostgreSQL (columna `tsvector` + índice GIN) **sin
  cambiar la interfaz** de `searchForUser`, o una extensión `pg_trgm` con índice GIN
  para acelerar el `ILIKE` tal cual.
- No hay ranking por relevancia ni tolerancia a erratas (fuzzy). Los resultados se
  ordenan por `updatedAt` (lo más reciente primero), que es un proxy razonable.
- La consulta mínima es de 2 caracteres para evitar escaneos de muy bajo valor.
- Documentado en [`docs/search.md`](../search.md).
