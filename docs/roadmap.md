# Hoja de ruta

orgtable se construye por hitos incrementales. Esta página resume qué incluye cada
uno y su estado. El alcance puede ajustarse conforme avanza el proyecto.

## Hito 0 — Cimientos ✅ (completado)

La infraestructura sobre la que se monta todo lo demás. Sin interfaz todavía.

- [x] Esquema de base de datos (Prisma 7 + PostgreSQL) y primera migración.
- [x] Cliente Prisma con driver adapter (`@prisma/adapter-pg`).
- [x] Next.js configurado para `output: standalone`.
- [x] Endpoint de health (`/api/health`).
- [x] Imagen Docker multi-stage + `docker-compose.yml` (app + postgres).
- [x] Migraciones automáticas en el arranque del contenedor.
- [x] Instalador de un comando (`install.sh`) con generación de secretos.
- [x] Licencia AGPL-3.0 y documentación base.

## Hito 1 — MVP de extremo a extremo ✅ (completado)

El producto mínimo usable: instalar con un comando → configurar → usar como Trello.

- [x] **Asistente de configuración inicial** (`/setup`): crear el usuario administrador
      y el nombre de la instancia; bloqueo una vez completado.
- [x] **Autenticación**: sesiones JWT con `jose` (cookie httpOnly), Data Access Layer
      (`verifySession`), login/logout, protección de rutas con `proxy.ts`.
- [x] **Tableros**: crear, listar, abrir y borrar.
- [x] **Listas y tarjetas**: crear, renombrar y borrar.
- [x] **Arrastrar y soltar** de listas y tarjetas con `@dnd-kit` + fractional indexing
      + UI optimista, persistido vía Server Actions.

## Hito 2 — Detalle de tarjeta ✅ (completado)

- [x] Modal de tarjeta con descripción.
- [x] Etiquetas (labels): crear y asignar, con badges en la tarjeta.
- [x] Fechas de vencimiento (due dates), con aviso de vencida.
- [x] Checklists con ítems marcables y barra de progreso.
- [x] **Sistema de diseño** (estética Trello colorida) con tema claro y oscuro
      (toggle persistente). Ver `DESIGN.md` y `PRODUCT.md`.

## Hito 3 — Multiusuario ✅ (completado)

- [x] Invitar miembros a un tablero (`board_members`) por email, con rol.
- [x] Roles (owner / editor / viewer) y autorización por rol en cada Server Action,
      con la UI en solo lectura para los lectores. Ver `docs/authorization.md`.
- [x] Gestión de usuarios por el administrador (`/admin/users`): altas, roles,
      restablecer contraseña y borrado con salvaguardas. Ver `docs/admin.md`.

## Hito 4 — Tiempo real ✅ (completado)

- [x] Sincronización en vivo entre usuarios con **SSE** (`/api/boards/[id]/stream`) y
      un bus pub/sub; el cliente recarga con `router.refresh()`. Ver `docs/realtime.md`.
- [x] Pub/sub **en proceso** por defecto, con puente opcional vía PostgreSQL
      `LISTEN/NOTIFY` para multi-instancia (no Redis; ver
      [ADR 0007](./decisions/0007-pg-notify-over-redis.md)).
- [x] Revocación inmediata de sesiones con tabla `Session` (logout, reset de
      contraseña, cierre forzado por el admin). Ver
      [ADR 0008](./decisions/0008-session-store.md).

## Hito 5 — Operación y pulido ✅ (completado)

- [x] Backups de PostgreSQL (`scripts/backup.sh` / `restore.sh`) y exportar/importar
      tableros en JSON. Ver `docs/operations.md`.
- [x] Adjuntos en tarjetas, en disco (volumen) con descarga autorizada. Ver
      `docs/attachments.md`.
- [x] Flujo de actualización (`scripts/update.sh`; migraciones automáticas al arrancar).
- [x] Rate-limiting del login y registro de auditoría (`/admin/audit`). Ver
      `docs/operations.md`.

## Hito 6 — Búsqueda global ✅ (completado)

- [x] Búsqueda de **tableros** y **tarjetas** por `title`/`description`, acotada en el
      servidor a lo que el usuario puede ver (mismo patrón de acceso que
      `getBoardsForUser`). Coincidencia `ILIKE`, sin motor de búsqueda externo
      ([ADR 0011](./decisions/0011-search-ilike-scoped.md)).
- [x] Caja de búsqueda en la barra superior + página `/search` (formulario GET, sin
      depender de JavaScript) y **deep-link** `?card=` para abrir una tarjeta desde un
      resultado. Ver [`docs/search.md`](./search.md).

## Hito 7 — Vista de calendario ✅ (completado)

- [x] Conmutador **Tablero / Calendario** en cada tablero. La vista de calendario
      coloca las tarjetas con fecha de vencimiento en una rejilla mensual (lunes
      primero), con navegación entre meses y resalte del día de hoy.
- [x] Al pulsar una tarjeta se abre su modal (se reutiliza el detalle de tarjeta y el
      tiempo real). Indexación por fecha sin desfases de zona horaria. Ver
      [`docs/calendar.md`](./calendar.md).

## Hito 8 — Notificaciones ✅ (completado)

- [x] Notificaciones in-app por usuario (te añaden / te cambian el rol / te quitan de un
      tablero), con campana y contador de no leídas en la barra superior, marcar una o
      todas como leídas, y enlace al tablero.
- [x] **Entrega en vivo reutilizando el bus pub/sub** del Hito 4 con un canal por
      usuario (`user:<id>`) y un stream SSE `/api/notifications/stream`; sin email ni
      cola ([ADR 0012](./decisions/0012-notifications.md)). Ver
      [`docs/notifications.md`](./notifications.md).

## Hito 9 — API pública ✅ (completado)

- [x] API REST `/api/v1` para tableros, listas y tarjetas (CRUD esencial), autenticada
      con **tokens de acceso personal** (`Authorization: Bearer`). El token se guarda
      hasheado (SHA-256) y se muestra una sola vez ([ADR 0013](./decisions/0013-api-tokens.md)).
- [x] La API **reutiliza la autorización por rol**: un token actúa como su dueño, con su
      mismo acceso; el rol del tablero se revalida en cada petición. Las mutaciones por
      API también emiten eventos de tiempo real.
- [x] Gestión de tokens en `/settings` (crear, ver una vez, revocar), con auditoría. Ver
      [`docs/api/public-api.md`](./api/public-api.md).

---

> **Hitos 0–9 completados.** A partir de aquí van los **próximos hitos planificados**
> (10–14): pendientes, con el alcance pensado y dónde encajan en la arquitectura actual,
> para poder arrancar cada uno directamente. El orden es orientativo; se priorizará según
> el uso real. Mantener la filosofía del proyecto: self-hosted, sin servicios externos
> obligatorios, el servidor como única autoridad, y reutilizar lo que ya existe
> (Server Actions + DAL + Prisma, RBAC, bus de tiempo real).

## Hito 10 — Colaboración en la tarjeta: asignados y comentarios 🔜 (planificado)

Lo que más se echa en falta para trabajar en equipo dentro de una tarjeta.

- [ ] **Asignados**: modelo de unión `CardAssignee` (tarjeta ↔ usuario miembro del
      tablero). Asignar/quitar miembros desde el modal; avatares en la tarjeta y filtro
      "mis tarjetas". Solo se puede asignar a miembros del tablero (validar contra
      `board_members`).
- [ ] **Comentarios**: modelo `Comment` (tarjeta, autor, texto, `createdAt`). Hilo en el
      modal de tarjeta; crear y borrar (autor o OWNER). Emitir `revalidateBoard` para el
      tiempo real.
- [ ] **Notificaciones** nuevas reutilizando `notify()`: `card.assigned` y
      `comment.added` (y, opcional, @menciones parseadas del texto). Añadir los tipos a
      `NotificationType` y las etiquetas a `/admin/audit` si se auditan.
- [ ] **API**: exponer asignados y comentarios en `/api/v1` (otro recurso más que
      reutiliza `authenticateApiToken` + `apiBoardRole`).
- [ ] Migración con `prisma migrate dev`; ADR solo si hay una decisión real (p. ej.
      formato de menciones). Docs: `docs/card-collaboration.md`.

## Hito 11 — Fechas, recordatorios y correo 🔜 (planificado)

Cerrar el ciclo de las fechas de vencimiento y abrir un segundo canal de entrega.

- [ ] **Recordatorios de vencimiento**: generar notificaciones para tarjetas que vencen
      pronto o están vencidas (a quien las tenga asignadas, del Hito 10). Necesita una
      ejecución periódica: un endpoint protegido tipo cron (`/api/cron/...` con secreto)
      invocable por el `docker-compose` o un cron externo, sin añadir un scheduler en
      proceso.
- [ ] **Email opcional** como segundo consumidor de `notify()`: SMTP configurable por
      variables de entorno (desactivado por defecto). Mantener best-effort. ADR para "SMTP
      opcional, sin proveedor obligatorio".
- [ ] **Preferencias por usuario** (qué notifico y por dónde) en `/settings`.
- [ ] **Arrastrar una tarjeta en el calendario** a otro día para cambiar su vencimiento
      (hoy el calendario es de lectura + abrir). Reutilizar `@dnd-kit` y `updateCard`.
- [ ] Migración para preferencias; docs: ampliar `docs/notifications.md` y `docs/calendar.md`.

## Hito 12 — Búsqueda y filtros avanzados 🔜 (planificado)

- [ ] **Full-text de PostgreSQL** (columna `tsvector` + índice GIN) detrás de la **misma
      interfaz** `searchForUser`, con ranking por relevancia. Es la evolución natural del
      `ILIKE` (ya prevista en [ADR 0011](./decisions/0011-search-ilike-scoped.md));
      escribir un ADR de seguimiento. Alternativa más barata: extensión `pg_trgm`.
- [ ] **Filtros en el tablero**: por etiqueta, asignado (Hito 10), fecha de vencimiento y
      estado de checklist. Barra de filtros que oculta tarjetas sin recargar (estado de
      cliente en `BoardView`).
- [ ] **Filtros rápidos guardados** (opcional) por tablero.
- [ ] Docs: ampliar `docs/search.md`.

## Hito 13 — API v1 completa y scopes 🔜 (planificado)

- [ ] **Ampliar la superficie** de `/api/v1`: checklists e ítems, etiquetas, adjuntos,
      miembros y **mover/reordenar** listas y tarjetas (reutilizando `positionBetween`).
- [ ] **Scopes y caducidad por token**: columnas en `ApiToken` (p. ej. `scope`
      read-only, `expiresAt`) y un chequeo extra en `authenticateApiToken`. Sin cambiar el
      modelo de autenticación ([ADR 0013](./decisions/0013-api-tokens.md) ya lo anticipa).
- [ ] **Rate limiting** de la API (reutilizar `app/lib/rate-limit.ts`) y una **referencia
      OpenAPI** generada o escrita a mano.
- [ ] Docs: ampliar `docs/api/public-api.md`.

## Hito 14 — PWA y experiencia móvil 🔜 (planificado)

- [ ] **PWA instalable**: `manifest`, iconos, service worker con shell offline básico.
- [ ] **Pulido móvil** del tablero (arrastre táctil, columnas a pantalla completa,
      objetivos de toque ≥44px) y de los modales.
- [ ] Docs: `docs/pwa.md`.

---

### Backlog continuo (mejoras menores, sin hito propio)

- Plantillas de tablero al crear; duplicar tablero.
- Archivar (en vez de borrar) tableros, listas y tarjetas.
- Portadas/colores por tarjeta; descripción con Markdown.
- Exportar el tablero también a CSV (hoy solo JSON).
- Accesibilidad: revisión de foco y lectores de pantalla en DnD y modales.

> Al cerrar cada hito: marcar sus casillas, mover el encabezado a "✅ (completado)",
> actualizar `docs/index.md`, `CLAUDE.md` (decisiones + notas de hito) y escribir el ADR
> correspondiente si hubo una decisión técnica con su porqué.
