@AGENTS.md

# Contexto del proyecto y decisiones

orgtable es un clon de Trello open-source y self-hosted (Next.js 16, Prisma 7,
PostgreSQL). Este archivo es el contexto operativo para agentes y contribuidores:
resume el estado, las convenciones y las decisiones tomadas en cada hito. Las
decisiones técnicas con su porqué completo están en `docs/decisions/` (ADRs); aquí va
el resumen de una línea con el enlace.

## Convenciones

- **Idioma**: el código, los comentarios y la documentación (`docs/`) van en español.
  Los mensajes de commit van en inglés y detallados.
- **Arquitectura**: Server Actions (`app/lib/actions/`) + Data Access Layer
  (`app/lib/dal.ts`) + Prisma. Toda mutación valida con zod, autoriza por el DAL y
  revalida la ruta. Ver `docs/architecture.md` y `docs/api/server-actions.md`.
- **Autorización**: el servidor es la única autoridad; la UI solo oculta controles.
  Ver `docs/authorization.md`.
- **Next.js 16 / Prisma 7**: hay cambios de ruptura respecto a versiones anteriores
  (ver `AGENTS.md`). `params`/`searchParams` son asíncronos; el middleware se llama
  `proxy.ts`; la URL de la BD va en `prisma.config.ts` + driver adapter, no en el
  esquema.

## Estado por hitos

Ver `docs/roadmap.md` para el detalle. Hitos 0–5 completados.

## Decisiones (resumen)

- ADR 0001 — Prisma como ORM.
- ADR 0002 — Fractional indexing para el orden de listas/tarjetas.
- ADR 0003 — Credenciales de BD en `.env`.
- ADR 0004 — Sin Redis en el MVP (entra con tiempo real / rate-limiting).
- ADR 0005 — Licencia AGPL-3.0.
- ADR 0006 — Autorización por rol con guardas explícitas (no `forbidden()`
  experimental). Roles de tablero OWNER/EDITOR/VIEWER en `app/lib/roles.ts`.
- ADR 0007 — PostgreSQL `LISTEN/NOTIFY` (no Redis) para el pub/sub del tiempo real.
- ADR 0008 — Tabla `Session` para revocación inmediata de sesiones.
- ADR 0009 — Rate limiting en memoria (sin Redis) para el login.
- ADR 0010 — Adjuntos en disco local (volumen), no S3.

## Notas de hito

- **Hito 3 (multiusuario)**: el esquema ya tenía `BoardMember`/`BoardRole`/`User.role`
  desde el Hito 0, así que no hizo falta migración. Se añadieron las guardas de rol en
  todas las acciones, el panel de miembros por tablero y `/admin/users` para la gestión
  de cuentas. No hay registro abierto: el admin crea las cuentas.
- **Hito 4 (tiempo real)**: SSE en `/api/boards/[id]/stream` + bus pub/sub
  (`app/lib/realtime/`). Toda mutación llama `revalidateBoard()` (revalida + publica).
  Sesiones respaldadas por la tabla `Session` (el JWT lleva `sid`); revocación inmediata.
  Migración `20260605100000_sessions` escrita a mano (no había BD local para
  `migrate dev`); aplicar con `prisma migrate deploy` (lo hace el entrypoint de Docker).
- **Hito 5 (operación)**: rate-limit del login (`app/lib/rate-limit.ts`, en memoria) +
  auditoría (`app/lib/audit.ts`, `/admin/audit`); adjuntos en disco
  (`app/lib/storage.ts`, volumen `/data/uploads`, descarga por route handler con
  autorización); export/import de tableros (JSON); scripts `scripts/{backup,restore,update}.sh`.
  Migraciones a mano: `..._audit_log` y `..._attachments`. Todas las migraciones
  escritas a mano se aplican con `migrate deploy`; al haber BD, `migrate dev` no detecta
  deriva porque coinciden esquema y SQL.
