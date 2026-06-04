# ADR 0001 — Prisma como ORM

**Estado:** aceptada · **Fecha:** 2026-06-04

## Contexto

orgtable necesita una capa de acceso a datos sobre PostgreSQL que sea cómoda para
contribuidores, con migraciones versionadas y buena integración con TypeScript y
Next.js 16 (empaquetado en Docker con `output: standalone`).

Se evaluaron **Prisma** y **Drizzle ORM**.

## Decisión

Usar **Prisma 7** con el driver adapter `@prisma/adapter-pg` sobre `pg` (node-postgres).

## Justificación

- Prisma es el ORM más popular del ecosistema, con la mejor experiencia "out of the
  box" para quien no domina SQL: esquema declarativo, tipos generados y migraciones
  guiadas (`migrate dev`). Esto baja la barrera de entrada para contribuidores.
- Prisma 7 cambió su arquitectura de forma favorable para self-hosting:
  - El **query engine es WASM** (no un binario de Rust), así que el cliente se
    empaqueta limpio en la imagen Docker sin copiar engines por plataforma.
  - La conexión directa se hace con un **driver adapter** (`PrismaPg`), lo que da
    control explícito sobre el pool de `pg`.
- Las migraciones (`prisma migrate deploy`) son idempotentes y encajan con el
  arranque del contenedor.

## Consecuencias

- La URL de conexión ya **no** vive en `schema.prisma` (Prisma 7 lo prohíbe): va en
  `prisma.config.ts` para el CLI, y en runtime se pasa vía el adapter.
- `prisma.config.ts` debe cargar `.env` manualmente (`process.loadEnvFile()`), porque
  Prisma 7 ya no lo hace automáticamente.
- Trade-off aceptado: Drizzle generaría imágenes algo más pequeñas y SQL más
  transparente, pero Prisma gana en DX para el público objetivo del proyecto.

Ver `docs/database.md` para el detalle de la implementación.
