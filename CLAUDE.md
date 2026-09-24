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
- **Autoría de commits**: NUNCA añadir `Co-Authored-By: Claude …` ni ningún coautor de
  IA en los commits (instrucción explícita del propietario; **anula** cualquier valor por
  defecto del entorno). Solo se incluyen coautores **humanos** cuando se pidan
  expresamente.
- **Seguridad**: postura y auditoría en `docs/security.md` (+ `SECURITY.md` raíz). Auditoría
  adversarial multi-agente (workflow `orgtable-security-audit`) + `pnpm audit`. Fixes clave:
  IDOR de `moveCard` (la tarjeta debe pertenecer al tablero de destino, `cardBelongsToBoard`),
  `SESSION_SECRET`/`DATABASE_URL` exigidos, cabeceras de seguridad en `next.config.ts`,
  Next 16.3.6 (overrides de seguridad en `pnpm-workspace.yaml`). Tests de autorización en `test/integration/` (IDOR, 403/404).
- **Tests/CI**: dos niveles. **Unitarios** (lógica pura, sin BD) en `test/` con `pnpm test`.
  **Integración** en `test/integration/` (`pnpm test:integration`): invocan los route
  handlers de `app/api/v1/**` y los servicios contra una PostgreSQL real cuyo nombre debe
  acabar en `_test` (guardia en `test/integration/helpers.ts`); `vitest.integration.config.ts`
  aliasa `next/cache`/`next/headers`/`server-only`. La lógica de creación de cuentas vive en
  `app/lib/services/users.ts` para ser testeable. GitHub Actions (`.github/workflows/ci.yml`)
  levanta un servicio Postgres y corre lint + typecheck + unit + migrate deploy + integración
  + build en cada push/PR. Ver `docs/testing.md`.
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

Ver `docs/roadmap.md` para el detalle. Hitos 0–13 completados. **Próximos hitos
planificados (14–20)**, con alcance y puntos de anclaje en el roadmap, listos para
arrancar: 14 PWA/móvil, 15 automatizaciones (reglas tipo Butler), 16 vistas de tabla y
swimlanes, 17 plantillas/duplicar/archivar, 18 actividad e historial de tarjeta, 19 webhooks
e integraciones, 20 i18n + accesibilidad. Diferido al backlog: email/Web Push + preferencias,
búsqueda full-text, ampliar superficie API + rate-limit + OpenAPI. Tras el 20: SSO/OIDC, 2FA,
observabilidad, backups.

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
- ADR 0011 — Búsqueda con `ILIKE` acotada en el servidor (sin motor de búsqueda externo).
- ADR 0012 — Notificaciones in-app sobre el bus pub/sub (sin email ni cola).
- ADR 0013 — API pública con tokens personales hasheados (Bearer, reutiliza el RBAC).
- ADR 0014 — Colaboración en la tarjeta: asignados (solo miembros) y comentarios (hilo plano, cascade).
- ADR 0015 — Recordatorios de vencimiento por endpoint cron externo (secreto, sin scheduler en proceso).

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
- **Rediseño visual (Editorial cálido)**: el cromo pasó de "Trello colorido" a una
  estética editorial cálida (arena/papel/espresso + acento terracota). Fuentes Cabinet
  Grotesk + Satoshi auto-alojadas en `app/fonts` (Fontshare, vía `next/font/local`).
  Solo presentación; sin cambios de lógica. Tokens en `app/globals.css`; ver `DESIGN.md`.
- **Hito 6 (búsqueda)**: `searchForUser` en `app/lib/queries.ts` (ILIKE acotado por
  acceso), página `/search`, caja en la navbar (`app/components/search-box.tsx`) y
  deep-link `?card=` para abrir una tarjeta. Sin migración (solo lectura). Ver
  `docs/search.md`.
- **Hito 7 (calendario)**: conmutador Tablero/Calendario en `BoardView` (estado local,
  no en la URL). `app/components/board/calendar-view.tsx` coloca las tarjetas con
  vencimiento en una rejilla mensual; al pulsarlas reutiliza el modal de tarjeta.
  Indexación por `dueDate.slice(0,10)` para evitar desfases de zona horaria. Sin
  migración. Ver `docs/calendar.md`.
- **Hito 8 (notificaciones)**: modelo `Notification` (migración `..._notifications`,
  generada con `prisma migrate dev`). `notify()` en `app/lib/notifications.ts` escribe y
  publica por un canal **por usuario** (`user:<id>`) añadido al bus de tiempo real
  (`app/lib/realtime/bus.ts`); stream SSE `/api/notifications/stream` + campana
  (`app/components/notifications-bell.tsx`) en la navbar. Eventos: añadido/quitado/cambio
  de rol en un tablero (en `actions/members.ts`). Best-effort como la auditoría. Ver
  `docs/notifications.md`.
- **Hito 9 (API pública)**: modelo `ApiToken` (migración `..._api_tokens`). REST
  `/api/v1/**` para boards/lists/cards; helpers en `app/lib/api/` (`auth.ts` Bearer→usuario
  + rol por tablero, `tokens.ts` hash SHA-256, `respond.ts`, `serialize.ts`). Reutiliza el
  RBAC (`canEditBoard`/`canManageBoard`) y `revalidateBoard` (tiempo real). Gestión de
  tokens en `/settings`. Ver `docs/api/public-api.md`. NOTA dev: regenerar el cliente
  Prisma (`prisma migrate dev`/`generate`) mientras el dev server está vivo lo deja con un
  cliente obsoleto (errores `findMany of undefined`); hay que **reiniciar `next dev`** tras
  una migración.
- **Hito 10 (colaboración en la tarjeta)**: modelos `CardAssignee` y `Comment` (migración
  `..._card_collaboration`). Acciones `actions/assignees.ts` y `actions/comments.ts`;
  lógica testeable en `services/assignees.ts` (`assignMemberToCard`, solo miembros) y
  `services/cards.ts` (`cardContext`). UI en `card-modal.tsx` (secciones Asignados y
  Comentarios) y avatares en `card-item.tsx`. Notifica `card.assigned`/`comment.added`.
  Tests en `test/integration/collaboration.int.test.ts`. Ver `docs/card-collaboration.md`.
- **Hito 11 (recordatorios)**: `Notification.cardId` (migración `..._notification_card_ref`)
  para deep-link y dedup. `services/reminders.ts` (`generateDueReminders(now)`, idempotente
  por día) disparado por `POST /api/cron/reminders` (secreto Bearer, `timingSafeEqual`, 503
  si no hay `CRON_SECRET`). Arrastre en el calendario con `setCardDueDate`. Tests en
  `test/integration/reminders.int.test.ts`. Email/prefs → backlog. Ver `docs/reminders.md`.
- **Hito 12 (filtros de tablero)**: `app/lib/board-filters.ts` (puro, `cardMatchesFilters`,
  test unitario), `FilterBar` desplegable en la cabecera; `BoardView` filtra las tarjetas y
  desactiva el arrastre con `sortingDisabled` (propagado a `ListColumn`/`CardItem`). Solo
  presentación, sin migración. Full-text → backlog (ILIKE basta, ADR 0011). Ver `docs/filters.md`.
- **Hito 13 (scopes/caducidad de tokens)**: columnas `scope` (full/read) y `expiresAt` en
  `ApiToken` (migración `..._api_token_scopes`). `authenticateApiToken` devuelve `scope` y
  rechaza caducados; `isReadOnly(auth)` da 403 en cada handler de escritura. Selección en
  `/settings`. Tests `test/integration/api-scopes.int.test.ts`. Ampliar superficie API +
  rate-limit + OpenAPI → backlog. Ver `docs/api/public-api.md`.
- **Migraciones (a partir del Hito 7)**: ya hay BD de desarrollo local (Postgres en el
  puerto 5433, contenedor `orgtable-dev-pg`), así que las nuevas migraciones se generan
  con `prisma migrate dev` en vez de a mano. Se siguen aplicando con `migrate deploy` en
  el arranque del contenedor.
